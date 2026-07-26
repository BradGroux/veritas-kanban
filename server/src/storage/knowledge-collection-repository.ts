import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  KnowledgeActivityEntry,
  KnowledgeCollection,
  KnowledgeIngestionProposal,
  KnowledgePage,
  KnowledgePageExpectedState,
  KnowledgeSource,
} from '@veritas-kanban/shared';
import {
  parseKnowledgeActivityEntry,
  parseKnowledgeCollection,
  parseKnowledgeIngestionProposal,
  parseKnowledgePage,
  parseKnowledgeSource,
} from '../schemas/knowledge-collection-schemas.js';
import { ConflictError } from '../middleware/error-handler.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_STORE_BYTES = 256 * 1_024 * 1_024;
const MAX_COLLECTIONS = 10_000;
const MAX_SOURCES = 100_000;
const MAX_PAGES = 100_000;
const MAX_PROPOSALS = 100_000;
const MAX_KNOWLEDGE_ACTIVITY = 100_000;
export const MAX_KNOWLEDGE_PAGE_BATCH = 5_000;

interface KnowledgeCollectionFileState {
  schemaVersion: 'knowledge-collection-store/v1';
  collections: KnowledgeCollection[];
  sources: KnowledgeSource[];
  pages: KnowledgePage[];
  proposals: KnowledgeIngestionProposal[];
  activity: KnowledgeActivityEntry[];
  blobs: Record<string, string>;
}

export interface KnowledgeProposalTransitionBatch {
  workspaceId: string;
  collectionId: string;
  proposalId: string;
  expectedProposalDigest: string;
  nextProposal: KnowledgeIngestionProposal;
  expectedPages: KnowledgePageExpectedState[];
  upsertPages: KnowledgePage[];
  deletePageIds: string[];
  activity: KnowledgeActivityEntry;
}

export interface KnowledgeCollectionRepository {
  createCollection(candidate: KnowledgeCollection): Promise<KnowledgeCollection>;
  getCollection(workspaceId: string, collectionId: string): Promise<KnowledgeCollection | null>;
  listCollections(workspaceId: string): Promise<KnowledgeCollection[]>;
  createSource(candidate: KnowledgeSource, content: Buffer | null): Promise<KnowledgeSource>;
  getSource(
    workspaceId: string,
    collectionId: string,
    sourceId: string
  ): Promise<KnowledgeSource | null>;
  listSources(workspaceId: string, collectionId: string): Promise<KnowledgeSource[]>;
  readSourceContent(
    workspaceId: string,
    collectionId: string,
    sourceId: string
  ): Promise<Buffer | null>;
  getPage(workspaceId: string, collectionId: string, pageId: string): Promise<KnowledgePage | null>;
  listPages(workspaceId: string, collectionId: string): Promise<KnowledgePage[]>;
  applyPageBatch(
    workspaceId: string,
    collectionId: string,
    pages: KnowledgePage[],
    expected: KnowledgePageExpectedState[]
  ): Promise<KnowledgePage[]>;
  createProposal(candidate: KnowledgeIngestionProposal): Promise<KnowledgeIngestionProposal>;
  getProposal(
    workspaceId: string,
    collectionId: string,
    proposalId: string
  ): Promise<KnowledgeIngestionProposal | null>;
  listProposals(workspaceId: string, collectionId: string): Promise<KnowledgeIngestionProposal[]>;
  transitionProposal(batch: KnowledgeProposalTransitionBatch): Promise<KnowledgeIngestionProposal>;
  listKnowledgeActivity(
    workspaceId: string,
    collectionId: string
  ): Promise<KnowledgeActivityEntry[]>;
}

export function getKnowledgeCollectionStorePath(): string {
  return path.join(getRuntimeDir(), 'knowledge-collections.json');
}

export class FileKnowledgeCollectionRepository implements KnowledgeCollectionRepository {
  constructor(private readonly filePath = getKnowledgeCollectionStorePath()) {
    ensureWithinBase(path.dirname(filePath), filePath);
  }

