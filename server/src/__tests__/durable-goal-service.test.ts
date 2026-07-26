import { describe, expect, it } from 'vitest';
import type {
  DurableGoalCompareAndSetInput,
  DurableGoalCompareAndSetResult,
  DurableGoalListQuery,
  DurableGoalRecord,
} from '@veritas-kanban/shared';
import { DurableGoalService } from '../services/durable-goal-service.js';
import type { DurableGoalRepository } from '../storage/interfaces.js';

const NOW = new Date('2026-07-26T02:00:00.000Z');
const GOAL_ID = 'goal_0123456789abcdef';

class InMemoryDurableGoalRepository implements DurableGoalRepository {
  private readonly records = new Map<string, DurableGoalRecord>();

  async create(record: DurableGoalRecord): Promise<DurableGoalRecord> {
    if (this.records.has(record.id)) throw new Error('duplicate');
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
      .map((record) => structuredClone(record));
  }

  async compareAndSet(
    input: DurableGoalCompareAndSetInput
  ): Promise<DurableGoalCompareAndSetResult> {
    const current = this.records.get(input.id);
    if (!current) return { updated: false, reason: 'not-found' };
    if (current.revision !== input.expectedRevision) {
      return {
        record: structuredClone(current),
        updated: false,
        reason: 'stale-revision',
      };
    }
    if (input.next.id !== input.id || input.next.revision !== input.expectedRevision + 1) {
      return {
        record: structuredClone(current),
        updated: false,
        reason: 'invalid-revision',
      };
    }
    this.records.set(input.id, structuredClone(input.next));
    return { record: structuredClone(input.next), updated: true };
  }
}

function service(): DurableGoalService {
  return new DurableGoalService({
    repository: new InMemoryDurableGoalRepository(),
    now: () => NOW,
  });
}

async function createGoal(goalService = service()) {
  const goal = await goalService.create({
    id: GOAL_ID,
    objective: 'Deliver the durable goal supervisor.',
    constraints: ['Preserve operator authority.'],
    acceptanceCriteria: ['The goal survives restart.'],
    root: { kind: 'task', taskId: 'task-865' },
    continuation: {
      mode: 'automatic',
      maxTurns: 20,
      maxRollovers: 2,
      requireApprovalForRollover: true,
    },
    completionRequirements: [
      {
        id: 'focused-tests',
        description: 'Focused verification passes.',
        required: true,
        verificationKind: 'test',
      },
    ],
  });
  return { goalService, goal };
}

