import crypto from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from './fs-helpers.js';

export interface StoredAuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  resource?: string;
  details?: Record<string, unknown>;
  integrity: string;
}

export interface AuditFileVerifyResult {
  valid: boolean;
  entries: number;
  firstBroken?: number;
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export class AuditFileRepository {
  constructor(private readonly directory: string) {}

  getMonthlyLogPath(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return path.join(this.directory, `audit-${yyyy}-${mm}.log`);
  }

  ensureReady(): Promise<void> {
    return mkdir(this.directory, { recursive: true }).then(() => undefined);
  }

  async getLastHash(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.trimEnd().split('\n').filter(Boolean);
      return lines.length > 0 ? sha256(lines[lines.length - 1]) : '';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  append(filePath: string, line: string): Promise<void> {
    return appendFile(filePath, `${line}\n`, 'utf8');
  }

  async verify(filePath: string): Promise<AuditFileVerifyResult> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let previousHash = '';
    let lineIndex = 0;
    let totalEntries = 0;

    try {
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) {
          lineIndex += 1;
          continue;
        }

        totalEntries += 1;
        let entry: StoredAuditEntry;
        try {
          entry = JSON.parse(trimmed) as StoredAuditEntry;
        } catch {
          return { valid: false, entries: totalEntries, firstBroken: lineIndex };
        }

        if (entry.integrity !== previousHash) {
          return { valid: false, entries: totalEntries, firstBroken: lineIndex };
        }
        previousHash = sha256(trimmed);
        lineIndex += 1;
      }
      return { valid: true, entries: totalEntries };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { valid: true, entries: 0 };
      throw error;
    } finally {
      reader.close();
      stream.destroy();
    }
  }

  async readRecent(filePath: string, limit: number): Promise<StoredAuditEntry[]> {
    try {
      const content = await readFile(filePath, 'utf8');
      return content
        .trimEnd()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .reverse()
        .map((line) => JSON.parse(line) as StoredAuditEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
