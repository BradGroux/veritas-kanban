import { describe, expect, it, vi } from 'vitest';
import type {
  CompletionResult,
  DurableGoalCompareAndSetInput,
  DurableGoalCompareAndSetResult,
  DurableGoalContinuationPolicy,
  DurableGoalListQuery,
  DurableGoalRecord,
} from '@veritas-kanban/shared';
import { ZERO_AGENT_BUDGET_USAGE } from '@veritas-kanban/shared';
import { DurableGoalService } from '../services/durable-goal-service.js';
import { DurableGoalSupervisorService } from '../services/durable-goal-supervisor-service.js';
import type { DurableGoalRepository } from '../storage/interfaces.js';

const NOW = new Date('2026-07-26T03:00:00.000Z');
const GOAL_ID = 'goal_supervisor865';

class InMemoryDurableGoalRepository implements DurableGoalRepository {
  private readonly records = new Map<string, DurableGoalRecord>();

  async create(record: DurableGoalRecord): Promise<DurableGoalRecord> {
    this.records.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async get(id: string): Promise<DurableGoalRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async list(query: DurableGoalListQuery): Promise<DurableGoalRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.workspaceId === query.workspaceId)
      .filter((record) => !query.states || query.states.includes(record.state))
      .filter(
        (record) =>
          !query.rootTaskId ||
          (record.root.kind === 'task'
            ? record.root.taskId === query.rootTaskId
            : record.root.taskId === query.rootTaskId)
      )
      .map((record) => structuredClone(record));
  }

  async compareAndSet(
    input: DurableGoalCompareAndSetInput
  ): Promise<DurableGoalCompareAndSetResult> {
    const current = this.records.get(input.id);
    if (!current) return { updated: false, reason: 'not-found' };
    if (current.revision !== input.expectedRevision) {
      return { record: structuredClone(current), updated: false, reason: 'stale-revision' };
    }
    this.records.set(input.id, structuredClone(input.next));
    return { record: structuredClone(input.next), updated: true };
  }
}

function services() {
  const goals = new DurableGoalService({
    repository: new InMemoryDurableGoalRepository(),
    now: () => NOW,
  });
  return { goals, supervisor: new DurableGoalSupervisorService(goals) };
}

async function createGoal(
  goals: DurableGoalService,
  options: {
    continuation?: DurableGoalContinuationPolicy;
    budgets?: { totalTokens?: number };
  } = {}
) {
  return goals.create({
    id: GOAL_ID,
    workspaceId: 'workspace-1',
    objective: 'Ship the durable goal supervisor.',
    constraints: ['Preserve admission controls.'],
    acceptanceCriteria: ['Focused verification passes.'],
    root: { kind: 'task', taskId: 'task-865' },
    continuation: options.continuation ?? { mode: 'automatic', maxTurns: 4 },
    budgets: options.budgets,
    completionRequirements: [
      {
        id: 'focused-tests',
        description: 'Focused verification passes.',
        required: true,
        verificationKind: 'test',
      },
    ],
  });
}

function completion(overrides: Partial<CompletionResult> = {}): CompletionResult {
  return {
    schemaVersion: 'completion-result/v1',
    digest: 'sha256:completion',
    idempotencyKey: 'completion-attempt-1',
    completedAt: NOW.toISOString(),
    terminalSource: 'process',
    taskEnvelopeSchemaVersion: 'task-envelope/v1',
    taskEnvelopeDigest: 'sha256:envelope',
    taskId: 'task-865',
    attemptId: 'attempt-1',
    providerRuntimeManifestDigest: 'sha256:runtime',
    status: 'success',
    summary: 'Implemented the next durable goal slice.',
    error: null,
    blockers: [],
    evidence: [
      {
        id: 'focused-tests-evidence',
        kind: 'verification',
        source: 'harness',
        summary: 'Focused tests passed.',
        reference: null,
        requirementIds: ['focused-tests'],
        verified: true,
      },
    ],
    changedFiles: [],
    artifacts: [],
    verification: [],
    sideEffects: [],
    continuation: {
      provider: 'codex-cli',
      kind: 'thread',
      reference: 'thread-1',
    },
    ...overrides,
  };
}

const usage = {
  ...ZERO_AGENT_BUDGET_USAGE,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  runtimeSeconds: 3,
  toolCalls: 2,
  fanOut: 1,
};

