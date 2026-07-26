import { createHash } from 'node:crypto';
import type {
  KnowledgeActivityEntry,
  KnowledgeCollection,
  KnowledgeIngestionProposal,
  KnowledgePage,
  KnowledgePageExpectedState,
  KnowledgeSource,
} from '@veritas-kanban/shared';
import { ConflictError } from '../../middleware/error-handler.js';
import {
  MAX_KNOWLEDGE_PAGE_BATCH,
  assertKnowledgeActivityIntegrity,
  assertKnowledgeCollectionIntegrity,
  assertKnowledgeIngestionProposalIntegrity,
  assertKnowledgeProposalTransition,
  assertKnowledgePageIntegrity,
  assertKnowledgeSourceIntegrity,
  assertExpectedPages,
  assertPageBatchShape,
  validateKnowledgePageGraph,
  validateKnowledgePageReferences,
  validateKnowledgeProposalPlan,
  type KnowledgeCollectionRepository,
  type KnowledgeProposalTransitionBatch,
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

interface ProposalRow {
  proposal_json: string;
}

interface ActivityRow {
  entry_json: string;
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

  async createProposal(candidate: KnowledgeIngestionProposal): Promise<KnowledgeIngestionProposal> {
    const proposal = assertKnowledgeIngestionProposalIntegrity(candidate);
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const existing = await this.getProposal(
        proposal.workspaceId,
        proposal.collectionId,
        proposal.id
      );
      if (existing) {
        if (existing.requestDigest !== proposal.requestDigest) {
          throw new ConflictError(
            'Knowledge ingestion operation identity was reused for changed input.'
          );
        }
        db.exec('COMMIT;');
        return existing;
      }
      const collection = await this.getCollection(proposal.workspaceId, proposal.collectionId);
      if (!collection) throw new ConflictError('Knowledge collection does not exist.');
      validateKnowledgeProposalPlan(
        collection,
        await this.listSources(proposal.workspaceId, proposal.collectionId),
        await this.listPages(proposal.workspaceId, proposal.collectionId),
        proposal
      );
      db.prepare(
        `
            INSERT INTO knowledge_ingestion_proposals (
              id, workspace_id, collection_id, operation_id_digest, state,
              proposal_json, proposed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
      ).run(
        proposal.id,
        proposal.workspaceId,
        proposal.collectionId,
        proposal.operationIdDigest,
        proposal.state,
        JSON.stringify(proposal),
        proposal.proposedAt,
        proposal.proposedAt
      );
      db.exec('COMMIT;');
      return proposal;
    } catch (error) {
      db.exec('ROLLBACK;');
      if (error instanceof ConflictError) throw error;
      throw new ConflictError('Knowledge ingestion operation identity already exists.');
    }
  }

  async getProposal(
    workspaceId: string,
    collectionId: string,
    proposalId: string
  ): Promise<KnowledgeIngestionProposal | null> {
    const row = this.database
      .getConnection()
      .prepare(
        `
          SELECT proposal_json
          FROM knowledge_ingestion_proposals
          WHERE workspace_id = ? AND collection_id = ? AND id = ?
        `
      )
      .get(workspaceId, collectionId, proposalId) as unknown as ProposalRow | undefined;
    if (!row) return null;
    const proposal = assertKnowledgeIngestionProposalIntegrity(JSON.parse(row.proposal_json));
    assertProposalScope(proposal, workspaceId, collectionId, proposalId);
    return proposal;
  }

  async listProposals(
    workspaceId: string,
    collectionId: string
  ): Promise<KnowledgeIngestionProposal[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT proposal_json
          FROM knowledge_ingestion_proposals
          WHERE workspace_id = ? AND collection_id = ?
          ORDER BY proposed_at DESC, id ASC
        `
      )
      .all(workspaceId, collectionId) as unknown as ProposalRow[];
    return rows.map((row) => {
      const proposal = assertKnowledgeIngestionProposalIntegrity(JSON.parse(row.proposal_json));
      assertProposalScope(proposal, workspaceId, collectionId);
      return proposal;
    });
  }

  async transitionProposal(
    batch: KnowledgeProposalTransitionBatch
  ): Promise<KnowledgeIngestionProposal> {
    const nextProposal = assertKnowledgeIngestionProposalIntegrity(batch.nextProposal);
    const activity = assertKnowledgeActivityIntegrity(batch.activity);
    const pages = batch.upsertPages.map(assertKnowledgePageIntegrity);
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const collection = await this.getCollection(batch.workspaceId, batch.collectionId);
      if (!collection) throw new ConflictError('Knowledge collection does not exist.');
      const current = await this.getProposal(
        batch.workspaceId,
        batch.collectionId,
        batch.proposalId
      );
      if (!current) throw new ConflictError('Knowledge ingestion proposal does not exist.');
      if (current.digest !== batch.expectedProposalDigest) {
        throw new ConflictError('Knowledge ingestion proposal changed before transition.');
      }
      assertKnowledgeProposalTransition(current, nextProposal, activity, batch);
      const currentPages = await this.listPages(batch.workspaceId, batch.collectionId);
      assertExpectedPages(currentPages, batch.expectedPages);
      const upsertIds = new Set(pages.map((page) => page.id));
      const deleteIds = new Set(batch.deletePageIds);
      if (
        deleteIds.size !== batch.deletePageIds.length ||
        [...deleteIds].some((id) => upsertIds.has(id))
      ) {
        throw new ConflictError('Knowledge ingestion page transition is inconsistent.');
      }
      const scopeStatement = db.prepare(
        'SELECT workspace_id, collection_id FROM knowledge_pages WHERE id = ?'
      );
      for (const pageId of [...upsertIds, ...deleteIds]) {
        const scope = scopeStatement.get(pageId) as unknown as PageScopeRow | undefined;
        if (
          scope &&
          (scope.workspace_id !== batch.workspaceId || scope.collection_id !== batch.collectionId)
        ) {
          throw new ConflictError('Knowledge page identity already exists in another scope.');
        }
      }
      const resultingPages = [
        ...currentPages.filter((page) => !upsertIds.has(page.id) && !deleteIds.has(page.id)),
        ...pages,
      ];
      validateKnowledgePageReferences(
        collection,
        await this.listSources(batch.workspaceId, batch.collectionId),
        resultingPages
      );
      const deleteStatement = db.prepare(
        'DELETE FROM knowledge_pages WHERE workspace_id = ? AND collection_id = ? AND id = ?'
      );
      for (const pageId of deleteIds) {
        deleteStatement.run(batch.workspaceId, batch.collectionId, pageId);
      }
      const upsertStatement = db.prepare(
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
        upsertStatement.run(
          page.id,
          page.workspaceId,
          page.collectionId,
          page.stableKey,
          JSON.stringify(page),
          page.current.updatedAt
        );
      }
      db.prepare(
        `
          UPDATE knowledge_ingestion_proposals
          SET state = ?, proposal_json = ?, updated_at = ?
          WHERE workspace_id = ? AND collection_id = ? AND id = ?
        `
      ).run(
        nextProposal.state,
        JSON.stringify(nextProposal),
        activity.createdAt,
        batch.workspaceId,
        batch.collectionId,
        batch.proposalId
      );
      db.prepare(
        `
          INSERT INTO knowledge_activity_entries (
            id, workspace_id, collection_id, proposal_id, type, entry_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        activity.id,
        activity.workspaceId,
        activity.collectionId,
        activity.proposalId,
        activity.type,
        JSON.stringify(activity),
        activity.createdAt
      );
      db.exec('COMMIT;');
      return nextProposal;
    } catch (error) {
      db.exec('ROLLBACK;');
      if (error instanceof ConflictError) throw error;
      throw new ConflictError('Knowledge ingestion proposal transition failed atomically.');
    }
  }

  async listKnowledgeActivity(
    workspaceId: string,
    collectionId: string
  ): Promise<KnowledgeActivityEntry[]> {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT entry_json
          FROM knowledge_activity_entries
          WHERE workspace_id = ? AND collection_id = ?
          ORDER BY created_at DESC, id ASC
        `
      )
      .all(workspaceId, collectionId) as unknown as ActivityRow[];
    return rows.map((row) => {
      const activity = assertKnowledgeActivityIntegrity(JSON.parse(row.entry_json));
      if (activity.workspaceId !== workspaceId || activity.collectionId !== collectionId) {
        throw new ConflictError('Knowledge activity row scope does not match its metadata.');
      }
      return activity;
    });
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

function assertProposalScope(
  proposal: KnowledgeIngestionProposal,
  workspaceId: string,
  collectionId: string,
  proposalId?: string
): void {
  if (
    proposal.workspaceId !== workspaceId ||
    proposal.collectionId !== collectionId ||
    (proposalId !== undefined && proposal.id !== proposalId)
  ) {
    throw new ConflictError('Knowledge ingestion row scope does not match its metadata.');
  }
}
