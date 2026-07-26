import type { TaskEnvelope, WorktreeManifest } from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import { WorktreeService } from './worktree-service.js';

export interface WorkspaceCheckpointOwnershipSource {
  getManifest(taskId: string): Promise<WorktreeManifest | null>;
}

export interface WorkspaceCheckpointOwnershipInput {
  taskEnvelope: TaskEnvelope;
  taskId: string;
  attemptId: string;
}

export type WorkspaceCheckpointOwnershipResult =
  | { status: 'verified'; manifest: WorktreeManifest }
  | { status: 'skipped'; reason: 'unmanaged-worktree' };

export interface WorkspaceCheckpointOwnershipServiceOptions {
  ownership?: WorkspaceCheckpointOwnershipSource;
  now?: () => Date;
}

export class WorkspaceCheckpointOwnershipService {
  private readonly ownership: WorkspaceCheckpointOwnershipSource;
  private readonly now: () => Date;

  constructor(options: WorkspaceCheckpointOwnershipServiceOptions = {}) {
    this.ownership = options.ownership ?? new WorktreeService();
    this.now = options.now ?? (() => new Date());
  }

  async verify(
    input: WorkspaceCheckpointOwnershipInput
  ): Promise<WorkspaceCheckpointOwnershipResult> {
    const workspace = input.taskEnvelope.workspace;
    if (!workspace.worktreeManifestId && !workspace.ownershipLeaseId) {
      return { status: 'skipped', reason: 'unmanaged-worktree' };
    }
    if (!workspace.worktreeManifestId || !workspace.ownershipLeaseId) {
      throw new ConflictError(
        'Workspace checkpoint requires complete managed-worktree ownership evidence.',
        {
          taskId: input.taskId,
          attemptId: input.attemptId,
          hasManifestId: Boolean(workspace.worktreeManifestId),
          hasLeaseId: Boolean(workspace.ownershipLeaseId),
        }
      );
    }
    if (
      input.taskEnvelope.subject.id !== input.taskId ||
      input.taskEnvelope.attempt.id !== input.attemptId ||
      workspace.ownershipAttemptId !== input.attemptId
    ) {
      throw new ConflictError(
        'Workspace checkpoint request does not match its task-envelope ownership.',
        {
          taskId: input.taskId,
          attemptId: input.attemptId,
          envelopeTaskId: input.taskEnvelope.subject.id,
          envelopeAttemptId: input.taskEnvelope.attempt.id,
          ownershipAttemptId: workspace.ownershipAttemptId,
        }
      );
    }

    const manifest = await this.ownership.getManifest(input.taskId);
    if (
      !manifest ||
      manifest.id !== workspace.worktreeManifestId ||
      manifest.taskId !== input.taskId ||
      manifest.path !== workspace.worktreePath ||
      manifest.branch !== workspace.branch ||
      manifest.lease.id !== workspace.ownershipLeaseId ||
      manifest.lease.ownerTaskId !== input.taskId ||
      manifest.lease.ownerAttemptId !== input.attemptId ||
      Date.parse(manifest.lease.expiresAt) <= this.now().getTime() ||
      manifest.lifecycle.creation !== 'ready' ||
      manifest.lifecycle.integration !== 'idle' ||
      manifest.lifecycle.cleanup !== 'active' ||
      manifest.rebase.state !== 'idle'
    ) {
      throw new ConflictError(
        'Workspace checkpoint cannot prove current run-owned worktree authority.',
        {
          taskId: input.taskId,
          attemptId: input.attemptId,
          manifestId: workspace.worktreeManifestId,
          activeManifestId: manifest?.id,
          activeOwnerAttemptId: manifest?.lease.ownerAttemptId,
          leaseExpiresAt: manifest?.lease.expiresAt,
          lifecycle: manifest?.lifecycle,
          rebaseState: manifest?.rebase.state,
        }
      );
    }
    return { status: 'verified', manifest };
  }
}
