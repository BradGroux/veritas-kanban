import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { workflowAdmissionStub } from './helpers/workflow-admission-stub.js';

const mockLoadWorkflow = vi.fn();
const mockListWorkflowsMetadata = vi.fn();
const mockPrepareStep = vi.fn();
const mockApplyPreparation = vi.fn();
const mockExecuteStep = vi.fn();
const mockValidateFallbackAgent = vi.fn();
const mockBroadcastWorkflowStatus = vi.fn();
const mockGetTask = vi.fn();
const mockCheckWorkflowPermission = vi.fn();
const mockGetFallback = vi.fn();

vi.mock('../services/workflow-service.js', () => ({
  getWorkflowService: () => ({
    loadWorkflow: mockLoadWorkflow,
    listWorkflowsMetadata: mockListWorkflowsMetadata,
  }),
}));

vi.mock('../services/workflow-step-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/workflow-step-executor.js')>();
  return {
    HumanGateBlockError: actual.HumanGateBlockError,
    WorkflowStepExecutor: class {
      prepareStep = mockPrepareStep;
      applyPreparation = mockApplyPreparation;
      executeStep = mockExecuteStep;
      validateFallbackAgent = mockValidateFallbackAgent;
    },
  };
});

vi.mock('../services/broadcast-service.js', () => ({
  broadcastWorkflowStatus: mockBroadcastWorkflowStatus,
}));

vi.mock('../services/task-service.js', () => ({
  getTaskService: () => ({ getTask: mockGetTask }),
}));

vi.mock('../middleware/workflow-auth.js', () => ({
  checkWorkflowPermission: mockCheckWorkflowPermission,
}));

vi.mock('../services/agent-routing-service.js', () => ({
  getAgentRoutingService: () => ({ getFallback: mockGetFallback }),
}));

function makeWorkflow(overrides: Record<string, any> = {}) {
  return {
    id: 'wf-1',
    version: 3,
    name: 'Workflow One',
    variables: { global: 'value' },
    agents: [{ id: 'agent-1', name: 'Agent 1' }],
    steps: [
      { id: 'step-1', type: 'agent', agent: 'agent-1', prompt: 'one' },
      { id: 'step-2', type: 'agent', agent: 'agent-1', prompt: 'two' },
    ],
    ...overrides,
  };
}

