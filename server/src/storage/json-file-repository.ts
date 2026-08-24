import path from 'node:path';
import { withFileLock } from '../services/file-lock.js';
import { atomicWriteFile, mkdir, readFile } from './fs-helpers.js';

export interface JsonFileRepositoryOptions {
  trailingNewline?: boolean;
}

/**
 * Small persistence boundary for JSON-backed service state.
 *
 * Reads intentionally surface filesystem and parse errors so each service can
 * retain its existing fallback policy. Writes are serialized across processes
 * and replace the destination atomically.
 */
export class JsonFileRepository<T> {
  private readonly trailingNewline: boolean;

  constructor(
    private readonly filePath: string,
    options: JsonFileRepositoryOptions = {}
  ) {
    this.trailingNewline = options.trailingNewline ?? false;
  }

  async read(): Promise<T> {
    return JSON.parse(await readFile(this.filePath, 'utf8')) as T;
  }

  async write(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const serialized = JSON.stringify(value, null, 2) + (this.trailingNewline ? '\n' : '');
    await withFileLock(this.filePath, () => atomicWriteFile(this.filePath, serialized, 'utf8'));
  }
}
