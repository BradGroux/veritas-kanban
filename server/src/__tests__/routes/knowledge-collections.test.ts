import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';

const knowledge = vi.hoisted(() => ({
  createCollection: vi.fn(),
  listCollections: vi.fn(),
  getCollection: vi.fn(),
  registerSource: vi.fn(),
  listSources: vi.fn(),
  getSource: vi.fn(),
  listPages: vi.fn(),
  getPage: vi.fn(),
}));

vi.mock('../../services/knowledge-collection-service.js', () => ({
  getKnowledgeCollectionService: () => knowledge,
}));

import { knowledgeCollectionRoutes } from '../../routes/knowledge-collections.js';

const COLLECTION_ID = 'knowledge_collection_0123456789abcdef';
const COLLECTION_INPUT = {
  operationId: 'create-product-knowledge',
  slug: 'product-knowledge',
  name: 'Product knowledge',
  definition: {
    schemaVersion: 'knowledge-collection-definition/v1',
    version: 1,
    pageKinds: ['concept', 'decision'],
    requiredMetadata: ['owner'],
    naming: 'stable-id',
    links: 'bidirectional',
    ingestion: 'review-required',
    maxPageVersions: 25,
  },
  accessPolicy: {
    readRoles: ['admin', 'agent'],
    writeRoles: ['admin', 'agent'],
    maxSourceClassification: 'confidential',
    exportPolicy: 'redacted-only',
  },
};

function createApp(workspaceId = 'workspace-a'): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role: 'admin',
      isLocalhost: false,
      userId: 'operator-1',
      workspaceId,
    };
    next();
  });
  app.use('/api/knowledge/collections', knowledgeCollectionRoutes);
  app.use(errorHandler);
  return app;
}

describe('knowledge collection routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a collection with authenticated workspace and actor identity', async () => {
    knowledge.createCollection.mockResolvedValue({
      id: COLLECTION_ID,
      workspaceId: 'workspace-a',
    });

    const response = await request(createApp())
      .post('/api/knowledge/collections')
      .send(COLLECTION_INPUT);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: COLLECTION_ID,
      workspaceId: 'workspace-a',
    });
    expect(knowledge.createCollection).toHaveBeenCalledWith(
      'workspace-a',
      { id: 'operator-1', role: 'admin' },
      COLLECTION_INPUT
    );
  });

  it('registers a bounded source snapshot under the requested collection', async () => {
    knowledge.registerSource.mockResolvedValue({
      id: 'knowledge_source_0123456789abcdef',
      collectionId: COLLECTION_ID,
      contentHash: `sha256:${'a'.repeat(64)}`,
    });
    const sourceInput = {
      operationId: 'register-readme',
      sourceKey: 'readme',
      uri: 'repo://README.md',
      mediaType: 'text/markdown',
      owner: 'product',
      classification: 'internal',
      storage: 'content-addressed-blob',
      content: '# Product',
    };

    const response = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/sources`)
      .send(sourceInput);

    expect(response.status).toBe(201);
    expect(knowledge.registerSource).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      { id: 'operator-1', role: 'admin' },
      sourceInput
    );
  });

  it('returns bounded collection pages with pagination metadata', async () => {
    knowledge.listCollections.mockResolvedValue([
      { id: 'collection-1' },
      { id: 'collection-2' },
      { id: 'collection-3' },
    ]);

    const response = await request(createApp()).get('/api/knowledge/collections?page=2&limit=2');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'collection-3' }]);
    expect(knowledge.listCollections).toHaveBeenCalledWith('workspace-a', {
      id: 'operator-1',
      role: 'admin',
    });
  });

  it('returns bounded derived pages without exposing source content', async () => {
    knowledge.listPages.mockResolvedValue([
      { id: 'knowledge_page_1', current: { title: 'One' } },
      { id: 'knowledge_page_2', current: { title: 'Two' } },
    ]);

    const response = await request(createApp()).get(
      `/api/knowledge/collections/${COLLECTION_ID}/pages?page=1&limit=1`
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'knowledge_page_1', current: { title: 'One' } }]);
    expect(knowledge.listPages).toHaveBeenCalledWith('workspace-a', COLLECTION_ID, {
      id: 'operator-1',
      role: 'admin',
    });
  });

  it('rejects invalid identifiers and unknown request fields before service dispatch', async () => {
    const invalidIdentifier = await request(createApp()).get(
      '/api/knowledge/collections/not%20valid'
    );
    const unknownField = await request(createApp())
      .post('/api/knowledge/collections')
      .send({ ...COLLECTION_INPUT, workspaceId: 'spoofed-workspace' });

    expect(invalidIdentifier.status).toBe(400);
    expect(unknownField.status).toBe(400);
    expect(knowledge.getCollection).not.toHaveBeenCalled();
    expect(knowledge.createCollection).not.toHaveBeenCalled();
  });
});
