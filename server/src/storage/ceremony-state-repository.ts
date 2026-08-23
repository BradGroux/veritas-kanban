import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { CeremonyRequirement } from '@veritas-kanban/shared';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_CEREMONY_STATE_BYTES = 16 * 1024 * 1024;

export interface CeremonyState {
  version: 1;
  requirements: CeremonyRequirement[];
  updatedAt: string;
}

export interface CeremonyStateRepository {
  read(): Promise<CeremonyState>;
  update(updater: (state: CeremonyState) => CeremonyState): Promise<CeremonyState>;
}

function emptyState(): CeremonyState {
  return { version: 1, requirements: [], updatedAt: new Date().toISOString() };
}

function normalizeState(parsed: Partial<CeremonyState>): CeremonyState {
  return {
    version: 1,
    requirements: Array.isArray(parsed.requirements)
      ? (parsed.requirements as CeremonyRequirement[])
      : [],
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
  };
}

export class FileCeremonyStateRepository implements CeremonyStateRepository {
  private readonly storageDir: string;
  private readonly stateFile: string;

  constructor(storageDir: string) {
    this.storageDir = path.resolve(storageDir);
    this.stateFile = ensureWithinBase(
      this.storageDir,
      path.join(this.storageDir, 'requirements.json')
    );
  }

  async read(): Promise<CeremonyState> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.stateFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(this.stateFile), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error('Ceremony state must not use a symbolic link or changed file');
      }
      if (!stats.isFile() || stats.size > MAX_CEREMONY_STATE_BYTES) {
        throw new Error('Ceremony state must use a bounded regular file');
      }
      return normalizeState(JSON.parse(await handle.readFile({ encoding: 'utf8' })));
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return emptyState();
      if (errorCode === 'ELOOP') {
        throw new Error('Ceremony state must not use a symbolic link', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async update(updater: (state: CeremonyState) => CeremonyState): Promise<CeremonyState> {
    await this.prepareDirectory();
    return withFileLock(this.stateFile, async () => {
      const state = {
        ...updater(await this.read()),
        version: 1 as const,
        updatedAt: new Date().toISOString(),
      };
      const content = JSON.stringify(state, null, 2);
      if (Buffer.byteLength(content, 'utf8') > MAX_CEREMONY_STATE_BYTES) {
        throw new Error('Ceremony state exceeds the 16 MiB storage limit');
      }
      await atomicWriteFile(this.stateFile, content, 'utf8');
      return state;
    });
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.storageDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Ceremony storage path must use a regular directory');
    }
  }
}

export class InMemoryCeremonyStateRepository implements CeremonyStateRepository {
  private state = emptyState();

  async read(): Promise<CeremonyState> {
    return this.state;
  }

  async update(updater: (state: CeremonyState) => CeremonyState): Promise<CeremonyState> {
    this.state = {
      ...updater(this.state),
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    return this.state;
  }
}
