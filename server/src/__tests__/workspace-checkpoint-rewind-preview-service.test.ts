import { describe, expect, it, vi } from 'vitest';
import type {
  TaskEnvelope,
  WorkspaceCheckpoint,
  WorkspaceCheckpointCurrentState,
  WorkspaceCheckpointDiff,
  WorktreeManifest,
} from '@veritas-kanban/shared';
import type { WorkspaceCheckpointRepository } from '../storage/workspace-checkpoint-repository.js';
import { WorkspaceCheckpointRewindPreviewService } from '../services/workspace-checkpoint-rewind-preview-service.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const targetId = 'checkpoint_target12345678901234';
const descendantId = 'checkpoint_descendant1234567890';

function checkpoint(
  id: string,
  contentDigest: string,
  overrides: Partial<WorkspaceCheckpoint> = {}
): WorkspaceCheckpoint {
  return {
    schemaVersion: 'workspace-checkpoint/v1',
    id,
    workspaceId: 'workspace-872',
    taskId: 'task-872',
    attemptId: 'attempt-872',
    boundary: 'before-user-turn',
    operationIdDigest: hash('1'),
    captureRequestDigest: hash('2'),
    worktreeRootDigest: hash('3'),
    worktreeManifestId: 'worktree-872',
    git: {
      head: 'a'.repeat(40),
      branch: 'feat/checkpoints',
      indexDigest: hash('4'),
      indexBlobDigest: hash('5'),
      indexBytes: 10,
      statusDigest: hash('6'),
      dirty: true,
    },
    policy: {
      ignoredFiles: 'excluded',
      sensitiveFiles: 'excluded',
      binaryFiles: 'excluded',
      symlinks: 'excluded',
      maxFiles: 10_000,
      maxBytes: 64 * 1_024 * 1_024,
      maxFileBytes: 8 * 1_024 * 1_024,
      maxExclusions: 2_000,
    },
    files: [
      {
        path: 'file.ts',
        source: 'tracked',
        state: 'present',
        mode: 0o644,
        size: 12,
        contentDigest,
        blobDigest: contentDigest,
      },
    ],
    exclusions: [],
    excludedCount: 0,
    exclusionsTruncated: false,
    fileCount: 1,
    contentBytes: 12,
    storedBytes: 22,
    conversationCursor: `{"thread":"${id}"}`,
    createdAt: '2026-07-26T06:00:00.000Z',
    digest: id === targetId ? hash('7') : hash('8'),
    ...overrides,
  };
}

