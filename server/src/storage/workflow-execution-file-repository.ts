import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_STEP_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_PROGRESS_BYTES = 10 * 1024 * 1024;

export interface WorkflowExecutionFileRepository {
  writeStepOutput(runId: string, filename: string, content: string): Promise<string>;
  readProgress(runId: string): Promise<string | null>;
  appendProgress(runId: string, entry: string): Promise<{ appended: boolean; size: number }>;
}

export class FileWorkflowExecutionFileRepository implements WorkflowExecutionFileRepository {
  private readonly runsDir: string;

  constructor(runsDir: string) {
    this.runsDir = path.resolve(runsDir);
  }

  async writeStepOutput(runId: string, filename: string, content: string): Promise<string> {
    const runDir = this.runDir(runId);
    const outputDir = ensureWithinBase(runDir, path.join(runDir, 'step-outputs'));
    await this.prepareDirectory(this.runsDir);
    await this.prepareDirectory(runDir);
    await this.prepareDirectory(outputDir);
    const outputPath = ensureWithinBase(
      outputDir,
      path.join(outputDir, validatePathSegment(filename))
    );
    if (Buffer.byteLength(content, 'utf8') > MAX_STEP_OUTPUT_BYTES) {
      throw new Error('Workflow step output exceeds the 16 MiB storage limit');
    }
    await withFileLock(outputPath, () => atomicWriteFile(outputPath, content, 'utf8'));
    return outputPath;
  }

  async readProgress(runId: string): Promise<string | null> {
    const runDir = this.runDir(runId);
    await this.prepareDirectory(this.runsDir);
    await this.prepareDirectory(runDir);
    return this.readBounded(this.progressPath(runId), MAX_PROGRESS_BYTES, 'Workflow progress');
  }

  async appendProgress(runId: string, entry: string): Promise<{ appended: boolean; size: number }> {
    const runDir = this.runDir(runId);
    const progressPath = this.progressPath(runId);
    await this.prepareDirectory(this.runsDir);
    await this.prepareDirectory(runDir);
    return withFileLock(progressPath, async () => {
      const current = (await this.readProgress(runId)) ?? '';
      const next = `${current}${entry}`;
      const size = Buffer.byteLength(next, 'utf8');
      if (size > MAX_PROGRESS_BYTES) {
        return { appended: false, size: Buffer.byteLength(current, 'utf8') };
      }
      await atomicWriteFile(progressPath, next, 'utf8');
      return { appended: true, size };
    });
  }

  private runDir(runId: string): string {
    return ensureWithinBase(this.runsDir, path.join(this.runsDir, validatePathSegment(runId)));
  }

  private progressPath(runId: string): string {
    const runDir = this.runDir(runId);
    return ensureWithinBase(runDir, path.join(runDir, 'progress.md'));
  }

  private async prepareDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Workflow execution path must use a regular directory');
    }
  }

  private async readBounded(
    filePath: string,
    maximumBytes: number,
    label: string
  ): Promise<string | null> {
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
      if (!stats.isFile() || stats.size > maximumBytes) {
        throw new Error(`${label} must use a bounded regular file`);
      }
      return await handle.readFile({ encoding: 'utf8' });
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return null;
      if (errorCode === 'ELOOP') {
        throw new Error(`${label} must not use a symbolic link`, { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }
}
