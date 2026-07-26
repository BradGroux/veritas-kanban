import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableGoalService } from '../services/durable-goal-service.js';
import { FileDurableGoalRepository } from '../storage/durable-goal-repository.js';
import type { DurableGoalRepository } from '../storage/interfaces.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteDurableGoalRepository } from '../storage/sqlite/durable-goal-repository.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('durable goal repository parity', () => {
  it('persists compare-and-set goal state through a file repository restart', async () => {
    const root = await temporaryRoot();
    const filePath = path.join(root, 'durable-goals.jsonl');

    await exerciseRepository(
      new FileDurableGoalRepository(filePath),
      async () => new FileDurableGoalRepository(filePath)
    );
  });

  it('persists compare-and-set goal state through a SQLite restart', async () => {
    const root = await temporaryRoot();
    const databasePath = path.join(root, 'veritas.db');
    let database = new SqliteDatabase({ databasePath });
    database.open();

    await exerciseRepository(new SqliteDurableGoalRepository(database), async () => {
      database.close();
      database = new SqliteDatabase({ databasePath });
      database.open();
      return new SqliteDurableGoalRepository(database);
    });

    database.close();
  });
});

async function exerciseRepository(
  repository: DurableGoalRepository,
  reopen: () => Promise<DurableGoalRepository>
): Promise<void> {
  const service = new DurableGoalService({
    repository,
    now: () => new Date('2026-07-26T02:00:00.000Z'),
  });
  const created = await service.create({
    id: 'goal_0123456789abcdef',
    workspaceId: 'workspace-a',
    objective: 'Persist this objective across restart.',
    acceptanceCriteria: ['The resumed service reads revision two.'],
    root: { kind: 'workflow', workflowId: 'workflow-865', taskId: 'task-865' },
    continuation: { mode: 'manual' },
    completionRequirements: [
      {
        id: 'restart-evidence',
        description: 'Restart recovery is verified.',
        required: true,
        verificationKind: 'test',
      },
    ],
  });
  const withOutcome = await service.recordRunOutcome(created.id, {
    expectedRevision: created.revision,
    run: { taskId: 'task-865', attemptId: 'attempt-1' },
    usageEvent: {
      id: 'completion-1',
      taskId: 'task-865',
      attemptId: 'attempt-1',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costUsd: 0.01,
        toolCalls: 2,
        runtimeSeconds: 3,
        idleRuntimeSeconds: 0,
        retries: 0,
        fanOut: 1,
      },
    },
  });
  const withPlan = await service.planContinuation(created.id, {
    expectedRevision: withOutcome.revision,
    sourceTaskId: 'task-865',
    sourceAttemptId: 'attempt-1',
    message: 'Continue after restart.',
  });
  const paused = await service.transition(created.id, {
    expectedRevision: withPlan.revision,
    to: 'paused',
    actorId: 'operator-brad',
    reason: 'Exercise durable compare-and-set state.',
  });

  expect(paused).toMatchObject({
    state: 'paused',
    revision: 4,
    usage: { totalTokens: 15, costUsd: 0.01 },
    usageEvents: [{ id: 'completion-1' }],
    continuationAttempts: [
      {
        sourceAttemptId: 'attempt-1',
        state: 'planned',
        admissionIdempotencyKey: `durable-goal:${created.id}:attempt-1`,
      },
    ],
  });
  expect(
    await repository.list({
      workspaceId: 'workspace-a',
      states: ['paused'],
      rootTaskId: 'task-865',
      rootWorkflowId: 'workflow-865',
    })
  ).toEqual([paused]);

  const restartedRepository = await reopen();
  const restarted = new DurableGoalService({
    repository: restartedRepository,
    now: () => new Date('2026-07-26T02:01:00.000Z'),
  });
  expect(await restarted.get(created.id)).toEqual(paused);
  expect(
    await restarted.transition(created.id, {
      expectedRevision: paused.revision,
      to: 'active',
      actorId: 'operator-brad',
      reason: 'Resume after restart.',
    })
  ).toMatchObject({ state: 'active', revision: 5 });
}

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-durable-goals-'));
  roots.push(root);
  return root;
}
