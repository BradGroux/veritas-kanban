import { createHash } from 'node:crypto';
import type {
  CreateKnowledgeCollectionInput,
  KnowledgeAccessRole,
  KnowledgeClassification,
  KnowledgeCollection,
  KnowledgePage,
  KnowledgePageClaim,
  KnowledgePageRevision,
  KnowledgeSource,
  RegisterKnowledgeSourceInput,
  UpsertKnowledgePageCandidate,
  UpsertKnowledgePagesInput,
} from '@veritas-kanban/shared';
import { ConflictError, ForbiddenError, NotFoundError } from '../middleware/error-handler.js';
import {
  CreateKnowledgeCollectionBodySchema,
  RegisterKnowledgeSourceBodySchema,
  UpsertKnowledgePagesBodySchema,
  parseKnowledgeCollection,
  parseKnowledgePage,
  parseKnowledgeSource,
} from '../schemas/knowledge-collection-schemas.js';
import {
  FileKnowledgeCollectionRepository,
  type KnowledgeCollectionRepository,
} from '../storage/knowledge-collection-repository.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteKnowledgeCollectionRepository } from '../storage/sqlite/knowledge-collection-repository.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';

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
  now?: () => Date;
}

export class KnowledgeCollectionService {
  private readonly repository: KnowledgeCollectionRepository;
  private readonly sqliteDatabase?: SqliteDatabase;
  private readonly ownsSqliteDatabase: boolean;
  private readonly now: () => Date;

  constructor(options: KnowledgeCollectionServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
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

  async upsertPages(
    workspaceId: string,
    collectionId: string,
    actor: KnowledgeCollectionActor,
    input: UpsertKnowledgePagesInput
  ): Promise<KnowledgePage[]> {
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
      return priorOperationRevisions.map(({ page }) => page);
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
      return resolved
        .map((entry) => existingById.get(entry.id))
        .filter((page): page is KnowledgePage => Boolean(page));
    }
    return this.repository.applyPageBatch(
      workspaceId,
      collectionId,
      changedPages,
      changedPages.map((page) => ({
        id: page.id,
        digest: existingById.get(page.id)?.digest ?? null,
      }))
    );
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
