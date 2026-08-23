import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TransitionHooksConfig } from '@veritas-kanban/shared';
import { FileTransitionHooksConfigRepository } from '../storage/transition-hooks-config-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

function config(enabled = true): TransitionHooksConfig {
  return { version: 1, enabled, rules: [] };
}

describe('FileTransitionHooksConfigRepository', () => {
  let root: string;
  let runtimeDir: string;
  let repository: FileTransitionHooksConfigRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-transition-hooks-config-'));
    runtimeDir = path.join(root, 'runtime');
    repository = new FileTransitionHooksConfigRepository(runtimeDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads missing state and atomically replaces configuration', async () => {
    await expect(repository.read()).resolves.toBeNull();
    await repository.write(config());
    await expect(repository.read()).resolves.toEqual(config());
    await repository.write(config(false));
    await expect(repository.read()).resolves.toEqual(config(false));
  });

  it('rejects symbolic links, changed files, and non-file paths', async () => {
    await mkdir(runtimeDir, { recursive: true });
    const configFile = path.join(runtimeDir, 'transition-hooks.json');
    const target = path.join(root, 'outside.json');
    await writeFile(target, JSON.stringify(config()), 'utf8');
    await symlink(target, configFile);
    await expect(repository.read()).rejects.toThrow(/symbolic link/i);

    await rm(configFile);
    await writeFile(configFile, JSON.stringify(config()), 'utf8');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementationOnce(async (filePath) => {
      const stats = await actual.lstat(filePath);
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });
    await expect(repository.read()).rejects.toThrow(/changed file/i);

    await rm(configFile);
    await mkdir(configFile);
    await expect(repository.read()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link directories and oversized configuration', async () => {
    const realDirectory = path.join(root, 'real-runtime');
    const linkedDirectory = path.join(root, 'linked-runtime');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileTransitionHooksConfigRepository(linkedDirectory);
    await expect(linkedRepository.write(config())).rejects.toThrow(/regular directory/i);

    await expect(
      repository.write({
        ...config(),
        rules: [
          {
            id: 'large',
            name: 'x'.repeat(4 * 1024 * 1024),
            enabled: true,
            from: '*',
            to: '*',
            gates: [],
            actions: [],
          },
        ],
      })
    ).rejects.toThrow(/4 MiB/i);
  });
});