  async createCollection(candidate: KnowledgeCollection): Promise<KnowledgeCollection> {
    const collection = assertKnowledgeCollectionIntegrity(candidate);
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const state = await this.readState();
      const existing = state.collections.find((entry) => entry.id === collection.id);
      if (existing) {
        if (existing.digest !== collection.digest) {
          throw new ConflictError(
            'Knowledge collection operation identity was reused for changed input.'
          );
        }
        return existing;
      }
      if (
        state.collections.some(
          (entry) => entry.workspaceId === collection.workspaceId && entry.slug === collection.slug
        )
      ) {
        throw new ConflictError('Knowledge collection slug already exists in this workspace.');
      }
      if (state.collections.length >= MAX_COLLECTIONS) {
        throw new ConflictError('Knowledge collection store reached its collection limit.');
      }
      state.collections.push(collection);
      await this.writeState(state);
      return collection;
    });
  }

  async getCollection(
    workspaceId: string,
    collectionId: string
  ): Promise<KnowledgeCollection | null> {
    return (
      (await this.readState()).collections.find(
        (entry) => entry.workspaceId === workspaceId && entry.id === collectionId
      ) ?? null
    );
  }

  async listCollections(workspaceId: string): Promise<KnowledgeCollection[]> {
    return (await this.readState()).collections
      .filter((entry) => entry.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
          left.id.localeCompare(right.id)
      );
  }

  async createSource(candidate: KnowledgeSource, content: Buffer | null): Promise<KnowledgeSource> {
    const source = assertKnowledgeSourceIntegrity(candidate);
    this.validateSourceContent(source, content);
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const state = await this.readState();
      this.requireCollection(state, source.workspaceId, source.collectionId);
      const existing = state.sources.find((entry) => entry.id === source.id);
      if (existing) {
        if (existing.digest !== source.digest) {
          throw new ConflictError(
            'Knowledge source operation identity was reused for changed input.'
          );
        }
        return existing;
      }
      const revisions = state.sources
        .filter(
          (entry) =>
            entry.workspaceId === source.workspaceId &&
            entry.collectionId === source.collectionId &&
            entry.sourceKey === source.sourceKey
        )
        .sort((left, right) => right.revision - left.revision);
      const latest = revisions[0];
      if (
        source.revision !== (latest?.revision ?? 0) + 1 ||
        source.supersedesSourceId !== latest?.id
      ) {
        throw new ConflictError('Knowledge source revision chain changed before persistence.');
      }
      if (state.sources.length >= MAX_SOURCES) {
        throw new ConflictError('Knowledge collection store reached its source limit.');
      }
      if (content && source.blobDigest) {
        const encoded = content.toString('base64');
        const existingBlob = state.blobs[source.blobDigest];
        if (existingBlob && existingBlob !== encoded) {
          throw new ConflictError('Knowledge source blob digest conflicts with stored content.');
        }
        state.blobs[source.blobDigest] = encoded;
      }
      state.sources.push(source);
      await this.writeState(state);
      return source;
    });
  }

  async getSource(
    workspaceId: string,
    collectionId: string,
    sourceId: string
  ): Promise<KnowledgeSource | null> {
    return (
      (await this.readState()).sources.find(
        (entry) =>
          entry.workspaceId === workspaceId &&
          entry.collectionId === collectionId &&
          entry.id === sourceId
      ) ?? null
    );
  }

  async listSources(workspaceId: string, collectionId: string): Promise<KnowledgeSource[]> {
    return (await this.readState()).sources
      .filter((entry) => entry.workspaceId === workspaceId && entry.collectionId === collectionId)
      .sort(
        (left, right) =>
          left.sourceKey.localeCompare(right.sourceKey) ||
          right.revision - left.revision ||
          left.id.localeCompare(right.id)
      );
  }

  async readSourceContent(
    workspaceId: string,
    collectionId: string,
    sourceId: string
  ): Promise<Buffer | null> {
    const state = await this.readState();
    const source = state.sources.find(
      (entry) =>
        entry.workspaceId === workspaceId &&
        entry.collectionId === collectionId &&
        entry.id === sourceId
    );
    if (!source?.blobDigest) return null;
    const encoded = state.blobs[source.blobDigest];
    if (encoded === undefined) {
      throw new ConflictError('Knowledge source snapshot content is missing.');
    }
    const content = this.decodeBlob(source.blobDigest, encoded);
    if (content.byteLength !== source.contentBytes || source.contentHash !== source.blobDigest) {
      throw new ConflictError('Knowledge source snapshot content does not match its metadata.');
    }
    return content;
  }

  async getPage(
    workspaceId: string,
    collectionId: string,
    pageId: string
  ): Promise<KnowledgePage | null> {
    return (
      (await this.readState()).pages.find(
        (entry) =>
          entry.workspaceId === workspaceId &&
          entry.collectionId === collectionId &&
          entry.id === pageId
      ) ?? null
    );
  }

  async listPages(workspaceId: string, collectionId: string): Promise<KnowledgePage[]> {
    return (await this.readState()).pages
      .filter((entry) => entry.workspaceId === workspaceId && entry.collectionId === collectionId)
      .sort(
        (left, right) =>
          left.stableKey.localeCompare(right.stableKey) || left.id.localeCompare(right.id)
      );
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
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const state = await this.readState();
      this.requireCollection(state, workspaceId, collectionId);
      assertExpectedPages(state.pages, expected);
      const candidateIds = new Set(pages.map((page) => page.id));
      const nextPages = [...state.pages.filter((page) => !candidateIds.has(page.id)), ...pages];
      if (nextPages.length > MAX_PAGES) {
        throw new ConflictError('Knowledge collection store reached its page limit.');
      }
      validateKnowledgePageReferences(
        this.requireCollection(state, workspaceId, collectionId),
        state.sources.filter(
          (source) => source.workspaceId === workspaceId && source.collectionId === collectionId
        ),
        nextPages.filter(
          (page) => page.workspaceId === workspaceId && page.collectionId === collectionId
        )
      );
      state.pages = nextPages;
      await this.writeState(state);
      return pages;
    });
  }

  async createProposal(candidate: KnowledgeIngestionProposal): Promise<KnowledgeIngestionProposal> {
    const proposal = assertKnowledgeIngestionProposalIntegrity(candidate);
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const state = await this.readState();
      this.requireCollection(state, proposal.workspaceId, proposal.collectionId);
      const existing = state.proposals.find((entry) => entry.id === proposal.id);
      if (existing) {
        if (existing.requestDigest !== proposal.requestDigest) {
          throw new ConflictError(
            'Knowledge ingestion operation identity was reused for changed input.'
          );
        }
        return existing;
      }
      if (
        state.proposals.some(
          (entry) =>
            entry.workspaceId === proposal.workspaceId &&
            entry.collectionId === proposal.collectionId &&
            entry.operationIdDigest === proposal.operationIdDigest
        )
      ) {
        throw new ConflictError('Knowledge ingestion operation identity already exists.');
      }
      if (state.proposals.length >= MAX_PROPOSALS) {
        throw new ConflictError('Knowledge collection store reached its proposal limit.');
      }
      validateKnowledgeProposalPlan(
        this.requireCollection(state, proposal.workspaceId, proposal.collectionId),
        state.sources.filter(
          (source) =>
            source.workspaceId === proposal.workspaceId &&
            source.collectionId === proposal.collectionId
        ),
        state.pages.filter(
          (page) =>
            page.workspaceId === proposal.workspaceId && page.collectionId === proposal.collectionId
        ),
        proposal
      );
      state.proposals.push(proposal);
      await this.writeState(state);
      return proposal;
    });
  }

  async getProposal(
    workspaceId: string,
    collectionId: string,
    proposalId: string
  ): Promise<KnowledgeIngestionProposal | null> {
    return (
      (await this.readState()).proposals.find(
        (entry) =>
          entry.workspaceId === workspaceId &&
          entry.collectionId === collectionId &&
          entry.id === proposalId
      ) ?? null
    );
  }

  async listProposals(
    workspaceId: string,
    collectionId: string
  ): Promise<KnowledgeIngestionProposal[]> {
    return (await this.readState()).proposals
      .filter((entry) => entry.workspaceId === workspaceId && entry.collectionId === collectionId)
      .sort(
        (left, right) =>
          Date.parse(right.proposedAt) - Date.parse(left.proposedAt) ||
          left.id.localeCompare(right.id)
      );
  }

  async transitionProposal(
    batch: KnowledgeProposalTransitionBatch
  ): Promise<KnowledgeIngestionProposal> {
    const nextProposal = assertKnowledgeIngestionProposalIntegrity(batch.nextProposal);
    const activity = assertKnowledgeActivityIntegrity(batch.activity);
    const pages = batch.upsertPages.map(assertKnowledgePageIntegrity);
    await this.prepareParent();
    return withFileLock(this.filePath, async () => {
      const state = await this.readState();
      const collection = this.requireCollection(state, batch.workspaceId, batch.collectionId);
      const index = state.proposals.findIndex(
        (proposal) =>
          proposal.workspaceId === batch.workspaceId &&
          proposal.collectionId === batch.collectionId &&
          proposal.id === batch.proposalId
      );
      if (index < 0) throw new ConflictError('Knowledge ingestion proposal does not exist.');
      const current = state.proposals[index];
      if (current.digest !== batch.expectedProposalDigest) {
        throw new ConflictError('Knowledge ingestion proposal changed before transition.');
      }
      assertKnowledgeProposalTransition(current, nextProposal, activity, batch);
      assertExpectedPages(state.pages, batch.expectedPages);
      const upsertIds = new Set(pages.map((page) => page.id));
      const deleteIds = new Set(batch.deletePageIds);
      if (
        deleteIds.size !== batch.deletePageIds.length ||
        [...deleteIds].some((id) => upsertIds.has(id))
      ) {
        throw new ConflictError('Knowledge ingestion page transition is inconsistent.');
      }
      const nextPages = [
        ...state.pages.filter((page) => !upsertIds.has(page.id) && !deleteIds.has(page.id)),
        ...pages,
      ];
      validateKnowledgePageReferences(
        collection,
        state.sources.filter(
          (source) =>
            source.workspaceId === batch.workspaceId && source.collectionId === batch.collectionId
        ),
        nextPages.filter(
          (page) =>
            page.workspaceId === batch.workspaceId && page.collectionId === batch.collectionId
        )
      );
      if (state.activity.length >= MAX_KNOWLEDGE_ACTIVITY) {
        throw new ConflictError('Knowledge collection store reached its activity limit.');
      }
      state.pages = nextPages;
      state.proposals[index] = nextProposal;
      state.activity.push(activity);
      await this.writeState(state);
      return nextProposal;
    });
  }

  async listKnowledgeActivity(
    workspaceId: string,
    collectionId: string
  ): Promise<KnowledgeActivityEntry[]> {
    return (await this.readState()).activity
      .filter((entry) => entry.workspaceId === workspaceId && entry.collectionId === collectionId)
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          left.id.localeCompare(right.id)
      );
  }

  private validateSourceContent(source: KnowledgeSource, content: Buffer | null): void {
    if (source.storage === 'content-addressed-blob') {
      if (
        !content ||
        content.byteLength !== source.contentBytes ||
        `sha256:${createHash('sha256').update(content).digest('hex')}` !== source.contentHash
      ) {
        throw new ConflictError('Knowledge source snapshot content does not match its metadata.');
      }
      return;
    }
    if (content) {
      throw new ConflictError('Referenced knowledge sources cannot persist inline content.');
    }
  }

  private requireCollection(
    state: KnowledgeCollectionFileState,
    workspaceId: string,
    collectionId: string
  ): KnowledgeCollection {
    const collection = state.collections.find(
      (entry) => entry.workspaceId === workspaceId && entry.id === collectionId
    );
    if (!collection) throw new ConflictError('Knowledge collection does not exist.');
    return collection;
  }

  private async prepareParent(): Promise<void> {
    const parent = path.dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new ConflictError('Knowledge collection store parent is not a safe directory.');
    }
  }

  private async readState(): Promise<KnowledgeCollectionFileState> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_STORE_BYTES) {
        throw new ConflictError('Knowledge collection store is not a bounded regular file.');
      }
      const parsed = JSON.parse(await handle.readFile({ encoding: 'utf8' })) as Record<
        string,
        unknown
      >;
      if (parsed.schemaVersion !== 'knowledge-collection-store/v1') {
        throw new ConflictError('Knowledge collection store schema is unsupported.');
      }
      const collections = Array.isArray(parsed.collections)
        ? parsed.collections.map(assertKnowledgeCollectionIntegrity)
        : [];
      const sources = Array.isArray(parsed.sources)
        ? parsed.sources.map(assertKnowledgeSourceIntegrity)
        : [];
      const pages = Array.isArray(parsed.pages)
        ? parsed.pages.map(assertKnowledgePageIntegrity)
        : [];
      const proposals = Array.isArray(parsed.proposals)
        ? parsed.proposals.map(assertKnowledgeIngestionProposalIntegrity)
        : [];
      const activity = Array.isArray(parsed.activity)
        ? parsed.activity.map(assertKnowledgeActivityIntegrity)
        : [];
      const blobs =
        parsed.blobs && typeof parsed.blobs === 'object' && !Array.isArray(parsed.blobs)
          ? (parsed.blobs as Record<string, string>)
          : {};
      if (
        collections.length > MAX_COLLECTIONS ||
        sources.length > MAX_SOURCES ||
        pages.length > MAX_PAGES ||
        proposals.length > MAX_PROPOSALS ||
        activity.length > MAX_KNOWLEDGE_ACTIVITY
      ) {
        throw new ConflictError('Knowledge collection store exceeds its bounded inventory.');
      }
      for (const [digest, encoded] of Object.entries(blobs)) {
        if (
          typeof encoded !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/.test(digest) ||
          !hasBase64Shape(encoded)
        ) {
          throw new ConflictError('Knowledge collection store contains an invalid blob.');
        }
      }
      validatePageCollections(collections, sources, pages);
      return {
        schemaVersion: 'knowledge-collection-store/v1',
        collections,
        sources,
        pages,
        proposals,
        activity,
        blobs,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          schemaVersion: 'knowledge-collection-store/v1',
          collections: [],
          sources: [],
          pages: [],
          proposals: [],
          activity: [],
          blobs: {},
        };
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async writeState(state: KnowledgeCollectionFileState): Promise<void> {
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized) > MAX_STORE_BYTES) {
      throw new ConflictError('Knowledge collection store reached its size limit.');
    }
    await atomicWriteFile(this.filePath, serialized);
  }

  private decodeBlob(digest: string, encoded: string): Buffer {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest) || !isCanonicalBase64(encoded)) {
      throw new ConflictError('Knowledge collection store contains an invalid blob.');
    }
    const content = Buffer.from(encoded, 'base64');
    if (`sha256:${createHash('sha256').update(content).digest('hex')}` !== digest) {
      throw new ConflictError('Knowledge collection store contains a corrupted blob.');
    }
    return content;
  }
}

