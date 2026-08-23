import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { DelegationLog, DelegationSettings } from '@veritas-kanban/shared';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_DELEGATION_BYTES = 4 * 1024 * 1024;

export interface DelegationRepository {
  readSettings(): Promise<DelegationSettings | null>;
  writeSettings(settings: DelegationSettings): Promise<void>;
  updateSettings(
    updater: (settings: DelegationSettings | null) => DelegationSettings | null
  ): Promise<DelegationSettings | null>;
  readLog(): Promise<DelegationLog>;
  updateLog(updater: (log: DelegationLog) => DelegationLog): Promise<DelegationLog>;
}

export class FileDelegationRepository implements DelegationRepository {
  private readonly runtimeDir: string;
  private readonly settingsFile: string;
  private readonly logFile: string;

  constructor(runtimeDir = getRuntimeDir()) {
    this.runtimeDir = path.resolve(runtimeDir);
    this.settingsFile = ensureWithinBase(
      this.runtimeDir,
      path.join(this.runtimeDir, 'delegation.json')
    );
    this.logFile = ensureWithinBase(
      this.runtimeDir,
      path.join(this.runtimeDir, 'delegation-log.json')
    );
  }

  readSettings(): Promise<DelegationSettings | null> {
    return this.readJson<DelegationSettings | null>(this.settingsFile, null, 'Delegation settings');
  }

  async writeSettings(settings: DelegationSettings): Promise<void> {
    await this.prepareDirectory();
    await withFileLock(this.settingsFile, () =>
      this.writeJson(this.settingsFile, settings, 'Delegation settings')
    );
  }

  async updateSettings(
    updater: (settings: DelegationSettings | null) => DelegationSettings | null
  ): Promise<DelegationSettings | null> {
    await this.prepareDirectory();
    return withFileLock(this.settingsFile, async () => {
      const settings = updater(await this.readSettings());
      if (settings) {
        await this.writeJson(this.settingsFile, settings, 'Delegation settings');
      }
      return settings;
    });
  }

  async readLog(): Promise<DelegationLog> {
    return this.readJson<DelegationLog>(this.logFile, { approvals: [] }, 'Delegation log');
  }

  async updateLog(updater: (log: DelegationLog) => DelegationLog): Promise<DelegationLog> {
    await this.prepareDirectory();
    return withFileLock(this.logFile, async () => {
      const delegationLog = updater(await this.readLog());
      await this.writeJson(this.logFile, delegationLog, 'Delegation log');
      return delegationLog;
    });
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.runtimeDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Delegation storage path must use a regular directory');
    }
  }

  private async readJson<T>(filePath: string, fallback: T, label: string): Promise<T> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const pathStats = await lstat(filePath);
      if (pathStats.isSymbolicLink()) {
        throw new Error(`${label} must not use a symbolic link`);
      }
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_DELEGATION_BYTES) {
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
    if (Buffer.byteLength(content, 'utf8') > MAX_DELEGATION_BYTES) {
      throw new Error(`${label} exceeds the 4 MiB storage limit`);
    }
    await atomicWriteFile(filePath, content, 'utf8');
  }
}
