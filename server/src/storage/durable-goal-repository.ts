import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type {
  DurableGoalCompareAndSetInput,
  DurableGoalCompareAndSetResult,
  DurableGoalListQuery,
  DurableGoalRecord,
} from '@veritas-kanban/shared';
import { DurableGoalRecordSchema } from '../schemas/durable-goal-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import type { DurableGoalRepository } from './interfaces.js';

const MAX_GOAL_LOG_BYTES = 64 * 1024 * 1024;
const MAX_GOAL_SNAPSHOTS = 50_000;

export function getDurableGoalsPath(): string {
  return path.join(getRuntimeDir(), 'durable-goals.jsonl');
}

export class FileDurableGoalRepository implements DurableGoalRepository {
  constructor(private readonly filePath = getDurableGoalsPath()) {
    ensureWithinBase(path.dirname(filePath), filePath);
  }

  async create(record: DurableGoalRecord): Promise<DurableGoalRecord> {
    const parsed = DurableGoalRecordSchema.parse(record);
    if (parsed.revision !== 1) throw new Error('New durable goals must start at revision 1.');
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      if (snapshots.some((candidate) => candidate.id === parsed.id)) {
        throw new Error(`Durable goal ${parsed.id} already exists.`);
      }
      await this.appendSnapshot(parsed, snapshots);
      return parsed;
    });
  }

  async get(id: string): Promise<DurableGoalRecord | null> {
    return this.materialize(await this.readSnapshots()).get(id) ?? null;
  }

  async list(query: DurableGoalListQuery): Promise<DurableGoalRecord[]> {
    const stateFilter = query.states ? new Set(query.states) : undefined;
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1_000);
    return [...this.materialize(await this.readSnapshots()).values()]
      .filter((record) => record.workspaceId === query.workspaceId)
      .filter((record) => !stateFilter || stateFilter.has(record.state))
      .filter(
        (record) =>
          !query.rootTaskId ||
          (record.root.kind === 'task' && record.root.taskId === query.rootTaskId) ||
          (record.root.kind === 'workflow' && record.root.taskId === query.rootTaskId)
      )
      .filter(
        (record) =>
          !query.rootWorkflowId ||
          (record.root.kind === 'workflow' && record.root.workflowId === query.rootWorkflowId)
      )
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, limit);
  }

  async compareAndSet(
    input: DurableGoalCompareAndSetInput
  ): Promise<DurableGoalCompareAndSetResult> {
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
      const next = DurableGoalRecordSchema.parse(input.next);
      await this.appendSnapshot(next, snapshots);
      return { record: next, updated: true };
    });
  }

  private async prepareParent(): Promise<void> {
    const parent = path.dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Durable goal directory is not a private regular directory.');
    }
  }

  private async readSnapshots(): Promise<DurableGoalRecord[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_GOAL_LOG_BYTES) {
        throw new Error('Durable goal log is not a bounded regular file.');
      }
      const content = await handle.readFile({ encoding: 'utf8' });
      if (!content.trim()) return [];
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length > MAX_GOAL_SNAPSHOTS) {
        throw new Error('Durable goal log reached its bounded snapshot limit.');
      }
      return lines.map((line) => DurableGoalRecordSchema.parse(JSON.parse(line)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Durable goal log is not a bounded regular file.', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private materialize(snapshots: DurableGoalRecord[]): Map<string, DurableGoalRecord> {
    const byId = new Map<string, DurableGoalRecord>();
    for (const snapshot of snapshots) {
      const current = byId.get(snapshot.id);
      if (!current || snapshot.revision > current.revision) byId.set(snapshot.id, snapshot);
    }
    return byId;
  }

  private async appendSnapshot(
    snapshot: DurableGoalRecord,
    existing: DurableGoalRecord[]
  ): Promise<void> {
    if (existing.length >= MAX_GOAL_SNAPSHOTS) {
      throw new Error('Durable goal log reached its bounded snapshot limit.');
    }
    const line = `${JSON.stringify(snapshot)}\n`;
    const existingBytes = existing.reduce(
      (total, candidate) => total + Buffer.byteLength(JSON.stringify(candidate), 'utf8') + 1,
      0
    );
    if (existingBytes + Buffer.byteLength(line, 'utf8') > MAX_GOAL_LOG_BYTES) {
      throw new Error('Durable goal log reached its bounded byte limit.');
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
