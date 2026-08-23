import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { Deliverable, DeliverableRun } from '../services/scheduled-deliverables-service.js';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_STATE_BYTES = 16 * 1024 * 1024;

export class FileScheduledDeliverablesStore {
  private readonly deliverablesFile: string;
  private readonly runsFile: string;

  constructor(deliverablesFile: string, runsFile: string) {
    this.deliverablesFile = this.resolveFile(deliverablesFile);
    this.runsFile = this.resolveFile(runsFile);
  }

  loadDeliverables(): Promise<Deliverable[]> {
    return this.readArray<Deliverable>(this.deliverablesFile, 'Scheduled deliverables');
  }

  loadRuns(): Promise<DeliverableRun[]> {
    return this.readArray<DeliverableRun>(this.runsFile, 'Scheduled deliverable runs');
  }

  saveDeliverables(deliverables: Deliverable[]): Promise<void> {
    return this.writeArray(this.deliverablesFile, deliverables, 'Scheduled deliverables');
  }

  saveRuns(runs: DeliverableRun[]): Promise<void> {
    return this.writeArray(this.runsFile, runs, 'Scheduled deliverable runs');
  }

  private resolveFile(filePath: string): string {
    const resolved = path.resolve(filePath);
    return ensureWithinBase(path.dirname(resolved), resolved);
  }

  private async readArray<T>(filePath: string, label: string): Promise<T[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, 'r');
      const [pathStats, stats] = await Promise.all([lstat(filePath), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error(`${label} must not use a symbolic link or changed file`);
      }
      if (!stats.isFile() || stats.size > MAX_STATE_BYTES) {
        throw new Error(`${label} must use a bounded regular file`);
      }
      const parsed: unknown = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async writeArray<T>(filePath: string, entries: T[], label: string): Promise<void> {
    const parent = path.dirname(filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const parentStats = await lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
      throw new Error(`${label} path must use a regular directory`);
    }

    const content = JSON.stringify(entries, null, 2);
    if (Buffer.byteLength(content, 'utf8') > MAX_STATE_BYTES) {
      throw new Error(`${label} exceeds the 16 MiB storage limit`);
    }
    await withFileLock(filePath, () => atomicWriteFile(filePath, content, 'utf8'));
  }
}
