import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase } from '../utils/sanitize.js';

const MAX_CONFLICT_FILE_BYTES = 16 * 1024 * 1024;

export interface ConflictWorkspaceRepository {
  exists(workspaceRoot: string, relativePath: string): Promise<boolean>;
  readText(workspaceRoot: string, relativePath: string): Promise<string>;
  writeText(workspaceRoot: string, relativePath: string, content: string): Promise<void>;
}

export class LocalConflictWorkspaceRepository implements ConflictWorkspaceRepository {
  async exists(workspaceRoot: string, relativePath: string): Promise<boolean> {
    try {
      await this.resolveCanonicalPath(workspaceRoot, relativePath);
      return true;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') return false;
      throw error;
    }
  }

  async readText(workspaceRoot: string, relativePath: string): Promise<string> {
    const filePath = await this.resolveCanonicalPath(workspaceRoot, relativePath);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_CONFLICT_FILE_BYTES) {
        throw new Error('Conflict content must use a bounded regular file');
      }
      return await handle.readFile({ encoding: 'utf8' });
    } finally {
      await handle?.close();
    }
  }

  async writeText(workspaceRoot: string, relativePath: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > MAX_CONFLICT_FILE_BYTES) {
      throw new Error('Conflict content exceeds the 16 MiB storage limit');
    }

    const filePath = await this.resolveCanonicalPath(workspaceRoot, relativePath);
    await withFileLock(filePath, async () => {
      let inspectionHandle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        inspectionHandle = await open(
          filePath,
          constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)
        );
        if (!(await inspectionHandle.stat()).isFile()) {
          throw new Error('Conflict content must use a regular file');
        }
      } finally {
        await inspectionHandle?.close();
      }

      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(
          filePath,
          constants.O_WRONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)
        );
        await handle.truncate(0);
        await handle.writeFile(content, { encoding: 'utf8' });
      } finally {
        await handle?.close();
      }
    });
  }

  private async resolveCanonicalPath(workspaceRoot: string, relativePath: string): Promise<string> {
    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedPath = ensureWithinBase(resolvedRoot, path.resolve(resolvedRoot, relativePath));
    const [canonicalRoot, canonicalPath] = await Promise.all([
      realpath(resolvedRoot),
      realpath(resolvedPath),
    ]);
    return ensureWithinBase(canonicalRoot, canonicalPath);
  }
}
