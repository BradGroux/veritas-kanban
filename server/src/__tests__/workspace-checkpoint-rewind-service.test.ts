import { describe, expect, it, vi } from 'vitest';
import type {
  RunApprovalRequest,
  TaskEnvelope,
  WorkspaceCheckpoint,
  WorkspaceCheckpointRewindPreview,
  WorkspaceCheckpointRewindTransaction,
} from '@veritas-kanban/shared';
import type { WorkspaceCheckpointRepository } from '../storage/workspace-checkpoint-repository.js';
import {
  WorkspaceCheckpointRewindService,
  type WorkspaceCheckpointRewindRuntime,
  type WorkspaceCheckpointRewindRuntimeSnapshot,
} from '../services/workspace-checkpoint-rewind-service.js';

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function envelope(): TaskEnvelope {
  return {
    schemaVersion: 'task-envelope/v1',
    digest: hash('1'),
    subject: {
      id: 'task-872',
      title: 'Rewind task',
      objective: 'Rewind safely',
      background: [],
      constraints: [],
      acceptanceCriteria: [],
    },
    attempt: { id: 'attempt-872', createdAt: '2026-07-26T07:00:00.000Z' },
    workspace: {
      workspaceId: 'workspace-872',
      worktreeId: 'task-872',
      worktreeManifestId: 'manifest-872',
      ownershipLeaseId: 'lease-872',
      ownershipAttemptId: 'attempt-872',
      repo: 'BradGroux/veritas-kanban',
      branch: 'feat/rewind',
      baseBranch: 'main',
      worktreePath: '/tmp/worktree-872',
      baseline: {
        capturedAt: '2026-07-26T06:00:00.000Z',
        headSha: 'a'.repeat(40),
        dirty: false,
        files: [],
      },
    },
    commitPolicy: 'allowed',
    allowedSideEffects: [],
    expectedOutputs: [],
    verificationGates: [],
    launchManifest: {
      schemaVersion: 'provider-runtime-manifest/v1',
      digest: hash('2'),
      provider: 'codex-cli',
      adapter: 'codex-cli',
      protocolVersion: 'codex-jsonl/v1',
    },
    completionContract: {
      schemaVersion: 'completion-result/v1',
      evidenceRequirements: [],
    },
  };
}

function preview(evidenceDigest = hash('3'), digest = hash('4')): WorkspaceCheckpointRewindPreview {
  return {
    schemaVersion: 'workspace-checkpoint-rewind-preview/v1',
    workspaceId: 'workspace-872',
    taskId: 'task-872',
    attemptId: 'attempt-872',
    targetCheckpointId: 'checkpoint_target',
    descendantCheckpointId: 'checkpoint_descendant',
    ownership: {
      manifestId: 'manifest-872',
      leaseId: 'lease-872',
      ownerAttemptId: 'attempt-872',
      verifiedAt: '2026-07-26T07:01:00.000Z',
    },
    current: {
      schemaVersion: 'workspace-checkpoint-current-state/v1',
      worktreeRootDigest: hash('5'),
      git: {
        head: 'a'.repeat(40),
        branch: 'feat/rewind',
        indexDigest: hash('6'),
        statusDigest: hash('7'),
        dirty: true,
      },
      files: [],
      inspectedAt: '2026-07-26T07:01:00.000Z',
      digest: hash('8'),
    },
    checkpointDiff: {
      schemaVersion: 'workspace-checkpoint-diff/v1',
      workspaceId: 'workspace-872',
      taskId: 'task-872',
      attemptId: 'attempt-872',
      fromCheckpoint: {
        id: 'checkpoint_target',
        boundary: 'before-user-turn',
        createdAt: '2026-07-26T06:00:00.000Z',
        digest: hash('9'),
      },
      toCheckpoint: {
        id: 'checkpoint_descendant',
        boundary: 'before-user-turn',
        createdAt: '2026-07-26T06:05:00.000Z',
        digest: hash('a'),
      },
      directParent: true,
      git: {
        headChanged: false,
        branchChanged: false,
        indexChanged: false,
        statusChanged: false,
      },
      summary: { filesChanged: 0, additions: 0, deletions: 0 },
      attribution: { evidenceComplete: true, eventsConsidered: 1 },
      files: [],
    },
    git: { headWillChange: false, branchWillChange: false, indexWillChange: false },
    conversation: { cursorWillChange: true, targetCursorAvailable: true },
    files: [],
    resolutions: [],
    selectedPaths: [],
    exclusions: {
      targetCount: 0,
      descendantCount: 0,
      overlappingPaths: [],
      inventoryIncomplete: false,
    },
    conflicts: [],
    unresolvedConflicts: [],
    estimatedDataLossBytes: 12,
    safeForAutomaticRewind: true,
    safeForApprovedRewind: true,
    evidenceDigest,
    digest,
  };
}

