import type {
  TaskEnvelope,
  WorkspaceCheckpoint,
  WorkspaceCheckpointBoundary,
  WorktreeManifest,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import {
  FileWorkspaceCheckpointRepository,
  getWorkspaceCheckpointIdForOperation,
  type WorkspaceCheckpointRepository,
} from '../storage/workspace-checkpoint-repository.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { WorktreeService } from './worktree-service.js';

export interface WorkspaceCheckpointOwnershipSource {
  getManifest(taskId: string): Promise<WorktreeManifest | null>;
}

export interface WorkspaceCheckpointBoundaryInput {
  taskEnvelope: TaskEnvelope;
  taskId: string;
  attemptId: string;
  operationId: string;
  boundary: WorkspaceCheckpointBoundary;
  turnId?: string;
  conversationCursor?: string;
}

export type WorkspaceCheckpointBoundaryResult =
  | {
      status: 'captured';
      checkpoint: WorkspaceCheckpoint;
    }
  | {
      status: 'skipped';
      reason: 'unmanaged-worktree';
    };

export interface WorkspaceCheckpointServiceOptions {
  repository?: WorkspaceCheckpointRepository;
  ownership?: WorkspaceCheckpointOwnershipSource;
  now?: () => Date;
}

export class WorkspaceCheckpointService {
  private readonly repository: WorkspaceCheckpointRepository;
  private readonly ownership: WorkspaceCheckpointOwnershipSource;
  private readonly now: () => Date;
  private readonly captureQueues = new Map<string, Promise<void>>();

  constructor(options: WorkspaceCheckpointServiceOptions = {}) {
    this.repository = options.repository ?? new FileWorkspaceCheckpointRepository();
    this.ownership = options.ownership ?? new WorktreeService();
    this.now = options.now ?? (() => new Date());
  }

  async captureBoundary(
    input: WorkspaceCheckpointBoundaryInput
  ): Promise<WorkspaceCheckpointBoundaryResult> {
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

    const scopeKey = digestRunLaunchValue([workspace.workspaceId, input.taskId, input.attemptId]);
    return this.serializeCapture(scopeKey, async () => {
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

      const operationIdDigest = digestRunLaunchValue(input.operationId);
      const checkpointId = getWorkspaceCheckpointIdForOperation({
        workspaceId: workspace.workspaceId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        operationIdDigest,
      });
      const existing = await this.repository.get({
        workspaceId: workspace.workspaceId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        checkpointId,
      });
      const latest = existing
        ? undefined
        : (
            await this.repository.list({
              workspaceId: workspace.workspaceId,
              taskId: input.taskId,
              attemptId: input.attemptId,
              limit: 1,
            })
          )[0];
      const checkpoint = await this.repository.capture({
        workspaceId: workspace.workspaceId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        operationId: input.operationId,
        boundary: input.boundary,
        worktreePath: workspace.worktreePath,
        worktreeManifestId: workspace.worktreeManifestId,
        parentCheckpointId: existing?.parentCheckpointId ?? latest?.id,
        turnId: input.turnId,
        conversationCursor: input.conversationCursor,
      });
      return { status: 'captured', checkpoint };
    });
  }

  private async serializeCapture<T>(scopeKey: string, capture: () => Promise<T>): Promise<T> {
    const previous = this.captureQueues.get(scopeKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.captureQueues.set(scopeKey, current);
    await previous;
    try {
      return await capture();
    } finally {
      if (this.captureQueues.get(scopeKey) === current) this.captureQueues.delete(scopeKey);
      release();
    }
  }
}

let singleton: WorkspaceCheckpointService | null = null;

export function getWorkspaceCheckpointService(): WorkspaceCheckpointService {
  singleton ??= new WorkspaceCheckpointService();
  return singleton;
}

export function resetWorkspaceCheckpointServiceForTests(): void {
  singleton = null;
}
