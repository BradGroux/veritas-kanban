import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { TransitionHooksConfig } from '@veritas-kanban/shared';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_TRANSITION_HOOKS_CONFIG_BYTES = 4 * 1024 * 1024;

export interface TransitionHooksConfigRepository {
  read(): Promise<TransitionHooksConfig | null>;
  write(config: TransitionHooksConfig): Promise<void>;
}

export class FileTransitionHooksConfigRepository implements TransitionHooksConfigRepository {
  private readonly runtimeDir: string;
  private readonly configFile: string;

  constructor(runtimeDir = getRuntimeDir()) {
    this.runtimeDir = path.resolve(runtimeDir);
    this.configFile = ensureWithinBase(
      this.runtimeDir,
      path.join(this.runtimeDir, 'transition-hooks.json')
    );
  }

  async read(): Promise<TransitionHooksConfig | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.configFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(this.configFile), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error('Transition hooks config must not use a symbolic link or changed file');
      }
      if (!stats.isFile() || stats.size > MAX_TRANSITION_HOOKS_CONFIG_BYTES) {
        throw new Error('Transition hooks config must use a bounded regular file');
      }
      return JSON.parse(await handle.readFile({ encoding: 'utf8' })) as TransitionHooksConfig;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return null;
      if (errorCode === 'ELOOP') {
        throw new Error('Transition hooks config must not use a symbolic link', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async write(config: TransitionHooksConfig): Promise<void> {
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    const directoryStats = await lstat(this.runtimeDir);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error('Transition hooks config path must use a regular directory');
    }
    const content = JSON.stringify(config, null, 2);
    if (Buffer.byteLength(content, 'utf8') > MAX_TRANSITION_HOOKS_CONFIG_BYTES) {
      throw new Error('Transition hooks config exceeds the 4 MiB storage limit');
    }
    await withFileLock(this.configFile, () => atomicWriteFile(this.configFile, content, 'utf8'));
  }
}
