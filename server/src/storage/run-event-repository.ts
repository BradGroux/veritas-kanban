import { constants } from 'node:fs';
import { open, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  RUN_EVENT_SCHEMA_VERSION,
  type RunEventAppendResult,
  type RunEventEnvelope,
  type RunEventPage,
  type RunEventQuery,
} from '@veritas-kanban/shared';
import type { RunEventRepository, RunEventRepositoryAppendInput } from './interfaces.js';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { getRuntimeDir } from '../utils/paths.js';
import { RunEventEnvelopeSchema } from '../schemas/run-event-schemas.js';

const MAX_EVENTS_PER_ATTEMPT = 50_000;
const MAX_JOURNAL_BYTES = 128 * 1024 * 1024;
const DEFAULT_REPLAY_LIMIT = 200;
const MAX_REPLAY_LIMIT = 500;

export function getRunEventsDir(): string {
  return path.join(getRuntimeDir(), 'run-events');
}

function parseEvents(content: string): RunEventEnvelope[] {
  if (!content.trim()) return [];
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => RunEventEnvelopeSchema.parse(JSON.parse(line)));
}

export class FileRunEventRepository implements RunEventRepository {
  constructor(private readonly baseDir = getRunEventsDir()) {}

  async append(event: RunEventRepositoryAppendInput): Promise<RunEventAppendResult> {
    const journalPath = this.journalPath(event.taskId, event.attemptId);
    const taskDir = path.dirname(journalPath);
    await mkdir(taskDir, { recursive: true, mode: 0o700 });
    const taskDirStat = await lstat(taskDir);
    if (!taskDirStat.isDirectory() || taskDirStat.isSymbolicLink()) {
      throw new Error('Run event journal directory is not a private regular directory');
    }
    return withFileLock(journalPath, async () => {
      const events = await this.readJournal(journalPath);
      if (event.dedupeKey) {
        const duplicate = events.find((candidate) => candidate.dedupeKey === event.dedupeKey);
        if (duplicate) return { event: duplicate, appended: false };
      }
      if (events.length >= MAX_EVENTS_PER_ATTEMPT) {
        throw new Error('Run event journal reached its bounded event limit');
      }
      const sequence = (events.at(-1)?.sequence ?? 0) + 1;
      const persisted = RunEventEnvelopeSchema.parse({ ...event, sequence });
      const line = `${JSON.stringify(persisted)}\n`;
      const existingBytes = events.reduce(
        (total, candidate) => total + Buffer.byteLength(JSON.stringify(candidate), 'utf-8') + 1,
        0
      );
      if (existingBytes + Buffer.byteLength(line, 'utf-8') > MAX_JOURNAL_BYTES) {
        throw new Error('Run event journal reached its bounded byte limit');
      }
      const handle = await open(
        journalPath,
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      );
      try {
        await handle.write(line, undefined, 'utf-8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { event: persisted, appended: true };
    });
  }

  async list(query: RunEventQuery): Promise<RunEventPage> {
    const journalPath = this.journalPath(query.taskId, query.attemptId);
    const afterSequence = Math.max(0, query.afterSequence ?? 0);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_REPLAY_LIMIT, 1), MAX_REPLAY_LIMIT);
    const events = (await this.readJournal(journalPath)).filter(
      (event) => event.sequence > afterSequence
    );
    const page = events.slice(0, limit);
    return {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      taskId: query.taskId,
      attemptId: query.attemptId,
      events: page,
      nextCursor: page.at(-1)?.sequence ?? afterSequence,
      hasMore: events.length > page.length,
    };
  }

  private journalPath(taskId: string, attemptId: string): string {
    validatePathSegment(taskId);
    validatePathSegment(attemptId);
    const taskDir = path.join(this.baseDir, taskId);
    const journalPath = path.join(taskDir, `${attemptId}.jsonl`);
    ensureWithinBase(this.baseDir, journalPath);
    return journalPath;
  }

  private async readJournal(journalPath: string): Promise<RunEventEnvelope[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(journalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const journalStat = await handle.stat();
      if (!journalStat.isFile() || journalStat.size > MAX_JOURNAL_BYTES) {
        throw new Error('Run event journal is not a bounded regular file');
      }
      return parseEvents(await handle.readFile({ encoding: 'utf-8' }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Run event journal is not a bounded regular file', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }
}
