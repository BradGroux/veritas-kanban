import type {
  TaskEnvelope,
  WorkspaceCheckpoint,
  WorkspaceCheckpointBoundary,
} from '@veritas-kanban/shared';
import {
  FileWorkspaceCheckpointRepository,
  getWorkspaceCheckpointIdForOperation,
  type WorkspaceCheckpointRepository,
} from '../storage/workspace-checkpoint-repository.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import {
  WorkspaceCheckpointOwnershipService,
  type WorkspaceCheckpointOwnershipSource,
} from './workspace-checkpoint-ownership-service.js';

export type { WorkspaceCheckpointOwnershipSource } from './workspace-checkpoint-ownership-service.js';

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
  private readonly authority: WorkspaceCheckpointOwnershipService;
  private readonly captureQueues = new Map<string, Promise<void>>();

  constructor(options: WorkspaceCheckpointServiceOptions = {}) {
    this.repository = options.repository ?? new FileWorkspaceCheckpointRepository();
    this.authority = new WorkspaceCheckpointOwnershipService(options);
  }

  async captureBoundary(
    input: WorkspaceCheckpointBoundaryInput
  ): Promise<WorkspaceCheckpointBoundaryResult> {
    const workspace = input.taskEnvelope.workspace;
    const scopeKey = digestRunLaunchValue([workspace.workspaceId, input.taskId, input.attemptId]);
    return this.serializeCapture(scopeKey, async () => {
      const authority = await this.authority.verify(input);
      if (authority.status === 'skipped') return authority;

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
        worktreeManifestId: authority.manifest.id,
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
