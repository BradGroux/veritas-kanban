import type {
  CompletionResult,
  Task,
  TaskAttempt,
  TaskCompletionStatus,
  TaskEnvelope,
  UpdateTaskInput,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import {
  parseCompletionResultForEnvelope,
  parseTaskEnvelope,
} from '../schemas/task-envelope-schemas.js';
import { parseRunLaunchManifest } from '../schemas/run-launch-manifest-schemas.js';
import { assertProviderRuntimeManifestSnapshot } from './provider-runtime-control-service.js';

const COMPLETION_PERSISTENCE_ATTEMPTS = 3;

export interface AttemptLifecycleStore {
  getTask(taskId: string): Promise<Task | null>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<Task | null>;
  patchTaskAttempt(
    taskId: string,
    attemptId: string,
    patch: Partial<Omit<TaskAttempt, 'id'>>
  ): Promise<Task | null>;
}

export interface PersistActiveAttemptInput {
  task: Task;
  attempt: TaskAttempt;
  status?: UpdateTaskInput['status'];
}

export interface BeginAttemptInput {
  task: Task;
  attempt: TaskAttempt;
}

export interface PersistAttemptCompletionInput {
  task: Task;
  attempt: TaskAttempt;
  completionResult: CompletionResult;
  preserveNonActiveTaskStatus?: boolean;
  clearRunRecovery?: boolean;
}

export interface PersistAttemptCompletionOutcome {
  task: Task;
  attempt: TaskAttempt;
  completionResult: CompletionResult;
  duplicate: boolean;
}

export class CompletionOwnershipError extends ConflictError {}
export class AttemptOwnershipError extends ConflictError {}

/**
 * Owns attempt mutation and its persistence invariants from launch through
 * terminal completion. Provider orchestration prepares state and evidence,
 * then crosses this seam instead of writing attempt fields directly.
 */
export class AttemptLifecycleCoordinator {
  constructor(private readonly store: AttemptLifecycleStore) {}

  /**
   * Replaces the currently active attempt while preserving one canonical
   * history entry for that same attempt ID.
   */
  async persistActiveAttempt(input: PersistActiveAttemptInput): Promise<Task | null> {
    this.assertActiveAttempt(input.task, input.attempt.id, 'Attempt update');
    return this.store.updateTask(input.task.id, {
      expectedRevision: normalizedTaskRevision(input.task),
      ...(input.status !== undefined ? { status: input.status } : {}),
      attempt: input.attempt,
      attempts: upsertAttemptHistory(input.task.attempts, input.attempt),
    });
  }

  /**
   * Installs a new running attempt and archives the displaced active attempt.
   * The new attempt remains solely in `task.attempt` until it reaches a state
   * transition that belongs in history.
   */
  async beginAttempt(input: BeginAttemptInput): Promise<Task | null> {
    if (input.task.attempt?.id === input.attempt.id) {
      throw new AttemptOwnershipError('New attempt already owns the task', {
        taskId: input.task.id,
        attemptId: input.attempt.id,
      });
    }
    if (input.attempt.status !== 'running') {
      throw new AttemptOwnershipError('New attempt must begin in the running state', {
        taskId: input.task.id,
        attemptId: input.attempt.id,
        attemptStatus: input.attempt.status,
      });
    }
    return this.store.updateTask(input.task.id, {
      expectedRevision: normalizedTaskRevision(input.task),
      status: 'in-progress',
      attempt: input.attempt,
      attempts: input.task.attempt
        ? upsertAttemptHistory(input.task.attempts, input.task.attempt)
        : input.task.attempts,
    });
  }

  /** Records a provider launch failure without losing the displaced attempt. */
  async persistLaunchFailure(taskId: string, attempt: TaskAttempt): Promise<Task | null> {
    if (attempt.status !== 'failed') {
      throw new AttemptOwnershipError('Launch failure must persist a failed attempt', {
        taskId,
        attemptId: attempt.id,
        attemptStatus: attempt.status,
      });
    }
    const task = await this.store.getTask(taskId);
    if (!task) return null;
    this.assertActiveAttempt(task, attempt.id, 'Launch failure');
    return this.store.updateTask(taskId, {
      expectedRevision: normalizedTaskRevision(task),
      status: 'todo',
      attempt,
      attempts: upsertAttemptHistory(
        task.attempt ? upsertAttemptHistory(task.attempts, task.attempt) : task.attempts,
        attempt
      ),
    });
  }

  /** Applies a partial mutation only while the same attempt still owns the task. */
  async patchActiveAttempt(
    taskId: string,
    attemptId: string,
    patch: Partial<Omit<TaskAttempt, 'id'>>
  ): Promise<Task | null> {
    return this.store.patchTaskAttempt(taskId, attemptId, patch);
  }

  parsePersistedCompletion(attempt: TaskAttempt): CompletionResult {
    if (!attempt.taskEnvelope || !attempt.completionResult) {
      throw new CompletionOwnershipError(
        'Persisted provider completion is missing its task envelope',
        { attemptId: attempt.id }
      );
    }
    try {
      return parseCompletionResultForEnvelope(attempt.completionResult, attempt.taskEnvelope);
    } catch {
      throw new CompletionOwnershipError(
        'Persisted provider completion failed integrity validation',
        {
          attemptId: attempt.id,
          remediation:
            'Repair or remove the corrupted completion record before accepting another terminal claim.',
        }
      );
    }
  }

  assertCompletionBinding(taskId: string, attempt: TaskAttempt): TaskEnvelope {
    const providerRuntimeManifest = attempt.providerRuntimeManifest;
    const taskEnvelope = attempt.taskEnvelope;
    if (!providerRuntimeManifest || !taskEnvelope) {
      throw new CompletionOwnershipError(
        'Persisted attempt is missing immutable completion bindings',
        { taskId, attemptId: attempt.id }
      );
    }

    let parsedEnvelope: TaskEnvelope;
    let parsedRunLaunchManifest: ReturnType<typeof parseRunLaunchManifest> | undefined;
    try {
      assertProviderRuntimeManifestSnapshot(providerRuntimeManifest);
      parsedEnvelope = parseTaskEnvelope(taskEnvelope);
      parsedRunLaunchManifest = attempt.runLaunchManifest
        ? parseRunLaunchManifest(attempt.runLaunchManifest)
        : undefined;
    } catch {
      throw new CompletionOwnershipError('Persisted attempt binding failed integrity validation', {
        taskId,
        attemptId: attempt.id,
      });
    }

    const mismatches = [
      attempt.provider !== providerRuntimeManifest.provider && 'attempt runtime provider',
      parsedEnvelope.subject.id !== taskId && 'task ID',
      parsedEnvelope.attempt.id !== attempt.id && 'attempt ID',
      parsedEnvelope.launchManifest.digest !== providerRuntimeManifest.digest &&
        'envelope runtime digest',
      parsedEnvelope.launchManifest.provider !== providerRuntimeManifest.provider &&
        'envelope runtime provider',
      parsedEnvelope.launchManifest.adapter !== providerRuntimeManifest.adapter &&
        'envelope runtime adapter',
      parsedEnvelope.launchManifest.protocolVersion !== providerRuntimeManifest.protocolVersion &&
        'envelope runtime protocol',
      parsedRunLaunchManifest?.taskId !== undefined &&
        parsedRunLaunchManifest.taskId !== taskId &&
        'run launch task ID',
      parsedRunLaunchManifest?.attemptId !== undefined &&
        parsedRunLaunchManifest.attemptId !== attempt.id &&
        'run launch attempt ID',
      parsedRunLaunchManifest?.taskEnvelope.digest !== undefined &&
        parsedRunLaunchManifest.taskEnvelope.digest !== parsedEnvelope.digest &&
        'run launch task envelope digest',
      parsedRunLaunchManifest?.providerRuntime.digest !== undefined &&
        parsedRunLaunchManifest.providerRuntime.digest !== providerRuntimeManifest.digest &&
        'run launch runtime digest',
      parsedRunLaunchManifest?.providerRuntime.provider !== undefined &&
        parsedRunLaunchManifest.providerRuntime.provider !== providerRuntimeManifest.provider &&
        'run launch runtime provider',
      parsedRunLaunchManifest?.providerRuntime.adapter !== undefined &&
        parsedRunLaunchManifest.providerRuntime.adapter !== providerRuntimeManifest.adapter &&
        'run launch runtime adapter',
    ].filter((field): field is string => typeof field === 'string');

    if (mismatches.length > 0) {
      throw new CompletionOwnershipError('Persisted attempt completion bindings do not agree', {
        taskId,
        attemptId: attempt.id,
        mismatches,
        remediation: 'Repair the persisted attempt binding before accepting a terminal completion.',
      });
    }
    return parsedEnvelope;
  }

  async persistCompletion(
    input: PersistAttemptCompletionInput
  ): Promise<PersistAttemptCompletionOutcome> {
    const taskId = input.task.id;
    if (input.task.attempt?.id !== input.attempt.id) {
      throw new CompletionOwnershipError(
        'Provider finalization does not match the active attempt',
        {
          taskId,
          activeAttemptId: input.task.attempt?.id,
          finalizationAttemptId: input.attempt.id,
        }
      );
    }
    const envelope = this.assertCompletionBinding(taskId, input.attempt);
    const completionResult = parseCompletionResultForEnvelope(input.completionResult, envelope);
    const completedAttempt: TaskAttempt = {
      ...input.attempt,
      status: completionResult.status === 'success' ? 'complete' : 'failed',
      ended: completionResult.completedAt,
      completionResult,
      ...(input.clearRunRecovery ? { runRecovery: undefined } : {}),
    };
    let taskSnapshot = input.task;
    let lastError: unknown;

    for (
      let persistenceAttempt = 1;
      persistenceAttempt <= COMPLETION_PERSISTENCE_ATTEMPTS;
      persistenceAttempt++
    ) {
      try {
        const statusUpdate =
          input.preserveNonActiveTaskStatus && taskSnapshot.status !== 'in-progress'
            ? {}
            : { status: taskStatusForCompletion(completionResult.status) };
        const updatedTask = await this.store.updateTask(taskId, {
          expectedRevision: normalizedTaskRevision(taskSnapshot),
          ...statusUpdate,
          attempt: completedAttempt,
          attempts: upsertAttemptHistory(taskSnapshot.attempts, completedAttempt),
        });
        if (!updatedTask) {
          throw new CompletionOwnershipError(
            'Task was archived or deleted before completion could be persisted',
            { taskId, attemptId: input.attempt.id }
          );
        }
        return {
          task: updatedTask,
          attempt: completedAttempt,
          completionResult,
          duplicate: false,
        };
      } catch (error) {
        if (error instanceof CompletionOwnershipError) throw error;
        lastError = error;

        let latestTask: Task | null;
        try {
          latestTask = await this.store.getTask(taskId);
        } catch {
          continue;
        }
        if (!latestTask) continue;
        if (latestTask.attempt?.id !== input.attempt.id) {
          throw new CompletionOwnershipError(
            'Provider finalization no longer matches the active attempt',
            {
              taskId,
              activeAttemptId: latestTask.attempt?.id,
              finalizationAttemptId: input.attempt.id,
            }
          );
        }
        this.assertRetryBinding(taskId, completedAttempt, latestTask.attempt);
        if (latestTask.attempt.completionResult) {
          const persisted = this.parsePersistedCompletion(latestTask.attempt);
          if (persisted.idempotencyKey === completionResult.idempotencyKey) {
            return {
              task: latestTask,
              attempt: latestTask.attempt,
              completionResult: persisted,
              duplicate: true,
            };
          }
          throw new CompletionOwnershipError(
            'A different terminal result already owns this attempt',
            {
              taskId,
              attemptId: input.attempt.id,
              persistedIdempotencyKey: persisted.idempotencyKey,
              completionIdempotencyKey: completionResult.idempotencyKey,
            }
          );
        }
        taskSnapshot = latestTask;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Provider completion persistence retry budget was exhausted');
  }

  private assertActiveAttempt(task: Task, attemptId: string, operation: string): void {
    if (task.attempt?.id === attemptId) return;
    throw new AttemptOwnershipError(`${operation} does not match the active attempt`, {
      taskId: task.id,
      activeAttemptId: task.attempt?.id,
      requestedAttemptId: attemptId,
    });
  }

  private assertRetryBinding(
    taskId: string,
    expectedAttempt: TaskAttempt,
    latestAttempt: TaskAttempt
  ): void {
    this.assertCompletionBinding(taskId, latestAttempt);
    const mismatches = [
      expectedAttempt.provider !== latestAttempt.provider && 'provider',
      expectedAttempt.providerRuntimeManifest?.digest !==
        latestAttempt.providerRuntimeManifest?.digest && 'provider runtime manifest',
      expectedAttempt.taskEnvelope?.digest !== latestAttempt.taskEnvelope?.digest &&
        'task envelope',
      expectedAttempt.runLaunchManifest?.digest !== latestAttempt.runLaunchManifest?.digest &&
        'run launch manifest',
    ].filter((field): field is string => typeof field === 'string');
    if (mismatches.length > 0) {
      throw new CompletionOwnershipError(
        'Persisted attempt binding changed during completion retry',
        {
          attemptId: latestAttempt.id,
          mismatches,
          remediation:
            'Discard the stale local finalizer and reconcile the currently persisted attempt.',
        }
      );
    }
  }
}

function normalizedTaskRevision(task: Pick<Task, 'revision'>): number {
  return typeof task.revision === 'number' && Number.isInteger(task.revision) && task.revision >= 0
    ? task.revision
    : 1;
}

function taskStatusForCompletion(status: TaskCompletionStatus): 'done' | 'blocked' | 'in-progress' {
  if (status === 'success') return 'done';
  if (status === 'blocked') return 'blocked';
  return 'in-progress';
}

function upsertAttemptHistory(
  history: TaskAttempt[] | undefined,
  attempt: TaskAttempt
): TaskAttempt[] {
  return [...(history ?? []).filter((candidate) => candidate.id !== attempt.id), attempt];
}
