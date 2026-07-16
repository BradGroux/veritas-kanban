import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readlink } from 'node:fs/promises';
import path from 'node:path';
import { ensureWithinBase } from './sanitize.js';

function isMissingOrRaced(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR';
}

/**
 * Hash one worktree entry without following symlinks outside the worktree.
 * Symlinks are hashed as their link-target text, matching Git's blob semantics.
 */
export async function sha256WorktreeEntry(
  worktreePath: string,
  relativePath: string
): Promise<string | null> {
  const absolutePath = ensureWithinBase(worktreePath, path.resolve(worktreePath, relativePath));

  try {
    const stat = await lstat(absolutePath);
    const hash = createHash('sha256');

    if (stat.isSymbolicLink()) {
      return hash.update(await readlink(absolutePath), 'utf8').digest('hex');
    }
    if (!stat.isFile()) return null;

    const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const openedStat = await handle.stat();
      if (!openedStat.isFile()) return null;
      const stream = handle.createReadStream({ autoClose: false });
      for await (const chunk of stream) hash.update(chunk);
      return hash.digest('hex');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissingOrRaced(error)) return null;
    throw error;
  }
}
