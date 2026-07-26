import { describe, expect, it, vi } from 'vitest';
import type { TaskEnvelope, WorkspaceCheckpoint, WorktreeManifest } from '@veritas-kanban/shared';
import type { WorkspaceCheckpointRepository } from '../storage/workspace-checkpoint-repository.js';
import { WorkspaceCheckpointService } from '../services/workspace-checkpoint-service.js';

const checkpoint = {
  schemaVersion: 'workspace-checkpoint/v1',
  id: 'checkpoint_123456789012345678901234',
  workspaceId: 'workspace-872',
  taskId: 'task-872',
  attemptId: 'attempt-872',
  boundary: 'before-user-turn',
  operationIdDigest: `sha256:${'1'.repeat(64)}`,
  captureRequestDigest: `sha256:${'2'.repeat(64)}`,
  worktreeRootDigest: `sha256:${'3'.repeat(64)}`,
  worktreeManifestId: 'worktree-872',
  git: {
    head: 'a'.repeat(40),
    branch: 'feat/checkpoints',
    indexDigest: `sha256:${'4'.repeat(64)}`,
    indexBlobDigest: `sha256:${'5'.repeat(64)}`,
    indexBytes: 10,
    statusDigest: `sha256:${'6'.repeat(64)}`,
    dirty: false,
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
  files: [],
  exclusions: [],
  excludedCount: 0,
  exclusionsTruncated: false,
  fileCount: 0,
  contentBytes: 0,
  storedBytes: 10,
  createdAt: '2026-07-26T06:00:00.000Z',
  digest: `sha256:${'7'.repeat(64)}`,
} satisfies WorkspaceCheckpoint;

function envelope(managed = true): TaskEnvelope {
  return {
    schemaVersion: 'task-envelope/v1',
    digest: `sha256:${'8'.repeat(64)}`,
    subject: {
      id: 'task-872',
      title: 'Checkpoint task',
      objective: 'Checkpoint task',
      background: [],
      constraints: [],
      acceptanceCriteria: [],
    },
    attempt: {
      id: 'attempt-872',
      createdAt: '2026-07-26T06:00:00.000Z',
    },
    workspace: {
      workspaceId: 'workspace-872',
      worktreeId: 'task-872',
      ...(managed
        ? {
            worktreeManifestId: 'worktree-872',
            ownershipLeaseId: 'lease-872',
            ownershipAttemptId: 'attempt-872',
          }
        : {}),
      repo: 'BradGroux/veritas-kanban',
      branch: 'feat/checkpoints',
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
      digest: `sha256:${'9'.repeat(64)}`,
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
    lifecycle: {
      creation: 'ready',
      integration: 'idle',
      cleanup: 'active',
    },
    rebase: { state: 'idle' },
    integration: {},
    createdAt: '2026-07-26T05:00:00.000Z',
    updatedAt: '2026-07-26T06:00:00.000Z',
    overrides: [],
  };
}

describe('WorkspaceCheckpointService', () => {
  it('skips worktrees without Veritas ownership evidence', async () => {
    const repository = {
      capture: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
    } as unknown as WorkspaceCheckpointRepository;
    const ownership = { getManifest: vi.fn() };
    const service = new WorkspaceCheckpointService({
      repository,
      ownership,
      now: () => new Date('2026-07-26T06:30:00.000Z'),
    });

    await expect(
      service.captureBoundary({
        taskEnvelope: envelope(false),
        taskId: 'task-872',
        attemptId: 'attempt-872',
        operationId: 'launch:attempt-872',
        boundary: 'before-user-turn',
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'unmanaged-worktree' });
    expect(ownership.getManifest).not.toHaveBeenCalled();
    expect(repository.capture).not.toHaveBeenCalled();
  });

  it('captures only after exact current manifest and lease ownership is proven', async () => {
    const repository = {
      capture: vi.fn(async () => checkpoint),
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
    } as unknown as WorkspaceCheckpointRepository;
    const ownership = { getManifest: vi.fn(async () => manifest()) };
    const service = new WorkspaceCheckpointService({
      repository,
      ownership,
      now: () => new Date('2026-07-26T06:30:00.000Z'),
    });

    await expect(
      service.captureBoundary({
        taskEnvelope: envelope(),
        taskId: 'task-872',
        attemptId: 'attempt-872',
        operationId: 'launch:attempt-872',
        boundary: 'before-user-turn',
        turnId: 'turn-872',
        conversationCursor: '{"conversationId":"thread-872"}',
      })
    ).resolves.toEqual({ status: 'captured', checkpoint });
    expect(repository.capture).toHaveBeenCalledWith({
      workspaceId: 'workspace-872',
      taskId: 'task-872',
      attemptId: 'attempt-872',
      operationId: 'launch:attempt-872',
      boundary: 'before-user-turn',
      worktreePath: '/tmp/worktree-872',
      worktreeManifestId: 'worktree-872',
      parentCheckpointId: undefined,
      turnId: 'turn-872',
      conversationCursor: '{"conversationId":"thread-872"}',
    });
  });

  it('preserves the original parent when an old operation is retried', async () => {
    const existing = {
      ...checkpoint,
      parentCheckpointId: 'checkpoint_parent12345678901234',
    };
    const repository = {
      capture: vi.fn(async () => existing),
      get: vi.fn(async () => existing),
      list: vi.fn(),
    } as unknown as WorkspaceCheckpointRepository;
    const service = new WorkspaceCheckpointService({
      repository,
      ownership: { getManifest: vi.fn(async () => manifest()) },
      now: () => new Date('2026-07-26T06:30:00.000Z'),
    });

    await service.captureBoundary({
      taskEnvelope: envelope(),
      taskId: 'task-872',
      attemptId: 'attempt-872',
      operationId: 'launch:attempt-872',
      boundary: 'before-user-turn',
    });

    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.capture).toHaveBeenCalledWith(
      expect.objectContaining({ parentCheckpointId: existing.parentCheckpointId })
    );
  });

  it('fails closed when durable ownership moved to another attempt', async () => {
    const repository = {
      capture: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
    } as unknown as WorkspaceCheckpointRepository;
    const ownership = {
      getManifest: vi.fn(async () => ({
        ...manifest(),
        lease: { ...manifest().lease, ownerAttemptId: 'attempt-other' },
      })),
    };
    const service = new WorkspaceCheckpointService({
      repository,
      ownership,
      now: () => new Date('2026-07-26T06:30:00.000Z'),
    });

    await expect(
      service.captureBoundary({
        taskEnvelope: envelope(),
        taskId: 'task-872',
        attemptId: 'attempt-872',
        operationId: 'launch:attempt-872',
        boundary: 'before-user-turn',
      })
    ).rejects.toThrow('cannot prove current run-owned worktree authority');
    expect(repository.capture).not.toHaveBeenCalled();
  });
});
