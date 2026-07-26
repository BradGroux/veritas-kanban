import { createHash } from 'node:crypto';
import type {
  CreateKnowledgeIngestionProposalInput,
  CreateKnowledgeCitedExportInput,
  CreateKnowledgeQueryPromotionInput,
  CreateWorkProductInput,
  CreateKnowledgeCollectionInput,
  KnowledgeAccessRole,
  KnowledgeActivityEntry,
  KnowledgeClassification,
  KnowledgeCollection,
  KnowledgeIngestionContradiction,
  KnowledgeIngestionContradictionInput,
  KnowledgeIngestionProposal,
  KnowledgePage,
  KnowledgePageClaim,
  KnowledgePageExpectedState,
  KnowledgePageRevision,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
  KnowledgeSource,
  RegisterKnowledgeSourceInput,
  SearchKnowledgeCollectionInput,
  TransitionKnowledgeIngestionProposalInput,
  UpsertKnowledgePageCandidate,
  UpsertKnowledgePagesInput,
  WorkProduct,
} from '@veritas-kanban/shared';
import { redactString } from '../lib/redact.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../middleware/error-handler.js';
import {
  CreateKnowledgeIngestionProposalBodySchema,
  CreateKnowledgeCitedExportBodySchema,
  CreateKnowledgeQueryPromotionBodySchema,
  CreateKnowledgeCollectionBodySchema,
  RegisterKnowledgeSourceBodySchema,
  SearchKnowledgeCollectionBodySchema,
  TransitionKnowledgeIngestionProposalBodySchema,
  UpsertKnowledgePagesBodySchema,
  parseKnowledgeActivityEntry,
  parseKnowledgeCollection,
  parseKnowledgeIngestionProposal,
  parseKnowledgePage,
  parseKnowledgeSource,
} from '../schemas/knowledge-collection-schemas.js';
import {
  FileKnowledgeCollectionRepository,
  computeKnowledgeIngestionPreviewDigest,
  type KnowledgeCollectionRepository,
} from '../storage/knowledge-collection-repository.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteKnowledgeCollectionRepository } from '../storage/sqlite/knowledge-collection-repository.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import {
  KnowledgeQmdSearchService,
  type KnowledgeQmdSearchAdapter,
} from './knowledge-qmd-search-service.js';
import { getWorkProductService } from './work-product-service.js';

const CLASSIFICATION_RANK: Record<KnowledgeClassification, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

export interface KnowledgeCollectionActor {
  id: string;
  role: KnowledgeAccessRole;
}

export interface KnowledgeCollectionServiceOptions {
  repository?: KnowledgeCollectionRepository;
  storageType?: 'file' | 'sqlite';
  filePath?: string;
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  qmdSearch?: KnowledgeQmdSearchAdapter;
  workProductWriter?: KnowledgeWorkProductWriter;
  now?: () => Date;
}

export interface KnowledgeWorkProductWriter {
  create(input: CreateWorkProductInput): Promise<WorkProduct>;
}

interface PreparedKnowledgePageBatch {
  operationIdDigest: string;
  requestDigest: string;
  afterPages: KnowledgePage[];
  beforePages: Array<{ pageId: string; page: KnowledgePage | null }>;
  expectedPages: KnowledgePageExpectedState[];
  candidatePageIds: string[];
  resultPages: KnowledgePage[];
  replayed: boolean;
}

export class KnowledgeCollectionService {
  private readonly repository: KnowledgeCollectionRepository;
  private readonly sqliteDatabase?: SqliteDatabase;
  private readonly ownsSqliteDatabase: boolean;
  private readonly qmdSearch: KnowledgeQmdSearchAdapter;
  private readonly workProductWriter?: KnowledgeWorkProductWriter;
  private readonly now: () => Date;

