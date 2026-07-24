import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WORKTREE_MANIFEST_SCHEMA_VERSION, type WorktreeManifest } from '@veritas-kanban/shared';
import { FileWorktreeManifestRepository } from '../storage/worktree-manifest-repository.js';

describe('FileWorktreeManifestRepository', () => {
  let root: string;
  let manifestsDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-worktree-manifests-'));
    manifestsDir = path.join(root, 'manifests');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function manifest(): WorktreeManifest {
    return {
      schemaVersion: WORKTREE_MANIFEST_SCHEMA_VERSION,
      id: 'worktree_fixture',
      revision: 0,
      taskId: 'task_858',
      repository: {
        name: 'veritas',
        rootPath: '/tmp/veritas',
        commonGitDir: '/tmp/veritas/.git',
        originFingerprint: `sha256:${'a'.repeat(64)}`,
      },
      path: '/tmp/veritas-worktree',
      branch: 'feat/worktree-858',
      base: {
        branch: 'main',
        commit: 'b'.repeat(40),
        source: 'remote',
        resolvedAt: '2026-07-23T20:00:00.000Z',
        fetchedAt: '2026-07-23T20:00:00.000Z',
      },
      lease: {
        id: 'lease_fixture',
        ownerTaskId: 'task_858',
        acquiredAt: '2026-07-23T20:00:00.000Z',
        expiresAt: '2026-08-22T20:00:00.000Z',
      },
      lifecycle: {
        creation: 'ready',
        integration: 'idle',
        cleanup: 'active',
      },
      rebase: { state: 'idle' },
      integration: {},
      createdAt: '2026-07-23T20:00:00.000Z',
      updatedAt: '2026-07-23T20:00:00.000Z',
      overrides: [],
    };
  }

  it('atomically validates, versions, reads, and lists manifests', async () => {
    const repository = new FileWorktreeManifestRepository({ manifestsDir });

    const first = await repository.withTaskLock('task_858', () => repository.save(manifest()));
    const second = await repository.withTaskLock('task_858', () =>
      repository.save({
        ...first,
        lifecycle: { ...first.lifecycle, integration: 'preparing' },
      })
    );

    expect(first.revision).toBe(0);
    expect(second.revision).toBe(1);
    expect(await repository.read('task_858')).toEqual(second);
    expect(await repository.list()).toEqual([second]);
  });

  it('surfaces invalid persisted state instead of silently replacing it', async () => {
    const repository = new FileWorktreeManifestRepository({ manifestsDir });
    await fs.mkdir(manifestsDir, { recursive: true });
    await fs.writeFile(path.join(manifestsDir, 'task_858.json'), '{}\n');

    await expect(repository.read('task_858')).rejects.toThrow();
  });

  it('never auto-removes an ambiguous stale-looking lock', async () => {
    const repository = new FileWorktreeManifestRepository({
      manifestsDir,
      lockTimeoutMs: 75,
    });
    await fs.mkdir(manifestsDir, { recursive: true });
    const lockPath = path.join(manifestsDir, 'task_858.json.lock');
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: 999_999,
        createdAt: '2020-01-01T00:00:00.000Z',
        token: 'ambiguous-owner',
      })
    );

    await expect(repository.withTaskLock('task_858', async () => undefined)).rejects.toThrow(
      /held or stale/
    );
    expect(await fs.readFile(lockPath, 'utf8')).toContain('ambiguous-owner');
  });
});
