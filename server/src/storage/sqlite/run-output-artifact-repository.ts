import { createHash } from 'node:crypto';
import type {
  RunOutputArtifactCleanupInput,
  RunOutputArtifactCleanupResult,
  RunOutputArtifactCreateResult,
  RunOutputArtifactListQuery,
  RunOutputArtifactLookup,
  RunOutputArtifactMetadata,
  RunOutputArtifactRange,
  RunOutputArtifactRangeQuery,
  RunOutputQuarantineReason,
} from '@veritas-kanban/shared';
import { RunOutputArtifactMetadataSchema } from '../../schemas/run-output-artifact-schemas.js';
import type { RunOutputArtifactRepository } from '../interfaces.js';
import type { SqliteDatabase } from './database.js';

const MAX_RANGE_BYTES = 4 * 1024 * 1024;
const MAX_LIST_LIMIT = 2_000;
const MAX_CLEANUP_LIMIT = 2_000;

interface ArtifactRow {
  metadata_json: string;
}

interface ArtifactRangeRow extends ArtifactRow {
  content: Uint8Array | null;
}

interface CountRow {
  count: number;
}

function contentHash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function sameIdentity(
  left: RunOutputArtifactMetadata,
  right: RunOutputArtifactMetadata
): boolean {
  return (
    left.id === right.id &&
    left.sha256 === right.sha256 &&
    left.scope.workspaceId === right.scope.workspaceId &&
    left.scope.taskId === right.scope.taskId &&
    left.scope.runId === right.scope.runId &&
    left.scope.attemptId === right.scope.attemptId
  );
}

