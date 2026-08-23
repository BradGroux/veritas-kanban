import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { LocalConflictWorkspaceRepository } from '../storage/conflict-workspace-repository.js';

describe('LocalConflictWorkspaceRepository', () => {
  let root: string;
  let outsideRoot: string;
  const repository = new LocalConflictWorkspaceRepository();

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-conflict-workspace-'));
    outsideRoot = await mkdtemp(path.join(process.cwd(), '.veritas-conflict-outside-'));
  });

  afterEach(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outsideRoot, { recursive: true, force: true }),
    ]);
  });

  it('inspects Git state paths and distinguishes missing entries', async () => {
    await mkdir(path.join(root, '.git', 'rebase-merge'), { recursive: true });
    await writeFile(path.join(root, '.git', 'MERGE_HEAD'), 'abc123\n', 'utf8');

    await expect(repository.exists(root, '.git/rebase-merge')).resolves.toBe(true);
    await expect(repository.exists(root, '.git/MERGE_HEAD')).resolves.toBe(true);
    await expect(repository.exists(root, '.git/rebase-apply')).resolves.toBe(false);
    await expect(repository.exists(root, '.git/MERGE_HEAD/child')).resolves.toBe(false);
  });

  it('reads and rewrites conflict content without changing file mode', async () => {
    const conflictPath = path.join(root, 'script.sh');
    await writeFile(conflictPath, '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n', 'utf8');
    await chmod(conflictPath, 0o755);

    await expect(repository.readText(root, 'script.sh')).resolves.toContain('<<<<<<< HEAD');
    await repository.writeText(root, 'script.sh', '#!/bin/sh\necho resolved\n');

    await expect(readFile(conflictPath, 'utf8')).resolves.toBe('#!/bin/sh\necho resolved\n');
    expect((await stat(conflictPath)).mode & 0o777).toBe(0o755);
  });

  it('allows internal symlinks and rejects traversal or external symlinks', async () => {
    await writeFile(path.join(root, 'target.txt'), 'inside\n', 'utf8');
    await symlink(path.join(root, 'target.txt'), path.join(root, 'inside-link.txt'));
    await expect(repository.readText(root, 'inside-link.txt')).resolves.toBe('inside\n');

    await writeFile(path.join(outsideRoot, 'outside.txt'), 'outside\n', 'utf8');
    await symlink(path.join(outsideRoot, 'outside.txt'), path.join(root, 'outside-link.txt'));
    await expect(repository.readText(root, 'outside-link.txt')).rejects.toThrow(
      /outside the base directory/i
    );
    await expect(repository.exists(root, '../outside.txt')).rejects.toThrow(
      /outside the base directory/i
    );
  });

  it('rejects missing, non-file, and oversized conflict content', async () => {
    await expect(repository.readText(root, 'missing.txt')).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await mkdir(path.join(root, 'directory'));
    await expect(repository.readText(root, 'directory')).rejects.toThrow(/bounded regular file/i);
    await expect(repository.writeText(root, 'directory', 'content')).rejects.toThrow();

    const oversizedPath = path.join(root, 'oversized.txt');
    await writeFile(oversizedPath, '', 'utf8');
    await truncate(oversizedPath, 16 * 1024 * 1024 + 1);
    await expect(repository.readText(root, 'oversized.txt')).rejects.toThrow(
      /bounded regular file/i
    );
    await expect(
      repository.writeText(root, 'oversized.txt', 'x'.repeat(16 * 1024 * 1024 + 1))
    ).rejects.toThrow(/16 MiB/i);
  });
});