function approval(status: 'pending' | 'approved'): RunApprovalRequest {
  return {
    schemaVersion: 'run-approval/v1',
    id: 'approval-872',
    workspaceId: 'workspace-872',
    taskId: 'task-872',
    attemptId: 'attempt-872',
    provider: 'codex-cli',
    agentId: 'VERITAS',
    requestKind: 'approval',
    actionClass: 'filesystem',
    action: 'Rewind workspace',
    actionHash: hash('b'),
    resourceScope: ['worktree:manifest-872'],
    riskClass: 'critical',
    evidenceRevision: hash('3'),
    providerRequestId: 'workspace-rewind:request-872',
    mobileSafe: false,
    status,
    revision: status === 'pending' ? 1 : 2,
    createdAt: '2026-07-26T07:01:00.000Z',
    updatedAt: '2026-07-26T07:02:00.000Z',
    expiresAt: '2026-07-26T07:10:00.000Z',
  };
}

function transaction(): WorkspaceCheckpointRewindTransaction {
  return {
    schemaVersion: 'workspace-checkpoint-rewind-transaction/v1',
    id: 'rewind-872',
    workspaceId: 'workspace-872',
    taskId: 'task-872',
    attemptId: 'attempt-872',
    operationIdDigest: hash('c'),
    requestDigest: hash('d'),
    previewDigest: hash('4'),
    previewEvidenceDigest: hash('3'),
    expectedCurrentDigest: hash('8'),
    targetCheckpointId: 'checkpoint_target',
    targetCheckpointDigest: hash('9'),
    descendantCheckpointId: 'checkpoint_descendant',
    descendantCheckpointDigest: hash('a'),
    worktreeRootDigest: hash('5'),
    state: 'committed',
    affectedPaths: [],
    restoredPathCount: 0,
    recoveryCheckpointId: 'checkpoint_descendant',
    startedAt: '2026-07-26T07:02:00.000Z',
    updatedAt: '2026-07-26T07:02:01.000Z',
    completedAt: '2026-07-26T07:02:01.000Z',
    digest: hash('e'),
  };
}

const runtimeSnapshot: WorkspaceCheckpointRewindRuntimeSnapshot = {
  provider: 'codex-cli',
  agentId: 'VERITAS',
  evidenceRevision: hash('f'),
  stateDigest: hash('0'),
  conversationCursor: 'cursor-descendant',
};

function checkpoint(id: string, cursor: string): WorkspaceCheckpoint {
  return {
    id,
    conversationCursor: cursor,
  } as unknown as WorkspaceCheckpoint;
}

function fixture(options: {
  approvalStatus?: 'pending' | 'approved';
  previews?: WorkspaceCheckpointRewindPreview[];
  commitError?: Error;
}) {
  const previews = options.previews ?? [preview(), preview(hash('3'), hash('5'))];
  const previewService = {
    preview: vi.fn(async () => previews.shift() ?? preview()),
  };
  const approvalBroker = {
    request: vi.fn(async () => approval(options.approvalStatus ?? 'approved')),
    get: vi.fn(async () => approval(options.approvalStatus ?? 'approved')),
  };
  const repository = {
    get: vi.fn(async ({ checkpointId }) =>
      checkpointId === 'checkpoint_target'
        ? checkpoint('checkpoint_target', 'cursor-target')
        : checkpoint('checkpoint_descendant', 'cursor-descendant')
    ),
    rewind: vi.fn(async () => transaction()),
    rollbackRewind: vi.fn(async () => ({ ...transaction(), state: 'rolled-back' as const })),
  } as unknown as WorkspaceCheckpointRepository;
  const runtime = {
    inspect: vi.fn(async () => runtimeSnapshot),
    quiesce: vi.fn(async () => ({ token: 'quiesce-872', snapshot: runtimeSnapshot })),
    commit: options.commitError
      ? vi.fn(async () => {
          throw options.commitError;
        })
      : vi.fn(async () => ({
          ...runtimeSnapshot,
          conversationCursor: 'cursor-recovered',
          rewindAnchorCursor: 'cursor-target',
        })),
    rollback: vi.fn(async () => runtimeSnapshot),
  } satisfies WorkspaceCheckpointRewindRuntime;
  const service = new WorkspaceCheckpointRewindService({
    repository,
    previews: previewService,
    approvals: approvalBroker,
    runtime,
  });
  const request = {
    taskEnvelope: envelope(),
    taskId: 'task-872',
    attemptId: 'attempt-872',
    targetCheckpointId: 'checkpoint_target',
    descendantCheckpointId: 'checkpoint_descendant',
    requestId: 'request-872',
  };
  return { service, request, previewService, approvalBroker, repository, runtime };
}