function isCanonicalBase64(value: string): boolean {
  if (!hasBase64Shape(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function hasBase64Shape(value: string): boolean {
  if (value.length === 0) return true;
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  return true;
}

export function assertKnowledgeCollectionIntegrity(value: unknown): KnowledgeCollection {
  const collection = parseKnowledgeCollection(value);
  const { digest, ...payload } = collection;
  if (digestRunLaunchValue(payload) !== digest) {
    throw new ConflictError('Knowledge collection metadata digest is invalid.');
  }
  return collection;
}

export function assertKnowledgeSourceIntegrity(value: unknown): KnowledgeSource {
  const source = parseKnowledgeSource(value);
  const { digest, ...payload } = source;
  if (digestRunLaunchValue(payload) !== digest) {
    throw new ConflictError('Knowledge source metadata digest is invalid.');
  }
  return source;
}

export function assertKnowledgePageIntegrity(value: unknown): KnowledgePage {
  const page = parseKnowledgePage(value);
  for (const revision of [page.current, ...page.history]) {
    const { digest, ...payload } = revision;
    if (
      digestRunLaunchValue(payload) !== digest ||
      `sha256:${createHash('sha256').update(revision.markdown).digest('hex')}` !==
        revision.contentHash
    ) {
      throw new ConflictError('Knowledge page revision digest is invalid.');
    }
  }
  const { digest, ...payload } = page;
  if (digestRunLaunchValue(payload) !== digest) {
    throw new ConflictError('Knowledge page metadata digest is invalid.');
  }
  return page;
}

export function computeKnowledgeIngestionPreviewDigest(
  proposal: Omit<KnowledgeIngestionProposal, 'digest' | 'previewDigest'>
): string {
  const { state: _state, revision: _revision, transitions: _transitions, ...plan } = proposal;
  return digestRunLaunchValue(plan);
}

export function assertKnowledgeIngestionProposalIntegrity(
  value: unknown
): KnowledgeIngestionProposal {
  const proposal = parseKnowledgeIngestionProposal(value);
  for (const entry of proposal.beforePages) {
    if (entry.page) assertKnowledgePageIntegrity(entry.page);
  }
  for (const page of proposal.afterPages) assertKnowledgePageIntegrity(page);
  for (const transition of proposal.transitions) {
    const { digest, ...payload } = transition;
    if (digestRunLaunchValue(payload) !== digest) {
      throw new ConflictError('Knowledge ingestion transition digest is invalid.');
    }
  }
  const { digest, previewDigest, ...payload } = proposal;
  const proposalPayload = { ...payload, previewDigest };
  if (
    computeKnowledgeIngestionPreviewDigest(payload) !== previewDigest ||
    digestRunLaunchValue(proposalPayload) !== digest
  ) {
    throw new ConflictError('Knowledge ingestion proposal digest is invalid.');
  }
  return proposal;
}

export function assertKnowledgeActivityIntegrity(value: unknown): KnowledgeActivityEntry {
  const activity = parseKnowledgeActivityEntry(value);
  const { digest, ...payload } = activity;
  if (digestRunLaunchValue(payload) !== digest) {
    throw new ConflictError('Knowledge activity entry digest is invalid.');
  }
  return activity;
}

export function validateKnowledgePageGraph(pages: KnowledgePage[]): void {
  const byId = new Map<string, KnowledgePage>();
  const identities = new Map<string, string>();
  for (const page of pages) {
    if (byId.has(page.id)) throw new ConflictError('Knowledge page identity is duplicated.');
    byId.set(page.id, page);
    for (const identity of [page.stableKey, ...page.current.aliases]) {
      const normalized = normalizePageIdentity(identity);
      const owner = identities.get(normalized);
      if (owner && owner !== page.id) {
        throw new ConflictError('Knowledge page stable key or alias is ambiguous.');
      }
      identities.set(normalized, page.id);
    }
  }
  const expectedBacklinks = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const targetId of page.current.outgoingPageIds) {
      if (targetId === page.id || !byId.has(targetId)) {
        throw new ConflictError('Knowledge page link target is invalid.');
      }
      const backlinks = expectedBacklinks.get(targetId) ?? new Set<string>();
      backlinks.add(page.id);
      expectedBacklinks.set(targetId, backlinks);
    }
  }
  for (const page of pages) {
    const expected = [...(expectedBacklinks.get(page.id) ?? [])].sort();
    const actual = [...page.current.backlinkPageIds].sort();
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
      throw new ConflictError('Knowledge page backlinks do not match outgoing links.');
    }
  }
}