describe('DurableGoalService', () => {
  it('creates a versioned active goal with bounded policy and zero aggregate usage', async () => {
    const { goal } = await createGoal();

    expect(goal).toMatchObject({
      schemaVersion: 'durable-goal/v1',
      id: GOAL_ID,
      workspaceId: 'local',
      state: 'active',
      revision: 1,
      root: { kind: 'task', taskId: 'task-865' },
      usage: {
        totalTokens: 0,
        costUsd: 0,
        toolCalls: 0,
        retries: 0,
        fanOut: 0,
      },
    });
  });

  it('requires an evidence-gated completion contract at creation', async () => {
    await expect(
      service().create({
        id: GOAL_ID,
        objective: 'Attempt an unsupported objective.',
        acceptanceCriteria: ['The objective should not be accepted.'],
        root: { kind: 'task', taskId: 'task-865' },
        continuation: { mode: 'manual' },
      })
    ).rejects.toThrow('Durable goals require at least one evidence-gated completion requirement');
  });

  it('applies an exact compare-and-set transition and rejects a stale writer', async () => {
    const { goalService, goal } = await createGoal();
    const paused = await goalService.transition(goal.id, {
      expectedRevision: goal.revision,
      to: 'paused',
      actorId: 'operator-brad',
      reason: 'Pause before external coordination.',
    });

    expect(paused).toMatchObject({
      state: 'paused',
      revision: 2,
      transitions: [
        {
          revision: 2,
          from: 'active',
          to: 'paused',
          actorId: 'operator-brad',
        },
      ],
    });
    await expect(
      goalService.transition(goal.id, {
        expectedRevision: goal.revision,
        to: 'cancelled',
        actorId: 'operator-brad',
        reason: 'Stale cancellation.',
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('preserves an actionable blocker and supports a safe resume', async () => {
    const { goalService, goal } = await createGoal();
    const blocked = await goalService.transition(goal.id, {
      expectedRevision: goal.revision,
      to: 'blocked',
      actorId: 'goal-supervisor',
      reason: 'External approval is missing.',
      blocker: {
        id: 'blocker-approval',
        code: 'EXTERNAL_APPROVAL_REQUIRED',
        summary: 'A release owner must approve publication.',
        attempts: 2,
        nextSafeAction: 'Wait for the release owner.',
        requiredAuthority: 'release:publish',
        recordedAt: NOW.toISOString(),
      },
    });
    const resumed = await goalService.transition(goal.id, {
      expectedRevision: blocked.revision,
      to: 'active',
      actorId: 'operator-brad',
      reason: 'Release approval was granted.',
    });

    expect(blocked.blockers[0]).toMatchObject({
      code: 'EXTERNAL_APPROVAL_REQUIRED',
      attempts: 2,
      requiredAuthority: 'release:publish',
    });
    expect(resumed).toMatchObject({ state: 'active', revision: 3 });
  });

  it('requires a blocker when entering blocked state', async () => {
    const { goalService, goal } = await createGoal();

    await expect(
      goalService.transition(goal.id, {
        expectedRevision: goal.revision,
        to: 'blocked',
        actorId: 'goal-supervisor',
        reason: 'No blocker was supplied.',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  it('rejects completion until all required evidence is present', async () => {
    const { goalService, goal } = await createGoal();

    await expect(
      goalService.transition(goal.id, {
        expectedRevision: goal.revision,
        to: 'complete',
        actorId: 'goal-supervisor',
        reason: 'Unsupported completion.',
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      details: { missingRequirementIds: ['focused-tests'] },
    });
  });

  it('records verified completion evidence and makes terminal state immutable', async () => {
    const { goalService, goal } = await createGoal();
    const complete = await goalService.transition(goal.id, {
      expectedRevision: goal.revision,
      to: 'complete',
      actorId: 'operator-brad',
      reason: 'All acceptance criteria are verified.',
      completionEvidence: [
        {
          requirementId: 'focused-tests',
          evidenceId: 'ci-run-30182450098',
          summary: 'Focused durable-goal tests passed.',
          verifier: 'github-actions',
          verifiedAt: NOW.toISOString(),
        },
      ],
    });

    expect(complete).toMatchObject({
      state: 'complete',
      terminalReason: 'All acceptance criteria are verified.',
      completionEvidence: [{ evidenceId: 'ci-run-30182450098' }],
    });
    await expect(
      goalService.transition(goal.id, {
        expectedRevision: complete.revision,
        to: 'active',
        actorId: 'operator-brad',
        reason: 'Terminal goals cannot reopen.',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    await expect(
      goalService.linkRun(goal.id, {
        expectedRevision: complete.revision,
        run: { taskId: 'task-865', attemptId: 'attempt-after-complete' },
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  it('links a continuation run exactly once without changing goal state', async () => {
    const { goalService, goal } = await createGoal();
    const linked = await goalService.linkRun(goal.id, {
      expectedRevision: goal.revision,
      run: {
        taskId: 'task-865',
        attemptId: 'attempt-1',
        conversationId: 'conversation-1',
      },
    });
    const duplicate = await goalService.linkRun(goal.id, {
      expectedRevision: linked.revision,
      run: {
        taskId: 'task-865',
        attemptId: 'attempt-1',
        conversationId: 'conversation-1',
      },
    });

    expect(linked).toMatchObject({
      state: 'active',
      revision: 2,
      currentRun: { attemptId: 'attempt-1' },
    });
    expect(linked.continuationChain).toHaveLength(1);
    expect(duplicate).toEqual(linked);
  });
});
