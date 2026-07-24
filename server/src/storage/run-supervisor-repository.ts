import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type {
  RunSupervisorCompareAndSetInput,
  RunSupervisorCompareAndSetResult,
  RunSupervisorListQuery,
  RunSupervisorRecord,
} from '@veritas-kanban/shared';
import { RunSupervisorRecordSchema } from '../schemas/run-supervisor-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import type { RunSupervisorRepository } from './interfaces.js';

const MAX_SUPERVISOR_LOG_BYTES = 128 * 1024 * 1024;
const MAX_SUPERVISOR_SNAPSHOTS = 100_000;

export function getRunSupervisorsPath(): string {
  return path.join(getRuntimeDir(), 'run-supervisors.jsonl');
}

export class FileRunSupervisorRepository implements RunSupervisorRepository {
  constructor(private readonly filePath = getRunSupervisorsPath()) {
    ensureWithinBase(path.dirname(filePath), filePath);
  }

  async create(record: RunSupervisorRecord): Promise<RunSupervisorRecord> {
    const parsed = RunSupervisorRecordSchema.parse(record);
    if (parsed.revision !== 1)
      throw new Error('New run supervisor records must start at revision 1.');
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      if (snapshots.some((candidate) => candidate.id === parsed.id)) {
        throw new Error(`Run supervisor ${parsed.id} already exists.`);
      }
      await this.appendSnapshot(parsed, snapshots);
      return parsed;
    });
  }

  async get(id: string): Promise<RunSupervisorRecord | null> {
    return this.materialize(await this.readSnapshots()).get(id) ?? null;
  }

  async list(query: RunSupervisorListQuery): Promise<RunSupervisorRecord[]> {
    const stateFilter = query.states ? new Set(query.states) : undefined;
    return [...this.materialize(await this.readSnapshots()).values()]
      .filter((record) => record.workspaceId === query.workspaceId)
      .filter((record) => !query.taskId || record.taskId === query.taskId)
      .filter((record) => !query.attemptId || record.attemptId === query.attemptId)
      .filter((record) => !stateFilter || stateFilter.has(record.state))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async compareAndSet(
    input: RunSupervisorCompareAndSetInput
  ): Promise<RunSupervisorCompareAndSetResult> {
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const current = this.materialize(snapshots).get(input.id);
      if (!current) return { updated: false, reason: 'not-found' };
      if (current.revision !== input.expectedRevision) {
        return { record: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        return { record: current, updated: false, reason: 'invalid-revision' };
      }
      const next = RunSupervisorRecordSchema.parse(input.next);
      await this.appendSnapshot(next, snapshots);
      return { record: next, updated: true };
    });
  }

  private async prepareParent(): Promise<void> {
    const parent = path.dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Run supervisor directory is not a private regular directory.');
    }
  }

  private async readSnapshots(): Promise<RunSupervisorRecord[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_SUPERVISOR_LOG_BYTES) {
        throw new Error('Run supervisor log is not a bounded regular file.');
      }
      const content = await handle.readFile({ encoding: 'utf8' });
      if (!content.trim()) return [];
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length > MAX_SUPERVISOR_SNAPSHOTS) {
        throw new Error('Run supervisor log reached its bounded snapshot limit.');
      }
      return lines.map((line) => RunSupervisorRecordSchema.parse(JSON.parse(line)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Run supervisor log is not a bounded regular file.', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private materialize(snapshots: RunSupervisorRecord[]): Map<string, RunSupervisorRecord> {
    const byId = new Map<string, RunSupervisorRecord>();
    for (const snapshot of snapshots) {
      const current = byId.get(snapshot.id);
      if (!current || snapshot.revision > current.revision) byId.set(snapshot.id, snapshot);
    }
    return byId;
  }

  private async appendSnapshot(
    snapshot: RunSupervisorRecord,
    existing: RunSupervisorRecord[]
  ): Promise<void> {
    if (existing.length >= MAX_SUPERVISOR_SNAPSHOTS) {
      throw new Error('Run supervisor log reached its bounded snapshot limit.');
    }
    const line = `${JSON.stringify(snapshot)}\n`;
    const existingBytes = existing.reduce(
      (total, candidate) => total + Buffer.byteLength(JSON.stringify(candidate), 'utf8') + 1,
      0
    );
    if (existingBytes + Buffer.byteLength(line, 'utf8') > MAX_SUPERVISOR_LOG_BYTES) {
      throw new Error('Run supervisor log reached its bounded byte limit.');
    }
    const handle = await open(
      this.filePath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.write(line, undefined, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
