import type {
  ReflectionExtractionJob,
  ReflectionExtractionJobClaimInput,
  ReflectionExtractionJobClaimResult,
  ReflectionExtractionJobCompareAndSetInput,
  ReflectionExtractionJobCompareAndSetResult,
  ReflectionExtractionJobEnqueueResult,
  ReflectionExtractionJobListQuery,
} from '@veritas-kanban/shared';
import { ReflectionExtractionJobSchema } from '../../schemas/reflection-extraction-job-schemas.js';
import type { ReflectionExtractionJobRepository } from '../interfaces.js';
import {
  leaseExtractionJob,
  normalizeExpiredExtractionJob,
  selectExtractionJob,
} from '../reflection-extraction-job-state.js';
import type { SqliteDatabase } from './database.js';

interface JobRow {
  job_json: string;
}

export class SqliteReflectionExtractionJobRepository implements ReflectionExtractionJobRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async enqueue(job: ReflectionExtractionJob): Promise<ReflectionExtractionJobEnqueueResult> {
    const parsed = ReflectionExtractionJobSchema.parse(job);
    if (parsed.revision !== 1) throw new Error('New extraction jobs must start at revision 1.');
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const existing = connection
        .prepare('SELECT job_json FROM reflection_extraction_jobs WHERE idempotency_key = ?')
        .get(parsed.idempotencyKey) as JobRow | undefined;
      if (existing) {
        connection.exec('COMMIT');
        return {
          job: ReflectionExtractionJobSchema.parse(JSON.parse(existing.job_json)),
          created: false,
        };
      }
      connection
        .prepare(
          `INSERT INTO reflection_extraction_jobs (
             id, workspace_id, state, revision, idempotency_key, available_at,
             lease_owner_id, lease_expires_at, job_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          parsed.id,
          parsed.workspaceId,
          parsed.state,
          parsed.revision,
          parsed.idempotencyKey,
          parsed.availableAt,
          null,
          null,
          JSON.stringify(parsed),
          parsed.createdAt,
          parsed.updatedAt
        );
      connection.exec('COMMIT');
      return { job: parsed, created: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async get(id: string): Promise<ReflectionExtractionJob | null> {
    const row = this.database
      .getConnection()
      .prepare('SELECT job_json FROM reflection_extraction_jobs WHERE id = ?')
      .get(id) as JobRow | undefined;
    return row ? ReflectionExtractionJobSchema.parse(JSON.parse(row.job_json)) : null;
  }

  async list(query: ReflectionExtractionJobListQuery): Promise<ReflectionExtractionJob[]> {
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (query.workspaceId) {
      clauses.push('workspace_id = ?');
      parameters.push(query.workspaceId);
    }
    if (query.states?.length) {
      clauses.push(`state IN (${query.states.map(() => '?').join(', ')})`);
      parameters.push(...query.states);
    }
    parameters.push(Math.min(Math.max(query.limit ?? 100, 1), 1_000));
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT job_json
         FROM reflection_extraction_jobs
         ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY available_at, created_at, id
         LIMIT ?`
      )
      .all(...parameters) as unknown as JobRow[];
    return rows.map((row) => ReflectionExtractionJobSchema.parse(JSON.parse(row.job_json)));
  }

  async claim(
    input: ReflectionExtractionJobClaimInput
  ): Promise<ReflectionExtractionJobClaimResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const rows = connection
        .prepare('SELECT job_json FROM reflection_extraction_jobs')
        .all() as unknown as JobRow[];
      const jobs = rows.map((row) => ReflectionExtractionJobSchema.parse(JSON.parse(row.job_json)));
      const normalized = jobs.map((job) => normalizeExpiredExtractionJob(job, input));
      for (const [index, job] of normalized.entries()) {
        if (job.revision !== jobs[index]?.revision) this.updateJob(connection, job);
      }
      const selection = selectExtractionJob(normalized, input);
      if ('reason' in selection) {
        connection.exec('COMMIT');
        return { claimed: false, reason: selection.reason };
      }
      const claimed = leaseExtractionJob(selection.job, input);
      this.updateJob(connection, claimed);
      connection.exec('COMMIT');
      return { claimed: true, job: claimed };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async compareAndSet(
    input: ReflectionExtractionJobCompareAndSetInput
  ): Promise<ReflectionExtractionJobCompareAndSetResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const row = connection
        .prepare('SELECT job_json FROM reflection_extraction_jobs WHERE id = ?')
        .get(input.id) as JobRow | undefined;
      if (!row) {
        connection.exec('COMMIT');
        return { updated: false, reason: 'not-found' };
      }
      const current = ReflectionExtractionJobSchema.parse(JSON.parse(row.job_json));
      if (current.revision !== input.expectedRevision) {
        connection.exec('COMMIT');
        return { job: current, updated: false, reason: 'stale-revision' };
      }
      if (input.next.revision !== input.expectedRevision + 1 || input.next.id !== input.id) {
        connection.exec('COMMIT');
        return { job: current, updated: false, reason: 'invalid-revision' };
      }
      const next = ReflectionExtractionJobSchema.parse(input.next);
      const result = this.updateJob(connection, next, input.expectedRevision);
      if (result !== 1) throw new Error('Extraction job compare-and-set changed unexpectedly.');
      connection.exec('COMMIT');
      return { job: next, updated: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  private updateJob(
    connection: ReturnType<SqliteDatabase['getConnection']>,
    job: ReflectionExtractionJob,
    expectedRevision?: number
  ): number {
    const result = connection
      .prepare(
        `UPDATE reflection_extraction_jobs
         SET state = ?, revision = ?, available_at = ?, lease_owner_id = ?,
             lease_expires_at = ?, job_json = ?, updated_at = ?
         WHERE id = ?${expectedRevision === undefined ? '' : ' AND revision = ?'}`
      )
      .run(
        job.state,
        job.revision,
        job.availableAt,
        job.lease?.ownerId ?? null,
        job.lease?.expiresAt ?? null,
        JSON.stringify(job),
        job.updatedAt,
        job.id,
        ...(expectedRevision === undefined ? [] : [expectedRevision])
      );
    return Number(result.changes);
  }
}
