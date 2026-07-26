import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { KnowledgeCollection, KnowledgeSource } from '@veritas-kanban/shared';
import {
  parseKnowledgeCollection,
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

interface KnowledgeCollectionFileState {
  schemaVersion: 'knowledge-collection-store/v1';
  collections: KnowledgeCollection[];
  sources: KnowledgeSource[];
  blobs: Record<string, string>;
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
      const blobs =
        parsed.blobs && typeof parsed.blobs === 'object' && !Array.isArray(parsed.blobs)
          ? (parsed.blobs as Record<string, string>)
          : {};
      if (collections.length > MAX_COLLECTIONS || sources.length > MAX_SOURCES) {
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
      return {
        schemaVersion: 'knowledge-collection-store/v1',
        collections,
        sources,
        blobs,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          schemaVersion: 'knowledge-collection-store/v1',
          collections: [],
          sources: [],
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
