import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { StatusHistoryEntry } from '../services/status-history-service.js';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_HISTORY_BYTES = 16 * 1024 * 1024;

export class FileStatusHistoryStore {
  private readonly historyFile: string;

  constructor(historyFile: string) {
    this.historyFile = path.resolve(historyFile);
    ensureWithinBase(path.dirname(this.historyFile), this.historyFile);
  }

  async read(): Promise<StatusHistoryEntry[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.historyFile, 'r');
      const [pathStats, stats] = await Promise.all([lstat(this.historyFile), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error('Status history must not be a symbolic link or changed file');
      }
      if (!stats.isFile() || stats.size > MAX_HISTORY_BYTES) {
        throw new Error('Status history must be a bounded regular file');
      }
      const parsed: unknown = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
      return Array.isArray(parsed) ? (parsed as StatusHistoryEntry[]) : [];
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async update(
    updater: (entries: StatusHistoryEntry[]) => StatusHistoryEntry[]
  ): Promise<StatusHistoryEntry[]> {
    await this.prepareParent();
    return withFileLock(this.historyFile, async () => {
      const entries = updater(await this.read());
      const content = JSON.stringify(entries, null, 2);
      if (Buffer.byteLength(content, 'utf8') > MAX_HISTORY_BYTES) {
        throw new Error('Status history exceeds the 16 MiB storage limit');
      }
      await atomicWriteFile(this.historyFile, content, 'utf8');
      return entries;
    });
  }

  async clear(): Promise<void> {
    await this.update(() => []);
  }

  private async prepareParent(): Promise<void> {
    const parent = path.dirname(this.historyFile);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const stats = await lstat(parent);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Status history path must use a regular directory');
    }
  }
}
