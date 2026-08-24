import { describe, expect, it } from 'vitest';
import type { Task, TaskAttempt, TaskEnvelope, UpdateTaskInput } from '@veritas-kanban/shared';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';
import {
  AttemptLifecycleCoordinator,
  type AttemptLifecycleStore,
} from '../services/attempt-lifecycle-coordinator.js';
import { ProviderCompletionService } from '../services/provider-completion-service.js';
import { TaskEnvelopeService } from '../services/task-envelope-service.js';

const completedAt = '2026-08-24T05:00:00.000Z';

function baseTask(): Task {
  return {
    id: 'task_lifecycle_completion',
    title: 'Persist completion through one lifecycle owner',
    description: 'Keep terminal attempt mutation behind the lifecycle coordinator.',
    type: 'code',
    status: 'in-progress',
    priority: 'high',
    project: 'veritas-kanban',
    created: '2026-08-24T04:00:00.000Z',
    updated: '2026-08-24T04:00:00.000Z',
    revision: 4,
    executionPolicy: { commitPolicy: 'allowed' },
  };
}

async function taskEnvelope(task: Task): Promise<TaskEnvelope> {
  return new TaskEnvelopeService({
    captureLaunchBaseline: async (_worktreePath, capturedAt) => ({
      capturedAt,
      headSha: 'a'.repeat(40),
      dirty: false,
      files: [],
    }),
    captureCompletionEvidence: async () => ({
      capturedAt: completedAt,
      headSha: 'b'.repeat(40),
      changedFiles: [],
      commits: [],
      artifacts: [],
      verification: [],
      sideEffects: [],
    }),
  }).build({
    task,
    attemptId: 'attempt_lifecycle_completion',
    createdAt: '2026-08-24T04:30:00.000Z',
    worktreePath: '/tmp/veritas-attempt-lifecycle',
    providerRuntimeManifest,
    commitPolicy: 'allowed',
  });
}

class MemoryAttemptLifecycleStore implements AttemptLifecycleStore {
  constructor(private task: Task) {}

