import type {
  ExecutableAgentProvider,
  RunApprovalRequest,
  TaskEnvelope,
  WorkspaceCheckpointRewindPreview,
  WorkspaceCheckpointRewindTransaction,
} from '@veritas-kanban/shared';
import { ConflictError, ForbiddenError } from '../middleware/error-handler.js';
import {
  FileWorkspaceCheckpointRepository,
  type WorkspaceCheckpointRepository,
} from '../storage/workspace-checkpoint-repository.js';
import {
  getRunApprovalBrokerService,
  type RunApprovalBrokerService,
} from './run-approval-broker-service.js';
import { WorkspaceCheckpointRewindPreviewService } from './workspace-checkpoint-rewind-preview-service.js';

export interface WorkspaceCheckpointRewindRequest {
  taskEnvelope: TaskEnvelope;
  taskId: string;
  attemptId: string;
  targetCheckpointId: string;
  descendantCheckpointId: string;
  requestId: string;
}

export interface WorkspaceCheckpointRewindRuntimeSnapshot {
  provider: ExecutableAgentProvider;
  agentId: string;
  evidenceRevision: string;
  stateDigest: string;
  conversationCursor: string;
  rewindAnchorCursor?: string;
}

export interface WorkspaceCheckpointRewindQuiescedRuntime {
  token: string;
  snapshot: WorkspaceCheckpointRewindRuntimeSnapshot;
}

export interface WorkspaceCheckpointRewindRuntime {
  inspect(
    input: WorkspaceCheckpointRewindRequest
  ): Promise<WorkspaceCheckpointRewindRuntimeSnapshot>;
  quiesce(
    input: WorkspaceCheckpointRewindRequest & {
      expectedStateDigest: string;
      previewEvidenceDigest: string;
    }
  ): Promise<WorkspaceCheckpointRewindQuiescedRuntime>;
  commit(input: {
    request: WorkspaceCheckpointRewindRequest;
    token: string;
    expectedStateDigest: string;
    targetConversationCursor: string;
    transaction: WorkspaceCheckpointRewindTransaction;
  }): Promise<WorkspaceCheckpointRewindRuntimeSnapshot>;
  rollback(input: {
    request: WorkspaceCheckpointRewindRequest;
    token: string;
    snapshot: WorkspaceCheckpointRewindRuntimeSnapshot;
  }): Promise<WorkspaceCheckpointRewindRuntimeSnapshot>;
}

export type WorkspaceCheckpointRewindResult =
  | {
      status: 'approval-required';
      preview: WorkspaceCheckpointRewindPreview;
      approval: RunApprovalRequest;
    }
  | {
      status: 'completed';
      preview: WorkspaceCheckpointRewindPreview;
      approval: RunApprovalRequest;
      transaction: WorkspaceCheckpointRewindTransaction;
      runtime: WorkspaceCheckpointRewindRuntimeSnapshot;
    };

export interface WorkspaceCheckpointRewindServiceOptions {
  repository?: WorkspaceCheckpointRepository;
  previews?: Pick<WorkspaceCheckpointRewindPreviewService, 'preview'>;
  approvals?: Pick<RunApprovalBrokerService, 'request' | 'get'>;
  runtime: WorkspaceCheckpointRewindRuntime;
}

export class WorkspaceCheckpointRewindService {
  private readonly repository: WorkspaceCheckpointRepository;
  private readonly previews: Pick<WorkspaceCheckpointRewindPreviewService, 'preview'>;
  private readonly approvals: Pick<RunApprovalBrokerService, 'request' | 'get'>;
  private readonly runtime: WorkspaceCheckpointRewindRuntime;

  constructor(options: WorkspaceCheckpointRewindServiceOptions) {
    this.repository = options.repository ?? new FileWorkspaceCheckpointRepository();
    this.previews = options.previews ?? new WorkspaceCheckpointRewindPreviewService();
    this.approvals = options.approvals ?? getRunApprovalBrokerService();
    this.runtime = options.runtime;
  }