export class SqliteRunOutputArtifactRepository implements RunOutputArtifactRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(
    candidate: RunOutputArtifactMetadata,
    content: Uint8Array | null
  ): Promise<RunOutputArtifactCreateResult> {
    const metadata = RunOutputArtifactMetadataSchema.parse(candidate);
    this.validateContent(metadata, content);
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const existing = connection
        .prepare('SELECT metadata_json FROM run_output_artifacts WHERE id = ?')
        .get(metadata.id) as ArtifactRow | undefined;
      if (existing) {
        const persisted = RunOutputArtifactMetadataSchema.parse(JSON.parse(existing.metadata_json));
        if (!sameIdentity(persisted, metadata)) {
          throw new Error(`Run output artifact ${metadata.id} has conflicting identity.`);
        }
        connection.exec('COMMIT');
        return { metadata: persisted, created: false };
      }
      connection
        .prepare(
          `INSERT INTO run_output_artifacts (
             id, workspace_id, task_id, run_id, attempt_id, turn_id, state,
             expires_at, active_lease_until, stored_bytes, metadata_json, content, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          metadata.id,
          metadata.scope.workspaceId,
          metadata.scope.taskId,
          metadata.scope.runId,
          metadata.scope.attemptId,
          metadata.scope.turnId ?? null,
          metadata.state,
          metadata.retention.expiresAt,
          metadata.retention.activeLeaseUntil ?? null,
          metadata.storedBytes,
          JSON.stringify(metadata),
          content ? Buffer.from(content) : null,
          metadata.retention.createdAt
        );
      connection.exec('COMMIT');
      return { metadata, created: true };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async get(lookup: RunOutputArtifactLookup): Promise<RunOutputArtifactMetadata | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `SELECT metadata_json
         FROM run_output_artifacts
         WHERE id = ? AND workspace_id = ? AND task_id = ? AND run_id = ? AND attempt_id = ?`
      )
      .get(
        lookup.artifactId,
        lookup.workspaceId,
        lookup.taskId,
        lookup.runId,
        lookup.attemptId
      ) as ArtifactRow | undefined;
    if (!row) return null;
    const metadata = RunOutputArtifactMetadataSchema.parse(JSON.parse(row.metadata_json));
    if (lookup.turnId !== undefined && metadata.scope.turnId !== lookup.turnId) return null;
    return metadata;
  }

  async readRange(query: RunOutputArtifactRangeQuery): Promise<RunOutputArtifactRange | null> {
    if (!Number.isInteger(query.offset) || query.offset < 0) {
      throw new Error('Artifact range offset must be a non-negative integer.');
    }
    if (!Number.isInteger(query.length) || query.length < 1 || query.length > MAX_RANGE_BYTES) {
      throw new Error(`Artifact range length must be between 1 and ${MAX_RANGE_BYTES} bytes.`);
    }
    const row = this.database
      .getConnection()
      .prepare(
        `SELECT metadata_json, substr(content, ?, ?) AS content
         FROM run_output_artifacts
         WHERE id = ? AND workspace_id = ? AND task_id = ? AND run_id = ?
           AND attempt_id = ? AND state = 'available'`
      )
      .get(
        query.offset + 1,
        query.length,
        query.artifactId,
        query.workspaceId,
        query.taskId,
        query.runId,
        query.attemptId
      ) as ArtifactRangeRow | undefined;
    if (!row || row.content === null) return null;
    const metadata = RunOutputArtifactMetadataSchema.parse(JSON.parse(row.metadata_json));
    if (query.turnId !== undefined && metadata.scope.turnId !== query.turnId) return null;
    const content = new Uint8Array(row.content);
    return {
      metadata,
      offset: query.offset,
      length: content.byteLength,
      content,
    };
  }

  async list(query: RunOutputArtifactListQuery): Promise<RunOutputArtifactMetadata[]> {
    const clauses = ['workspace_id = ?'];
    const parameters: Array<string | number> = [query.workspaceId];
    if (query.taskId) {
      clauses.push('task_id = ?');
      parameters.push(query.taskId);
    }
    if (query.runId) {
      clauses.push('run_id = ?');
      parameters.push(query.runId);
    }
    if (query.attemptId) {
      clauses.push('attempt_id = ?');
      parameters.push(query.attemptId);
    }
    if (query.states?.length) {
      clauses.push(`state IN (${query.states.map(() => '?').join(', ')})`);
      parameters.push(...query.states);
    }
    parameters.push(Math.min(Math.max(query.limit ?? 100, 1), MAX_LIST_LIMIT));
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT metadata_json
         FROM run_output_artifacts
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC, id
         LIMIT ?`
      )
      .all(...parameters) as unknown as ArtifactRow[];
    return rows.map((row) =>
      RunOutputArtifactMetadataSchema.parse(JSON.parse(row.metadata_json))
    );
  }

  async cleanup(input: RunOutputArtifactCleanupInput): Promise<RunOutputArtifactCleanupResult> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), MAX_CLEANUP_LIMIT);
    const workspaceClause = input.workspaceId ? ' AND workspace_id = ?' : '';
    const parameters = input.workspaceId
      ? [input.now, input.now, input.workspaceId, limit + 1]
      : [input.now, input.now, limit + 1];
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const rows = connection
        .prepare(
          `SELECT metadata_json
           FROM run_output_artifacts
           WHERE state = 'available' AND expires_at <= ?
             AND (active_lease_until IS NULL OR active_lease_until <= ?)
             ${workspaceClause}
           ORDER BY expires_at, id
           LIMIT ?`
        )
        .all(...parameters) as unknown as ArtifactRow[];
      const retainedParameters = input.workspaceId
        ? [input.now, input.now, input.workspaceId]
        : [input.now, input.now];
      const retained = connection
        .prepare(
          `SELECT COUNT(*) AS count
           FROM run_output_artifacts
           WHERE state = 'available' AND expires_at <= ? AND active_lease_until > ?
             ${workspaceClause}`
        )
        .get(...retainedParameters) as unknown as CountRow;
      let reclaimedBytes = 0;
      const expiredArtifactIds: string[] = [];
      for (const row of rows.slice(0, limit)) {
        const metadata = RunOutputArtifactMetadataSchema.parse(JSON.parse(row.metadata_json));
        const expired = RunOutputArtifactMetadataSchema.parse({
          ...metadata,
          state: 'expired',
          redaction: { ...metadata.redaction, validatedAt: input.now },
        });
        const result = connection
          .prepare(
            `UPDATE run_output_artifacts
             SET state = 'expired', metadata_json = ?, content = NULL
             WHERE id = ? AND state = 'available'`
          )
          .run(JSON.stringify(expired), metadata.id);
        if (result.changes === 1) {
          reclaimedBytes += metadata.storedBytes;
          expiredArtifactIds.push(metadata.id);
        }
      }
      connection.exec('COMMIT');
      return {
        expiredArtifactIds,
        reclaimedBytes,
        retainedByLease: Number(retained.count),
        hasMore: rows.length > limit,
      };
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  async quarantine(
    lookup: RunOutputArtifactLookup,
    reason: RunOutputQuarantineReason,
    now: string
  ): Promise<RunOutputArtifactMetadata | null> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE');
    try {
      const row = connection
        .prepare(
          `SELECT metadata_json
           FROM run_output_artifacts
           WHERE id = ? AND workspace_id = ? AND task_id = ? AND run_id = ? AND attempt_id = ?`
        )
        .get(
          lookup.artifactId,
          lookup.workspaceId,
          lookup.taskId,
          lookup.runId,
          lookup.attemptId
        ) as ArtifactRow | undefined;
      if (!row) {
        connection.exec('COMMIT');
        return null;
      }
      const metadata = RunOutputArtifactMetadataSchema.parse(JSON.parse(row.metadata_json));
      if (lookup.turnId !== undefined && metadata.scope.turnId !== lookup.turnId) {
        connection.exec('COMMIT');
        return null;
      }
      if (metadata.state !== 'available') {
        connection.exec('COMMIT');
        return metadata;
      }
      const quarantined = RunOutputArtifactMetadataSchema.parse({
        ...metadata,
        state: 'quarantined',
        quarantineReason: reason,
        redaction: {
          ...metadata.redaction,
          state: 'quarantined',
          validatedAt: now,
        },
      });
      connection
        .prepare(
          `UPDATE run_output_artifacts
           SET state = 'quarantined', metadata_json = ?, content = NULL
           WHERE id = ? AND state = 'available'`
        )
        .run(JSON.stringify(quarantined), metadata.id);
      connection.exec('COMMIT');
      return quarantined;
    } catch (error) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }

  private validateContent(metadata: RunOutputArtifactMetadata, content: Uint8Array | null): void {
    if (metadata.state === 'available') {
      if (!content) throw new Error('Available run output artifacts require persisted content.');
      if (content.byteLength !== metadata.storedBytes || contentHash(content) !== metadata.sha256) {
        throw new Error('Run output artifact content does not match its integrity metadata.');
      }
      return;
    }
    if (content || metadata.storedBytes !== 0) {
      throw new Error('Unavailable run output artifacts cannot persist a payload body.');
    }
  }
}
