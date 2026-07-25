/**
 * Regression tests for issue #781:
 * ClawdbotAgentService.reconcileRunningAttempts() must detect persisted running
 * attempts after a server restart and move legacy runs into an actionable blocked state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RunRecoveryRecord, Task, TaskAttempt } from '@veritas-kanban/shared';
import { providerRuntimeManifestFixture } from '../fixtures/provider-runtime-manifest.js';
import {
  TaskEnvelopeService,
  type CompletionEvidenceSource,
} from '../../services/task-envelope-service.js';
import { ProviderCompletionService } from '../../services/provider-completion-service.js';
import { RunRecoveryPolicyService } from '../../services/run-recovery-policy-service.js';

// ─── Mocks ────────────────────────────────────────────────────────────────

// Provide a stub for the shared package so transitive imports resolve
vi.mock('@veritas-kanban/shared', async (importOriginal) => {
  try {
    return await importOriginal();
  } catch {
    // Package not built — return minimal stubs used by clawdbot-agent-service
    return {
      evaluateTaskReadiness: vi.fn().mockReturnValue({ isReady: true, reasons: [] }),
      DEFAULT_ROUTING_CONFIG: { agents: [] },
      DEFAULT_FEATURE_SETTINGS: {},
      ZERO_AGENT_BUDGET_USAGE: { tokens: 0, cost: 0 },
    };
  }
});

const mockListTasks = vi.fn<[], Promise<Task[]>>();
const mockGetTask = vi.fn<[string], Promise<Task | null>>();
const mockUpdateTask = vi.fn<
  [string, Partial<Task> & { expectedRevision?: number }],
  Promise<Task>
>();

vi.mock('../../services/task-service.js', () => ({
  TaskService: class MockTaskService {
    listTasks = mockListTasks;
    getTask = mockGetTask;
    updateTask = mockUpdateTask;
  },
}));

vi.mock('../../services/config-service.js', () => {
  class MockConfigService {
    getConfig = vi.fn().mockResolvedValue({ agents: [], features: {} });
    getFeatureSettings = vi.fn().mockResolvedValue({});
    dispose = vi.fn();
  }
  return {
    ConfigService: MockConfigService,
    getConfigService: () => new MockConfigService(),
  };
});

vi.mock('../../services/agent-health-service.js', () => ({
  AgentHealthService: class MockAgentHealthService {
    checkHealth = vi.fn().mockResolvedValue(true);
  },
}));

vi.mock('../../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/paths.js')>();
  return {
    ...actual,
    getRuntimeDir: () => '/tmp/test-veritas-kanban',
    getLogsDir: () => '/tmp/test-veritas-kanban/logs',
  };
});

vi.mock('../../storage/fs-helpers.js', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

// Import the service under test AFTER mocks are in place
const { ClawdbotAgentService } = await import('../../services/clawdbot-agent-service.js');

// ─── Helper ───────────────────────────────────────────────────────────────

function makeTask(id: string, attemptStatus: TaskAttempt['status'] | null): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'in-progress',
    type: 'code',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    attempt: attemptStatus
      ? ({
          id: `attempt_${id}`,
          agent: 'openclaw',
          status: attemptStatus,
          started: new Date().toISOString(),
          provider: 'openclaw',
        } as TaskAttempt)
      : undefined,
  } as Task;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ClawdbotAgentService.reconcileRunningAttempts (issue #781)', () => {
  let service: InstanceType<typeof ClawdbotAgentService>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Construct a new instance for each test (avoids shared state)
    service = new ClawdbotAgentService();
    mockUpdateTask.mockResolvedValue({} as Task);
  });

  it('marks legacy orphaned attempts failed and blocks unsafe automatic restart', async () => {
    const runningTask = makeTask('task-running-1', 'running'); // status: 'in-progress'
    mockListTasks.mockResolvedValue([runningTask]);

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    const [calledId, update] = mockUpdateTask.mock.calls[0];
    expect(calledId).toBe('task-running-1');
    expect(update.status).toBe('blocked');
    expect(update.attempt?.status).toBe('failed');
    expect(update.attempt?.ended).toBeDefined();
    const ended = update.attempt?.ended;
    expect(ended).toBeDefined();
    // ended should be a valid ISO timestamp
    if (ended) {
      expect(Number.isNaN(new Date(ended).getTime())).toBe(false);
    }
  });

  it('does not reset task status for non-in-progress tasks with stale running attempts', async () => {
    // Task was moved to 'blocked' by a human but still has a stale running attempt
    const blockedTask: Task = {
      ...makeTask('task-blocked', 'running'),
      status: 'blocked',
    } as Task;
    mockListTasks.mockResolvedValue([blockedTask]);

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
    const [, update] = mockUpdateTask.mock.calls[0];
    // Task status should NOT be overridden when already non-in-progress
    expect(update.status).toBeUndefined();
    expect(update.attempt?.status).toBe('failed');
  });

  it('does not touch tasks whose attempt status is not running', async () => {
    const tasks = [
      makeTask('task-done', 'complete'),
      makeTask('task-failed', 'failed'),
      makeTask('task-no-attempt', null),
    ];
    mockListTasks.mockResolvedValue(tasks);

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('reconciles multiple orphaned attempts in one pass', async () => {
    const tasks = [
      makeTask('task-running-a', 'running'),
      makeTask('task-running-b', 'running'),
      makeTask('task-done-c', 'complete'),
    ];
    mockListTasks.mockResolvedValue(tasks);

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).toHaveBeenCalledTimes(2);
    const updatedIds = mockUpdateTask.mock.calls.map(([id]) => id).sort();
    expect(updatedIds).toEqual(['task-running-a', 'task-running-b']);
  });

  it('does not fail if listTasks throws — logs and returns', async () => {
    mockListTasks.mockRejectedValue(new Error('storage unavailable'));

    await expect(service.reconcileRunningAttempts()).resolves.not.toThrow();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('continues reconciling remaining tasks when one updateTask fails', async () => {
    const tasks = [
      makeTask('task-fail-update', 'running'),
      makeTask('task-success-update', 'running'),
    ];
    mockListTasks.mockResolvedValue(tasks);
    mockUpdateTask
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({} as Task);

    await expect(service.reconcileRunningAttempts()).resolves.not.toThrow();
    expect(mockUpdateTask).toHaveBeenCalledTimes(2);
  });

  it('preserves all existing attempt fields when updating status to failed', async () => {
    const agent = 'openclaw';
    const model = 'gpt-5.3-codex';
    const task = {
      ...makeTask('task-with-model', 'running'),
    };
    (task.attempt as TaskAttempt).model = model;
    (task.attempt as TaskAttempt).agent = agent;
    mockListTasks.mockResolvedValue([task]);

    await service.reconcileRunningAttempts();

    const [, update] = mockUpdateTask.mock.calls[0];
    expect(update.attempt?.agent).toBe(agent);
    expect(update.attempt?.model).toBe(model);
    expect(update.attempt?.status).toBe('failed');
  });

  it('persists an interrupted completion result for a current provider attempt after restart', async () => {
    const completedAt = '2026-07-23T18:00:00.000Z';
    const evidence: CompletionEvidenceSource = {
      captureLaunchBaseline: async (_worktreePath, capturedAt) => ({
        capturedAt,
        headSha: 'a'.repeat(40),
        dirty: false,
        files: [],
      }),
      captureCompletionEvidence: async ({ taskEnvelope, capturedAt }) => ({
        capturedAt,
        headSha: taskEnvelope.workspace.baseline.headSha,
        changedFiles: [],
        commits: [],
        artifacts: [],
        verification: [],
        sideEffects: [],
      }),
    };
    const envelopes = new TaskEnvelopeService(evidence);
    const providerRuntimeManifest = providerRuntimeManifestFixture({
      provider: 'codex-cli',
      adapter: 'codex-cli',
    });
    const runningTask = {
      ...makeTask('task-current-running', 'running'),
      revision: 4,
      verificationSteps: [],
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'feat/provider-completion',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-provider-completion',
      },
    } as Task;
    const runningAttempt = runningTask.attempt;
    const worktreePath = runningTask.git?.worktreePath;
    if (!runningAttempt || !worktreePath) throw new Error('Expected a runnable task fixture');
    const taskEnvelope = await envelopes.build({
      task: runningTask,
      attemptId: runningAttempt.id,
      createdAt: '2026-07-23T17:00:00.000Z',
      worktreePath,
      providerRuntimeManifest,
      commitPolicy: 'allowed',
    });
    runningTask.attempt = {
      ...runningAttempt,
      provider: 'codex-cli',
      providerRuntimeManifest,
      taskEnvelope,
    };
    runningTask.attempts = [runningTask.attempt];
    mockListTasks.mockResolvedValue([runningTask]);
    let persistedTask = runningTask;
    let raced = false;
    mockGetTask.mockImplementation(async () => persistedTask);
    mockUpdateTask.mockImplementation(async (_id, update) => {
      if (!raced) {
        raced = true;
        persistedTask = { ...persistedTask, revision: 5, priority: 'high' };
        throw Object.assign(new Error('concurrent task mutation'), { statusCode: 409 });
      }
      persistedTask = {
        ...persistedTask,
        ...update,
        revision: (persistedTask.revision ?? 1) + 1,
      } as Task;
      return persistedTask;
    });
    service = new ClawdbotAgentService(
      undefined,
      undefined,
      envelopes,
      undefined,
      new ProviderCompletionService(evidence, () => completedAt)
    );

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).toHaveBeenLastCalledWith(
      runningTask.id,
      expect.objectContaining({
        expectedRevision: 5,
        status: 'in-progress',
        attempt: expect.objectContaining({
          id: runningTask.attempt.id,
          status: 'failed',
          completionResult: expect.objectContaining({
            status: 'interrupted',
            terminalSource: 'operator-interruption',
            completedAt,
            taskEnvelopeDigest: taskEnvelope.digest,
          }),
        }),
      })
    );
    expect(mockUpdateTask.mock.calls.map(([, update]) => update.expectedRevision)).toEqual([4, 5]);
    expect(persistedTask.priority).toBe('high');
    const completionResult = mockUpdateTask.mock.calls[1]?.[1].attempt?.completionResult;
    expect(completionResult?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(completionResult?.idempotencyKey).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('interrupts a callback-era OpenClaw attempt without durable supervisor bindings', async () => {
    const evidence: CompletionEvidenceSource = {
      captureLaunchBaseline: async (_worktreePath, capturedAt) => ({
        capturedAt,
        headSha: 'a'.repeat(40),
        dirty: false,
        files: [],
      }),
      captureCompletionEvidence: async ({ taskEnvelope, capturedAt }) => ({
        capturedAt,
        headSha: taskEnvelope.workspace.baseline.headSha,
        changedFiles: [],
        commits: [],
        artifacts: [],
        verification: [],
        sideEffects: [],
      }),
    };
    const envelopes = new TaskEnvelopeService(evidence);
    const providerRuntimeManifest = providerRuntimeManifestFixture({
      provider: 'openclaw',
      adapter: 'openclaw',
    });
    const runningTask = {
      ...makeTask('task-openclaw-callback', 'running'),
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'feat/provider-completion',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-provider-completion',
      },
      verificationSteps: [],
    } as Task;
    const runningAttempt = runningTask.attempt;
    if (!runningAttempt) throw new Error('Expected a running attempt fixture');
    const taskEnvelope = await envelopes.build({
      task: runningTask,
      attemptId: runningAttempt.id,
      createdAt: '2026-07-23T17:00:00.000Z',
      worktreePath: runningTask.git?.worktreePath ?? '/tmp/veritas-provider-completion',
      providerRuntimeManifest,
      commitPolicy: 'allowed',
    });
    runningTask.attempt = {
      ...runningAttempt,
      provider: 'openclaw',
      providerRuntimeManifest,
      taskEnvelope,
    };
    mockListTasks.mockResolvedValue([runningTask]);
    service = new ClawdbotAgentService(
      undefined,
      undefined,
      envelopes,
      undefined,
      new ProviderCompletionService(evidence)
    );

    await service.reconcileRunningAttempts();

    expect(mockUpdateTask).toHaveBeenCalledWith(
      runningTask.id,
      expect.objectContaining({
        status: 'in-progress',
        attempt: expect.objectContaining({
          id: runningAttempt.id,
          status: 'failed',
          completionResult: expect.objectContaining({
            status: 'interrupted',
            terminalSource: 'operator-interruption',
            summary:
              'Legacy running attempt has no durable supervisor bindings and cannot be recovered safely.',
          }),
        }),
      })
    );
  });

  it('plans retry policy for a failed supervisor completion discovered after restart', async () => {
    const completedAt = '2026-07-23T18:30:00.000Z';
    const evidence: CompletionEvidenceSource = {
      captureLaunchBaseline: async (_worktreePath, capturedAt) => ({
        capturedAt,
        headSha: 'a'.repeat(40),
        dirty: false,
        files: [],
      }),
      captureCompletionEvidence: async ({ taskEnvelope, capturedAt }) => ({
        capturedAt,
        headSha: taskEnvelope.workspace.baseline.headSha,
        changedFiles: [],
        commits: [],
        artifacts: [],
        verification: [],
        sideEffects: [],
      }),
    };
    const envelopes = new TaskEnvelopeService(evidence);
    const completions = new ProviderCompletionService(evidence, () => completedAt);
    const providerRuntimeManifest = providerRuntimeManifestFixture({
      provider: 'codex-cli',
      adapter: 'codex-cli',
    });
    let currentTask = {
      ...makeTask('task-supervisor-failure', 'running'),
      revision: 1,
      verificationSteps: [],
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'feat/recovery',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-supervisor-recovery',
      },
    } as Task;
    const runningAttempt = currentTask.attempt;
    if (!runningAttempt) throw new Error('Expected a running attempt fixture');
    const taskEnvelope = await envelopes.build({
      task: currentTask,
      attemptId: runningAttempt.id,
      createdAt: '2026-07-23T17:00:00.000Z',
      worktreePath: currentTask.git?.worktreePath ?? '/tmp/veritas-supervisor-recovery',
      providerRuntimeManifest,
      commitPolicy: 'allowed',
    });
    currentTask.attempt = {
      ...runningAttempt,
      provider: 'codex-cli',
      providerRuntimeManifest,
      taskEnvelope,
    };
    currentTask.attempts = [currentTask.attempt];
    const completionResult = await completions.complete({
      task: currentTask,
      taskEnvelope,
      claim: {
        terminalSource: 'process',
        status: 'failed',
        summary: 'ECONNRESET after restart',
        error: 'ECONNRESET after restart',
      },
    });
    mockGetTask.mockImplementation(async () => currentTask);
    mockUpdateTask.mockImplementation(async (_id, update) => {
      if (
        update.expectedRevision !== undefined &&
        update.expectedRevision !== (currentTask.revision ?? 1)
      ) {
        throw Object.assign(new Error('stale revision'), { statusCode: 409 });
      }
      currentTask = {
        ...currentTask,
        ...update,
        revision: (currentTask.revision ?? 1) + 1,
      } as Task;
      return currentTask;
    });
    const append = vi.fn(async (input: { taskId: string; attemptId: string; kind: string }) => ({
      event: {
        taskId: input.taskId,
        attemptId: input.attemptId,
        kind: input.kind,
        sequence: 1,
      },
    }));
    service = new ClawdbotAgentService(
      undefined,
      undefined,
      envelopes,
      undefined,
      completions,
      undefined,
      undefined,
      { append } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new RunRecoveryPolicyService(() => 0.5)
    );
    const schedule = vi
      .spyOn(service as never, 'scheduleTaskRecovery')
      .mockImplementation(() => undefined);

    await (
      service as unknown as {
        persistSupervisorCompletion(
          task: Task,
          attempt: TaskAttempt,
          result: typeof completionResult
        ): Promise<void>;
      }
    ).persistSupervisorCompletion(currentTask, currentTask.attempt, completionResult);

    expect(currentTask.attempt).toMatchObject({
      id: runningAttempt.id,
      status: 'failed',
      runRetry: {
        parentRunId: runningAttempt.id,
        state: 'scheduled',
        action: 'retry',
        failure: { classification: 'transient-transport' },
      },
    });
    expect(schedule).toHaveBeenCalledWith(
      currentTask.id,
      runningAttempt.id,
      expect.objectContaining({ state: 'scheduled', action: 'retry' })
    );
  });

  it('persists one retry branch for duplicate failure planning and cancels the exact parent', async () => {
    let currentTask = {
      ...makeTask('task-retry-once', 'failed'),
      revision: 1,
    } as Task;
    const failedAttempt = currentTask.attempt;
    if (!failedAttempt) throw new Error('Expected a failed attempt fixture');
    failedAttempt.runLaunchManifest = {
      digest: `sha256:${'a'.repeat(64)}`,
      routing: {
        requestedAgent: 'openclaw',
        selectedAgent: 'openclaw',
        selectedHost: 'local-process',
        reason: 'Test routing decision.',
        fallbackAgent: null,
        fallbackAllowed: false,
        fallbackOnFailure: false,
        maxRetries: 3,
      },
      providerRequirements: { required: [], capabilities: [] },
    } as TaskAttempt['runLaunchManifest'];
    currentTask.attempts = [failedAttempt];
    mockGetTask.mockImplementation(async () => currentTask);
    mockUpdateTask.mockImplementation(async (_id, update) => {
      if (
        update.expectedRevision !== undefined &&
        update.expectedRevision !== (currentTask.revision ?? 1)
      ) {
        throw Object.assign(new Error('stale revision'), { statusCode: 409 });
      }
      currentTask = {
        ...currentTask,
        ...update,
        revision: (currentTask.revision ?? 1) + 1,
      } as Task;
      return currentTask;
    });
    const append = vi.fn(async (input: { taskId: string; attemptId: string; kind: string }) => ({
      event: {
        taskId: input.taskId,
        attemptId: input.attemptId,
        kind: input.kind,
        sequence: 1,
      },
    }));
    service = new ClawdbotAgentService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { append } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new RunRecoveryPolicyService(() => 0.5)
    );
    const testable = service as unknown as {
      planTaskRecovery(
        taskId: string,
        attempt: TaskAttempt,
        failure: RunRecoveryRecord['failure']
      ): Promise<RunRecoveryRecord | null>;
    };
    const failure: RunRecoveryRecord['failure'] = {
      classification: 'transient-transport',
      summary: 'ECONNRESET',
      retryable: true,
      approvalRequired: false,
      destructiveSideEffects: false,
    };

    const [first, duplicate] = await Promise.all([
      testable.planTaskRecovery(currentTask.id, failedAttempt, failure),
      testable.planTaskRecovery(currentTask.id, failedAttempt, failure),
    ]);

    expect(first?.state).toBe('scheduled');
    expect(duplicate?.state).toBe('scheduled');
    expect(mockUpdateTask).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledTimes(1);
    const scheduled = currentTask.attempt?.runRetry;
    expect(scheduled).toMatchObject({
      parentRunId: failedAttempt.id,
      sequence: 1,
      action: 'retry',
      state: 'scheduled',
    });

    const cancelled = await service.cancelTaskRecovery(
      currentTask.id,
      failedAttempt.id,
      'test-operator'
    );
    expect(cancelled).toMatchObject({
      state: 'cancelled',
      action: 'cancelled',
      cancelledBy: 'test-operator',
    });
    expect(currentTask.status).toBe('in-progress');
    await expect(
      service.cancelTaskRecovery(currentTask.id, 'attempt_wrong', 'test-operator')
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('durably queues the exact scheduled recovery before mutating its parent state', async () => {
    const recovery: RunRecoveryRecord = {
      schemaVersion: 'run-recovery/v1',
      rootRunId: 'attempt_root',
      parentRunId: 'attempt_parent',
      sequence: 1,
      fallbackUsed: false,
      state: 'scheduled',
      action: 'retry',
      failure: {
        classification: 'transient-transport',
        summary: 'ECONNRESET',
        retryable: true,
        approvalRequired: false,
        destructiveSideEffects: false,
      },
      reason: 'Retry 1 of 1 after transient-transport.',
      backoffMs: 100,
      scheduledAt: '2026-07-24T00:00:00.000Z',
      notBefore: '2026-07-24T00:00:00.100Z',
      selectedAgent: 'openclaw',
      routingDecision: 'Matched code rule.',
      requiredRuntimeCapabilities: [],
      cumulativeBudget: {
        tokens: 0,
        cost: 0,
        runtimeSeconds: 0,
        idleRuntimeSeconds: 0,
        retries: 0,
        fanOut: 1,
      },
    };
    let currentTask = {
      ...makeTask('task-launch-recovery', 'failed'),
      revision: 1,
    } as Task;
    const parentAttempt = currentTask.attempt;
    if (!parentAttempt) throw new Error('Expected a failed attempt fixture');
    parentAttempt.id = recovery.parentRunId;
    parentAttempt.runRetry = recovery;
    currentTask.attempts = [parentAttempt];
    mockGetTask.mockImplementation(async () => currentTask);
    mockUpdateTask.mockImplementation(async (_id, update) => {
      currentTask = {
        ...currentTask,
        ...update,
        revision: (currentTask.revision ?? 1) + 1,
      } as Task;
      return currentTask;
    });
    const appendRunEvent = vi
      .spyOn(service as never, 'appendRunEvent')
      .mockResolvedValue({} as never);
    const startAgent = vi.spyOn(service, 'startAgent').mockResolvedValue({
      taskId: currentTask.id,
      attemptId: 'attempt_queued',
      queueId: 'admission_queue_recovery',
      agent: 'openclaw',
      status: 'queued',
      enqueuedAt: '2026-07-25T12:00:00.000Z',
      retryAfterMs: 250,
      limitingScopes: [{ scope: 'global', scopeId: 'global' }],
    } as never);

    await (
      service as unknown as {
        launchScheduledTaskRecovery(taskId: string, attemptId: string): Promise<void>;
      }
    ).launchScheduledTaskRecovery(currentTask.id, parentAttempt.id);

    expect(mockUpdateTask).not.toHaveBeenCalled();
    expect(startAgent).toHaveBeenCalledWith(
      currentTask.id,
      'openclaw',
      expect.objectContaining({
        parentAttemptId: parentAttempt.id,
        admissionIdempotencyKey: `recovery:${recovery.rootRunId}:${recovery.parentRunId}:${recovery.sequence}`,
        recovery: expect.objectContaining({
          parentRunId: parentAttempt.id,
          state: 'scheduled',
        }),
      })
    );
    expect(appendRunEvent).toHaveBeenCalledWith(
      currentTask.id,
      parentAttempt.id,
      'recovery.queued',
      expect.objectContaining({ queueId: 'admission_queue_recovery', sequence: 1 }),
      expect.any(Object)
    );

    const claimed = await (
      service as unknown as {
        claimTaskRecoveryAfterAdmission(
          taskId: string,
          task: Task,
          options: { parentAttemptId: string; recovery: RunRecoveryRecord }
        ): Promise<Task>;
      }
    ).claimTaskRecoveryAfterAdmission(currentTask.id, currentTask, {
      parentAttemptId: parentAttempt.id,
      recovery,
    });
    expect(claimed.attempt?.runRetry).toMatchObject({
      state: 'launching',
      sequence: recovery.sequence,
    });
    expect(mockUpdateTask).toHaveBeenCalledTimes(1);
  });

  it('keeps a scheduled task recovery armed when cancellation persistence fails', async () => {
    const task = {
      ...makeTask('task-cancel-race', 'failed'),
      revision: 1,
    } as Task;
    const attempt = task.attempt;
    if (!attempt) throw new Error('Expected a failed attempt fixture');
    const recovery = new RunRecoveryPolicyService(() => 0.5).decide(
      {
        classification: 'transient-transport',
        summary: 'ECONNRESET',
        retryable: true,
        approvalRequired: false,
        destructiveSideEffects: false,
      },
      {
        rootRunId: attempt.id,
        parentRunId: attempt.id,
        selectedAgent: attempt.agent,
        routingDecision: 'Test route.',
        maxRetries: 1,
        fallbackOnFailure: false,
        now: new Date(Date.now() + 60_000),
      }
    );
    attempt.runRetry = recovery;
    mockGetTask.mockResolvedValue(task);
    mockUpdateTask.mockRejectedValue(new Error('concurrent task mutation'));
    const testable = service as unknown as {
      scheduleTaskRecovery(taskId: string, attemptId: string, recovery: RunRecoveryRecord): void;
      clearScheduledRecovery(taskId: string, attemptId: string): void;
    };
    testable.scheduleTaskRecovery(task.id, attempt.id, recovery);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await expect(service.cancelTaskRecovery(task.id, attempt.id, 'test-operator')).rejects.toThrow(
      'concurrent task mutation'
    );
    expect(clearTimeoutSpy).not.toHaveBeenCalled();

    testable.clearScheduledRecovery(task.id, attempt.id);
    clearTimeoutSpy.mockRestore();
  });
});
