import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type {
  ReflectionExtractionJob,
  ReflectionExtractionJobClaimInput,
  ReflectionExtractionJobClaimResult,
  ReflectionExtractionJobCompareAndSetInput,
  ReflectionExtractionJobCompareAndSetResult,
  ReflectionExtractionJobEnqueueResult,
  ReflectionExtractionJobListQuery,
} from '@veritas-kanban/shared';
import { ReflectionExtractionJobSchema } from '../schemas/reflection-extraction-job-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import type { ReflectionExtractionJobRepository } from './interfaces.js';
import {
  leaseExtractionJob,
  normalizeExpiredExtractionJob,
  selectExtractionJob,
} from './reflection-extraction-job-state.js';

const MAX_JOB_LOG_BYTES = 64 * 1024 * 1024;
const MAX_JOB_SNAPSHOTS = 50_000;

export function getReflectionExtractionJobsPath(): string {
  return path.join(getRuntimeDir(), 'reflection-extraction-jobs.jsonl');
}

export class FileReflectionExtractionJobRepository implements ReflectionExtractionJobRepository {
  constructor(private readonly filePath = getReflectionExtractionJobsPath()) {
    ensureWithinBase(path.dirname(filePath), filePath);
  }

  async enqueue(job: ReflectionExtractionJob): Promise<ReflectionExtractionJobEnqueueResult> {
    const parsed = ReflectionExtractionJobSchema.parse(job);
    if (parsed.revision !== 1) throw new Error('New extraction jobs must start at revision 1.');
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const jobs = this.materialize(snapshots);
      const existing = [...jobs.values()].find(
        (candidate) => candidate.idempotencyKey === parsed.idempotencyKey
      );
      if (existing) return { job: existing, created: false };
      if (jobs.has(parsed.id)) throw new Error(`Extraction job ${parsed.id} already exists.`);
      await this.appendSnapshots([parsed], snapshots);
      return { job: parsed, created: true };
    });
  }

  async get(id: string): Promise<ReflectionExtractionJob | null> {
    return this.materialize(await this.readSnapshots()).get(id) ?? null;
  }

  async list(query: ReflectionExtractionJobListQuery): Promise<ReflectionExtractionJob[]> {
    const states = query.states ? new Set(query.states) : undefined;
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1_000);
    return [...this.materialize(await this.readSnapshots()).values()]
      .filter((job) => !query.workspaceId || job.workspaceId === query.workspaceId)
      .filter((job) => !states || states.has(job.state))
      .sort(
        (left, right) =>
          Date.parse(left.availableAt) - Date.parse(right.availableAt) ||
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id)
      )
      .slice(0, limit);
  }

  async claim(
    input: ReflectionExtractionJobClaimInput
  ): Promise<ReflectionExtractionJobClaimResult> {
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const jobs = [...this.materialize(snapshots).values()];
      const normalized = jobs.map((job) => normalizeExpiredExtractionJob(job, input));
      const expired = normalized.filter((job, index) => job.revision !== jobs[index]?.revision);
      const selection = selectExtractionJob(normalized, input);
      if ('reason' in selection) {
        if (expired.length > 0) await this.appendSnapshots(expired, snapshots);
        return { claimed: false, reason: selection.reason };
      }
      const claimed = leaseExtractionJob(selection.job, input);
      await this.appendSnapshots([...expired, claimed], snapshots);
      return { claimed: true, job: claimed };
    });
  }

  async compareAndSet(
    input: ReflectionExtractionJobCompareAndSetInput
  ): Promise<ReflectionExtractionJobCompareAndSetResult> {
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const snapshots = await this.readSnapshots();
      const current = this.materialize(snapshots).get(input.id);
      if (!current) return { updated: false, reason: 'not-found' };
      if (current.revision !== input.expectedRevision) {
        return { job: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        return { job: current, updated: false, reason: 'invalid-revision' };
      }
      const next = ReflectionExtractionJobSchema.parse(input.next);
      await this.appendSnapshots([next], snapshots);
      return { job: next, updated: true };
    });
  }

  private async prepareParent(): Promise<void> {
    const parent = path.dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Extraction job directory is not a private regular directory.');
    }
  }

  private async readSnapshots(): Promise<ReflectionExtractionJob[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_JOB_LOG_BYTES) {
        throw new Error('Extraction job log is not a bounded regular file.');
      }
      const content = await handle.readFile({ encoding: 'utf8' });
      if (!content.trim()) return [];
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length > MAX_JOB_SNAPSHOTS) {
        throw new Error('Extraction job log reached its bounded snapshot limit.');
      }
      return lines.map((line) => ReflectionExtractionJobSchema.parse(JSON.parse(line)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Extraction job log is not a bounded regular file.', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private materialize(snapshots: ReflectionExtractionJob[]): Map<string, ReflectionExtractionJob> {
    const byId = new Map<string, ReflectionExtractionJob>();
    for (const snapshot of snapshots) {
      const current = byId.get(snapshot.id);
      if (!current || snapshot.revision > current.revision) byId.set(snapshot.id, snapshot);
    }
    return byId;
  }

  private async appendSnapshots(
    next: ReflectionExtractionJob[],
    existing: ReflectionExtractionJob[]
  ): Promise<void> {
    if (existing.length + next.length > MAX_JOB_SNAPSHOTS) {
      throw new Error('Extraction job log reached its bounded snapshot limit.');
    }
    const content = next.map((job) => `${JSON.stringify(job)}\n`).join('');
    const existingBytes = existing.reduce(
      (total, job) => total + Buffer.byteLength(JSON.stringify(job), 'utf8') + 1,
      0
    );
    if (existingBytes + Buffer.byteLength(content, 'utf8') > MAX_JOB_LOG_BYTES) {
      throw new Error('Extraction job log reached its bounded byte limit.');
    }
    const handle = await open(
      this.filePath,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.write(content, undefined, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