  async getTask(taskId: string): Promise<Task | null> {
    return taskId === this.task.id ? structuredClone(this.task) : null;
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<Task | null> {
    if (taskId !== this.task.id) return null;
    if (input.expectedRevision !== this.task.revision) {
      throw new Error('Task revision conflict');
    }
    const { expectedRevision: _expectedRevision, ...patch } = input;
    this.task = {
      ...this.task,
      ...patch,
      revision: (this.task.revision ?? 0) + 1,
      updated: completedAt,
    };
    return structuredClone(this.task);
  }
}

async function completionFixture(summary = 'Lifecycle work completed.') {
  const task = baseTask();
  const providerRuntimeManifest = providerRuntimeManifestFixture();
  const envelope = await taskEnvelope(task);
  const attempt: TaskAttempt = {
    id: envelope.attempt.id,
    agent: 'codex',
    provider: envelope.launchManifest.provider,
    status: 'running',
    started: envelope.createdAt,
    providerRuntimeManifest,
    taskEnvelope: envelope,
  };
  const activeTask: Task = { ...task, attempt, attempts: [attempt] };
  const completionResult = await new ProviderCompletionService(
    {
      captureCompletionEvidence: async () => ({
        capturedAt: completedAt,
        headSha: 'b'.repeat(40),
        changedFiles: [],
        commits: [],
        artifacts: [],
        verification: [],
        sideEffects: [],
      }),
    },
    () => completedAt
  ).complete({
    task: activeTask,
    taskEnvelope: envelope,
    claim: {
      terminalSource: 'process',
      status: 'success',
      summary,
    },
  });
  return { task: activeTask, attempt, completionResult };
}

describe('AttemptLifecycleCoordinator', () => {
  it('persists terminal completion through the lifecycle seam', async () => {
    const { task, attempt, completionResult } = await completionFixture();
    const store = new MemoryAttemptLifecycleStore(task);
    const coordinator = new AttemptLifecycleCoordinator(store);

    const outcome = await coordinator.persistCompletion({
      task,
      attempt,
      completionResult,
    });

    expect(outcome.duplicate).toBe(false);
    expect(outcome.task).toMatchObject({
      status: 'done',
      revision: 5,
      attempt: {
        id: attempt.id,
        status: 'complete',
        ended: completedAt,
        completionResult: { idempotencyKey: completionResult.idempotencyKey },
      },
    });
    expect(outcome.task.attempts).toEqual([
      expect.objectContaining({ id: attempt.id, status: 'complete' }),
    ]);
    await expect(store.getTask(task.id)).resolves.toEqual(outcome.task);
  });

  it('retries a revision conflict against the same immutable attempt', async () => {
    const fixture = await completionFixture();
    const historicalAttempt: TaskAttempt = {
      id: 'attempt_historical',
      agent: 'hermes',
      provider: 'hermes-cli',
      status: 'complete',
      ended: '2026-08-24T03:00:00.000Z',
    };
    const currentTask: Task = {
      ...fixture.task,
      revision: 5,
      attempts: [historicalAttempt, fixture.attempt],
    };
    const coordinator = new AttemptLifecycleCoordinator(
      new MemoryAttemptLifecycleStore(currentTask)
    );

    const outcome = await coordinator.persistCompletion(fixture);

    expect(outcome.task.revision).toBe(6);
    expect(outcome.task.attempts?.map((attempt) => attempt.id)).toEqual([
      historicalAttempt.id,
      fixture.attempt.id,
    ]);
  });

  it('treats the same persisted terminal result as an idempotent duplicate', async () => {
    const fixture = await completionFixture();
    const completedAttempt: TaskAttempt = {
      ...fixture.attempt,
      status: 'complete',
      ended: completedAt,
      completionResult: fixture.completionResult,
    };
    const persistedTask: Task = {
      ...fixture.task,
      status: 'done',
      revision: 5,
      attempt: completedAttempt,
      attempts: [completedAttempt],
    };
    const coordinator = new AttemptLifecycleCoordinator(
      new MemoryAttemptLifecycleStore(persistedTask)
    );

    const outcome = await coordinator.persistCompletion(fixture);

    expect(outcome.duplicate).toBe(true);
    expect(outcome.task).toEqual(persistedTask);
  });

  it('fails closed when another attempt owns the task during retry', async () => {
    const fixture = await completionFixture();
    const competingAttempt: TaskAttempt = {
      id: 'attempt_competing',
      agent: 'hermes',
      provider: 'hermes-cli',
      status: 'running',
    };
    const coordinator = new AttemptLifecycleCoordinator(
      new MemoryAttemptLifecycleStore({
        ...fixture.task,
        revision: 5,
        attempt: competingAttempt,
        attempts: [fixture.attempt, competingAttempt],
      })
    );

    await expect(coordinator.persistCompletion(fixture)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        activeAttemptId: competingAttempt.id,
        finalizationAttemptId: fixture.attempt.id,
      }),
    });
  });

  it('rejects stale completion input before the first persistence attempt', async () => {
    const fixture = await completionFixture();
    const competingAttempt: TaskAttempt = {
      id: 'attempt_competing',
      agent: 'hermes',
      provider: 'hermes-cli',
      status: 'running',
    };
    const staleTask: Task = {
      ...fixture.task,
      attempt: competingAttempt,
      attempts: [fixture.attempt, competingAttempt],
    };
    const coordinator = new AttemptLifecycleCoordinator(new MemoryAttemptLifecycleStore(staleTask));

    await expect(
      coordinator.persistCompletion({ ...fixture, task: staleTask })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        activeAttemptId: competingAttempt.id,
        finalizationAttemptId: fixture.attempt.id,
      }),
    });
  });

  it('rejects a different persisted terminal result for the same attempt', async () => {
    const fixture = await completionFixture();
    const competingFixture = await completionFixture('A different terminal claim completed.');
    const competingResult = competingFixture.completionResult;
    const completedAttempt: TaskAttempt = {
      ...fixture.attempt,
      status: 'complete',
      ended: completedAt,
      completionResult: competingResult,
    };
    const persistedTask: Task = {
      ...fixture.task,
      status: 'done',
      revision: 5,
      attempt: completedAttempt,
      attempts: [completedAttempt],
    };
    const coordinator = new AttemptLifecycleCoordinator(
      new MemoryAttemptLifecycleStore(persistedTask)
    );

    await expect(coordinator.persistCompletion(fixture)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      details: expect.objectContaining({
        persistedIdempotencyKey: competingResult.idempotencyKey,
        completionIdempotencyKey: fixture.completionResult.idempotencyKey,
      }),
    });
  });

  it('preserves a non-active task status during startup reconciliation', async () => {
    const fixture = await completionFixture();
    const blockedTask: Task = { ...fixture.task, status: 'blocked' };
    const coordinator = new AttemptLifecycleCoordinator(
      new MemoryAttemptLifecycleStore(blockedTask)
    );

    const outcome = await coordinator.persistCompletion({
      ...fixture,
      task: blockedTask,
      preserveNonActiveTaskStatus: true,
    });

    expect(outcome.task.status).toBe('blocked');
  });
});
