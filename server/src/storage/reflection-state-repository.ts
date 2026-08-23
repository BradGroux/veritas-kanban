import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { ReflectionCandidate } from '@veritas-kanban/shared';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_REFLECTION_STATE_BYTES = 16 * 1024 * 1024;

export interface ReflectionState {
  version: 1;
  candidates: ReflectionCandidate[];
  updatedAt: string;
}

export interface ReflectionStateRepository {
  read(): Promise<ReflectionState | null>;
  write(state: ReflectionState): Promise<void>;
}

function normalizeState(parsed: Partial<ReflectionState>): ReflectionState {
  return {
    version: 1,
    candidates: Array.isArray(parsed.candidates)
      ? (parsed.candidates as ReflectionCandidate[])
      : [],
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
  };
}

export class FileReflectionStateRepository implements ReflectionStateRepository {
  private readonly storageDir: string;
  private readonly stateFile: string;

  constructor(storageDir: string) {
    this.storageDir = path.resolve(storageDir);
    this.stateFile = ensureWithinBase(
      this.storageDir,
      path.join(this.storageDir, 'candidates.json')
    );
  }

  async read(): Promise<ReflectionState | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.stateFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(this.stateFile), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error('Reflection state must not use a symbolic link or changed file');
      }
      if (!stats.isFile() || stats.size > MAX_REFLECTION_STATE_BYTES) {
        throw new Error('Reflection state must use a bounded regular file');
      }
      return normalizeState(JSON.parse(await handle.readFile({ encoding: 'utf8' })));
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return null;
      if (errorCode === 'ELOOP') {
        throw new Error('Reflection state must not use a symbolic link', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async write(state: ReflectionState): Promise<void> {
    await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    const directoryStats = await lstat(this.storageDir);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error('Reflection state path must use a regular directory');
    }
    const content = JSON.stringify(state, null, 2);
    if (Buffer.byteLength(content, 'utf8') > MAX_REFLECTION_STATE_BYTES) {
      throw new Error('Reflection state exceeds the 16 MiB storage limit');
    }
    await withFileLock(this.stateFile, () => atomicWriteFile(this.stateFile, content, 'utf8'));
  }
}
