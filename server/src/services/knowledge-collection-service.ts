import { createHash } from 'node:crypto';
import type {
  CreateKnowledgeCollectionInput,
  KnowledgeAccessRole,
  KnowledgeClassification,
  KnowledgeCollection,
  KnowledgeSource,
  RegisterKnowledgeSourceInput,
} from '@veritas-kanban/shared';
import { ConflictError, ForbiddenError, NotFoundError } from '../middleware/error-handler.js';
import {
  CreateKnowledgeCollectionBodySchema,
  RegisterKnowledgeSourceBodySchema,
  parseKnowledgeCollection,
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

let knowledgeCollectionService: KnowledgeCollectionService | undefined;

export function getKnowledgeCollectionService(): KnowledgeCollectionService {
  knowledgeCollectionService ??= new KnowledgeCollectionService();
  return knowledgeCollectionService;
}

export function resetKnowledgeCollectionServiceForTests(): void {
  knowledgeCollectionService?.close();
  knowledgeCollectionService = undefined;
}