  async execute(input: WorkspaceCheckpointRewindRequest): Promise<WorkspaceCheckpointRewindResult> {
    const preview = await this.previews.preview(input);
    if (!preview.safeForAutomaticRewind) {
      throw new ConflictError('Workspace rewind preview contains unresolved conflicts.', {
        conflicts: preview.conflicts,
      });
    }
    const runtimeBeforeApproval = await this.runtime.inspect(input);
    const descendantBeforeApproval = await this.repository.get({
      workspaceId: preview.workspaceId,
      taskId: preview.taskId,
      attemptId: preview.attemptId,
      checkpointId: preview.descendantCheckpointId,
    });
    if (
      !descendantBeforeApproval?.conversationCursor ||
      descendantBeforeApproval.conversationCursor !== runtimeBeforeApproval.conversationCursor
    ) {
      throw new ConflictError(
        'Workspace rewind runtime cursor does not match the descendant checkpoint.'
      );
    }
    const requestedApproval = await this.approvals.request({
      workspaceId: input.taskEnvelope.workspace.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      provider: runtimeBeforeApproval.provider,
      agentId: runtimeBeforeApproval.agentId,
      providerRequestId: `workspace-rewind:${input.requestId}`,
      requestKind: 'approval',
      actionClass: 'filesystem',
      action: `Rewind workspace to ${input.targetCheckpointId}`,
      details: `${preview.files.length} affected paths; estimated ${preview.estimatedDataLossBytes} bytes discarded`,
      resourceScope: [
        `worktree:${preview.ownership.manifestId}`,
        `checkpoint:${input.targetCheckpointId}`,
        `checkpoint:${input.descendantCheckpointId}`,
      ],
      workingDirectory: input.taskEnvelope.workspace.worktreePath,
      riskClass: 'critical',
      policyReason:
        'Workspace rewind discards approved agent-authored changes and must match exact evidence.',
      evidenceRevision: preview.evidenceDigest,
      mobileSafe: false,
      exactAction: {
        schemaVersion: 'workspace-checkpoint-rewind-action/v1',
        workspaceId: preview.workspaceId,
        taskId: preview.taskId,
        attemptId: preview.attemptId,
        requestId: input.requestId,
        targetCheckpointId: preview.targetCheckpointId,
        descendantCheckpointId: preview.descendantCheckpointId,
        previewEvidenceDigest: preview.evidenceDigest,
        runtimeStateDigest: runtimeBeforeApproval.stateDigest,
        runtimeEvidenceRevision: runtimeBeforeApproval.evidenceRevision,
        estimatedDataLossBytes: preview.estimatedDataLossBytes,
      },
    });
    const approval = await this.approvals.get(
      requestedApproval.id,
      input.taskEnvelope.workspace.workspaceId
    );
    if (approval.status === 'pending') {
      return { status: 'approval-required', preview, approval };
    }
    if (approval.status !== 'approved') {
      throw new ForbiddenError('Workspace rewind was not approved.', {
        approvalId: approval.id,
        status: approval.status,
      });
    }

    const quiesced = await this.runtime.quiesce({
      ...input,
      expectedStateDigest: runtimeBeforeApproval.stateDigest,
      previewEvidenceDigest: preview.evidenceDigest,
    });
    if (!sameRuntimeSnapshot(quiesced.snapshot, runtimeBeforeApproval)) {
      await this.rollbackRuntime(input, quiesced, 'Runtime changed while it was quiesced.');
    }

    let transaction: WorkspaceCheckpointRewindTransaction | undefined;
    try {
      const approvedPreview = await this.previews.preview(input);
      if (approvedPreview.evidenceDigest !== preview.evidenceDigest) {
        throw new ConflictError('Workspace rewind evidence changed after approval.', {
          approvalId: approval.id,
          approvedEvidenceDigest: preview.evidenceDigest,
          currentEvidenceDigest: approvedPreview.evidenceDigest,
        });
      }
      const target = await this.repository.get({
        workspaceId: approvedPreview.workspaceId,
        taskId: approvedPreview.taskId,
        attemptId: approvedPreview.attemptId,
        checkpointId: approvedPreview.targetCheckpointId,
      });
      if (!target?.conversationCursor) {
        throw new ConflictError(
          'Workspace rewind target no longer has a restorable conversation cursor.'
        );
      }
      transaction = await this.repository.rewind({
        workspaceId: approvedPreview.workspaceId,
        taskId: approvedPreview.taskId,
        attemptId: approvedPreview.attemptId,
        operationId: input.requestId,
        worktreePath: input.taskEnvelope.workspace.worktreePath,
        preview: approvedPreview,
      });
      const runtime = await this.runtime.commit({
        request: input,
        token: quiesced.token,
        expectedStateDigest: quiesced.snapshot.stateDigest,
        targetConversationCursor: target.conversationCursor,
        transaction,
      });
      if (runtime.rewindAnchorCursor !== target.conversationCursor) {
        throw new ConflictError(
          'Workspace rewind runtime did not recover from the target conversation cursor.'
        );
      }
      return { status: 'completed', preview: approvedPreview, approval, transaction, runtime };
    } catch (error) {
      if (transaction?.state === 'committed') {
        try {
          await this.repository.rollbackRewind({
            workspaceId: transaction.workspaceId,
            taskId: transaction.taskId,
            attemptId: transaction.attemptId,
            transactionId: transaction.id,
            worktreePath: input.taskEnvelope.workspace.worktreePath,
            expectedTransactionDigest: transaction.digest,
          });
        } catch (rollbackError) {
          throw new ConflictError(
            'Workspace rewind runtime failed and storage rollback requires recovery; the runtime remains quiesced.',
            {
              transactionId: transaction.id,
              error: error instanceof Error ? error.message : String(error),
              rollbackError:
                rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
            }
          );
        }
      }
      return this.rollbackRuntime(
        input,
        quiesced,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async rollbackRuntime(
    input: WorkspaceCheckpointRewindRequest,
    quiesced: WorkspaceCheckpointRewindQuiescedRuntime,
    cause: string
  ): Promise<never> {
    try {
      await this.runtime.rollback({
        request: input,
        token: quiesced.token,
        snapshot: quiesced.snapshot,
      });
    } catch (rollbackError) {
      throw new ConflictError('Workspace rewind failed and runtime rollback requires recovery.', {
        cause,
        rollbackError:
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
    throw new ConflictError(
      'Workspace rewind failed and recovered from the prior runtime anchor.',
      {
        cause,
      }
    );
  }
}

function sameRuntimeSnapshot(
  left: WorkspaceCheckpointRewindRuntimeSnapshot,
  right: WorkspaceCheckpointRewindRuntimeSnapshot
): boolean {
  return (
    left.provider === right.provider &&
    left.agentId === right.agentId &&
    left.evidenceRevision === right.evidenceRevision &&
    left.stateDigest === right.stateDigest &&
    left.conversationCursor === right.conversationCursor &&
    left.rewindAnchorCursor === right.rewindAnchorCursor
  );
}