function envelope(): TaskEnvelope {
  return {
    schemaVersion: 'task-envelope/v1',
    digest: hash('8'),
    subject: {
      id: 'task-872',
      title: 'Checkpoint task',
      objective: 'Checkpoint task',
      background: [],
      constraints: [],
      acceptanceCriteria: [],
    },
    attempt: { id: 'attempt-872', createdAt: '2026-07-26T06:00:00.000Z' },
    workspace: {
      workspaceId: 'workspace-872',
      worktreeId: 'task-872',
      worktreeManifestId: 'worktree-872',
      ownershipLeaseId: 'lease-872',
      ownershipAttemptId: 'attempt-872',
      repo: 'BradGroux/veritas-kanban',
      branch: 'feat/checkpoints',
      baseBranch: 'main',
      worktreePath: '/tmp/worktree-872',
      baseline: {
        capturedAt: '2026-07-26T05:00:00.000Z',
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
      digest: hash('9'),
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

function manifest(): WorktreeManifest {
  return {
    schemaVersion: 'worktree-manifest/v1',
    id: 'worktree-872',
    revision: 2,
    taskId: 'task-872',
    repository: {
      name: 'veritas-kanban',
      rootPath: '/tmp/veritas-kanban',
      commonGitDir: '/tmp/veritas-kanban/.git',
      originFingerprint: 'origin',
    },
    path: '/tmp/worktree-872',
    branch: 'feat/checkpoints',
    base: {
      branch: 'main',
      commit: 'a'.repeat(40),
      source: 'remote',
      resolvedAt: '2026-07-26T05:00:00.000Z',
    },
    lease: {
      id: 'lease-872',
      ownerTaskId: 'task-872',
      ownerAttemptId: 'attempt-872',
      acquiredAt: '2026-07-26T06:00:00.000Z',
      expiresAt: '2026-07-26T07:00:00.000Z',
    },
    lifecycle: { creation: 'ready', integration: 'idle', cleanup: 'active' },
    rebase: { state: 'idle' },
    integration: {},
    createdAt: '2026-07-26T05:00:00.000Z',
    updatedAt: '2026-07-26T06:00:00.000Z',
    overrides: [],
  };
}

function checkpointDiff(source: 'agent-tool' | 'operator'): WorkspaceCheckpointDiff {
  const attribution = {
    source,
    confidence: 'high' as const,
    basis:
      source === 'agent-tool' ? ('provider-file-event' as const) : ('operator-file-event' as const),
    scope: 'checkpoint-file-window' as const,
    evidenceEventIds: ['event-2'],
  };
  return {
    schemaVersion: 'workspace-checkpoint-diff/v1',
    workspaceId: 'workspace-872',
    taskId: 'task-872',
    attemptId: 'attempt-872',
    fromCheckpoint: {
      id: targetId,
      boundary: 'before-user-turn',
      createdAt: '2026-07-26T06:00:00.000Z',
      digest: hash('a'),
    },
    toCheckpoint: {
      id: descendantId,
      boundary: 'before-user-turn',
      createdAt: '2026-07-26T06:05:00.000Z',
      digest: hash('b'),
    },
    directParent: true,
    git: {
      headChanged: false,
      branchChanged: false,
      indexChanged: true,
      statusChanged: true,
    },
    summary: { filesChanged: 1, additions: 1, deletions: 1 },
    attribution: {
      evidenceComplete: true,
      fromEventSequence: 1,
      toEventSequence: 3,
      eventsConsidered: 1,
    },
    files: [
      {
        path: 'file.ts',
        kind: 'modified',
        source: 'tracked',
        fromState: 'present',
        toState: 'present',
        additions: 1,
        deletions: 1,
        attribution,
        hunks: [],
      },
    ],
  };
}

function current(descendant: WorkspaceCheckpoint): WorkspaceCheckpointCurrentState {
  const file = descendant.files[0];
  return {
    schemaVersion: 'workspace-checkpoint-current-state/v1',
    worktreeRootDigest: descendant.worktreeRootDigest,
    git: {
      head: descendant.git.head,
      branch: descendant.git.branch,
      indexDigest: descendant.git.indexDigest,
      statusDigest: descendant.git.statusDigest,
      dirty: descendant.git.dirty,
    },
    files: [
      {
        path: file.path,
        state: 'present',
        mode: file.mode,
        size: file.size,
        contentDigest: file.contentDigest,
      },
    ],
    inspectedAt: '2026-07-26T06:10:00.000Z',
    digest: hash('c'),
  };
}

function service(
  target: WorkspaceCheckpoint,
  descendant: WorkspaceCheckpoint,
  diff: WorkspaceCheckpointDiff,
  currentState: WorkspaceCheckpointCurrentState
) {
  const boundDiff = {
    ...diff,
    fromCheckpoint: { ...diff.fromCheckpoint, digest: target.digest },
    toCheckpoint: { ...diff.toCheckpoint, digest: descendant.digest },
  };
  const repository = {
    get: vi.fn(async ({ checkpointId }) => (checkpointId === target.id ? target : descendant)),
    inspectCurrent: vi.fn(async () => currentState),
  } as unknown as WorkspaceCheckpointRepository;
  const ownership = { getManifest: vi.fn(async () => manifest()) };
  return {
    preview: new WorkspaceCheckpointRewindPreviewService({
      repository,
      diffs: { compare: vi.fn(async () => boundDiff) },
      ownership,
      now: () => new Date('2026-07-26T06:15:00.000Z'),
    }),
    repository,
    ownership,
  };
}

describe('WorkspaceCheckpointRewindPreviewService', () => {
  it('reports a safe automatic rewind only when current evidence matches the descendant', async () => {
    const target = checkpoint(targetId, hash('d'));
    const descendant = checkpoint(descendantId, hash('e'), {
      parentCheckpointId: target.id,
    });
    const fixture = service(target, descendant, checkpointDiff('agent-tool'), current(descendant));

    const result = await fixture.preview.preview({
      taskEnvelope: envelope(),
      taskId: 'task-872',
      attemptId: 'attempt-872',
      targetCheckpointId: target.id,
      descendantCheckpointId: descendant.id,
    });

    expect(result).toMatchObject({
      schemaVersion: 'workspace-checkpoint-rewind-preview/v1',
      safeForAutomaticRewind: true,
      conflicts: [],
      estimatedDataLossBytes: 12,
      git: { headWillChange: false, branchWillChange: false, indexWillChange: false },
      conversation: { cursorWillChange: true, targetCursorAvailable: true },
      files: [{ path: 'file.ts', action: 'restore', conflicts: [] }],
    });
    const { digest, ...payload } = result;
    expect(digest).toBe(digestRunLaunchValue(payload));
    expect(fixture.ownership.getManifest).toHaveBeenCalledTimes(2);
  });

  it('blocks divergent, excluded, incomplete, or non-agent changes with explicit conflicts', async () => {
    const target = checkpoint(targetId, hash('d'), {
      files: [],
      fileCount: 0,
      contentBytes: 0,
      exclusions: [{ path: 'file.ts', source: 'tracked', reason: 'binary', size: 12 }],
      exclusionsTruncated: true,
      excludedCount: 2,
    });
    const descendant = checkpoint(descendantId, hash('e'), {
      parentCheckpointId: target.id,
      git: { ...target.git, indexDigest: hash('f'), indexBlobDigest: hash('0') },
    });
    const currentState = current(descendant);
    currentState.git.statusDigest = hash('0');
    currentState.files[0].contentDigest = hash('f');
    const unsafeDiff = checkpointDiff('operator');
    unsafeDiff.files[0].kind = 'added';
    unsafeDiff.files[0].fromState = 'absent';
    const fixture = service(target, descendant, unsafeDiff, currentState);

    const result = await fixture.preview.preview({
      taskEnvelope: envelope(),
      taskId: 'task-872',
      attemptId: 'attempt-872',
      targetCheckpointId: target.id,
      descendantCheckpointId: descendant.id,
    });

    expect(result.safeForAutomaticRewind).toBe(false);
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(
      expect.arrayContaining([
        'status-diverged',
        'index-posture-change',
        'file-diverged',
        'excluded-path-overlap',
        'inventory-incomplete',
        'attribution-ambiguous',
      ])
    );
    expect(result.exclusions).toMatchObject({
      overlappingPaths: ['file.ts'],
      inventoryIncomplete: true,
    });
  });

  it('blocks status changes that may be hidden by excluded checkpoint files', async () => {
    const target = checkpoint(targetId, hash('d'), {
      exclusions: [{ path: 'binary.dat', source: 'tracked', reason: 'binary', size: 12 }],
      excludedCount: 1,
    });
    const descendant = checkpoint(descendantId, hash('e'), {
      parentCheckpointId: target.id,
      exclusions: [{ path: 'binary.dat', source: 'tracked', reason: 'binary', size: 12 }],
      excludedCount: 1,
      git: { ...target.git, statusDigest: hash('0') },
    });
    const currentState = current(descendant);
    const fixture = service(target, descendant, checkpointDiff('agent-tool'), currentState);

    const result = await fixture.preview.preview({
      taskEnvelope: envelope(),
      taskId: 'task-872',
      attemptId: 'attempt-872',
      targetCheckpointId: target.id,
      descendantCheckpointId: descendant.id,
    });

    expect(result.safeForAutomaticRewind).toBe(false);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        kind: 'inventory-incomplete',
        message: expect.stringContaining('exclude files'),
      })
    );
  });
});
