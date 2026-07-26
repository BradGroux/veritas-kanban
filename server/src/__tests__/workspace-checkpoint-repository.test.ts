import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';
import type { WorkspaceCheckpoint, WorkspaceCheckpointRewindPreview } from '@veritas-kanban/shared';
import {
  FileWorkspaceCheckpointRepository,
  getWorkspaceCheckpointRewindIdForOperation,
} from '../storage/workspace-checkpoint-repository.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { digestWorkspaceCheckpointRewindEvidence } from '../utils/workspace-checkpoint-rewind-digest.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-workspace-checkpoint-'));
  roots.push(root);
  const worktreePath = path.join(root, 'worktree');
  const storePath = path.join(root, 'store');
  await fs.mkdir(worktreePath);
  await execFileAsync('git', ['init'], { cwd: worktreePath });
  await execFileAsync('git', ['config', 'user.name', 'Veritas Test'], { cwd: worktreePath });
  await execFileAsync('git', ['config', 'user.email', 'veritas@example.test'], {
    cwd: worktreePath,
  });
  await fs.writeFile(path.join(worktreePath, '.gitignore'), '.env\nignored.txt\n');
  await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'tracked baseline\n');
  await fs.writeFile(path.join(worktreePath, 'deleted.txt'), 'delete me\n');
  await execFileAsync('git', ['add', '.gitignore', 'tracked.txt', 'deleted.txt'], {
    cwd: worktreePath,
  });
  await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: worktreePath });
  await fs.rm(path.join(worktreePath, 'deleted.txt'));
  await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'tracked staged\n');
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: worktreePath });
  await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'tracked worktree\n');
  await fs.writeFile(path.join(worktreePath, 'untracked.txt'), 'untracked content\n');
  await fs.writeFile(path.join(worktreePath, '.env'), 'SECRET=value\n');
  await fs.writeFile(path.join(worktreePath, 'ignored.txt'), 'ignored\n');
  await fs.writeFile(path.join(worktreePath, 'binary.bin'), Buffer.from([1, 0, 2]));
  await fs.symlink('tracked.txt', path.join(worktreePath, 'linked.txt'));
  return { root, worktreePath, storePath };
}