describe('WorkspaceCheckpointRewindService', () => {
  it('rejects unresolved conflicts before inspecting or quiescing the runtime', async () => {
    const conflict = {
      kind: 'file-diverged' as const,
      path: 'file.ts',
      message: 'Current file no longer matches the descendant checkpoint.',
    };
    const unsafe = {
      ...preview(),
      conflicts: [conflict],
      unresolvedConflicts: [conflict],
      safeForAutomaticRewind: false,
      safeForApprovedRewind: false,
    };
    const test = fixture({ previews: [unsafe] });

    await expect(test.service.execute(test.request)).rejects.toThrow('unresolved conflicts');
    expect(test.runtime.inspect).not.toHaveBeenCalled();
    expect(test.runtime.quiesce).not.toHaveBeenCalled();
    expect(test.approvalBroker.request).not.toHaveBeenCalled();
  });

  it('returns the exact approval request without quiescing a live runtime', async () => {
    const test = fixture({ approvalStatus: 'pending' });

    await expect(test.service.execute(test.request)).resolves.toMatchObject({
      status: 'approval-required',
      approval: { status: 'pending', riskClass: 'critical' },
      preview: { evidenceDigest: hash('3') },
    });
    expect(test.approvalBroker.request).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceRevision: hash('3'),
        exactAction: expect.objectContaining({
          previewEvidenceDigest: hash('3'),
          runtimeStateDigest: hash('0'),
        }),
      })
    );
    expect(test.runtime.quiesce).not.toHaveBeenCalled();
  });

  it('revalidates approved evidence and commits workspace plus runtime cursor', async () => {
    const test = fixture({ approvalStatus: 'approved' });

    await expect(test.service.execute(test.request)).resolves.toMatchObject({
      status: 'completed',
      transaction: { state: 'committed' },
      runtime: {
        conversationCursor: 'cursor-recovered',
        rewindAnchorCursor: 'cursor-target',
      },
    });
    expect(test.previewService.preview).toHaveBeenCalledTimes(2);
    expect(test.repository.rewind).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'request-872',
        preview: expect.objectContaining({ evidenceDigest: hash('3') }),
      })
    );
    expect(test.runtime.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'quiesce-872',
        targetConversationCursor: 'cursor-target',
      })
    );
  });

  it('restores storage and runtime when the runtime cursor commit fails', async () => {
    const test = fixture({
      approvalStatus: 'approved',
      commitError: new Error('injected runtime commit failure'),
    });

    await expect(test.service.execute(test.request)).rejects.toThrow(
      'recovered from the prior runtime anchor'
    );
    expect(test.repository.rollbackRewind).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'rewind-872',
        expectedTransactionDigest: hash('e'),
      })
    );
    expect(test.runtime.rollback).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'quiesce-872', snapshot: runtimeSnapshot })
    );
  });

  it('aborts before storage mutation when evidence changes after quiescence', async () => {
    const test = fixture({
      approvalStatus: 'approved',
      previews: [preview(hash('3'), hash('4')), preview(hash('1'), hash('5'))],
    });

    await expect(test.service.execute(test.request)).rejects.toThrow(
      'recovered from the prior runtime anchor'
    );
    expect(test.repository.rewind).not.toHaveBeenCalled();
    expect(test.runtime.rollback).toHaveBeenCalledOnce();
  });
});
