import { createHash } from 'node:crypto';
import type { KnowledgeCollection, KnowledgePage, KnowledgeSource } from '@veritas-kanban/shared';
import { ConflictError } from '../../middleware/error-handler.js';
import {
  MAX_KNOWLEDGE_PAGE_BATCH,
  assertKnowledgeCollectionIntegrity,
  assertKnowledgePageIntegrity,
  assertKnowledgeSourceIntegrity,
  assertExpectedPages,
  assertPageBatchShape,
  validateKnowledgePageGraph,
  validateKnowledgePageReferences,
  type KnowledgeCollectionRepository,
  type KnowledgePageExpectedState,
} from '../knowledge-collection-repository.js';
import type { SqliteDatabase } from './database.js';

interface CollectionRow {
  collection_json: string;
}

interface SourceRow {
  source_json: string;
}

interface ContentRow {
  source_json: string;
  content: Uint8Array | null;
}

interface PageRow {
  page_json: string;
}

interface PageScopeRow {
  workspace_id: string;
  collection_id: string;
}

export class SqliteKnowledgeCollectionRepository implements KnowledgeCollectionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async createCollection(candidate: KnowledgeCollection): Promise<KnowledgeCollection> {
    const collection = assertKnowledgeCollectionIntegrity(candidate);
    const existing = await this.getCollection(collection.workspaceId, collection.id);
    if (existing) {
      if (existing.digest !== collection.digest) {
        throw new ConflictError(
          'Knowledge collection operation identity was reused for changed input.'
        );
      }
      return existing;
    }
    try {
      this.database
        .getConnection()
        .prepare(
          `
            INSERT INTO knowledge_collections (
              id, workspace_id, slug, operation_id_digest, collection_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          collection.id,
          collection.workspaceId,
          collection.slug,
          collection.operationIdDigest,
          JSON.stringify(collection),
          collection.createdAt,
          collection.updatedAt
        );
      return collection;
    } catch {
      const raced = await this.getCollection(collection.workspaceId, collection.id);
      if (raced?.digest === collection.digest) return raced;
      throw new ConflictError(
        'Knowledge collection slug or operation identity already exists in this workspace.'
      );
    }
  }

  async getCollection(
    workspaceId: string,
    collectionId: string
  ): Promise<KnowledgeCollection | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT collection_json
          FROM knowledge_collections
          WHERE workspace_id = ? AND id = ?
        `
      )
      .get(workspaceId, collectionId) as unknown as CollectionRow | undefined;
    if (!row) return null;
    const collection = assertKnowledgeCollectionIntegrity(JSON.parse(row.collection_json));
    if (collection.workspaceId !== workspaceId || collection.id !== collectionId) {
      throw new ConflictError('Knowledge collection row scope does not match its metadata.');
    }
    return collection;
  }

