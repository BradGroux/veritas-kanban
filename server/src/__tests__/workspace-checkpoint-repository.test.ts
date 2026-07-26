import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';
import { FileWorkspaceCheckpointRepository } from '../storage/workspace-checkpoint-repository.js';

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
});
