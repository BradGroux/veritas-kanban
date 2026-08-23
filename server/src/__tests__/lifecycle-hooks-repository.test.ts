import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HookConfig, HookExecution } from '../services/lifecycle-hooks-service.js';
import { FileLifecycleHooksRepository } from '../storage/lifecycle-hooks-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

function hook(id: string, name = id): HookConfig {
  return {
    id,
    name,
    event: 'task.created',
    action: 'log_activity',
    enabled: true,
    builtIn: false,
    order: 10,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
}

function execution(hookId: string): HookExecution {
  return {
    hookId,
    hookName: hookId,
    event: 'task.created',
    taskId: 'task-1',
    action: 'log_activity',
    success: true,
    durationMs: 1,
    executedAt: '2026-08-23T00:00:00.000Z',
  };
}

describe('FileLifecycleHooksRepository', () => {
  let root: string;
  let runtimeDir: string;
  let repository: FileLifecycleHooksRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-lifecycle-hooks-'));
    runtimeDir = path.join(root, 'runtime');
    repository = new FileLifecycleHooksRepository(runtimeDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('preserves concurrent hook and execution updates', async () => {
    await expect(repository.readHooks()).resolves.toBeNull();
    await Promise.all([
      repository.updateHooks((hooks) => [...(hooks ?? []), hook('one')]),
      repository.updateHooks((hooks) => [...(hooks ?? []), hook('two')]),
    ]);
    expect(new Set((await repository.readHooks())?.map(({ id }) => id))).toEqual(
      new Set(['one', 'two'])
    );

    await Promise.all([
      repository.updateExecutions((executions) => [...executions, execution('one')]),
      repository.updateExecutions((executions) => [...executions, execution('two')]),
    ]);
    expect(new Set((await repository.readExecutions()).map(({ hookId }) => hookId))).toEqual(
      new Set(['one', 'two'])
    );
  });

  it('rejects symbolic links, changed files, and non-file paths', async () => {
    await mkdir(runtimeDir, { recursive: true });
    const hooksFile = path.join(runtimeDir, 'lifecycle-hooks.json');
    const target = path.join(root, 'outside.json');
    await writeFile(target, JSON.stringify([hook('outside')]), 'utf8');
    await symlink(target, hooksFile);
    await expect(repository.readHooks()).rejects.toThrow(/symbolic link/i);

    await rm(hooksFile);
    await writeFile(hooksFile, JSON.stringify([hook('changed')]), 'utf8');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementationOnce(async (filePath) => {
      const stats = await actual.lstat(filePath);
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });
    await expect(repository.readHooks()).rejects.toThrow(/changed file/i);

    await rm(hooksFile);
    await mkdir(hooksFile);
    await expect(repository.readHooks()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link directories and oversized state', async () => {
    const realDirectory = path.join(root, 'real-runtime');
    const linkedDirectory = path.join(root, 'linked-runtime');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileLifecycleHooksRepository(linkedDirectory);
    await expect(linkedRepository.updateHooks(() => [hook('linked')])).rejects.toThrow(
      /regular directory/i
    );

    await expect(
      repository.updateHooks(() => [hook('large', 'x'.repeat(8 * 1024 * 1024))])
    ).rejects.toThrow(/8 MiB/i);
  });
});
