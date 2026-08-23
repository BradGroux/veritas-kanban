import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { HookConfig, HookExecution } from '../services/lifecycle-hooks-service.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_LIFECYCLE_HOOKS_BYTES = 8 * 1024 * 1024;

export interface LifecycleHooksRepository {
  readHooks(): Promise<HookConfig[] | null>;
  updateHooks(updater: (hooks: HookConfig[] | null) => HookConfig[]): Promise<HookConfig[]>;
  readExecutions(): Promise<HookExecution[]>;
  updateExecutions(
    updater: (executions: HookExecution[]) => HookExecution[]
  ): Promise<HookExecution[]>;
}

export class FileLifecycleHooksRepository implements LifecycleHooksRepository {
  private readonly runtimeDir: string;
  private readonly hooksFile: string;
  private readonly executionsFile: string;

  constructor(runtimeDir = getRuntimeDir()) {
    this.runtimeDir = path.resolve(runtimeDir);
    this.hooksFile = ensureWithinBase(
      this.runtimeDir,
      path.join(this.runtimeDir, 'lifecycle-hooks.json')
    );
    this.executionsFile = ensureWithinBase(
      this.runtimeDir,
      path.join(this.runtimeDir, 'hook-executions.json')
    );
  }

  readHooks(): Promise<HookConfig[] | null> {
    return this.readJson<HookConfig[] | null>(this.hooksFile, null, 'Lifecycle hooks');
  }

  async updateHooks(updater: (hooks: HookConfig[] | null) => HookConfig[]): Promise<HookConfig[]> {
    await this.prepareDirectory();
    return withFileLock(this.hooksFile, async () => {
      const hooks = updater(await this.readHooks());
      await this.writeJson(this.hooksFile, hooks, 'Lifecycle hooks');
      return hooks;
    });
  }

  readExecutions(): Promise<HookExecution[]> {
    return this.readJson<HookExecution[]>(this.executionsFile, [], 'Lifecycle hook executions');
  }

  async updateExecutions(
    updater: (executions: HookExecution[]) => HookExecution[]
  ): Promise<HookExecution[]> {
    await this.prepareDirectory();
    return withFileLock(this.executionsFile, async () => {
      const executions = updater(await this.readExecutions());
      await this.writeJson(this.executionsFile, executions, 'Lifecycle hook executions');
      return executions;
    });
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.runtimeDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Lifecycle hooks path must use a regular directory');
    }
  }

  private async readJson<T>(filePath: string, fallback: T, label: string): Promise<T> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(filePath), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error(`${label} must not use a symbolic link or changed file`);
      }
      if (!stats.isFile() || stats.size > MAX_LIFECYCLE_HOOKS_BYTES) {
        throw new Error(`${label} must use a bounded regular file`);
      }
      return JSON.parse(await handle.readFile({ encoding: 'utf8' })) as T;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return fallback;
      if (errorCode === 'ELOOP') {
        throw new Error(`${label} must not use a symbolic link`, { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async writeJson(filePath: string, value: unknown, label: string): Promise<void> {
    const content = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(content, 'utf8') > MAX_LIFECYCLE_HOOKS_BYTES) {
      throw new Error(`${label} exceeds the 8 MiB storage limit`);
    }
    await atomicWriteFile(filePath, content, 'utf8');
  }
}
