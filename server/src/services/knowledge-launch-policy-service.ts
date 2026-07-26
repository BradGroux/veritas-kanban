import type {
  KnowledgeLaunchContext,
  RunLaunchManifest,
  TaskAttempt,
} from '@veritas-kanban/shared';
import { ConflictError, ForbiddenError } from '../middleware/error-handler.js';
import { parseRunLaunchManifest } from '../schemas/run-launch-manifest-schemas.js';
import { getTaskService, type TaskService } from './task-service.js';

export interface KnowledgeLaunchPolicyResolver {
  resolve(context: KnowledgeLaunchContext): Promise<Set<string>>;
}

export class KnowledgeLaunchPolicyService implements KnowledgeLaunchPolicyResolver {
  constructor(private readonly tasks: Pick<TaskService, 'getTask'> = getTaskService()) {}

  async resolve(context: KnowledgeLaunchContext): Promise<Set<string>> {
    const task = await this.tasks.getTask(context.taskId);
    if (!task) throw new ForbiddenError('Knowledge launch task is unavailable.');
    const attempts = [task.attempt, ...(task.attempts ?? [])].filter(
      (attempt): attempt is TaskAttempt => Boolean(attempt)
    );
    const attempt = attempts.find((candidate) => candidate.id === context.attemptId);
    if (!attempt?.runLaunchManifest) {
      throw new ForbiddenError('Knowledge launch attempt has no persisted manifest.');
    }
    const manifest: RunLaunchManifest = parseRunLaunchManifest(attempt.runLaunchManifest);
    if (
      manifest.taskId !== context.taskId ||
      manifest.attemptId !== context.attemptId ||
      manifest.digest !== context.launchManifestDigest
    ) {
      throw new ConflictError('Knowledge launch manifest binding is stale or invalid.');
    }
    if (manifest.enforcement.blockers.length > 0 || manifest.resources.enforcement !== 'enforced') {
      throw new ForbiddenError('Knowledge launch resources are not enforceable.');
    }
    return new Set(manifest.resources.shared);
  }
}
