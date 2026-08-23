import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProgressService } from '../services/progress-service.js';

const unlinkFailure = vi.hoisted(() => ({
  error: undefined as NodeJS.ErrnoException | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    unlink: async (filePath: Parameters<typeof actual.unlink>[0]) => {
      if (unlinkFailure.error) throw unlinkFailure.error;
      return actual.unlink(filePath);
    },
  };
});

describe('ProgressService file repository', () => {
  let root: string;
  let progressDir: string;
  let service: ProgressService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'veritas-progress-service-'));
    progressDir = path.join(root, 'progress');
    service = new ProgressService(progressDir);
  });

  afterEach(async () => {
    unlinkFailure.error = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it('rejects task IDs that escape the progress directory', async () => {
    await expect(service.updateProgress('../escape', 'outside')).rejects.toThrow(/path segment/i);
    await expect(readFile(path.join(root, 'escape.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('persists, appends, and deletes progress through the repository', async () => {
    await service.updateProgress('task-1', '# Progress\n');
    await service.appendProgress('task-1', 'Done', 'first item');
    await service.appendProgress('task-1', 'Done', 'second item');

    const progress = await service.getProgress('task-1');
    expect(progress).toContain('# Progress');
    expect(progress).toContain('## Done');
    expect(progress).toContain('first item');
    expect(progress).toContain('second item');

    await service.deleteProgress('task-1');
    await expect(service.getProgress('task-1')).resolves.toBeNull();
    await expect(service.deleteProgress('task-1')).resolves.toBeUndefined();
  });

  it('preserves concurrent appends with a repository lock', async () => {
    await Promise.all([
      service.appendProgress('task-2', 'Notes', 'alpha'),
      service.appendProgress('task-2', 'Notes', 'beta'),
    ]);

    const progress = await service.getProgress('task-2');
    expect(progress).toContain('alpha');
    expect(progress).toContain('beta');
  });

  it('refuses to read progress through a symbolic link', async () => {
    const target = path.join(root, 'target.md');
    await mkdir(progressDir, { recursive: true });
    await writeFile(target, 'outside');
    await symlink(target, path.join(progressDir, 'task-3.md'));

    await expect(service.getProgress('task-3')).rejects.toThrow(/symbolic link/i);
  });

  it('rejects oversized progress content and non-file entries', async () => {
    await expect(service.updateProgress('task-4', 'x'.repeat(2 * 1024 * 1024 + 1))).rejects.toThrow(
      /2 MiB/i
    );

    await mkdir(path.join(progressDir, 'task-4.md'), { recursive: true });
    await expect(service.getProgress('task-4')).rejects.toThrow(/bounded regular file/i);
  });

  it('keeps concurrent deletes idempotent', async () => {
    await service.updateProgress('task-5', 'temporary');

    await expect(
      Promise.all([service.deleteProgress('task-5'), service.deleteProgress('task-5')])
    ).resolves.toEqual([undefined, undefined]);
  });

  it('propagates repository delete failures', async () => {
    await service.updateProgress('task-6', 'temporary');
    unlinkFailure.error = Object.assign(new Error('delete denied'), { code: 'EACCES' });

    await expect(service.deleteProgress('task-6')).rejects.toThrow('delete denied');
  });

  it('rejects a symbolic-link progress directory', async () => {
    const realDirectory = path.join(root, 'real-progress');
    await mkdir(realDirectory);
    await symlink(realDirectory, progressDir, 'dir');

    await expect(service.updateProgress('task-7', 'unsafe')).rejects.toThrow(/regular directory/i);
  });
});