async function rewindPreview(
  repository: FileWorkspaceCheckpointRepository,
  worktreePath: string,
  target: WorkspaceCheckpoint,
  descendant: WorkspaceCheckpoint,
  paths: string[]
): Promise<WorkspaceCheckpointRewindPreview> {
  const current = await repository.inspectCurrent({
    worktreePath,
    paths,
    maxFileBytes: Math.max(target.policy.maxFileBytes, descendant.policy.maxFileBytes),
    maxBytes: Math.max(target.policy.maxBytes, descendant.policy.maxBytes),
  });
  const targetFiles = new Map(target.files.map((file) => [file.path, file]));
  const descendantFiles = new Map(descendant.files.map((file) => [file.path, file]));
  const attribution = {
    source: 'agent-tool' as const,
    confidence: 'high' as const,
    basis: 'provider-file-event' as const,
    scope: 'checkpoint-file-window' as const,
    evidenceEventIds: ['event-rewind'],
  };
  const checkpointFiles = paths.map((candidate) => {
    const from = targetFiles.get(candidate);
    const to = descendantFiles.get(candidate);
    const fromState = from?.state ?? 'absent';
    const toState = to?.state ?? 'absent';
    const kind =
      fromState === 'absent'
        ? ('added' as const)
        : toState === 'absent'
          ? ('deleted' as const)
          : from?.contentDigest === to?.contentDigest
            ? ('mode-changed' as const)
            : ('modified' as const);
    return {
      path: candidate,
      kind,
      source: to?.source ?? from?.source ?? ('untracked' as const),
      fromState,
      toState,
      ...(from?.mode === undefined ? {} : { fromMode: from.mode }),
      ...(to?.mode === undefined ? {} : { toMode: to.mode }),
      ...(from?.contentDigest ? { fromContentDigest: from.contentDigest } : {}),
      ...(to?.contentDigest ? { toContentDigest: to.contentDigest } : {}),
      additions: 1,
      deletions: 1,
      hunks: [],
      attribution,
    };
  });
  const previewFiles = checkpointFiles.map((file) => ({
    path: file.path,
    action:
      file.kind === 'added'
        ? ('delete' as const)
        : file.kind === 'mode-changed'
          ? ('restore-mode' as const)
          : ('restore' as const),
    estimatedDiscardedBytes:
      current.files.find((candidate) => candidate.path === file.path)?.size ?? 0,
    attribution,
    selectedForRewind: true,
    conflicts: [],
  }));
  const payload = {
    schemaVersion: 'workspace-checkpoint-rewind-preview/v1' as const,
    workspaceId: target.workspaceId,
    taskId: target.taskId,
    attemptId: target.attemptId,
    targetCheckpointId: target.id,
    descendantCheckpointId: descendant.id,
    ownership: {
      manifestId: target.worktreeManifestId ?? 'manifest-rewind',
      leaseId: 'lease-rewind',
      ownerAttemptId: target.attemptId,
      verifiedAt: '2026-07-26T06:05:00.000Z',
    },
    current,
    checkpointDiff: {
      schemaVersion: 'workspace-checkpoint-diff/v1' as const,
      workspaceId: target.workspaceId,
      taskId: target.taskId,
      attemptId: target.attemptId,
      fromCheckpoint: {
        id: target.id,
        boundary: target.boundary,
        createdAt: target.createdAt,
        digest: target.digest,
      },
      toCheckpoint: {
        id: descendant.id,
        boundary: descendant.boundary,
        createdAt: descendant.createdAt,
        digest: descendant.digest,
      },
      directParent: true as const,
      git: {
        headChanged: target.git.head !== descendant.git.head,
        branchChanged: target.git.branch !== descendant.git.branch,
        indexChanged: target.git.indexDigest !== descendant.git.indexDigest,
        statusChanged: target.git.statusDigest !== descendant.git.statusDigest,
      },
      summary: {
        filesChanged: checkpointFiles.length,
        additions: checkpointFiles.length,
        deletions: checkpointFiles.length,
      },
      attribution: { evidenceComplete: true, eventsConsidered: 1 },
      files: checkpointFiles,
    },
    git: {
      headWillChange: target.git.head !== descendant.git.head,
      branchWillChange: target.git.branch !== descendant.git.branch,
      indexWillChange: target.git.indexDigest !== descendant.git.indexDigest,
    },
    conversation: {
      cursorWillChange: target.conversationCursor !== descendant.conversationCursor,
      targetCursorAvailable: Boolean(target.conversationCursor),
    },
    files: previewFiles,
    resolutions: [],
    selectedPaths: previewFiles.map((file) => file.path),
    exclusions: {
      targetCount: target.excludedCount,
      descendantCount: descendant.excludedCount,
      overlappingPaths: [],
      inventoryIncomplete: false,
    },
    conflicts: [],
    unresolvedConflicts: [],
    estimatedDataLossBytes: previewFiles.reduce(
      (total, file) => total + file.estimatedDiscardedBytes,
      0
    ),
    safeForAutomaticRewind: true,
    safeForApprovedRewind: true,
  };
  const preview = {
    ...payload,
    evidenceDigest: digestWorkspaceCheckpointRewindEvidence(payload),
  };
  return { ...preview, digest: digestRunLaunchValue(preview) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('FileWorkspaceCheckpointRepository', () => {
  it('captures a bounded content-addressed worktree and exact Git index posture', async () => {
    const { worktreePath, storePath } = await fixture();
    const repository = new FileWorkspaceCheckpointRepository({
      baseDir: storePath,
      now: () => new Date('2026-07-26T06:00:00.000Z'),
    });
    const request = {
      workspaceId: 'workspace-872',
      taskId: 'task-872',
      attemptId: 'attempt-872',
      operationId: 'before-turn-1',
      boundary: 'before-user-turn' as const,
      worktreePath,
      worktreeManifestId: 'worktree-872',
      turnId: 'turn-1',
      conversationCursor: 'cursor-1',
    };

    const checkpoint = await repository.capture(request);

    expect(checkpoint).toMatchObject({
      schemaVersion: 'workspace-checkpoint/v1',
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      attemptId: request.attemptId,
      boundary: request.boundary,
      worktreeManifestId: request.worktreeManifestId,
      turnId: request.turnId,
      conversationCursor: request.conversationCursor,
      git: {
        dirty: true,
        head: expect.stringMatching(/^[a-f0-9]{40}$/),
        branch: expect.any(String),
        indexDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        indexBlobDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(checkpoint.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'tracked.txt',
          source: 'tracked',
          state: 'present',
          size: Buffer.byteLength('tracked worktree\n'),
        }),
        expect.objectContaining({
          path: 'untracked.txt',
          source: 'untracked',
          state: 'present',
        }),
        expect.objectContaining({
          path: 'deleted.txt',
          source: 'tracked',
          state: 'absent',
          size: 0,
        }),
      ])
    );
    expect(checkpoint.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'binary.bin', reason: 'binary' }),
        expect.objectContaining({ path: 'linked.txt', reason: 'symlink' }),
      ])
    );
    expect(checkpoint.files.some((file) => file.path === '.env')).toBe(false);
    expect(checkpoint.files.some((file) => file.path === 'ignored.txt')).toBe(false);
    const tracked = checkpoint.files.find((file) => file.path === 'tracked.txt');
    await expect(repository.readBlob(tracked?.blobDigest ?? '')).resolves.toEqual(
      Buffer.from('tracked worktree\n')
    );
    await expect(repository.readBlob(checkpoint.git.indexBlobDigest)).resolves.toHaveLength(
      checkpoint.git.indexBytes
    );
    await expect(
      repository.get({
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        attemptId: request.attemptId,
        checkpointId: checkpoint.id,
      })
    ).resolves.toEqual(checkpoint);
    await expect(repository.list(request)).resolves.toEqual([checkpoint]);

    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'changed after checkpoint\n');
    await expect(repository.capture(request)).resolves.toEqual(checkpoint);
    await expect(repository.capture({ ...request, boundary: 'before-compaction' })).rejects.toThrow(
      'operation identity was reused'
    );
  });

  it('publishes metadata last and leaves failed captures undiscoverable', async () => {
    const { worktreePath, storePath } = await fixture();
    const beforePublish = vi.fn(async () => {
      throw new Error('injected publish failure');
    });
    const repository = new FileWorkspaceCheckpointRepository({
      baseDir: storePath,
      beforePublish,
    });
    const request = {
      workspaceId: 'workspace-atomic',
      taskId: 'task-atomic',
      attemptId: 'attempt-atomic',
      operationId: 'capture-atomic',
      boundary: 'manual' as const,
      worktreePath,
    };

    await expect(repository.capture(request)).rejects.toThrow('injected publish failure');
    expect(beforePublish).toHaveBeenCalledOnce();
    await expect(repository.list(request)).resolves.toEqual([]);
  });

  it('returns one canonical checkpoint for concurrent retries of the same operation', async () => {
    const { worktreePath, storePath } = await fixture();
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = new FileWorkspaceCheckpointRepository({
      baseDir: storePath,
      beforePublish: async () => {
        arrivals += 1;
        if (arrivals === 2) release();
        await bothArrived;
      },
    });
    const request = {
      workspaceId: 'workspace-concurrent',
      taskId: 'task-concurrent',
      attemptId: 'attempt-concurrent',
      operationId: 'capture-concurrent',
      boundary: 'manual' as const,
      worktreePath,
    };

    const [first, second] = await Promise.all([
      repository.capture(request),
      repository.capture(request),
    ]);

    expect(first).toEqual(second);
    await expect(repository.list(request)).resolves.toEqual([first]);
  });

  it('enforces file and byte limits without exposing sensitive or oversized content', async () => {
    const { worktreePath, storePath } = await fixture();
    await fs.writeFile(path.join(worktreePath, 'credentials.json'), '{"token":"private"}\n');
    await fs.writeFile(path.join(worktreePath, 'large.txt'), 'x'.repeat(64));
    const repository = new FileWorkspaceCheckpointRepository({
      baseDir: storePath,
      policy: {
        maxFiles: 100,
        maxBytes: 1_024,
        maxFileBytes: 32,
        maxExclusions: 100,
      },
    });

    const checkpoint = await repository.capture({
      workspaceId: 'workspace-limits',
      taskId: 'task-limits',
      attemptId: 'attempt-limits',
      operationId: 'capture-limits',
      boundary: 'manual',
      worktreePath,
    });

    expect(checkpoint.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'credentials.json', reason: 'sensitive' }),
        expect.objectContaining({ path: 'large.txt', reason: 'too-large', size: 64 }),
      ])
    );
    expect(checkpoint.files.some((file) => file.path === 'credentials.json')).toBe(false);
    expect(checkpoint.files.some((file) => file.path === 'large.txt')).toBe(false);
  });

  it('rejects a checkpoint blob replaced by a symlink', async () => {
    const { root, worktreePath, storePath } = await fixture();
    const repository = new FileWorkspaceCheckpointRepository({ baseDir: storePath });
    const checkpoint = await repository.capture({
      workspaceId: 'workspace-symlink',
      taskId: 'task-symlink',
      attemptId: 'attempt-symlink',
      operationId: 'capture-symlink',
      boundary: 'manual',
      worktreePath,
    });
    const tracked = checkpoint.files.find((file) => file.path === 'tracked.txt');
    const digest = tracked?.blobDigest ?? '';
    const hex = digest.slice('sha256:'.length);
    const blobPath = path.join(storePath, 'blobs', hex.slice(0, 2), hex);
    const replacement = path.join(root, 'replacement.txt');
    await fs.writeFile(replacement, 'tracked worktree\n');
    await fs.rm(blobPath);
    await fs.symlink(replacement, blobPath);

    await expect(repository.readBlob(digest)).rejects.toThrow('blob is not a bounded regular file');
  });

  it('inspects current affected paths without persisting another checkpoint', async () => {
    const { worktreePath, storePath } = await fixture();
    await fs.writeFile(path.join(worktreePath, 'large.txt'), 'x'.repeat(64));
    const repository = new FileWorkspaceCheckpointRepository({
      baseDir: storePath,
      policy: {
        maxFiles: 100,
        maxBytes: 1_024,
        maxFileBytes: 32,
        maxExclusions: 100,
      },
      now: () => new Date('2026-07-26T06:00:00.000Z'),
    });
    const request = {
      workspaceId: 'workspace-inspect',
      taskId: 'task-inspect',
      attemptId: 'attempt-inspect',
      operationId: 'capture-inspect',
      boundary: 'manual' as const,
      worktreePath,
    };
    const checkpoint = await repository.capture(request);

    const current = await repository.inspectCurrent({
      worktreePath,
      paths: ['tracked.txt', 'deleted.txt', 'linked.txt', 'large.txt'],
      maxFileBytes: 32,
      maxBytes: 1_024,
    });

    expect(current).toMatchObject({
      schemaVersion: 'workspace-checkpoint-current-state/v1',
      worktreeRootDigest: checkpoint.worktreeRootDigest,
      git: {
        head: checkpoint.git.head,
        branch: checkpoint.git.branch,
        indexDigest: checkpoint.git.indexDigest,
        statusDigest: checkpoint.git.statusDigest,
      },
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(current.files).toEqual([
      { path: 'deleted.txt', state: 'absent' },
      { path: 'large.txt', state: 'too-large', size: 64 },
      { path: 'linked.txt', state: 'symlink', size: expect.any(Number) },
      expect.objectContaining({
        path: 'tracked.txt',
        state: 'present',
        contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    ]);
    await expect(repository.list(request)).resolves.toEqual([checkpoint]);
    await expect(
      repository.inspectCurrent({
        worktreePath,
        paths: ['../outside.txt'],
        maxFileBytes: 32,
        maxBytes: 1_024,
      })
    ).rejects.toThrow('inspection path is invalid');
  });

  it('prunes bounded metadata while preserving the newest active-run checkpoint', async () => {
    const { worktreePath, storePath } = await fixture();
    let now = new Date('2026-07-26T06:00:00.000Z');
    const repository = new FileWorkspaceCheckpointRepository({
      baseDir: storePath,
      now: () => now,
    });
    const scope = {
      workspaceId: 'workspace-retention',
      taskId: 'task-retention',
      attemptId: 'attempt-retention',
      boundary: 'manual' as const,
      worktreePath,
    };
    const first = await repository.capture({ ...scope, operationId: 'capture-1' });
    now = new Date('2026-07-26T06:01:00.000Z');
    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'second checkpoint\n');
    const second = await repository.capture({
      ...scope,
      operationId: 'capture-2',
      parentCheckpointId: first.id,
    });
    now = new Date('2026-07-26T06:02:00.000Z');
    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'third checkpoint\n');
    const third = await repository.capture({
      ...scope,
      operationId: 'capture-3',
      parentCheckpointId: second.id,
    });
    now = new Date('2026-07-26T06:03:00.000Z');
    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'branch checkpoint\n');
    const branch = await repository.capture({
      ...scope,
      operationId: 'capture-branch',
      parentCheckpointId: first.id,
    });

    const result = await repository.prune({
      ...scope,
      activeRun: true,
      maxCheckpoints: 0,
      maxLogicalBytes: 0,
      maxAgeSeconds: 1,
    });

    expect(result).toMatchObject({
      schemaVersion: 'workspace-checkpoint-retention-result/v1',
      activeRun: true,
      preservedCheckpointIds: [branch.id, third.id],
      removedCheckpointIds: [second.id, first.id],
      reclaimedMetadataBytes: expect.any(Number),
      logicalContentBytesDereferenced: first.storedBytes + second.storedBytes,
      contentBlobGcDeferred: true,
    });
    expect(result.reclaimedMetadataBytes).toBeGreaterThan(0);
    await expect(repository.list(scope)).resolves.toEqual([branch, third]);
    const firstTracked = first.files.find((file) => file.path === 'tracked.txt');
    await expect(repository.readBlob(firstTracked?.blobDigest ?? '')).resolves.toEqual(
      Buffer.from('tracked worktree\n')
    );
  });

  it('commits and can compensate a digest-bound rewind transaction', async () => {
    const { worktreePath, storePath } = await fixture();
    await fs.rm(path.join(worktreePath, 'binary.bin'));
    await fs.rm(path.join(worktreePath, 'linked.txt'));
    const repository = new FileWorkspaceCheckpointRepository({ baseDir: storePath });
    const scope = {
      workspaceId: 'workspace-rewind',
      taskId: 'task-rewind',
      attemptId: 'attempt-rewind',
      boundary: 'manual' as const,
      worktreePath,
      worktreeManifestId: 'manifest-rewind',
    };
    const target = await repository.capture({
      ...scope,
      operationId: 'rewind-target',
      conversationCursor: 'cursor-target',
    });
    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'descendant content\n');
    await fs.writeFile(path.join(worktreePath, 'added.txt'), 'added by agent\n');
    const descendant = await repository.capture({
      ...scope,
      operationId: 'rewind-descendant',
      parentCheckpointId: target.id,
      conversationCursor: 'cursor-descendant',
    });
    const preview = await rewindPreview(repository, worktreePath, target, descendant, [
      'added.txt',
      'tracked.txt',
    ]);

    const request = {
      ...scope,
      operationId: 'rewind-operation',
      preview,
    };
    const [transaction, retry] = await Promise.all([
      repository.rewind(request),
      repository.rewind(request),
    ]);

    expect(transaction).toMatchObject({
      schemaVersion: 'workspace-checkpoint-rewind-transaction/v1',
      state: 'committed',
      previewDigest: preview.digest,
      previewEvidenceDigest: preview.evidenceDigest,
      targetCheckpointId: target.id,
      descendantCheckpointId: descendant.id,
      recoveryCheckpointId: descendant.id,
      restoredPathCount: 2,
      completedAt: expect.any(String),
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(retry).toEqual(transaction);
    await expect(fs.readFile(path.join(worktreePath, 'tracked.txt'), 'utf8')).resolves.toBe(
      'tracked worktree\n'
    );
    await expect(fs.lstat(path.join(worktreePath, 'added.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      repository.getRewind({
        ...scope,
        transactionId: transaction.id,
      })
    ).resolves.toEqual(transaction);

    await expect(
      repository.rollbackRewind({
        ...scope,
        transactionId: transaction.id,
        expectedTransactionDigest: transaction.digest,
      })
    ).resolves.toMatchObject({
      state: 'rolled-back',
      recoveryCheckpointId: descendant.id,
    });
    await expect(fs.readFile(path.join(worktreePath, 'tracked.txt'), 'utf8')).resolves.toBe(
      'descendant content\n'
    );
    await expect(fs.readFile(path.join(worktreePath, 'added.txt'), 'utf8')).resolves.toBe(
      'added by agent\n'
    );
  });

  it('commits only explicitly accepted paths and preserves rejected descendant files', async () => {
    const { worktreePath, storePath } = await fixture();
    await fs.rm(path.join(worktreePath, 'binary.bin'));
    await fs.rm(path.join(worktreePath, 'linked.txt'));
    const repository = new FileWorkspaceCheckpointRepository({ baseDir: storePath });
    const scope = {
      workspaceId: 'workspace-selective',
      taskId: 'task-selective',
      attemptId: 'attempt-selective',
      boundary: 'manual' as const,
      worktreePath,
      worktreeManifestId: 'manifest-selective',
    };
    const target = await repository.capture({
      ...scope,
      operationId: 'selective-target',
      conversationCursor: 'cursor-target',
    });
    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'descendant content\n');
    await fs.writeFile(path.join(worktreePath, 'added.txt'), 'preserve this descendant file\n');
    const descendant = await repository.capture({
      ...scope,
      operationId: 'selective-descendant',
      parentCheckpointId: target.id,
      conversationCursor: 'cursor-descendant',
    });
    const original = await rewindPreview(repository, worktreePath, target, descendant, [
      'added.txt',
      'tracked.txt',
    ]);
    const { digest: _digest, evidenceDigest: _evidenceDigest, ...originalPayload } = original;
    const resolvedPayload = {
      ...originalPayload,
      files: original.files.map((file) =>
        file.path === 'added.txt'
          ? {
              ...file,
              resolution: 'reject' as const,
              selectedForRewind: false,
            }
          : file
      ),
      resolutions: [{ path: 'added.txt', decision: 'reject' as const }],
      selectedPaths: ['tracked.txt'],
      estimatedDataLossBytes:
        original.files.find((file) => file.path === 'tracked.txt')?.estimatedDiscardedBytes ?? 0,
      safeForAutomaticRewind: false,
      safeForApprovedRewind: true,
    };
    const resolvedWithEvidence = {
      ...resolvedPayload,
      evidenceDigest: digestWorkspaceCheckpointRewindEvidence(resolvedPayload),
    };
    const preview = {
      ...resolvedWithEvidence,
      digest: digestRunLaunchValue(resolvedWithEvidence),
    };

    const transaction = await repository.rewind({
      ...scope,
      operationId: 'selective-operation',
      preview,
    });

    expect(transaction).toMatchObject({
      state: 'committed',
      affectedPaths: ['tracked.txt'],
      resolutions: [{ path: 'added.txt', decision: 'reject' }],
      restoredPathCount: 1,
    });
    await expect(fs.readFile(path.join(worktreePath, 'tracked.txt'), 'utf8')).resolves.toBe(
      'tracked worktree\n'
    );
    await expect(fs.readFile(path.join(worktreePath, 'added.txt'), 'utf8')).resolves.toBe(
      'preserve this descendant file\n'
    );
  });

  it('rolls a partially applied rewind back to its durable descendant checkpoint', async () => {
    const { worktreePath, storePath } = await fixture();
    await fs.rm(path.join(worktreePath, 'binary.bin'));
    await fs.rm(path.join(worktreePath, 'linked.txt'));
    const repository = new FileWorkspaceCheckpointRepository({
      baseDir: storePath,
      beforeRewindMutation: ({ phase, index }) => {
        if (phase === 'apply' && index === 1) throw new Error('injected rewind failure');
      },
    });
    const scope = {
      workspaceId: 'workspace-rollback',
      taskId: 'task-rollback',
      attemptId: 'attempt-rollback',
      boundary: 'manual' as const,
      worktreePath,
      worktreeManifestId: 'manifest-rollback',
    };
    const target = await repository.capture({
      ...scope,
      operationId: 'rollback-target',
      conversationCursor: 'cursor-target',
    });
    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'descendant content\n');
    await fs.writeFile(path.join(worktreePath, 'added.txt'), 'added by agent\n');
    const descendant = await repository.capture({
      ...scope,
      operationId: 'rollback-descendant',
      parentCheckpointId: target.id,
      conversationCursor: 'cursor-descendant',
    });
    const preview = await rewindPreview(repository, worktreePath, target, descendant, [
      'added.txt',
      'tracked.txt',
    ]);
    const operationId = 'rollback-operation';

    await expect(
      repository.rewind({
        ...scope,
        operationId,
        preview,
      })
    ).rejects.toThrow('restored the descendant checkpoint');

    await expect(fs.readFile(path.join(worktreePath, 'tracked.txt'), 'utf8')).resolves.toBe(
      'descendant content\n'
    );
    await expect(fs.readFile(path.join(worktreePath, 'added.txt'), 'utf8')).resolves.toBe(
      'added by agent\n'
    );
    const transactionId = getWorkspaceCheckpointRewindIdForOperation({
      ...scope,
      operationIdDigest: digestRunLaunchValue(operationId),
    });
    await expect(repository.getRewind({ ...scope, transactionId })).resolves.toMatchObject({
      state: 'rolled-back',
      recoveryCheckpointId: descendant.id,
      restoredPathCount: 0,
      completedAt: expect.any(String),
    });
  });

  it('preserves a workspace that diverges after transaction preparation but before mutation', async () => {
    const { worktreePath, storePath } = await fixture();
    await fs.rm(path.join(worktreePath, 'binary.bin'));
    await fs.rm(path.join(worktreePath, 'linked.txt'));
    const repository = new FileWorkspaceCheckpointRepository({ baseDir: storePath });
    const scope = {
      workspaceId: 'workspace-prepared-race',
      taskId: 'task-prepared-race',
      attemptId: 'attempt-prepared-race',
      boundary: 'manual' as const,
      worktreePath,
      worktreeManifestId: 'manifest-prepared-race',
    };
    const target = await repository.capture({
      ...scope,
      operationId: 'prepared-target',
      conversationCursor: 'cursor-target',
    });
    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'descendant content\n');
    const descendant = await repository.capture({
      ...scope,
      operationId: 'prepared-descendant',
      parentCheckpointId: target.id,
      conversationCursor: 'cursor-descendant',
    });
    const preview = await rewindPreview(repository, worktreePath, target, descendant, [
      'tracked.txt',
    ]);
    const inspectCurrent = repository.inspectCurrent.bind(repository);
    let inspections = 0;
    vi.spyOn(repository, 'inspectCurrent').mockImplementation(async (input) => {
      inspections += 1;
      if (inspections === 2) {
        await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'external race edit\n');
      }
      return inspectCurrent(input);
    });
    const operationId = 'prepared-race-operation';

    await expect(
      repository.rewind({
        ...scope,
        operationId,
        preview,
      })
    ).rejects.toThrow('aborted before mutation');

    await expect(fs.readFile(path.join(worktreePath, 'tracked.txt'), 'utf8')).resolves.toBe(
      'external race edit\n'
    );
    const transactionId = getWorkspaceCheckpointRewindIdForOperation({
      ...scope,
      operationIdDigest: digestRunLaunchValue(operationId),
    });
    await expect(repository.getRewind({ ...scope, transactionId })).resolves.toMatchObject({
      state: 'rolled-back',
      restoredPathCount: 0,
    });
  });

  it('fails closed when durable rewind recovery finds an unknown external edit', async () => {
    const { worktreePath, storePath } = await fixture();
    await fs.rm(path.join(worktreePath, 'binary.bin'));
    await fs.rm(path.join(worktreePath, 'linked.txt'));
    const crashingRepository = new FileWorkspaceCheckpointRepository({
      baseDir: storePath,
      beforeRewindMutation: ({ phase, index }) => {
        if ((phase === 'apply' && index === 1) || (phase === 'rollback' && index === 0)) {
          throw new Error('injected interrupted transaction');
        }
      },
    });
    const scope = {
      workspaceId: 'workspace-recovery',
      taskId: 'task-recovery',
      attemptId: 'attempt-recovery',
      boundary: 'manual' as const,
      worktreePath,
      worktreeManifestId: 'manifest-recovery',
    };
    const target = await crashingRepository.capture({
      ...scope,
      operationId: 'recovery-target',
      conversationCursor: 'cursor-target',
    });
    await fs.writeFile(path.join(worktreePath, 'tracked.txt'), 'descendant content\n');
    await fs.writeFile(path.join(worktreePath, 'added.txt'), 'added by agent\n');
    const descendant = await crashingRepository.capture({
      ...scope,
      operationId: 'recovery-descendant',
      parentCheckpointId: target.id,
      conversationCursor: 'cursor-descendant',
    });
    const preview = await rewindPreview(crashingRepository, worktreePath, target, descendant, [
      'added.txt',
      'tracked.txt',
    ]);
    const operationId = 'recovery-operation';

    await expect(
      crashingRepository.rewind({
        ...scope,
        operationId,
        preview,
      })
    ).rejects.toThrow('requires durable transaction recovery');

    await fs.writeFile(path.join(worktreePath, 'added.txt'), 'external edit after crash\n');
    const recoveryRepository = new FileWorkspaceCheckpointRepository({ baseDir: storePath });
    const transactionId = getWorkspaceCheckpointRewindIdForOperation({
      ...scope,
      operationIdDigest: digestRunLaunchValue(operationId),
    });
    await expect(recoveryRepository.recoverRewind({ ...scope, transactionId })).rejects.toThrow(
      'outside the known transaction states'
    );
    await expect(fs.readFile(path.join(worktreePath, 'added.txt'), 'utf8')).resolves.toBe(
      'external edit after crash\n'
    );

    await fs.writeFile(path.join(worktreePath, 'added.txt'), 'added by agent\n');
    await expect(
      recoveryRepository.recoverRewind({ ...scope, transactionId })
    ).resolves.toMatchObject({
      state: 'rolled-back',
      recoveryCheckpointId: descendant.id,
    });
    await expect(fs.readFile(path.join(worktreePath, 'tracked.txt'), 'utf8')).resolves.toBe(
      'descendant content\n'
    );
  });
});
