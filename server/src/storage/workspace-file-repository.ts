import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ensureWithinBase } from '../utils/sanitize.js';
import type { WorkspaceFileRepository } from './interfaces.js';

export class LocalWorkspaceFileRepository implements WorkspaceFileRepository {
  async readOptionalText(workspaceRoot: string, relativePath: string): Promise<string | null> {
    const resolvedPath = ensureWithinBase(workspaceRoot, path.resolve(workspaceRoot, relativePath));
    try {
      const [canonicalRoot, canonicalPath] = await Promise.all([
        realpath(workspaceRoot),
        realpath(resolvedPath),
      ]);
      ensureWithinBase(canonicalRoot, canonicalPath);
      return await readFile(canonicalPath, 'utf8');
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return null;
      }
      throw error;
    }
  }
}