export function validateKnowledgePageReferences(
  collection: KnowledgeCollection,
  sources: KnowledgeSource[],
  pages: KnowledgePage[]
): void {
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const page of pages) {
    if (
      page.workspaceId !== collection.workspaceId ||
      page.collectionId !== collection.id ||
      page.history.length + 1 > collection.definition.maxPageVersions
    ) {
      throw new ConflictError('Knowledge page scope or version history violates its collection.');
    }
    for (const revision of [page.current, ...page.history]) {
      if (
        !collection.definition.pageKinds.includes(revision.pageKind) ||
        collection.definition.requiredMetadata.some((field) => !(field in revision.metadata))
      ) {
        throw new ConflictError('Knowledge page metadata violates its collection definition.');
      }
      if (
        revision.claims.some((claim) =>
          claim.citations.some((citation) => !sourceIds.has(citation.sourceId))
        )
      ) {
        throw new ConflictError('Knowledge page claim cites an unknown source revision.');
      }
    }
  }
  validateKnowledgePageGraph(pages);
}

export function validateKnowledgeProposalPlan(
  collection: KnowledgeCollection,
  sources: KnowledgeSource[],
  currentPages: KnowledgePage[],
  proposal: KnowledgeIngestionProposal
): void {
  if (
    proposal.workspaceId !== collection.workspaceId ||
    proposal.collectionId !== collection.id ||
    proposal.state !== 'dry-run' ||
    proposal.revision !== 1 ||
    proposal.transitions.length !== 0
  ) {
    throw new ConflictError('Knowledge ingestion dry-run scope or state is invalid.');
  }
  const sourceIds = new Set(sources.map((source) => source.id));
  if (
    proposal.sourceIds.some((sourceId) => !sourceIds.has(sourceId)) ||
    proposal.contradictions.some((contradiction) =>
      contradiction.sourceIds.some((sourceId) => !sourceIds.has(sourceId))
    )
  ) {
    throw new ConflictError('Knowledge ingestion dry run references an unknown source revision.');
  }
  assertExpectedPages(currentPages, proposal.expectedPages);
  const afterIds = new Set(proposal.afterPages.map((page) => page.id));
  validateKnowledgePageReferences(collection, sources, [
    ...currentPages.filter((page) => !afterIds.has(page.id)),
    ...proposal.afterPages,
  ]);
}

