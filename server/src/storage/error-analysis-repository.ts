import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type { ErrorAnalysis } from '../services/error-learning-service.js';
import { withFileLock } from '../services/file-lock.js';
import { migrateLegacyFiles } from '../utils/migrate-legacy-files.js';
import { getLegacyRuntimeDirs, getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_ERROR_ANALYSES_BYTES = 16 * 1024 * 1024;

export interface ErrorAnalysisRepository {
  read(): Promise<ErrorAnalysis[]>;
  update(updater: (analyses: ErrorAnalysis[]) => ErrorAnalysis[]): Promise<ErrorAnalysis[]>;
  mutate<T>(
    updater: (analyses: ErrorAnalysis[]) => { analyses: ErrorAnalysis[]; result: T }
  ): Promise<T>;
}

export class FileErrorAnalysisRepository implements ErrorAnalysisRepository {
  private readonly runtimeDir: string;
  private readonly analysisFile: string;
  private migrationChecked = false;

  constructor(
    runtimeDir = getRuntimeDir(),
    private readonly legacyRuntimeDirs: readonly string[] = getLegacyRuntimeDirs()
  ) {
    this.runtimeDir = path.resolve(runtimeDir);
    this.analysisFile = ensureWithinBase(
      this.runtimeDir,
      path.join(this.runtimeDir, 'error-analyses.json')
    );
  }

  async read(): Promise<ErrorAnalysis[]> {
    await this.ensureMigrated();
    return this.readFile();
  }

  async update(updater: (analyses: ErrorAnalysis[]) => ErrorAnalysis[]): Promise<ErrorAnalysis[]> {
    return this.mutate((analyses) => {
      const updated = updater(analyses);
      return { analyses: updated, result: updated };
    });
  }

  async mutate<T>(
    updater: (analyses: ErrorAnalysis[]) => { analyses: ErrorAnalysis[]; result: T }
  ): Promise<T> {
    await this.ensureMigrated();
    await this.prepareDirectory();
    return withFileLock(this.analysisFile, async () => {
      const { analyses, result } = updater(await this.readFile());
      const content = JSON.stringify(analyses, null, 2);
      if (Buffer.byteLength(content, 'utf8') > MAX_ERROR_ANALYSES_BYTES) {
        throw new Error('Error analyses exceed the 16 MiB storage limit');
      }
      await atomicWriteFile(this.analysisFile, content, 'utf8');
      return result;
    });
  }

  private async ensureMigrated(): Promise<void> {
    if (this.migrationChecked) return;
    this.migrationChecked = true;
    await migrateLegacyFiles(
      this.legacyRuntimeDirs,
      this.runtimeDir,
      ['error-analyses.json'],
      'error analysis'
    );
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.runtimeDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Error analysis storage path must use a regular directory');
    }
  }

  private async readFile(): Promise<ErrorAnalysis[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.analysisFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(this.analysisFile), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error('Error analyses must not use a symbolic link or changed file');
      }
      if (!stats.isFile() || stats.size > MAX_ERROR_ANALYSES_BYTES) {
        throw new Error('Error analyses must use a bounded regular file');
      }
      const parsed: unknown = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
      return Array.isArray(parsed) ? (parsed as ErrorAnalysis[]) : [];
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT' || error instanceof SyntaxError) return [];
      if (errorCode === 'ELOOP') {
        throw new Error('Error analyses must not use a symbolic link', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }
}

export class InMemoryErrorAnalysisRepository implements ErrorAnalysisRepository {
  private analyses: ErrorAnalysis[] = [];

  async read(): Promise<ErrorAnalysis[]> {
    return this.analyses;
  }

  async update(updater: (analyses: ErrorAnalysis[]) => ErrorAnalysis[]): Promise<ErrorAnalysis[]> {
    return this.mutate((analyses) => {
      const updated = updater(analyses);
      return { analyses: updated, result: updated };
    });
  }

  async mutate<T>(
    updater: (analyses: ErrorAnalysis[]) => { analyses: ErrorAnalysis[]; result: T }
  ): Promise<T> {
    const mutation = updater(this.analyses);
    this.analyses = mutation.analyses;
    return mutation.result;
  }
}