  async listCollections(workspaceId: string): Promise<KnowledgeCollection[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT collection_json
          FROM knowledge_collections
          WHERE workspace_id = ?
          ORDER BY datetime(updated_at) DESC, id ASC
        `
      )
      .all(workspaceId) as unknown as CollectionRow[];
    return rows.map((row) => {
      const collection = assertKnowledgeCollectionIntegrity(JSON.parse(row.collection_json));
      if (collection.workspaceId !== workspaceId) {
        throw new ConflictError('Knowledge collection row scope does not match its metadata.');
      }
      return collection;
    });
  }

  async createSource(candidate: KnowledgeSource, content: Buffer | null): Promise<KnowledgeSource> {
    const source = assertKnowledgeSourceIntegrity(candidate);
    validateSourceContent(source, content);
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const existing = await this.getSource(source.workspaceId, source.collectionId, source.id);
      if (existing) {
        if (existing.digest !== source.digest) {
          throw new ConflictError(
            'Knowledge source operation identity was reused for changed input.'
          );
        }
        db.exec('COMMIT;');
        return existing;
      }
      const collection = await this.getCollection(source.workspaceId, source.collectionId);
      if (!collection) throw new ConflictError('Knowledge collection does not exist.');
      const latestRow = db
        .prepare(
          `
            SELECT source_json
            FROM knowledge_sources
            WHERE workspace_id = ? AND collection_id = ? AND source_key = ?
            ORDER BY revision DESC
            LIMIT 1
          `
        )
        .get(source.workspaceId, source.collectionId, source.sourceKey) as unknown as
        SourceRow | undefined;
      const latest = latestRow
        ? assertKnowledgeSourceIntegrity(JSON.parse(latestRow.source_json))
        : undefined;
      if (
        source.revision !== (latest?.revision ?? 0) + 1 ||
        source.supersedesSourceId !== latest?.id
      ) {
        throw new ConflictError('Knowledge source revision chain changed before persistence.');
      }
      db.prepare(
        `
          INSERT INTO knowledge_sources (
            id, workspace_id, collection_id, source_key, revision, operation_id_digest,
            content_hash, source_json, content, captured_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        source.id,
        source.workspaceId,
        source.collectionId,
        source.sourceKey,
        source.revision,
        source.operationIdDigest,
        source.contentHash,
        JSON.stringify(source),
        content,
        source.capturedAt
      );
      db.exec('COMMIT;');
      return source;
    } catch (error) {
      db.exec('ROLLBACK;');
      if (error instanceof ConflictError) throw error;
      const raced = await this.getSource(source.workspaceId, source.collectionId, source.id);
      if (raced?.digest === source.digest) return raced;
      throw new ConflictError('Knowledge source revision or operation identity already exists.');
    }
  }

  async getSource(
    workspaceId: string,
    collectionId: string,
    sourceId: string
  ): Promise<KnowledgeSource | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT source_json
          FROM knowledge_sources
          WHERE workspace_id = ? AND collection_id = ? AND id = ?
        `
      )
      .get(workspaceId, collectionId, sourceId) as unknown as SourceRow | undefined;
    if (!row) return null;
    const source = assertKnowledgeSourceIntegrity(JSON.parse(row.source_json));
    assertSourceScope(source, workspaceId, collectionId, sourceId);
    return source;
  }

  async listSources(workspaceId: string, collectionId: string): Promise<KnowledgeSource[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT source_json
          FROM knowledge_sources
          WHERE workspace_id = ? AND collection_id = ?
          ORDER BY source_key ASC, revision DESC, id ASC
        `
      )
      .all(workspaceId, collectionId) as unknown as SourceRow[];
    return rows.map((row) => {
      const source = assertKnowledgeSourceIntegrity(JSON.parse(row.source_json));
      assertSourceScope(source, workspaceId, collectionId);
      return source;
    });
  }

  async readSourceContent(
    workspaceId: string,
    collectionId: string,
    sourceId: string
  ): Promise<Buffer | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT source_json, content
          FROM knowledge_sources
          WHERE workspace_id = ? AND collection_id = ? AND id = ?
        `
      )
      .get(workspaceId, collectionId, sourceId) as unknown as ContentRow | undefined;
    if (!row) return null;
    const source = assertKnowledgeSourceIntegrity(JSON.parse(row.source_json));
    assertSourceScope(source, workspaceId, collectionId, sourceId);
    const content = row.content === null ? null : Buffer.from(row.content);
    validateSourceContent(source, content);
    return content;
  }

  async getPage(
    workspaceId: string,
    collectionId: string,
    pageId: string
  ): Promise<KnowledgePage | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT page_json
          FROM knowledge_pages
          WHERE workspace_id = ? AND collection_id = ? AND id = ?
        `
      )
      .get(workspaceId, collectionId, pageId) as unknown as PageRow | undefined;
    if (!row) return null;
    const page = assertKnowledgePageIntegrity(JSON.parse(row.page_json));
    assertPageScope(page, workspaceId, collectionId, pageId);
    return page;
  }

  async listPages(workspaceId: string, collectionId: string): Promise<KnowledgePage[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT page_json
          FROM knowledge_pages
          WHERE workspace_id = ? AND collection_id = ?
          ORDER BY stable_key ASC, id ASC
        `
      )
      .all(workspaceId, collectionId) as unknown as PageRow[];
    const pages = rows.map((row) => {
      const page = assertKnowledgePageIntegrity(JSON.parse(row.page_json));
      assertPageScope(page, workspaceId, collectionId);
      return page;
    });
    validateKnowledgePageGraph(pages);
    return pages;
  }

  async applyPageBatch(
    workspaceId: string,
    collectionId: string,
    candidates: KnowledgePage[],
    expected: KnowledgePageExpectedState[]
  ): Promise<KnowledgePage[]> {
    if (candidates.length === 0 || candidates.length > MAX_KNOWLEDGE_PAGE_BATCH) {
      throw new ConflictError('Knowledge page batch is empty or exceeds its bounded size.');
    }
    const pages = candidates.map(assertKnowledgePageIntegrity);
    assertPageBatchShape(workspaceId, collectionId, pages, expected);
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const collection = await this.getCollection(workspaceId, collectionId);
      if (!collection) throw new ConflictError('Knowledge collection does not exist.');
      const current = await this.listPages(workspaceId, collectionId);
      assertExpectedPages(current, expected);
      const scopeStatement = db.prepare(
        'SELECT workspace_id, collection_id FROM knowledge_pages WHERE id = ?'
      );
      for (const page of pages) {
        const scope = scopeStatement.get(page.id) as unknown as PageScopeRow | undefined;
        if (scope && (scope.workspace_id !== workspaceId || scope.collection_id !== collectionId)) {
          throw new ConflictError('Knowledge page identity already exists in another scope.');
        }
      }
      const candidateIds = new Set(pages.map((page) => page.id));
      const resultingPages = [...current.filter((page) => !candidateIds.has(page.id)), ...pages];
      validateKnowledgePageReferences(
        collection,
        await this.listSources(workspaceId, collectionId),
        resultingPages
      );
      const statement = db.prepare(
        `
          INSERT INTO knowledge_pages (
            id, workspace_id, collection_id, stable_key, page_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            stable_key = excluded.stable_key,
            page_json = excluded.page_json,
            updated_at = excluded.updated_at
        `
      );
      for (const page of pages) {
        statement.run(
          page.id,
          page.workspaceId,
          page.collectionId,
          page.stableKey,
          JSON.stringify(page),
          page.current.updatedAt
        );
      }
      db.exec('COMMIT;');
      return pages;
    } catch (error) {
      db.exec('ROLLBACK;');
      if (error instanceof ConflictError) throw error;
      throw new ConflictError('Knowledge page batch could not be applied atomically.');
    }
  }
}

function validateSourceContent(source: KnowledgeSource, content: Buffer | null): void {
  if (source.storage === 'content-addressed-reference') {
    if (content) throw new ConflictError('Referenced knowledge sources cannot store inline data.');
    return;
  }
  if (
    !content ||
    content.byteLength !== source.contentBytes ||
    `sha256:${createHash('sha256').update(content).digest('hex')}` !== source.contentHash
  ) {
    throw new ConflictError('Knowledge source snapshot content does not match its metadata.');
  }
}

function assertSourceScope(
  source: KnowledgeSource,
  workspaceId: string,
  collectionId: string,
  sourceId?: string
): void {
  if (
    source.workspaceId !== workspaceId ||
    source.collectionId !== collectionId ||
    (sourceId !== undefined && source.id !== sourceId)
  ) {
    throw new ConflictError('Knowledge source row scope does not match its metadata.');
  }
}

function assertPageScope(
  page: KnowledgePage,
  workspaceId: string,
  collectionId: string,
  pageId?: string
): void {
  if (
    page.workspaceId !== workspaceId ||
    page.collectionId !== collectionId ||
    (pageId !== undefined && page.id !== pageId)
  ) {
    throw new ConflictError('Knowledge page row scope does not match its metadata.');
  }
}
