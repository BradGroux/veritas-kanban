import { access, appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { ensureWithinBase } from '../utils/sanitize.js';
import { createReadStream, createWriteStream } from './fs-helpers.js';

export class TelemetryFileRepository {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  ensureReady(): Promise<void> {
    return mkdir(this.directory, { recursive: true }).then(() => undefined);
  }

  async listFiles(): Promise<string[]> {
    return readdir(this.directory);
  }

  eventPath(filename: string): string {
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) throw new Error('Telemetry filename must be a path segment');
    return ensureWithinBase(this.directory, path.join(this.directory, safeFilename));
  }

  async append(filename: string, content: string): Promise<void> {
    await appendFile(this.eventPath(filename), content, 'utf8');
  }

  async remove(filename: string): Promise<void> {
    await unlink(this.eventPath(filename));
  }

  async exists(filename: string): Promise<boolean> {
    try {
      await access(this.eventPath(filename));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async streamLines(filename: string, visitor: (line: string) => boolean | void): Promise<void> {
    const reader = TelemetryFileRepository.createLineReader(this.eventPath(filename));
    for await (const line of reader) {
      if (visitor(line) === false) {
        reader.close();
        break;
      }
    }
  }

  async compress(filename: string): Promise<void> {
    const source = this.eventPath(filename);
    const destination = this.eventPath(`${filename}.gz`);
    await pipeline(createReadStream(source), createGzip(), createWriteStream(destination));
    await unlink(source);
  }

  static createLineReader(filePath: string): readline.Interface {
    if (filePath.endsWith('.gz')) {
      const decompressed = createReadStream(filePath).pipe(createGunzip());
      return readline.createInterface({ input: decompressed, crlfDelay: Infinity });
    }
    return readline.createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
  }
}