  constructor(options: KnowledgeCollectionServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.qmdSearch = options.qmdSearch ?? new KnowledgeQmdSearchService();
    this.workProductWriter = options.workProductWriter;
    this.ownsSqliteDatabase = false;
    if (options.repository) {
      this.repository = options.repository;
      return;
    }
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');
    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteKnowledgeCollectionRepository(this.sqliteDatabase);
      return;
    }
    this.repository = options.filePath
      ? new FileKnowledgeCollectionRepository(options.filePath)
      : new FileKnowledgeCollectionRepository();
  }

  async createCollection(
    workspaceId: string,
    actor: KnowledgeCollectionActor,
    input: CreateKnowledgeCollectionInput
  ): Promise<KnowledgeCollection> {
    const parsed = CreateKnowledgeCollectionBodySchema.parse(input);
    this.assertWorkspaceIdentifier(workspaceId);
    if (!parsed.accessPolicy.writeRoles.includes(actor.role) && actor.role !== 'admin') {
      throw new ForbiddenError(
        'Knowledge collection access policy must grant its creator write access.'
      );
    }
    const operationIdDigest = digestRunLaunchValue(parsed.operationId);
    const requestDigest = digestRunLaunchValue({
      workspaceId,
      operationIdDigest,
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      definition: parsed.definition,
      accessPolicy: parsed.accessPolicy,
    });
    const collectionId = stableId('knowledge_collection', {
      workspaceId,
      operationIdDigest,
    });
    const existing = await this.repository.getCollection(workspaceId, collectionId);
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new ConflictError(
          'Knowledge collection operation identity was reused for changed input.'
        );
      }
      return existing;
    }
    const now = this.now().toISOString();
    const payload = {
      schemaVersion: 'knowledge-collection/v1' as const,
      id: collectionId,
      workspaceId,
      slug: parsed.slug,
      name: parsed.name,
      ...(parsed.description ? { description: parsed.description } : {}),
      definition: parsed.definition,
      accessPolicy: parsed.accessPolicy,
      version: 1,
      operationIdDigest,
      requestDigest,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    return this.repository.createCollection(
      parseKnowledgeCollection({ ...payload, digest: digestRunLaunchValue(payload) })
    );
  }

  async listCollections(
    workspaceId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeCollection[]> {
    this.assertWorkspaceIdentifier(workspaceId);
    return (await this.repository.listCollections(workspaceId)).filter((collection) =>
      this.canRead(collection, actor)
    );
  }

  async getCollection(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeCollection | null> {
    this.assertWorkspaceIdentifier(workspaceId);
    const collection = await this.repository.getCollection(workspaceId, collectionId);
    return collection && this.canRead(collection, actor) ? collection : null;
  }

  async registerSource(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor,
    input: RegisterKnowledgeSourceInput
  ): Promise<KnowledgeSource> {
    const parsed = RegisterKnowledgeSourceBodySchema.parse(input);
    const collection = await this.requireWritableCollection(workspaceId, collectionId, actor);
    if (
      CLASSIFICATION_RANK[parsed.classification] >
      CLASSIFICATION_RANK[collection.accessPolicy.maxSourceClassification]
    ) {
      throw new ForbiddenError(
        'Knowledge source classification exceeds the collection access policy.'
      );
    }
    const operationIdDigest = digestRunLaunchValue(parsed.operationId);
    const sourceId = stableId('knowledge_source', {
      workspaceId,
      collectionId,
      operationIdDigest,
    });
    let content: Buffer | null;
    let contentHash: string;
    let contentBytes: number;
    if (parsed.storage === 'content-addressed-blob') {
      content = Buffer.from(parsed.content, 'utf8');
      contentHash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
      contentBytes = content.byteLength;
    } else {
      content = null;
      contentHash = parsed.contentHash;
      contentBytes = parsed.contentBytes;
    }
    const requestDigest = digestRunLaunchValue({
      workspaceId,
      collectionId,
      operationIdDigest,
      sourceKey: parsed.sourceKey,
      uri: parsed.uri,
      mediaType: parsed.mediaType,
      title: parsed.title,
      owner: parsed.owner,
      classification: parsed.classification,
      storage: parsed.storage,
      contentHash,
      contentBytes,
      capturedAt: parsed.capturedAt,
    });
    const existing = await this.repository.getSource(workspaceId, collectionId, sourceId);
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new ConflictError(
          'Knowledge source operation identity was reused for changed input.'
        );
      }
      return existing;
    }
    const latest = (await this.repository.listSources(workspaceId, collectionId)).find(
      (candidate) => candidate.sourceKey === parsed.sourceKey
    );
    const payload = {
      schemaVersion: 'knowledge-source/v1' as const,
      id: sourceId,
      workspaceId,
      collectionId,
      sourceKey: parsed.sourceKey,
      revision: (latest?.revision ?? 0) + 1,
      uri: parsed.uri,
      mediaType: parsed.mediaType,
      ...(parsed.title ? { title: parsed.title } : {}),
      owner: parsed.owner,
      classification: parsed.classification,
      storage: parsed.storage,
      contentHash,
      contentBytes,
      ...(content ? { blobDigest: contentHash } : {}),
      ...(latest ? { supersedesSourceId: latest.id } : {}),
      operationIdDigest,
      requestDigest,
      capturedAt: parsed.capturedAt ?? this.now().toISOString(),
      createdBy: actor.id,
    };
    return this.repository.createSource(
      parseKnowledgeSource({ ...payload, digest: digestRunLaunchValue(payload) }),
      content
    );
  }

  async listSources(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeSource[]> {
    await this.requireReadableCollection(workspaceId, collectionId, actor);
    return this.repository.listSources(workspaceId, collectionId);
  }

  async getSource(
    workspaceId: string,
    collectionId: string,
    sourceId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeSource | null> {
    await this.requireReadableCollection(workspaceId, collectionId, actor);
    return this.repository.getSource(workspaceId, collectionId, sourceId);
  }

  async readSourceContent(
    workspaceId: string,
    collectionId: string,
    sourceId: string,
    actor: KnowledgeCollectionActor
  ): Promise<Buffer | null> {
    const source = await this.getSource(workspaceId, collectionId, sourceId, actor);
    if (!source) return null;
    return this.repository.readSourceContent(workspaceId, collectionId, sourceId);
  }

  async listPages(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgePage[]> {
    await this.requireReadableCollection(workspaceId, collectionId, actor);
    return this.repository.listPages(workspaceId, collectionId);
  }

  async getPage(
    workspaceId: string,
    collectionId: string,
    pageId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgePage | null> {
    await this.requireReadableCollection(workspaceId, collectionId, actor);
    return this.repository.getPage(workspaceId, collectionId, pageId);
  }

  async createIngestionProposal(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor,
    input: CreateKnowledgeIngestionProposalInput
  ): Promise<KnowledgeIngestionProposal> {
    return this.createIngestionProposalInternal(workspaceId, collectionId, actor, input);
  }

  private async createIngestionProposalInternal(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor,
    input: CreateKnowledgeIngestionProposalInput,
    queryPromotion?: KnowledgeIngestionProposal['queryPromotion']
  ): Promise<KnowledgeIngestionProposal> {
    const parsed = CreateKnowledgeIngestionProposalBodySchema.parse(input);
    await this.requireWritableCollection(workspaceId, collectionId, actor);
    const operationIdDigest = digestRunLaunchValue(parsed.operationId);
    const requestDigest = digestRunLaunchValue({
      workspaceId,
      collectionId,
      operationIdDigest,
      sourceIds: parsed.sourceIds,
      pages: parsed.pages,
      contradictions: parsed.contradictions ?? [],
      queryPromotion,
    });
    const proposalId = stableId('knowledge_proposal', {
      workspaceId,
      collectionId,
      operationIdDigest,
    });
    const existing = await this.repository.getProposal(workspaceId, collectionId, proposalId);
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new ConflictError(
          'Knowledge ingestion operation identity was reused for changed input.'
        );
      }
      return existing;
    }
    const sources = await this.repository.listSources(workspaceId, collectionId);
    const sourceIds = new Set(sources.map((source) => source.id));
    if (parsed.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new ConflictError('Knowledge ingestion proposal selects an unknown source revision.');
    }
    const prepared = await this.preparePageBatch(workspaceId, collectionId, actor, {
      operationId: parsed.operationId,
      pages: parsed.pages,
    });
    if (prepared.replayed) {
      throw new ConflictError(
        'Knowledge ingestion operation identity already exists in page history without a matching proposal.'
      );
    }
    if (prepared.afterPages.length === 0) {
      throw new ConflictError('Knowledge ingestion proposal does not contain any page changes.');
    }
    const selectedSourceIds = new Set(parsed.sourceIds);
    const candidatePageIds = new Set(prepared.candidatePageIds);
    if (
      prepared.afterPages.some(
        (page) =>
          candidatePageIds.has(page.id) &&
          page.current.claims.some((claim) =>
            claim.citations.some((citation) => !selectedSourceIds.has(citation.sourceId))
          )
      )
    ) {
      throw new ConflictError(
        'Knowledge ingestion page claims must cite the proposal source selection.'
      );
    }
    const proposedAt = this.now().toISOString();
    const contradictions = buildProposalContradictions(
      proposalId,
      parsed.contradictions ?? [],
      prepared,
      selectedSourceIds
    );
    const beforeById = new Map(prepared.beforePages.map((entry) => [entry.pageId, entry.page]));
    const pageChanges = prepared.afterPages.map((page) => {
      const before = beforeById.get(page.id) ?? null;
      return {
        pageId: page.id,
        stableKey: page.stableKey,
        action: !before
          ? ('create' as const)
          : candidatePageIds.has(page.id)
            ? ('revise' as const)
            : ('backlink-update' as const),
        beforeDigest: before?.digest ?? null,
        afterDigest: page.digest,
        beforeVersion: before?.current.version ?? null,
        afterVersion: page.current.version,
      };
    });
    const indexChanges = prepared.afterPages.map((page) => {
      const before = beforeById.get(page.id) ?? null;
      return {
        pageId: page.id,
        action: 'upsert' as const,
        beforeContentHash: before?.current.contentHash ?? null,
        afterContentHash: page.current.contentHash,
      };
    });
    const plan = {
      schemaVersion: 'knowledge-ingestion-proposal/v1' as const,
      id: proposalId,
      workspaceId,
      collectionId,
      state: 'dry-run' as const,
      revision: 1,
      sourceIds: [...parsed.sourceIds].sort(),
      expectedPages: prepared.expectedPages,
      beforePages: prepared.beforePages,
      afterPages: prepared.afterPages,
      pageChanges,
      indexChanges,
      contradictions,
      activityChanges: [
        {
          type: 'knowledge.ingestion.applied' as const,
          sourceIds: [...parsed.sourceIds].sort(),
          pageIds: prepared.afterPages.map((page) => page.id).sort(),
        },
      ],
      ...(queryPromotion ? { queryPromotion } : {}),
      operationIdDigest,
      requestDigest,
      proposedBy: actor.id,
      proposedAt,
      transitions: [],
    };
    const previewDigest = computeKnowledgeIngestionPreviewDigest(plan);
    const payload = { ...plan, previewDigest };
    return this.repository.createProposal(
      parseKnowledgeIngestionProposal({
        ...payload,
        digest: digestRunLaunchValue(payload),
      })
    );
  }

  async listIngestionProposals(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeIngestionProposal[]> {
    await this.requireReadableCollection(workspaceId, collectionId, actor);
    return this.repository.listProposals(workspaceId, collectionId);
  }

  async getIngestionProposal(
    workspaceId: string,
    collectionId: string,
    proposalId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeIngestionProposal | null> {
    await this.requireReadableCollection(workspaceId, collectionId, actor);
    return this.repository.getProposal(workspaceId, collectionId, proposalId);
  }

  async applyIngestionProposal(
    workspaceId: string,
    collectionId: string,
    proposalId: string,
    actor: KnowledgeCollectionActor,
    input: TransitionKnowledgeIngestionProposalInput
  ): Promise<KnowledgeIngestionProposal> {
    return this.transitionIngestionProposal(
      workspaceId,
      collectionId,
      proposalId,
      actor,
      input,
      'applied'
    );
  }

  async reverseIngestionProposal(
    workspaceId: string,
    collectionId: string,
    proposalId: string,
    actor: KnowledgeCollectionActor,
    input: TransitionKnowledgeIngestionProposalInput
  ): Promise<KnowledgeIngestionProposal> {
    return this.transitionIngestionProposal(
      workspaceId,
      collectionId,
      proposalId,
      actor,
      input,
      'reversed'
    );
  }

  async listKnowledgeActivity(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeActivityEntry[]> {
    await this.requireReadableCollection(workspaceId, collectionId, actor);
    return this.repository.listKnowledgeActivity(workspaceId, collectionId);
  }

  async searchCollection(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor,
    input: SearchKnowledgeCollectionInput
  ): Promise<KnowledgeSearchResponse> {
    const parsed = SearchKnowledgeCollectionBodySchema.parse(input);
    await this.requireReadableCollection(workspaceId, collectionId, actor);
    const terms = knowledgeQueryTerms(parsed.query);
    const scope = parsed.scope ?? 'all';
    const limit = parsed.limit ?? 10;
    const [sources, pages] = await Promise.all([
      scope === 'derived-pages'
        ? Promise.resolve([])
        : this.repository.listSources(workspaceId, collectionId),
      scope === 'raw-sources'
        ? Promise.resolve([])
        : this.repository.listPages(workspaceId, collectionId),
    ]);
    const results: KnowledgeSearchResult[] = [];

    for (const source of sources) {
      const content = await this.repository.readSourceContent(workspaceId, collectionId, source.id);
      const searchable = [
        source.title,
        source.sourceKey,
        source.uri,
        source.owner,
        content?.toString('utf8'),
      ]
        .filter(Boolean)
        .join('\n');
      const score = scoreKnowledgeText(parsed.query, terms, searchable);
      if (score === 0) continue;
      results.push({
        id: source.id,
        kind: 'raw-source',
        backend: 'keyword',
        title: source.title ?? source.sourceKey,
        snippet: redactKnowledgeSnippet(knowledgeSnippet(searchable, terms)),
        score,
        sourceId: source.id,
        citations: [{ sourceId: source.id }],
      });
    }

    for (const page of pages) {
      const revision = page.current;
      const searchable = [
        revision.title,
        page.stableKey,
        ...revision.aliases,
        ...revision.tags,
        revision.markdown,
        ...revision.claims.map((claim) => claim.text),
      ].join('\n');
      const score = scoreKnowledgeText(parsed.query, terms, searchable);
      if (score === 0) continue;
      results.push({
        id: page.id,
        kind: 'derived-page',
        backend: 'keyword',
        title: revision.title,
        snippet: redactKnowledgeSnippet(knowledgeSnippet(searchable, terms)),
        score,
        pageId: page.id,
        stableKey: page.stableKey,
        citations: uniqueKnowledgeCitations(revision.claims.flatMap((claim) => claim.citations)),
      });
    }

    const requestedBackend = parsed.backend ?? 'keyword';
    if (requestedBackend !== 'keyword' && pages.length > 0) {
      try {
        const hits = await this.qmdSearch.search({
          workspaceId,
          collectionId,
          query: parsed.query,
          limit,
          pages,
        });
        const pagesById = new Map(pages.map((page) => [page.id, page]));
        const qmdResults = hits.flatMap((hit): KnowledgeSearchResult[] => {
          const page = pagesById.get(hit.pageId);
          if (!page) return [];
          return [
            {
              id: page.id,
              kind: 'derived-page',
              backend: 'qmd',
              title: page.current.title,
              snippet: redactKnowledgeSnippet(
                hit.snippet || knowledgeSnippet(page.current.markdown, terms)
              ),
              score: hit.score,
              pageId: page.id,
              stableKey: page.stableKey,
              citations: uniqueKnowledgeCitations(
                page.current.claims.flatMap((claim) => claim.citations)
              ),
            },
          ];
        });
        return finalizeKnowledgeSearchResponse({
          query: parsed.query,
          backend: 'qmd',
          degraded: false,
          results: rankKnowledgeResults([
            ...qmdResults,
            ...results.filter((result) => result.kind === 'raw-source'),
          ]).slice(0, limit),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'QMD knowledge search failed.';
        return finalizeKnowledgeSearchResponse({
          query: parsed.query,
          backend: 'keyword',
          degraded: true,
          reason,
          results: rankKnowledgeResults(results).slice(0, limit),
        });
      }
    }
    return finalizeKnowledgeSearchResponse({
      query: parsed.query,
      backend: 'keyword',
      degraded: requestedBackend !== 'keyword',
      ...(requestedBackend === 'keyword'
        ? {}
        : {
            reason:
              'The requested scope has no derived pages eligible for QMD; keyword search served the request.',
          }),
      results: rankKnowledgeResults(results).slice(0, limit),
    });
  }

  async createQueryPromotion(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor,
    input: CreateKnowledgeQueryPromotionInput
  ): Promise<KnowledgeIngestionProposal> {
    const parsed = CreateKnowledgeQueryPromotionBodySchema.parse(input);
    await this.requireWritableCollection(workspaceId, collectionId, actor);
    const { selectedIds, sourceIds } = await this.validateSearchEvidence(
      workspaceId,
      collectionId,
      parsed.evidence,
      parsed.selectedResultIds
    );
    return this.createIngestionProposalInternal(
      workspaceId,
      collectionId,
      actor,
      {
        operationId: parsed.operationId,
        sourceIds,
        pages: parsed.pages,
        contradictions: parsed.contradictions,
      },
      {
        query: parsed.evidence.query,
        evidenceDigest: parsed.evidence.evidenceDigest,
        selectedResultIds: [...selectedIds].sort(),
      }
    );
  }

  async createCitedExport(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor,
    input: CreateKnowledgeCitedExportInput
  ): Promise<WorkProduct> {
    const parsed = CreateKnowledgeCitedExportBodySchema.parse(input);
    const collection = await this.requireReadableCollection(workspaceId, collectionId, actor);
    if (collection.accessPolicy.exportPolicy === 'forbidden') {
      throw new ForbiddenError('Knowledge collection policy forbids export.');
    }
    if (collection.accessPolicy.exportPolicy === 'redacted-only' && parsed.redaction === 'none') {
      throw new ForbiddenError('Knowledge collection policy requires redacted export.');
    }
    const { selectedResults } = await this.validateSearchEvidence(
      workspaceId,
      collectionId,
      parsed.evidence,
      parsed.selectedResultIds
    );
    const redactionLevel =
      collection.accessPolicy.exportPolicy === 'redacted-only'
        ? 'standard'
        : (parsed.redaction ?? 'standard');
    const citations = uniqueKnowledgeCitations(
      selectedResults.flatMap((result) => result.citations)
    );
    const writer = this.workProductWriter ?? getWorkProductService();
    return writer.create({
      kind: 'markdown',
      title: parsed.title,
      workspaceId,
      render: {
        schemaVersion: 1,
        kind: 'markdown',
        markdown: renderKnowledgeCitedExport(parsed.title, parsed.evidence.query, selectedResults),
      },
      redaction: {
        level: redactionLevel,
        containsSensitiveContent: redactionLevel === 'strict',
        exportDefault: redactionLevel === 'none' ? 'full' : 'redacted',
        notes: ['Knowledge collection export policy enforced at creation and export time.'],
      },
      sourceLinks: selectedResults.map((result) => ({
        label: result.title,
        href:
          result.kind === 'raw-source'
            ? `/api/knowledge/collections/${collectionId}/sources/${result.id}`
            : `/api/knowledge/collections/${collectionId}/pages/${result.id}`,
        type: 'other',
      })),
      metadata: {
        knowledgeCollectionId: collectionId,
        knowledgeEvidenceDigest: parsed.evidence.evidenceDigest,
        knowledgeQuery: parsed.evidence.query,
        knowledgeExportPolicy: collection.accessPolicy.exportPolicy,
        selectedResultCount: selectedResults.length,
        citationCount: citations.length,
      },
      changeSummary: `Exported ${selectedResults.length} cited knowledge search result(s).`,
    });
  }

  private async validateSearchEvidence(
    workspaceId: string,
    collectionId: string,
    evidence: KnowledgeSearchResponse,
    selectedResultIds: string[]
  ): Promise<{
    selectedIds: Set<string>;
    selectedResults: KnowledgeSearchResult[];
    sourceIds: string[];
  }> {
    const expectedEvidenceDigest = computeKnowledgeSearchEvidenceDigest(
      evidence.query,
      evidence.results
    );
    if (evidence.evidenceDigest !== expectedEvidenceDigest) {
      throw new ConflictError('Knowledge search evidence digest is stale or invalid.');
    }
    const selectedIds = new Set(selectedResultIds);
    const selectedResults = evidence.results.filter((result) => selectedIds.has(result.id));
    if (selectedResults.length !== selectedIds.size) {
      throw new ConflictError('Knowledge search evidence selects an unknown result.');
    }
    const [sources, pages] = await Promise.all([
      this.repository.listSources(workspaceId, collectionId),
      this.repository.listPages(workspaceId, collectionId),
    ]);
    const sourcesById = new Map(sources.map((source) => [source.id, source]));
    const pagesById = new Map(pages.map((page) => [page.id, page]));
    for (const result of selectedResults) {
      if (result.kind === 'raw-source') {
        if (!result.sourceId || !sourcesById.has(result.sourceId)) {
          throw new ConflictError('Knowledge search source evidence is no longer valid.');
        }
        continue;
      }
      const page = result.pageId ? pagesById.get(result.pageId) : undefined;
      if (
        !page ||
        page.stableKey !== result.stableKey ||
        !sameKnowledgeCitations(
          result.citations,
          uniqueKnowledgeCitations(page.current.claims.flatMap((claim) => claim.citations))
        )
      ) {
        throw new ConflictError('Knowledge search derived evidence is stale.');
      }
    }
    const sourceIds = [
      ...new Set(
        selectedResults.flatMap((result) => result.citations.map((citation) => citation.sourceId))
      ),
    ].sort();
    if (sourceIds.length === 0 || sourceIds.some((sourceId) => !sourcesById.has(sourceId))) {
      throw new ConflictError('Knowledge search citations are no longer valid.');
    }
    return { selectedIds, selectedResults, sourceIds };
  }

  private async preparePageBatch(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor,
    input: UpsertKnowledgePagesInput
  ): Promise<PreparedKnowledgePageBatch> {
    const parsed = UpsertKnowledgePagesBodySchema.parse(input);
    const collection = await this.requireWritableCollection(workspaceId, collectionId, actor);
    const operationIdDigest = digestRunLaunchValue(parsed.operationId);
    const requestDigest = digestRunLaunchValue({
      workspaceId,
      collectionId,
      operationIdDigest,
      pages: parsed.pages,
    });
    const [existingPages, sources] = await Promise.all([
      this.repository.listPages(workspaceId, collectionId),
      this.repository.listSources(workspaceId, collectionId),
    ]);
    const priorOperationRevisions = existingPages.flatMap((page) =>
      [page.current, ...page.history]
        .filter((revision) => revision.operationIdDigest === operationIdDigest)
        .map((revision) => ({ page, revision }))
    );
    if (priorOperationRevisions.length > 0) {
      if (
        priorOperationRevisions.some(({ revision }) => revision.requestDigest !== requestDigest)
      ) {
        throw new ConflictError('Knowledge page operation identity was reused for changed input.');
      }
      if (
        priorOperationRevisions.some(
          ({ page, revision }) => page.current.digest !== revision.digest
        )
      ) {
        throw new ConflictError('Knowledge page operation was already applied and superseded.');
      }
      const resultPages = priorOperationRevisions.map(({ page }) => page);
      return {
        operationIdDigest,
        requestDigest,
        afterPages: [],
        beforePages: [],
        expectedPages: [],
        candidatePageIds: resultPages.map((page) => page.id),
        resultPages,
        replayed: true,
      };
    }
    const now = this.now().toISOString();
    const sourceIds = new Set(sources.map((source) => source.id));
    const resolved = resolvePageCandidates(existingPages, parsed.pages, workspaceId, collectionId);
    const resultingIdentity = buildResultingIdentityMap(existingPages, resolved);
    const desiredById = new Map<
      string,
      {
        candidate: UpsertKnowledgePageCandidate;
        stableKey: string;
        aliases: string[];
        outgoingPageIds: string[];
      }
    >();
    for (const entry of resolved) {
      assertCandidatePolicy(collection, actor, entry.candidate, sourceIds);
      const outgoingPageIds = (entry.candidate.links ?? []).map((identity) => {
        const targetId = resultingIdentity.get(normalizePageIdentity(identity));
        if (!targetId)
          throw new ConflictError(`Knowledge page link target "${identity}" is unknown.`);
        if (targetId === entry.id) {
          throw new ConflictError('Knowledge pages cannot link to themselves.');
        }
        return targetId;
      });
      desiredById.set(entry.id, {
        candidate: entry.candidate,
        stableKey: entry.stableKey,
        aliases: entry.aliases,
        outgoingPageIds: [...new Set(outgoingPageIds)].sort(),
      });
    }
    const allPageIds = new Set([
      ...existingPages.map((page) => page.id),
      ...resolved.map((entry) => entry.id),
    ]);
    const outgoingById = new Map<string, string[]>();
    for (const page of existingPages) {
      outgoingById.set(page.id, page.current.outgoingPageIds);
    }
    for (const [pageId, desired] of desiredById) {
      outgoingById.set(pageId, desired.outgoingPageIds);
    }
    const backlinksById = new Map<string, Set<string>>();
    for (const [pageId, outgoingPageIds] of outgoingById) {
      for (const targetId of outgoingPageIds) {
        if (!allPageIds.has(targetId)) {
          throw new ConflictError('Knowledge page link target no longer exists.');
        }
        const backlinks = backlinksById.get(targetId) ?? new Set<string>();
        backlinks.add(pageId);
        backlinksById.set(targetId, backlinks);
      }
    }
    const existingById = new Map(existingPages.map((page) => [page.id, page]));
    const changedPages: KnowledgePage[] = [];
    for (const pageId of allPageIds) {
      const existing = existingById.get(pageId);
      const desired = desiredById.get(pageId);
      const backlinkPageIds = [...(backlinksById.get(pageId) ?? [])].sort();
      const revisionPayload = desired
        ? buildCandidateRevisionPayload(
            pageId,
            desired,
            backlinkPageIds,
            operationIdDigest,
            requestDigest,
            actor.id,
            now
          )
        : existing
          ? {
              ...revisionPayloadWithoutIdentity(existing.current),
              backlinkPageIds,
              operationIdDigest,
              requestDigest,
              updatedBy: actor.id,
              updatedAt: now,
            }
          : undefined;
      if (!revisionPayload) continue;
      if (existing && revisionsHaveSameKnowledge(existing.current, revisionPayload)) continue;
      const current = createPageRevision((existing?.current.version ?? 0) + 1, revisionPayload);
      const history = existing
        ? [existing.current, ...existing.history].slice(
            0,
            Math.max(0, collection.definition.maxPageVersions - 1)
          )
        : [];
      const payload = {
        schemaVersion: 'knowledge-page/v1' as const,
        id: pageId,
        workspaceId,
        collectionId,
        stableKey: desired?.stableKey ?? existing?.stableKey ?? '',
        current,
        history,
        createdBy: existing?.createdBy ?? actor.id,
        createdAt: existing?.createdAt ?? now,
      };
      changedPages.push(parseKnowledgePage({ ...payload, digest: digestRunLaunchValue(payload) }));
    }
    if (changedPages.length === 0) {
      const resultPages = resolved
        .map((entry) => existingById.get(entry.id))
        .filter((page): page is KnowledgePage => Boolean(page));
      return {
        operationIdDigest,
        requestDigest,
        afterPages: [],
        beforePages: [],
        expectedPages: [],
        candidatePageIds: resolved.map((entry) => entry.id),
        resultPages,
        replayed: false,
      };
    }
    const expectedPages = changedPages.map((page) => ({
      id: page.id,
      digest: existingById.get(page.id)?.digest ?? null,
    }));
    return {
      operationIdDigest,
      requestDigest,
      afterPages: changedPages,
      beforePages: changedPages.map((page) => ({
        pageId: page.id,
        page: existingById.get(page.id) ?? null,
      })),
      expectedPages,
      candidatePageIds: resolved.map((entry) => entry.id),
      resultPages: changedPages,
      replayed: false,
    };
  }

  private async transitionIngestionProposal(
    workspaceId: string,
    collectionId: string,
    proposalId: string,
    actor: KnowledgeCollectionActor,
    input: TransitionKnowledgeIngestionProposalInput,
    target: 'applied' | 'reversed'
  ): Promise<KnowledgeIngestionProposal> {
    const parsed = TransitionKnowledgeIngestionProposalBodySchema.parse(input);
    await this.requireWritableCollection(workspaceId, collectionId, actor);
    if (actor.role !== 'admin') {
      throw new ForbiddenError('Only an administrator can apply or reverse knowledge ingestion.');
    }
    const current = await this.repository.getProposal(workspaceId, collectionId, proposalId);
    if (!current) throw new NotFoundError('Knowledge ingestion proposal not found.');
    if (current.state === target) {
      const transition = current.transitions.at(-1);
      if (transition?.to === target && transition.fromProposalDigest === parsed.proposalDigest) {
        return current;
      }
    }
    const expectedState = target === 'applied' ? 'dry-run' : 'applied';
    if (current.state !== expectedState || current.digest !== parsed.proposalDigest) {
      throw new ConflictError('Knowledge ingestion proposal state or digest is stale.');
    }
    if (
      target === 'applied' &&
      current.contradictions.some((contradiction) => contradiction.severity === 'blocking')
    ) {
      throw new ConflictError('Blocking contradictions require a replacement proposal.');
    }
    const at = this.now().toISOString();
    const transitionPayload = {
      from: current.state as 'dry-run' | 'applied',
      to: target,
      fromProposalDigest: current.digest,
      actorId: actor.id,
      at,
    };
    const transition = {
      ...transitionPayload,
      digest: digestRunLaunchValue(transitionPayload),
    };
    const { digest: _currentDigest, ...currentWithoutDigest } = current;
    const nextWithoutDigest = {
      ...currentWithoutDigest,
      state: target,
      revision: current.revision + 1,
      transitions: [...current.transitions, transition],
    };
    const nextProposal = parseKnowledgeIngestionProposal({
      ...nextWithoutDigest,
      digest: digestRunLaunchValue(nextWithoutDigest),
    });
    const activity = createKnowledgeActivity(current, actor.id, at, target);
    const isApply = target === 'applied';
    return this.repository.transitionProposal({
      workspaceId,
      collectionId,
      proposalId,
      expectedProposalDigest: current.digest,
      nextProposal,
      expectedPages: isApply
        ? current.expectedPages
        : current.afterPages.map((page) => ({ id: page.id, digest: page.digest })),
      upsertPages: isApply
        ? current.afterPages
        : current.beforePages
            .map((entry) => entry.page)
            .filter((page): page is KnowledgePage => Boolean(page)),
      deletePageIds: isApply
        ? []
        : current.beforePages.filter((entry) => !entry.page).map((entry) => entry.pageId),
      activity,
    });
  }

  close(): void {
    if (this.ownsSqliteDatabase) this.sqliteDatabase?.close();
  }

  private async requireReadableCollection(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeCollection> {
    const collection = await this.getCollection(workspaceId, collectionId, actor);
    if (!collection) throw new NotFoundError('Knowledge collection not found.');
    return collection;
  }

  private async requireWritableCollection(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor
  ): Promise<KnowledgeCollection> {
    this.assertWorkspaceIdentifier(workspaceId);
    const collection = await this.repository.getCollection(workspaceId, collectionId);
    if (!collection) throw new NotFoundError('Knowledge collection not found.');
    if (actor.role !== 'admin' && !collection.accessPolicy.writeRoles.includes(actor.role)) {
      throw new ForbiddenError('Knowledge collection write access is denied.');
    }
    return collection;
  }

  private canRead(collection: KnowledgeCollection, actor: KnowledgeCollectionActor): boolean {
    return actor.role === 'admin' || collection.accessPolicy.readRoles.includes(actor.role);
  }

  private assertWorkspaceIdentifier(workspaceId: string): void {
    if (!/^[A-Za-z0-9._:-]{1,240}$/.test(workspaceId)) {
      throw new ConflictError('Knowledge collection workspace identifier is invalid.');
    }
  }
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${digestRunLaunchValue(value).slice('sha256:'.length, 40)}`;
}

function buildProposalContradictions(
  proposalId: string,
  supplied: KnowledgeIngestionContradictionInput[],
  prepared: PreparedKnowledgePageBatch,
  selectedSourceIds: Set<string>
): KnowledgeIngestionContradiction[] {
  const beforeById = new Map(prepared.beforePages.map((entry) => [entry.pageId, entry.page]));
  const pagesByIdentity = new Map<string, KnowledgePage>();
  for (const page of prepared.afterPages) {
    const before = beforeById.get(page.id);
    for (const identity of [
      page.id,
      page.stableKey,
      ...page.current.aliases,
      ...(before ? [before.stableKey, ...before.current.aliases] : []),
    ]) {
      pagesByIdentity.set(normalizePageIdentity(identity), page);
    }
  }
  const contradictions: KnowledgeIngestionContradiction[] = supplied.map((contradiction, index) => {
    if (contradiction.sourceIds.some((sourceId) => !selectedSourceIds.has(sourceId))) {
      throw new ConflictError('Knowledge contradiction cites a source outside the proposal.');
    }
    const page = pagesByIdentity.get(normalizePageIdentity(contradiction.pageIdentity));
    if (!page) {
      throw new ConflictError('Knowledge contradiction references a page outside the proposal.');
    }
    if (
      contradiction.claimKey &&
      ![page.current, beforeById.get(page.id)?.current]
        .filter((revision): revision is KnowledgePageRevision => Boolean(revision))
        .some((revision) =>
          revision.claims.some((claim) => claim.claimKey === contradiction.claimKey)
        )
    ) {
      throw new ConflictError('Knowledge contradiction references an unknown stable claim.');
    }
    return {
      id: stableId('knowledge_contradiction', {
        proposalId,
        detectedBy: 'extractor',
        index,
        contradiction,
      }),
      ...contradiction,
      sourceIds: [...contradiction.sourceIds].sort(),
      detectedBy: 'extractor',
    };
  });
  const suppliedIdentities = new Set(
    supplied.map(
      (contradiction) =>
        `${normalizePageIdentity(contradiction.pageIdentity)}\0${contradiction.claimKey ?? ''}`
    )
  );
  for (const page of prepared.afterPages) {
    const before = beforeById.get(page.id);
    if (!before) continue;
    const priorClaims = new Map(before.current.claims.map((claim) => [claim.claimKey, claim]));
    for (const claim of page.current.claims) {
      const prior = priorClaims.get(claim.claimKey);
      if (!prior || prior.text === claim.text || sameCitationSourceSet(prior, claim)) {
        continue;
      }
      const identity = `${normalizePageIdentity(page.stableKey)}\0${claim.claimKey}`;
      if (suppliedIdentities.has(identity)) continue;
      const sourceIds = [
        ...new Set([...prior.citations, ...claim.citations].map((citation) => citation.sourceId)),
      ].sort();
      contradictions.push({
        id: stableId('knowledge_contradiction', {
          proposalId,
          detectedBy: 'stable-claim-diff',
          pageId: page.id,
          claimKey: claim.claimKey,
          sourceIds,
        }),
        pageIdentity: page.stableKey,
        claimKey: claim.claimKey,
        description: `Stable claim "${claim.claimKey}" changes text and supporting source revisions.`,
        severity: 'warning',
        sourceIds,
        detectedBy: 'stable-claim-diff',
      });
    }
  }
  return contradictions.sort((left, right) => left.id.localeCompare(right.id));
}

function sameCitationSourceSet(left: KnowledgePageClaim, right: KnowledgePageClaim): boolean {
  const leftIds = [...new Set(left.citations.map((citation) => citation.sourceId))].sort();
  const rightIds = [...new Set(right.citations.map((citation) => citation.sourceId))].sort();
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((sourceId, index) => sourceId === rightIds[index])
  );
}

function knowledgeQueryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLocaleLowerCase('en-US')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length > 1)
    ),
  ];
}

function scoreKnowledgeText(query: string, terms: string[], text: string): number {
  const normalized = text.toLocaleLowerCase('en-US');
  const phrase = query.toLocaleLowerCase('en-US');
  const matches = terms.filter((term) => normalized.includes(term)).length;
  if (matches === 0) return 0;
  return Math.min(1, matches / Math.max(terms.length, 1) + (normalized.includes(phrase) ? 0.2 : 0));
}

function knowledgeSnippet(text: string, terms: string[]): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const normalized = compact.toLocaleLowerCase('en-US');
  const firstMatch = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const start = Math.max(0, (firstMatch ?? 0) - 80);
  const end = Math.min(compact.length, start + 320);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

function redactKnowledgeSnippet(value: string): string {
  return redactString(value)
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization|cookie)\b\s*[:=]\s*["']?[^"',\s]+/gi,
      '$1: [redacted]'
    )
    .slice(0, 500);
}

function uniqueKnowledgeCitations(
  citations: KnowledgePageClaim['citations']
): KnowledgePageClaim['citations'] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = JSON.stringify(citation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankKnowledgeResults(results: KnowledgeSearchResult[]): KnowledgeSearchResult[] {
  return results.sort(
    (left, right) =>
      right.score - left.score ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id)
  );
}

function renderKnowledgeCitedExport(
  title: string,
  query: string,
  results: KnowledgeSearchResult[]
): string {
  const sections = results.flatMap((result) => [
    `## ${result.title}`,
    '',
    `Type: ${result.kind}`,
    `Backend: ${result.backend}`,
    `Score: ${result.score}`,
    '',
    redactKnowledgeSnippet(result.snippet),
    '',
    'Citations:',
    ...result.citations.map((citation) => {
      const details = [
        `sourceId=${citation.sourceId}`,
        citation.locator ? `locator=${JSON.stringify(citation.locator)}` : null,
        citation.excerptHash ? `excerptHash=${citation.excerptHash}` : null,
      ].filter((value): value is string => Boolean(value));
      return `- ${details.join(' ')}`;
    }),
    '',
  ]);
  return [`# ${title}`, '', `Query: ${query}`, '', ...sections].join('\n');
}

function computeKnowledgeSearchEvidenceDigest(
  query: string,
  results: KnowledgeSearchResult[]
): string {
  return digestRunLaunchValue({ query, results });
}

function finalizeKnowledgeSearchResponse(
  response: Omit<KnowledgeSearchResponse, 'evidenceDigest'>
): KnowledgeSearchResponse {
  return {
    ...response,
    evidenceDigest: computeKnowledgeSearchEvidenceDigest(response.query, response.results),
  };
}

function sameKnowledgeCitations(
  left: KnowledgePageClaim['citations'],
  right: KnowledgePageClaim['citations']
): boolean {
  const normalize = (citations: KnowledgePageClaim['citations']) =>
    citations.map((citation) => JSON.stringify(citation)).sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((citation, index) => citation === normalizedRight[index])
  );
}

function createKnowledgeActivity(
  proposal: KnowledgeIngestionProposal,
  actorId: string,
  createdAt: string,
  target: 'applied' | 'reversed'
): KnowledgeActivityEntry {
  const type =
    target === 'applied'
      ? ('knowledge.ingestion.applied' as const)
      : ('knowledge.ingestion.reversed' as const);
  const payload = {
    schemaVersion: 'knowledge-activity-entry/v1' as const,
    id: stableId('knowledge_activity', { proposalId: proposal.id, type }),
    workspaceId: proposal.workspaceId,
    collectionId: proposal.collectionId,
    proposalId: proposal.id,
    type,
    sourceIds: proposal.sourceIds,
    pageIds: proposal.afterPages.map((page) => page.id).sort(),
    actorId,
    createdAt,
  };
  return parseKnowledgeActivityEntry({
    ...payload,
    digest: digestRunLaunchValue(payload),
  });
}

type KnowledgePageRevisionPayload = Omit<
  KnowledgePageRevision,
  'schemaVersion' | 'version' | 'digest'
>;

interface ResolvedPageCandidate {
  id: string;
  stableKey: string;
  aliases: string[];
  candidate: UpsertKnowledgePageCandidate;
}

function resolvePageCandidates(
  existingPages: KnowledgePage[],
  candidates: UpsertKnowledgePageCandidate[],
  workspaceId: string,
  collectionId: string
): ResolvedPageCandidate[] {
  const existingIdentity = new Map<string, KnowledgePage>();
  for (const page of existingPages) {
    for (const identity of [page.id, page.stableKey, ...page.current.aliases]) {
      const normalized = normalizePageIdentity(identity);
      const prior = existingIdentity.get(normalized);
      if (prior && prior.id !== page.id) {
        throw new ConflictError('Knowledge page identity or alias is ambiguous.');
      }
      existingIdentity.set(normalized, page);
    }
  }
  const candidateIdentities = new Map<string, number>();
  for (const [index, candidate] of candidates.entries()) {
    for (const identity of [candidate.stableKey, ...(candidate.aliases ?? [])]) {
      const normalized = normalizePageIdentity(identity);
      const prior = candidateIdentities.get(normalized);
      if (prior !== undefined && prior !== index) {
        throw new ConflictError('Knowledge page candidates contain an ambiguous identity.');
      }
      candidateIdentities.set(normalized, index);
    }
  }
  const matchedPageIds = new Set<string>();
  return candidates.map((candidate) => {
    const matches = new Map<string, KnowledgePage>();
    for (const identity of [candidate.stableKey, ...(candidate.aliases ?? [])]) {
      const match = existingIdentity.get(normalizePageIdentity(identity));
      if (match) matches.set(match.id, match);
    }
    if (matches.size > 1) {
      throw new ConflictError('Knowledge page candidate matches multiple existing pages.');
    }
    const existing = [...matches.values()][0];
    if (existing && matchedPageIds.has(existing.id)) {
      throw new ConflictError('Multiple knowledge page candidates match one existing page.');
    }
    if (existing) matchedPageIds.add(existing.id);
    const stableKey = existing?.stableKey ?? candidate.stableKey;
    const aliases = uniquePageIdentities([
      ...(existing?.current.aliases ?? []),
      ...(candidate.stableKey !== stableKey ? [candidate.stableKey] : []),
      ...(candidate.aliases ?? []),
    ]).filter((alias) => normalizePageIdentity(alias) !== normalizePageIdentity(stableKey));
    return {
      id:
        existing?.id ??
        stableId('knowledge_page', {
          workspaceId,
          collectionId,
          stableKey,
        }),
      stableKey,
      aliases,
      candidate,
    };
  });
}

function buildResultingIdentityMap(
  existingPages: KnowledgePage[],
  resolved: ResolvedPageCandidate[]
): Map<string, string> {
  const resolvedById = new Map(resolved.map((entry) => [entry.id, entry]));
  const identities = new Map<string, string>();
  const add = (identity: string, pageId: string) => {
    const normalized = normalizePageIdentity(identity);
    const prior = identities.get(normalized);
    if (prior && prior !== pageId) {
      throw new ConflictError('Knowledge page stable key or alias is ambiguous.');
    }
    identities.set(normalized, pageId);
  };
  for (const page of existingPages) {
    if (resolvedById.has(page.id)) continue;
    for (const identity of [page.id, page.stableKey, ...page.current.aliases]) {
      add(identity, page.id);
    }
  }
  for (const entry of resolved) {
    for (const identity of [entry.id, entry.stableKey, ...entry.aliases]) {
      add(identity, entry.id);
    }
  }
  return identities;
}

function assertCandidatePolicy(
  collection: KnowledgeCollection,
  actor: KnowledgeCollectionActor,
  candidate: UpsertKnowledgePageCandidate,
  sourceIds: Set<string>
): void {
  if (!collection.definition.pageKinds.includes(candidate.pageKind)) {
    throw new ConflictError(`Knowledge page kind "${candidate.pageKind}" is not allowed.`);
  }
  const missingMetadata = collection.definition.requiredMetadata.filter(
    (field) => !(field in candidate.metadata)
  );
  if (missingMetadata.length > 0) {
    throw new ConflictError(
      `Knowledge page is missing required metadata: ${missingMetadata.join(', ')}.`
    );
  }
  if (
    actor.role !== 'admin' &&
    (candidate.reviewState === 'approved' || candidate.reviewState === 'rejected')
  ) {
    throw new ForbiddenError('Only an administrator can finalize knowledge page review state.');
  }
  for (const claim of candidate.claims) {
    const citations = new Set<string>();
    for (const citation of claim.citations) {
      if (!sourceIds.has(citation.sourceId)) {
        throw new ConflictError(
          `Knowledge claim "${claim.claimKey}" cites an unknown source revision.`
        );
      }
      const identity = digestRunLaunchValue(citation);
      if (citations.has(identity)) {
        throw new ConflictError(`Knowledge claim "${claim.claimKey}" repeats a citation.`);
      }
      citations.add(identity);
    }
  }
}

function buildCandidateRevisionPayload(
  pageId: string,
  desired: {
    candidate: UpsertKnowledgePageCandidate;
    aliases: string[];
    outgoingPageIds: string[];
  },
  backlinkPageIds: string[],
  operationIdDigest: string,
  requestDigest: string,
  actorId: string,
  updatedAt: string
): KnowledgePageRevisionPayload {
  const candidate = desired.candidate;
  const claims: KnowledgePageClaim[] = candidate.claims.map((claim) => ({
    id: stableId('knowledge_claim', { pageId, claimKey: claim.claimKey }),
    claimKey: claim.claimKey,
    text: claim.text,
    citations: claim.citations,
    confidence: claim.confidence,
  }));
  return {
    title: candidate.title,
    pageKind: candidate.pageKind,
    aliases: desired.aliases,
    tags: [...(candidate.tags ?? [])].sort(),
    metadata: candidate.metadata,
    markdown: candidate.markdown,
    contentHash: `sha256:${createHash('sha256').update(candidate.markdown).digest('hex')}`,
    claims,
    outgoingPageIds: desired.outgoingPageIds,
    backlinkPageIds,
    reviewState: candidate.reviewState,
    confidence: candidate.confidence,
    operationIdDigest,
    requestDigest,
    updatedBy: actorId,
    updatedAt,
  };
}

function revisionPayloadWithoutIdentity(
  revision: KnowledgePageRevision
): Omit<
  KnowledgePageRevisionPayload,
  'operationIdDigest' | 'requestDigest' | 'updatedBy' | 'updatedAt'
> {
  return {
    title: revision.title,
    pageKind: revision.pageKind,
    aliases: revision.aliases,
    tags: revision.tags,
    metadata: revision.metadata,
    markdown: revision.markdown,
    contentHash: revision.contentHash,
    claims: revision.claims,
    outgoingPageIds: revision.outgoingPageIds,
    backlinkPageIds: revision.backlinkPageIds,
    reviewState: revision.reviewState,
    confidence: revision.confidence,
  };
}

function createPageRevision(
  version: number,
  payload: KnowledgePageRevisionPayload
): KnowledgePageRevision {
  const revision = {
    schemaVersion: 'knowledge-page-revision/v1' as const,
    version,
    ...payload,
  };
  return {
    ...revision,
    digest: digestRunLaunchValue(revision),
  };
}

function revisionsHaveSameKnowledge(
  current: KnowledgePageRevision,
  candidate: KnowledgePageRevisionPayload
): boolean {
  return (
    digestRunLaunchValue(revisionPayloadWithoutIdentity(current)) ===
    digestRunLaunchValue({
      title: candidate.title,
      pageKind: candidate.pageKind,
      aliases: candidate.aliases,
      tags: candidate.tags,
      metadata: candidate.metadata,
      markdown: candidate.markdown,
      contentHash: candidate.contentHash,
      claims: candidate.claims,
      outgoingPageIds: candidate.outgoingPageIds,
      backlinkPageIds: candidate.backlinkPageIds,
      reviewState: candidate.reviewState,
      confidence: candidate.confidence,
    })
  );
}

function uniquePageIdentities(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .filter((value) => {
      const normalized = normalizePageIdentity(value);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .sort((left, right) => left.localeCompare(right));
}

function normalizePageIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

let knowledgeCollectionService: KnowledgeCollectionService | undefined;

export function getKnowledgeCollectionService(): KnowledgeCollectionService {
  knowledgeCollectionService ??= new KnowledgeCollectionService();
  return knowledgeCollectionService;
}

export function resetKnowledgeCollectionServiceForTests(): void {
  knowledgeCollectionService?.close();
  knowledgeCollectionService = undefined;
}