export function assertPageBatchShape(
  workspaceId: string,
  collectionId: string,
  pages: KnowledgePage[],
  expected: KnowledgePageExpectedState[]
): void {
  if (
    pages.length !== expected.length ||
    new Set(pages.map((page) => page.id)).size !== pages.length ||
    new Set(expected.map((entry) => entry.id)).size !== expected.length
  ) {
    throw new ConflictError('Knowledge page batch identities are inconsistent.');
  }
  const expectedIds = new Set(expected.map((entry) => entry.id));
  if (
    pages.some(
      (page) =>
        page.workspaceId !== workspaceId ||
        page.collectionId !== collectionId ||
        !expectedIds.has(page.id)
    )
  ) {
    throw new ConflictError('Knowledge page batch scope does not match its metadata.');
  }
}

export function assertExpectedPages(
  currentPages: KnowledgePage[],
  expected: KnowledgePageExpectedState[]
): void {
  for (const entry of expected) {
    const current = currentPages.find((page) => page.id === entry.id);
    if ((current?.digest ?? null) !== entry.digest) {
      throw new ConflictError('Knowledge page changed before the atomic batch was applied.');
    }
  }
}

function normalizePageIdentity(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

export function assertKnowledgeProposalTransition(
  current: KnowledgeIngestionProposal,
  next: KnowledgeIngestionProposal,
  activity: KnowledgeActivityEntry,
  batch: KnowledgeProposalTransitionBatch
): void {
  const expectedState =
    current.state === 'dry-run' ? 'applied' : current.state === 'applied' ? 'reversed' : null;
  if (
    !expectedState ||
    next.state !== expectedState ||
    next.revision !== current.revision + 1 ||
    next.id !== current.id ||
    next.workspaceId !== current.workspaceId ||
    next.collectionId !== current.collectionId ||
    next.previewDigest !== current.previewDigest ||
    next.requestDigest !== current.requestDigest ||
    next.operationIdDigest !== current.operationIdDigest ||
    next.transitions.length !== current.transitions.length + 1 ||
    current.transitions.some(
      (transition, index) => transition.digest !== next.transitions[index]?.digest
    )
  ) {
    throw new ConflictError('Knowledge ingestion proposal transition is invalid.');
  }
  const transition = next.transitions.at(-1);
  if (
    !transition ||
    transition.from !== current.state ||
    transition.to !== next.state ||
    transition.fromProposalDigest !== current.digest ||
    transition.actorId !== activity.actorId ||
    transition.at !== activity.createdAt ||
    activity.workspaceId !== current.workspaceId ||
    activity.collectionId !== current.collectionId ||
    activity.proposalId !== current.id ||
    activity.type !==
      (next.state === 'applied' ? 'knowledge.ingestion.applied' : 'knowledge.ingestion.reversed') ||
    !sameStringSet(activity.sourceIds, current.sourceIds) ||
    !sameStringSet(
      activity.pageIds,
      current.afterPages.map((page) => page.id)
    )
  ) {
    throw new ConflictError('Knowledge ingestion activity does not match its transition.');
  }
  if (
    next.state === 'applied' &&
    next.contradictions.some((contradiction) => contradiction.severity === 'blocking')
  ) {
    throw new ConflictError('Blocking knowledge contradictions require a replacement proposal.');
  }
  const expectedPages =
    next.state === 'applied'
      ? current.expectedPages
      : current.afterPages.map((page) => ({ id: page.id, digest: page.digest }));
  const upsertPages =
    next.state === 'applied'
      ? current.afterPages
      : current.beforePages
          .map((entry) => entry.page)
          .filter((page): page is KnowledgePage => Boolean(page));
  const deletePageIds =
    next.state === 'applied'
      ? []
      : current.beforePages.filter((entry) => !entry.page).map((entry) => entry.pageId);
  if (
    !sameExpectedPages(batch.expectedPages, expectedPages) ||
    !samePageDigests(batch.upsertPages, upsertPages) ||
    !sameStringSet(batch.deletePageIds, deletePageIds)
  ) {
    throw new ConflictError('Knowledge ingestion page batch does not match its proposal.');
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function sameExpectedPages(
  left: KnowledgePageExpectedState[],
  right: KnowledgePageExpectedState[]
): boolean {
  const rightById = new Map(right.map((entry) => [entry.id, entry.digest]));
  return (
    left.length === right.length &&
    new Set(left.map((entry) => entry.id)).size === left.length &&
    left.every((entry) => rightById.get(entry.id) === entry.digest)
  );
}

function samePageDigests(left: KnowledgePage[], right: KnowledgePage[]): boolean {
  const rightById = new Map(right.map((page) => [page.id, page.digest]));
  return (
    left.length === right.length &&
    new Set(left.map((page) => page.id)).size === left.length &&
    left.every((page) => rightById.get(page.id) === page.digest)
  );
}

function validatePageCollections(
  collections: KnowledgeCollection[],
  sources: KnowledgeSource[],
  pages: KnowledgePage[]
): void {
  const grouped = new Map<string, KnowledgePage[]>();
  for (const page of pages) {
    const key = `${page.workspaceId}\0${page.collectionId}`;
    const collectionPages = grouped.get(key) ?? [];
    collectionPages.push(page);
    grouped.set(key, collectionPages);
  }
  for (const collectionPages of grouped.values()) {
    const first = collectionPages[0];
    const collection = collections.find(
      (candidate) =>
        candidate.workspaceId === first.workspaceId && candidate.id === first.collectionId
    );
    if (!collection) throw new ConflictError('Knowledge page collection does not exist.');
    validateKnowledgePageReferences(
      collection,
      sources.filter(
        (source) =>
          source.workspaceId === collection.workspaceId && source.collectionId === collection.id
      ),
      collectionPages
    );
  }
}
