import { createHash } from 'node:crypto';
import type { WorkProductArtifactMetadata } from '@veritas-kanban/shared';
import { WorkProductArtifactMetadataSchema } from '../../schemas/work-product-schemas.js';
import type {
  WorkProductArtifactCreateResult,
  WorkProductArtifactDeleteResult,
  WorkProductArtifactDownload,
  WorkProductArtifactLookup,
  WorkProductArtifactRepository,
} from '../work-product-artifact-repository.js';
import type { SqliteDatabase } from './database.js';

interface WorkProductArtifactRow {
  metadata_json: string;
  content: Uint8Array | null;
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function sameIdentity(
  left: WorkProductArtifactMetadata,
  right: WorkProductArtifactMetadata
): boolean {
  return (
    left.id === right.id &&
    left.productId === right.productId &&
    left.version === right.version &&
    left.workspaceId === right.workspaceId &&
    left.taskId === right.taskId &&
    left.runId === right.runId &&
    left.attemptId === right.attemptId &&
    left.producingEventId === right.producingEventId &&
    left.requestIdDigest === right.requestIdDigest &&
    left.launchManifestDigest === right.launchManifestDigest &&
    left.mediaType === right.mediaType &&
    left.byteSize === right.byteSize &&
    left.sha256 === right.sha256 &&
    left.safeName === right.safeName &&
    left.state === right.state &&
    left.quarantineReason === right.quarantineReason &&
    left.redaction.state === right.redaction.state &&
    left.redaction.reason === right.redaction.reason
  );
}

export class SqliteWorkProductArtifactRepository implements WorkProductArtifactRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async create(
    candidate: WorkProductArtifactMetadata,
    content: Uint8Array | null
  ): Promise<WorkProductArtifactCreateResult> {
    const metadata = WorkProductArtifactMetadataSchema.parse(candidate);
    if (metadata.state === 'available' && !content) {
      throw new Error('Available work product artifacts require persisted download bytes.');
    }
    if (metadata.state !== 'available' && content) {
      throw new Error('Quarantined work product artifacts cannot persist download bytes.');
    }
    if (
      content &&
      (content.byteLength !== metadata.byteSize || sha256(content) !== metadata.sha256)
    ) {
      throw new Error('Work product artifact bytes do not match their integrity metadata.');
    }

    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = await this.get(this.lookupFor(metadata));
      if (existing) {
        if (!sameIdentity(existing, metadata)) {
          throw new Error(`Work product artifact ${metadata.id} has conflicting identity.`);
        }
        if (existing.state === 'available' && !(await this.read(this.lookupFor(existing)))) {
          throw new Error(`Work product artifact ${metadata.id} lost its immutable payload.`);
        }
        connection.exec('COMMIT;');
        return { metadata: existing, created: false };
      }
      connection
        .prepare(
          `
            INSERT INTO work_product_artifacts (
              id,
              workspace_id,
              product_id,
              version_number,
              task_id,
              attempt_id,
              request_id_digest,
              state,
              byte_size,
              sha256,
              metadata_json,
              content,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          metadata.id,
          metadata.workspaceId,
          metadata.productId,
          metadata.version,
          metadata.taskId,
          metadata.attemptId,
          metadata.requestIdDigest,
          metadata.state,
          metadata.byteSize,
          metadata.sha256,
          JSON.stringify(metadata),
          content ?? null,
          metadata.createdAt
        );
      connection.exec('COMMIT;');
      return { metadata, created: true };
    } catch (error) {
      connection.exec('ROLLBACK;');
      throw error;
    }
  }

  async get(lookup: WorkProductArtifactLookup): Promise<WorkProductArtifactMetadata | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT metadata_json, content
          FROM work_product_artifacts
          WHERE workspace_id = ?
            AND product_id = ?
            AND version_number = ?
            AND id = ?
        `
      )
      .get(lookup.workspaceId, lookup.productId, lookup.version, lookup.artifactId) as unknown as
      WorkProductArtifactRow | undefined;
    return row ? WorkProductArtifactMetadataSchema.parse(JSON.parse(row.metadata_json)) : null;
  }

  async read(lookup: WorkProductArtifactLookup): Promise<WorkProductArtifactDownload | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT metadata_json, content
          FROM work_product_artifacts
          WHERE workspace_id = ?
            AND product_id = ?
            AND version_number = ?
            AND id = ?
        `
      )
      .get(lookup.workspaceId, lookup.productId, lookup.version, lookup.artifactId) as unknown as
      WorkProductArtifactRow | undefined;
    if (!row) return null;
    const metadata = WorkProductArtifactMetadataSchema.parse(JSON.parse(row.metadata_json));
    if (metadata.state !== 'available' || !row.content) return null;
    const content = Buffer.from(row.content);
    if (content.byteLength !== metadata.byteSize || sha256(content) !== metadata.sha256) {
      throw new Error('Work product artifact payload failed its integrity check.');
    }
    return { metadata, content };
  }

  async deleteProduct(
    workspaceId: string,
    productId: string
  ): Promise<WorkProductArtifactDeleteResult> {
    const connection = this.database.getConnection();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const summary = connection
        .prepare(
          `
            SELECT COUNT(*) AS artifact_count,
                   COALESCE(SUM(CASE WHEN content IS NULL THEN 0 ELSE length(content) END), 0)
                     AS byte_count
            FROM work_product_artifacts
            WHERE workspace_id = ? AND product_id = ?
          `
        )
        .get(workspaceId, productId) as unknown as {
        artifact_count: number;
        byte_count: number;
      };
      connection
        .prepare('DELETE FROM work_product_artifacts WHERE workspace_id = ? AND product_id = ?')
        .run(workspaceId, productId);
      connection.exec('COMMIT;');
      return {
        artifactsDeleted: summary.artifact_count,
        bytesDeleted: summary.byte_count,
      };
    } catch (error) {
      connection.exec('ROLLBACK;');
      throw error;
    }
  }

  private lookupFor(metadata: WorkProductArtifactMetadata): WorkProductArtifactLookup {
    return {
      workspaceId: metadata.workspaceId,
      productId: metadata.productId,
      version: metadata.version,
      artifactId: metadata.id,
    };
  }
}