describe('WorkflowRunService', () => {
  let tmpDir: string;
  let service: any;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-run-'));
    mockLoadWorkflow.mockResolvedValue(makeWorkflow());
    mockListWorkflowsMetadata.mockResolvedValue([
      { id: 'wf-1', name: 'Workflow One' },
      { id: 'wf-2', name: 'Workflow Two' },
    ]);
    mockGetTask.mockResolvedValue({ id: 'task-1', title: 'Task 1' });
    mockCheckWorkflowPermission.mockResolvedValue(true);
    mockPrepareStep.mockImplementation(async (step: any) => ({ kind: 'non-agent', step }));
    mockApplyPreparation.mockImplementation(() => undefined);
    mockExecuteStep.mockImplementation(async (step: any) => ({
      output: { done: step.id },
      outputPath: `/tmp/${step.id}.json`,
    }));
    mockValidateFallbackAgent.mockResolvedValue({});
    mockGetFallback.mockResolvedValue(null);
    const mod = await import('../services/workflow-run-service.js');
    service = new mod.WorkflowRunService({
      runsDir: tmpDir,
      admission: workflowAdmissionStub(),
    });
  });

  afterEach(async () => {
    service.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('preserves interactive, scheduled, and watcher workflow admission sources', () => {
    const source = (
      service as unknown as {
        workflowAdmissionSource(run: { context: Record<string, unknown> }): string;
      }
    ).workflowAdmissionSource.bind(service);

    expect(source({ context: {} })).toBe('workflow');
    expect(source({ context: { scheduler: { itemId: 'workflow:nightly' } } })).toBe('scheduled');
    expect(source({ context: { queueMonitor: { monitorId: 'backlog' } } })).toBe('watcher');
  });

  it('starts a run, snapshots workflow, merges context, and completes asynchronously', async () => {
    const run = await service.startRun('wf-1', 'task-1', { custom: 42 });
    expect(run.id).toMatch(/^run_\d+_/);
    expect(run.context.task).toMatchObject({ id: 'task-1' });
    expect(run.context.custom).toBe(42);

    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(saved.status).toBe('completed');
      expect(saved.steps.every((s: any) => s.status === 'completed')).toBe(true);
    });

    const snapshot = await fs.readFile(path.join(tmpDir, run.id, 'workflow.yml'), 'utf8');
    expect(snapshot).toContain('wf-1');
    expect(mockBroadcastWorkflowStatus).toHaveBeenCalled();
  });

  it('resolves phase launch controls before mutating executable step state', async () => {
    let observed: { currentStep?: string; stepStatus?: string; startedAt?: string } | undefined;
    mockPrepareStep.mockImplementationOnce(async (_step: any, run: any) => {
      observed = {
        currentStep: run.currentStep,
        stepStatus: run.steps[0]?.status,
        startedAt: run.steps[0]?.startedAt,
      };
      throw new Error('The effective phase authority cannot be enforced.');
    });

    const run = await service.startRun('wf-1', 'task-1');

    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(saved.status).toBe('failed');
    });
    expect(observed).toEqual({
      currentStep: 'step-1',
      stepStatus: 'pending',
      startedAt: undefined,
    });
    expect(mockApplyPreparation).not.toHaveBeenCalled();
    expect(mockExecuteStep).not.toHaveBeenCalled();
  });

  it('rejects initial context that overrides server-owned workflow run keys', async () => {
    mockGetTask.mockResolvedValue({
      id: 'task-1',
      title: 'Trusted task',
      git: { worktreePath: '/trusted/worktree' },
    });

    await expect(
      service.startRun('wf-1', 'task-1', {
        task: {
          id: 'attacker-task',
          git: { worktreePath: '/attacker/worktree' },
        },
        _sessions: { codex: 'thread_attacker' },
      })
    ).rejects.toThrow('reserved workflow context keys: task, _sessions');
    expect(mockExecuteStep).not.toHaveBeenCalled();
  });

  it('rolls orchestrated pipeline roles into workflow run context', async () => {
    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        agents: [
          { id: 'orchestrator', name: 'Orchestrator' },
          { id: 'researcher', name: 'Researcher' },
          { id: 'reviewer', name: 'Reviewer' },
        ],
        pipeline: {
          mode: 'orchestrated',
          parentAgent: 'orchestrator',
          completion: 'all-required',
          roles: [
            {
              id: 'researcher',
              label: 'Researcher',
              agent: 'researcher',
              scope: 'Inspect source material.',
              taskBrief: 'Find relevant facts.',
              deliverable: 'Research findings.',
              verification: ['Cites source material.'],
            },
            {
              id: 'reviewer',
              label: 'Reviewer',
              agent: 'reviewer',
              scope: 'Check the research.',
              taskBrief: 'Validate findings.',
              deliverable: 'Review notes.',
              verification: ['Lists blockers first.'],
              dependsOn: ['researcher'],
            },
          ],
        },
        steps: [
          {
            id: 'delegate',
            type: 'parallel',
            parallel: {
              completion: 'all',
              steps: [
                { id: 'research', agent: 'researcher', input: 'Research.' },
                { id: 'review', agent: 'reviewer', input: 'Review.' },
              ],
            },
          },
        ],
      })
    );
    mockExecuteStep.mockImplementation(async (step: any) => ({
      output: {
        subSteps: step.parallel.steps.map((subStep: any) => ({
          id: subStep.id,
          status: 'fulfilled',
          output: `done ${subStep.id}`,
        })),
        completed: step.parallel.steps.length,
        failed: 0,
      },
      outputPath: `/tmp/${step.id}.json`,
    }));

    const run = await service.startRun('wf-1');

    expect(run.context.pipeline).toMatchObject({
      totals: { roles: 2, completed: 0 },
    });

    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(saved.context.pipeline).toMatchObject({
        totals: { roles: 2, completed: 2, failed: 0 },
      });
      expect(saved.context.pipeline.roles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'researcher', status: 'completed' }),
          expect.objectContaining({ id: 'reviewer', status: 'completed' }),
        ])
      );
    });
  });

  it('handles retry, retry_step, skip, block, and workflow failure', async () => {
    // Advance recovery time explicitly; real filesystem work must still settle.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let markPending!: () => void;
    let markBlocked!: () => void;
    const pending = new Promise<void>((resolve) => {
      markPending = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      markBlocked = resolve;
    });
    const scheduleRecovery = service.scheduleWorkflowRecovery.bind(service);
    const scheduleSpy = vi
      .spyOn(service, 'scheduleWorkflowRecovery')
      .mockImplementation((...args) => {
        scheduleRecovery(...args);
        markPending();
      });
    const saveRun = service.saveRun.bind(service);
    vi.spyOn(service, 'saveRun').mockImplementation(async (...args) => {
      await saveRun(...args);
      if ((args[0] as { status: string }).status === 'blocked') markBlocked();
    });

    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        agents: [
          { id: 'agent-1', name: 'Agent 1' },
          { id: 'TARS', name: 'TARS' },
        ],
        steps: [
          { id: 'prep', type: 'agent', agent: 'agent-1', prompt: 'prep' },
          {
            id: 'retryable',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { retry: 1, retry_delay_ms: 1 },
          },
          {
            id: 'reroute',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { retry_step: 'prep' },
          },
          {
            id: 'skippable',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { escalate_to: 'skip' },
          },
          {
            id: 'blocking',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { escalate_to: 'human', escalate_message: 'Need help' },
          },
        ],
      })
    );
    mockGetFallback.mockResolvedValue({
      agent: 'TARS',
      reason: 'Workspace fallback should not override retry_step.',
    });

    const counts: Record<string, number> = {};
    mockExecuteStep.mockImplementation(async (step: any) => {
      counts[step.id] = (counts[step.id] || 0) + 1;
      if (step.id === 'retryable' && counts[step.id] === 1) throw new Error('ECONNRESET fail once');
      if (step.id === 'reroute' && counts[step.id] === 1) throw new Error('ECONNRESET reroute me');
      if (step.id === 'skippable') throw new Error('skip me');
      if (step.id === 'blocking') throw new Error('block me');
      return { output: { done: step.id }, outputPath: `/tmp/${step.id}.json` };
    });

    const run = await service.startRun('wf-1');
    await pending;
    const scheduled = await service.getRun(run.id);
    const retry = scheduled.steps.find((s: any) => s.stepId === 'retryable').runRetry;
    const delay = Date.parse(retry.notBefore) - Date.now();
    expect(scheduled.status).toBe('pending');
    expect(delay).toBeGreaterThan(0);
    expect(retry.backoffMs).toBeGreaterThanOrEqual(100);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(counts.retryable).toBe(1);
    expect((await service.getRun(run.id)).status).toBe('pending');
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await blocked;
    const saved = await service.getRun(run.id);
    expect(saved.status).toBe('blocked');
    expect(saved.error).toBe('Need help');
    expect(saved.steps.find((s: any) => s.stepId === 'retryable').retries).toBe(1);
    expect(saved.steps.find((s: any) => s.stepId === 'skippable').status).toBe('skipped');
    expect(saved.context._retryContext.failedStep).toBe('reroute');
    expect(counts).toEqual({ prep: 2, retryable: 2, reroute: 2, skippable: 1, blocking: 1 });
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('routes an exhausted transient step to a validated fallback agent', async () => {
    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        agents: [
          { id: 'agent-1', name: 'Agent 1' },
          { id: 'TARS', name: 'TARS' },
        ],
        steps: [
          {
            id: 'step-1',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: {
              retry: 0,
              retry_delay_ms: 1,
              escalate_to: 'agent:TARS',
            },
          },
        ],
      })
    );
    mockExecuteStep
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ output: { ok: true }, outputPath: '/tmp/fallback.json' });

    const run = await service.startRun('wf-1');
    await vi.waitFor(
      async () => {
        const saved = await service.getRun(run.id);
        expect(saved.status).toBe('completed');
        expect(saved.steps[0]).toMatchObject({
          agent: 'TARS',
          retries: 1,
          runRetry: {
            action: 'fallback',
            state: 'launched',
            fallbackUsed: true,
            selectedAgent: 'TARS',
          },
        });
      },
      { timeout: 2_000 }
    );
    expect(mockValidateFallbackAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'step-1' }),
      expect.objectContaining({ id: run.id }),
      'TARS'
    );
  });

  it('cancels the exact pending workflow retry before its timer can launch', async () => {
    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        steps: [
          {
            id: 'step-1',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { retry: 2, retry_delay_ms: 10_000 },
          },
        ],
      })
    );
    mockExecuteStep.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const run = await service.startRun('wf-1');
    let parentRunId = '';
    await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(saved.status).toBe('pending');
      expect(saved.steps[0].runRetry?.state).toBe('scheduled');
      parentRunId = saved.steps[0].runRetry.parentRunId;
    });

    const cancelled = await service.cancelPendingRecovery(
      run.id,
      'step-1',
      parentRunId,
      'test-operator'
    );
    expect(cancelled).toMatchObject({
      status: 'blocked',
      steps: [
        expect.objectContaining({
          runRetry: expect.objectContaining({
            state: 'cancelled',
            action: 'cancelled',
            cancelledBy: 'test-operator',
          }),
        }),
      ],
    });
    expect(mockExecuteStep).toHaveBeenCalledTimes(1);
  });

  it('clears owned recovery timers before test storage is removed', () => {
    service.scheduleWorkflowRecovery('run_timer_cleanup', 'step-1', {
      state: 'scheduled',
      notBefore: '2999-01-01T00:00:00.000Z',
    });

    expect(service.scheduledWorkflowRecoveryTimers.size).toBe(1);
    service.dispose();
    expect(service.scheduledWorkflowRecoveryTimers.size).toBe(0);
  });

  it('blocks a restarted workflow when a launched recovery cannot be proven terminal', async () => {
    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        steps: [
          {
            id: 'step-1',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { retry: 1, retry_delay_ms: 10_000 },
          },
        ],
      })
    );
    mockExecuteStep.mockRejectedValueOnce(new Error('ECONNRESET'));

    const run = await service.startRun('wf-1');
    const persisted = await vi.waitFor(async () => {
      const saved = await service.getRun(run.id);
      expect(saved.steps[0].runRetry?.state).toBe('scheduled');
      return saved;
    });
    service.clearScheduledWorkflowRecovery(run.id, 'step-1');
    persisted.status = 'running';
    persisted.steps[0].status = 'running';
    persisted.steps[0].runRetry = {
      ...persisted.steps[0].runRetry,
      state: 'launched',
    };
    await service.saveRun(persisted);

    await service.reconcilePendingRecoveries();

    expect(await service.getRun(run.id)).toMatchObject({
      status: 'blocked',
      error: 'Workflow recovery requires operator reconciliation after restart.',
      steps: [
        expect.objectContaining({
          runRetry: expect.objectContaining({
            state: 'approval-required',
            action: 'approval',
          }),
        }),
      ],
    });
    expect(mockExecuteStep).toHaveBeenCalledTimes(1);
  });

  it('resumes blocked runs and validates invalid resume requests', async () => {
    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        steps: [
          {
            id: 'step-1',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { escalate_to: 'human', escalate_message: 'blocked' },
          },
        ],
      })
    );
    mockExecuteStep
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce({ output: { ok: true }, outputPath: '/tmp/out.json' });

    const run = await service.startRun('wf-1');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));

    const resumed = await service.resumeRun(run.id, { approved: true });
    expect(resumed.context.approved).toBe(true);
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('completed'));

    await expect(service.resumeRun('run_1234567890_abcdef', {})).rejects.toThrow(/not found/);
    await expect(service.resumeRun(run.id, {})).rejects.toThrow(/not blocked/);
  });

  it('rejects resume context that overrides server-owned workflow run keys', async () => {
    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        steps: [
          {
            id: 'step-1',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { escalate_to: 'human', escalate_message: 'blocked' },
          },
        ],
      })
    );
    mockExecuteStep.mockRejectedValueOnce(new Error('blocked'));

    const run = await service.startRun('wf-1');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('blocked'));
    mockExecuteStep.mockClear();

    await expect(
      service.resumeRun(run.id, {
        task: { git: { worktreePath: '/attacker/worktree' } },
        pipeline: { mode: 'attacker' },
      })
    ).rejects.toThrow('reserved workflow context keys: task, pipeline');

    const saved = await service.getRun(run.id);
    expect(saved.status).toBe('blocked');
    expect(mockExecuteStep).not.toHaveBeenCalled();
  });

  it('lists runs and metadata with filters while skipping invalid or broken entries', async () => {
    const run1 = await service.startRun('wf-1', 'task-1');
    const run2 = await service.startRun('wf-1', 'task-2');
    await vi.waitFor(async () => expect((await service.getRun(run1.id)).status).toBe('completed'));
    await vi.waitFor(async () => expect((await service.getRun(run2.id)).status).toBe('completed'));

    await fs.mkdir(path.join(tmpDir, 'run_9999999999_brokenxx'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'run_9999999999_brokenxx', 'run.json'), '{bad', 'utf8');

    await expect(service.listRuns({ taskId: 'task-1' })).rejects.toThrow();
    const meta = await service.listRunsMetadata({ workflowId: 'wf-1' });
    const expectedIds = [run1, run2]
      .sort(
        (a: any, b: any) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() ||
          b.id.localeCompare(a.id)
      )
      .map((run: any) => run.id);
    expect(meta.map((m: any) => m.id)).toEqual(expectedIds);
  });

  it('calculates stats using workflow permissions', async () => {
    const now = Date.now();
    const old = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now - 60 * 60 * 1000).toISOString();
    const recentEnd = new Date(now - 30 * 60 * 1000).toISOString();

    await fs.mkdir(path.join(tmpDir, 'run_1111111111_aaaaaa'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'run_1111111111_aaaaaa', 'run.json'),
      JSON.stringify(
        {
          id: 'run_1111111111_aaaaaa',
          workflowId: 'wf-1',
          workflowVersion: 1,
          taskId: 't1',
          status: 'completed',
          startedAt: recent,
          completedAt: recentEnd,
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(tmpDir, 'run_2222222222_bbbbbb'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'run_2222222222_bbbbbb', 'run.json'),
      JSON.stringify(
        {
          id: 'run_2222222222_bbbbbb',
          workflowId: 'wf-1',
          workflowVersion: 1,
          taskId: 't2',
          status: 'failed',
          startedAt: recent,
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(tmpDir, 'run_notvalid'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'run_notvalid', 'run.json'),
      JSON.stringify(
        {
          id: 'run_notvalid',
          workflowId: 'wf-x',
          workflowVersion: 1,
          taskId: 'tX',
          status: 'completed',
          startedAt: recent,
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(tmpDir, 'run_3333333333_cccccc'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'run_3333333333_cccccc', 'run.json'),
      JSON.stringify(
        {
          id: 'run_3333333333_cccccc',
          workflowId: 'wf-2',
          workflowVersion: 1,
          taskId: 't3',
          status: 'running',
          startedAt: old,
        },
        null,
        2
      )
    );

    mockCheckWorkflowPermission.mockImplementation(
      async (workflowId: string) => workflowId === 'wf-1'
    );

    const stats = await service.getStats('30d', 'brad');
    expect(stats).toMatchObject({
      totalWorkflows: 1,
      activeRuns: 0,
      completedRuns: 1,
      failedRuns: 1,
      successRate: 0.5,
    });
    expect(stats.avgDuration).toBe(30 * 60 * 1000);
    expect(stats.perWorkflow).toEqual([
      expect.objectContaining({
        workflowId: 'wf-1',
        workflowName: 'Workflow One',
        runs: 2,
        completed: 1,
        failed: 1,
        successRate: 0.5,
        avgDuration: 30 * 60 * 1000,
      }),
    ]);
  });

  it('validates human-gate approval and rejection state before mutation', async () => {
    const repository = (service as any).repository;
    const persist = async (id: string, overrides: Record<string, any> = {}) => {
      await repository.save(
        {
          id,
          workflowId: 'wf-1',
          workflowVersion: 3,
          status: 'blocked',
          context: {},
          steps: [],
          startedAt: '2026-08-23T00:00:00.000Z',
          revision: 1,
          ...overrides,
        },
        0
      );
    };

    await expect(
      service.approveGateStep('run_1111111111_missing', 'gate-1', 'operator')
    ).rejects.toThrow(/not found/);
    await persist('run_1111111111_running', { status: 'running' });
    await expect(
      service.approveGateStep('run_1111111111_running', 'gate-1', 'operator')
    ).rejects.toThrow(/is not blocked/);
    await persist('run_1111111111_nogate');
    await expect(
      service.approveGateStep('run_1111111111_nogate', 'gate-1', 'operator')
    ).rejects.toThrow(/not blocked at a human gate/);
    await persist('run_1111111111_wronggate', {
      context: { _gateBlock: { stepId: 'gate-2' } },
    });
    await expect(
      service.approveGateStep('run_1111111111_wronggate', 'gate-1', 'operator')
    ).rejects.toThrow(/blocked at gate/);
    await persist('run_1111111111_nostep', {
      context: { _gateBlock: { stepId: 'gate-1' } },
    });
    await expect(
      service.approveGateStep('run_1111111111_nostep', 'gate-1', 'operator')
    ).rejects.toThrow(/Step gate-1 not found/);

    await expect(
      service.rejectGateStep('run_1111111111_rejectmissing', 'gate-1', 'operator')
    ).rejects.toThrow(/not found/);
    await persist('run_1111111111_rejectrunning', { status: 'running' });
    await expect(
      service.rejectGateStep('run_1111111111_rejectrunning', 'gate-1', 'operator')
    ).rejects.toThrow(/is not blocked/);
    await persist('run_1111111111_rejectnogate');
    await expect(
      service.rejectGateStep('run_1111111111_rejectnogate', 'gate-1', 'operator')
    ).rejects.toThrow(/not blocked at a human gate/);
    await persist('run_1111111111_rejectwrong', {
      context: { _gateBlock: { stepId: 'gate-2' } },
    });
    await expect(
      service.rejectGateStep('run_1111111111_rejectwrong', 'gate-1', 'operator')
    ).rejects.toThrow(/blocked at gate/);
    await persist('run_1111111111_rejectnostep', {
      context: { _gateBlock: { stepId: 'gate-1' } },
    });
    await expect(
      service.rejectGateStep('run_1111111111_rejectnostep', 'gate-1', 'operator')
    ).rejects.toThrow(/Step gate-1 not found/);
  });

  it('rejects invalid ids, missing workflows, invalid metadata reads, and incompatible agent escalation', async () => {
    await expect(service.getRun('../bad')).rejects.toThrow(/illegal path characters/);
    await expect(service.getRun('run_invalid')).rejects.toThrow(/format is invalid/);

    mockLoadWorkflow.mockResolvedValueOnce(null);
    await expect(service.startRun('missing')).rejects.toThrow(/not found/);

    mockLoadWorkflow.mockResolvedValue(
      makeWorkflow({
        steps: [
          {
            id: 'step-1',
            type: 'agent',
            agent: 'agent-1',
            prompt: 'x',
            on_fail: { retry: 0, escalate_to: 'agent:TARS' },
          },
        ],
      })
    );
    mockExecuteStep.mockRejectedValueOnce(new Error('ECONNRESET'));
    mockValidateFallbackAgent.mockRejectedValueOnce(
      new Error('Workflow fallback agent TARS is not defined in the workflow')
    );
    const run = await service.startRun('wf-1');
    await vi.waitFor(async () => expect((await service.getRun(run.id)).status).toBe('failed'));
    expect((await service.getRun(run.id)).error).toMatch(/Fallback TARS was rejected/);
  });
});
