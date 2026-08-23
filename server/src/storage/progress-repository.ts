import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_PROGRESS_BYTES = 2 * 1024 * 1024;

export interface ProgressRepository {
  get(taskId: string): Promise<string | null>;
  set(taskId: string, content: string): Promise<void>;
  update(taskId: string, updater: (content: string | null) => string): Promise<void>;
  delete(taskId: string): Promise<void>;
}

export class FileProgressRepository implements ProgressRepository {
  private readonly progressDir: string;

  constructor(progressDir = path.join(getRuntimeDir(), 'progress')) {
    this.progressDir = path.resolve(progressDir);
    ensureWithinBase(path.dirname(this.progressDir), this.progressDir);
  }

  async get(taskId: string): Promise<string | null> {
    return this.read(this.getProgressPath(taskId));
  }

  async set(taskId: string, content: string): Promise<void> {
    const progressPath = this.getProgressPath(taskId);
    await this.prepareDirectory();
    await withFileLock(progressPath, () => this.write(progressPath, content));
  }

  async update(taskId: string, updater: (content: string | null) => string): Promise<void> {
    const progressPath = this.getProgressPath(taskId);
    await this.prepareDirectory();
    await withFileLock(progressPath, async () => {
      const current = await this.read(progressPath);
      await this.write(progressPath, updater(current));
    });
  }

  async delete(taskId: string): Promise<void> {
    const progressPath = this.getProgressPath(taskId);
    if ((await this.read(progressPath)) === null) return;
    await this.prepareDirectory();
    await withFileLock(progressPath, async () => {
      await unlink(progressPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    });
  }

  private getProgressPath(taskId: string): string {
    const safeTaskId = validatePathSegment(taskId);
    return ensureWithinBase(this.progressDir, path.join(this.progressDir, `${safeTaskId}.md`));
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.progressDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.progressDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Progress storage path must be a regular directory');
    }
  }

  private async read(progressPath: string): Promise<string | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(progressPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_PROGRESS_BYTES) {
        throw new Error('Progress file must be a bounded regular file');
      }
      return await handle.readFile({ encoding: 'utf8' });
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return null;
      if (errorCode === 'ELOOP') {
        throw new Error('Progress file must not be a symbolic link', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async write(progressPath: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > MAX_PROGRESS_BYTES) {
      throw new Error('Progress content exceeds the 2 MiB storage limit');
    }
    await atomicWriteFile(progressPath, content, 'utf8');
  }
}