describe('DurableGoalSupervisorService', () => {
  it('records a run once and completes only with verified required evidence', async () => {
    const { goals, supervisor } = services();
    await createGoal(goals);
    const dispatch = vi.fn();

    const result = await supervisor.handleRunCompletion(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        attemptId: 'attempt-1',
        completion: completion(),
        usage,
      },
      dispatch
    );

    expect(result.action).toBe('complete');
    expect(result.goal).toMatchObject({
      state: 'complete',
      usage: { totalTokens: 15, runtimeSeconds: 3, fanOut: 1 },
      completionEvidence: [{ requirementId: 'focused-tests' }],
      continuationChain: [{ attemptId: 'attempt-1' }],
    });
    expect(result.goal?.usageEvents).toHaveLength(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('persists a stable continuation plan before dispatch and deduplicates completion replay', async () => {
    const { goals, supervisor } = services();
    await createGoal(goals, { budgets: { totalTokens: 100 } });
    const dispatch = vi.fn().mockResolvedValue({ attemptId: 'attempt-2', queueId: 'queue-2' });
    const input = {
      workspaceId: 'workspace-1',
      taskId: 'task-865',
      attemptId: 'attempt-1',
      completion: completion({ evidence: [] }),
      usage,
    };

    const first = await supervisor.handleRunCompletion(input, dispatch);
    const replay = await supervisor.handleRunCompletion(input, dispatch);

    expect(first.action).toBe('dispatched');
    expect(first.continuation).toMatchObject({
      kind: 'resume',
      state: 'dispatched',
      sourceAttemptId: 'attempt-1',
      resultAttemptId: 'attempt-2',
      queueId: 'queue-2',
      admissionIdempotencyKey: `durable-goal:${GOAL_ID}:attempt-1`,
    });
    expect(first.goal?.continuationChain.map((run) => run.attemptId)).toEqual([
      'attempt-1',
      'attempt-2',
    ]);
    expect(replay.action).toBe('already-handled');
    expect(replay.goal?.usage.totalTokens).toBe(15);
    expect(replay.goal?.usageEvents).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ remainingBudget: { totalTokens: 85 } })
    );
  });

  it('rolls over to a fresh bounded conversation at the configured token threshold', async () => {
    const { goals, supervisor } = services();
    await createGoal(goals, {
      continuation: {
        mode: 'automatic',
        maxTurns: 4,
        maxRollovers: 2,
        compactAfterTokens: 10,
      },
    });
    const dispatch = vi.fn().mockResolvedValue({ attemptId: 'attempt-2' });

    const result = await supervisor.handleRunCompletion(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        attemptId: 'attempt-1',
        completion: completion({ evidence: [] }),
        usage,
      },
      dispatch
    );

    expect(result.action).toBe('dispatched');
    expect(result.continuation).toMatchObject({
      kind: 'rollover',
      state: 'dispatched',
      sourceAttemptId: 'attempt-1',
      resultAttemptId: 'attempt-2',
      admissionIdempotencyKey: `durable-goal:${GOAL_ID}:attempt-1:rollover`,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rollover',
        message: expect.stringContaining('Start a fresh conversation'),
      })
    );
    expect(dispatch.mock.calls[0][0].message).toContain('Preserve admission controls.');
    expect(dispatch.mock.calls[0][0].message).toContain('focused-tests');
    expect(Buffer.byteLength(dispatch.mock.calls[0][0].message, 'utf8')).toBeLessThanOrEqual(
      18_000
    );
  });

  it('waits for explicit rollover approval and then dispatches the persisted handoff', async () => {
    const { goals, supervisor } = services();
    await createGoal(goals, {
      continuation: {
        mode: 'automatic',
        maxTurns: 4,
        maxRollovers: 1,
        compactAfterTokens: 10,
        requireApprovalForRollover: true,
      },
    });
    const dispatch = vi.fn().mockResolvedValue({ attemptId: 'attempt-2' });
    const pending = await supervisor.handleRunCompletion(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        attemptId: 'attempt-1',
        completion: completion({ evidence: [] }),
        usage,
      },
      dispatch
    );

    expect(pending.action).toBe('awaiting-approval');
    expect(pending.goal?.state).toBe('awaiting-approval');
    expect(dispatch).not.toHaveBeenCalled();

    const approved = await supervisor.approveRollover(
      {
        goalId: GOAL_ID,
        expectedRevision: pending.goal?.revision as number,
        actorId: 'operator-brad',
      },
      dispatch
    );

    expect(approved.action).toBe('dispatched');
    expect(approved.goal?.state).toBe('active');
    expect(approved.continuation).toMatchObject({
      kind: 'rollover',
      resultAttemptId: 'attempt-2',
    });
    expect(approved.goal?.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'awaiting-approval',
          to: 'active',
          actorId: 'operator-brad',
        }),
      ])
    );
  });

  it('stops at the configured rollover limit instead of extending context indefinitely', async () => {
    const { goals, supervisor } = services();
    await createGoal(goals, {
      continuation: {
        mode: 'automatic',
        maxTurns: 6,
        maxRollovers: 1,
        compactAfterTokens: 10,
      },
    });
    const dispatch = vi.fn().mockResolvedValue({ attemptId: 'attempt-2' });
    const first = await supervisor.handleRunCompletion(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        attemptId: 'attempt-1',
        completion: completion({ evidence: [] }),
        usage,
      },
      dispatch
    );
    expect(first.action).toBe('dispatched');

    const second = await supervisor.handleRunCompletion(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        attemptId: 'attempt-2',
        parentAttemptId: 'attempt-1',
        completion: completion({
          attemptId: 'attempt-2',
          idempotencyKey: 'completion-attempt-2',
          evidence: [],
        }),
        usage,
      },
      dispatch
    );

    expect(second.action).toBe('usage-limited');
    expect(second.goal?.state).toBe('usage-limited');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('preserves an exact provider blocker without dispatching', async () => {
    const { goals, supervisor } = services();
    await createGoal(goals);
    const dispatch = vi.fn();

    const result = await supervisor.handleRunCompletion(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        attemptId: 'attempt-1',
        completion: completion({
          status: 'blocked',
          evidence: [],
          blockers: [
            {
              code: 'EXTERNAL_APPROVAL_REQUIRED',
              summary: 'Release approval is missing.',
              detail: 'Wait for the release owner.',
              retryable: true,
            },
          ],
        }),
      },
      dispatch
    );

    expect(result.action).toBe('blocked');
    expect(result.goal).toMatchObject({
      state: 'blocked',
      blockers: [
        {
          code: 'EXTERNAL_APPROVAL_REQUIRED',
          summary: 'Release approval is missing.',
          nextSafeAction: 'Wait for the release owner.',
        },
      ],
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('stops before dispatch when the aggregate budget is reached', async () => {
    const { goals, supervisor } = services();
    await createGoal(goals, { budgets: { totalTokens: 10 } });

    const result = await supervisor.handleRunCompletion(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        attemptId: 'attempt-1',
        completion: completion({ evidence: [] }),
        usage,
      },
      vi.fn()
    );

    expect(result.action).toBe('budget-limited');
    expect(result.goal?.state).toBe('budget-limited');
  });

  it('stops before dispatch when the turn limit is reached', async () => {
    const { goals, supervisor } = services();
    await createGoal(goals, { continuation: { mode: 'automatic', maxTurns: 1 } });

    const result = await supervisor.handleRunCompletion(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        attemptId: 'attempt-1',
        completion: completion({ evidence: [] }),
      },
      vi.fn()
    );

    expect(result.action).toBe('usage-limited');
    expect(result.goal?.state).toBe('usage-limited');
  });

  it('reconciles a crash after dispatch without launching a duplicate continuation', async () => {
    const { goals, supervisor } = services();
    const goal = await createGoal(goals);
    const withSource = await goals.recordRunOutcome(goal.id, {
      expectedRevision: goal.revision,
      run: { taskId: 'task-865', attemptId: 'attempt-1' },
    });
    await goals.planContinuation(goal.id, {
      expectedRevision: withSource.revision,
      sourceTaskId: 'task-865',
      sourceAttemptId: 'attempt-1',
      message: 'Continue safely.',
    });
    const dispatch = vi.fn();

    const result = await supervisor.reconcilePlannedForTask(
      {
        workspaceId: 'workspace-1',
        taskId: 'task-865',
        currentAttemptId: 'attempt-2',
        parentAttemptId: 'attempt-1',
        currentAttemptRunning: true,
      },
      dispatch
    );

    expect(result.action).toBe('reconciled');
    expect(result.continuation).toMatchObject({
      state: 'dispatched',
      resultAttemptId: 'attempt-2',
    });
    expect(result.goal?.continuationChain.map((run) => run.attemptId)).toEqual([
      'attempt-1',
      'attempt-2',
    ]);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
