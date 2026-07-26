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
  transitionClaim: vi.fn(),
  runIntegrityLint: vi.fn(),
  listIntegrityFindings: vi.fn(),
  getIntegrityHealth: vi.fn(),
  transitionIntegrityFinding: vi.fn(),
  searchCollection: vi.fn(),
  createQueryPromotion: vi.fn(),
  createCitedExport: vi.fn(),
  createIngestionProposal: vi.fn(),
  listIngestionProposals: vi.fn(),
  getIngestionProposal: vi.fn(),
  applyIngestionProposal: vi.fn(),
  reverseIngestionProposal: vi.fn(),
  listKnowledgeActivity: vi.fn(),
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
const PROPOSAL_INPUT = {
  operationId: 'ingest-readme',
  sourceIds: ['knowledge_source_0123456789abcdef'],
  pages: [
    {
      stableKey: 'architecture',
      title: 'Architecture',
      pageKind: 'concept',
      metadata: { owner: 'product' },
      markdown: '# Architecture',
      claims: [
        {
          claimKey: 'supported-claim',
          text: 'The source supports this claim.',
          citations: [{ sourceId: 'knowledge_source_0123456789abcdef' }],
          confidence: 0.9,
        },
      ],
      reviewState: 'review-required',
      confidence: 0.8,
    },
  ],
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

  it('searches a collection with authenticated scope and validated backend options', async () => {
    knowledge.searchCollection.mockResolvedValue({
      query: 'architecture',
      backend: 'keyword',
      degraded: true,
      reason: 'QMD unavailable',
      results: [{ id: 'knowledge_page_1', kind: 'derived-page', citations: [] }],
    });
    const input = {
      query: 'architecture',
      limit: 5,
      scope: 'derived-pages',
      backend: 'auto',
    };

    const response = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/search`)
      .send(input);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ backend: 'keyword', degraded: true });
    expect(knowledge.searchCollection).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      { id: 'operator-1', role: 'admin' },
      input
    );
  });

  it('runs bounded integrity linting in the authenticated launch scope', async () => {
    knowledge.runIntegrityLint.mockResolvedValue({
      schemaVersion: 'knowledge-integrity-report/v1',
      workspaceId: 'workspace-a',
      collectionId: COLLECTION_ID,
      asOf: '2026-07-26T00:00:00.000Z',
      inspected: { pages: 2, sources: 1, claims: 2 },
      findings: [],
      findingCounts: { info: 0, warning: 0, error: 0 },
      reportDigest: `sha256:${'a'.repeat(64)}`,
    });
    const input = {
      asOf: '2026-07-26T00:00:00.000Z',
      freshnessRules: [{ target: 'page-kind', match: 'concept', maxAgeDays: 30 }],
      includeResearchCandidates: true,
    };

    const response = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/integrity/lint`)
      .send(input);

    expect(response.status).toBe(200);
    expect(knowledge.runIntegrityLint).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      { id: 'operator-1', role: 'admin' },
      input
    );
  });

  it('lists and transitions durable integrity findings', async () => {
    const findingId = 'knowledge_finding_0123456789abcdef';
    knowledge.listIntegrityFindings.mockResolvedValue([{ id: findingId, status: 'open' }]);
    knowledge.transitionIntegrityFinding.mockResolvedValue({
      id: findingId,
      status: 'remediating',
      owner: 'architecture',
    });
    const listed = await request(createApp()).get(
      `/api/knowledge/collections/${COLLECTION_ID}/integrity/findings`
    );
    const input = {
      operationId: 'remediate-finding',
      expectedDigest: `sha256:${'a'.repeat(64)}`,
      to: 'remediating',
      owner: 'architecture',
      remediationLinks: ['task:repair-knowledge-link'],
    };
    const transitioned = await request(createApp())
      .post(
        `/api/knowledge/collections/${COLLECTION_ID}/integrity/findings/${findingId}/transitions`
      )
      .send(input);

    expect(listed.status).toBe(200);
    expect(transitioned.status).toBe(200);
    expect(knowledge.listIntegrityFindings).toHaveBeenCalledWith('workspace-a', COLLECTION_ID, {
      id: 'operator-1',
      role: 'admin',
    });
    expect(knowledge.transitionIntegrityFinding).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      findingId,
      { id: 'operator-1', role: 'admin' },
      input
    );
  });

  it('transitions a claim with compare-and-set page evidence', async () => {
    const pageId = 'knowledge_page_0123456789abcdef';
    const claimId = 'knowledge_claim_0123456789abcdef';
    const input = {
      operationId: 'dispute-claim',
      expectedPageDigest: `sha256:${'a'.repeat(64)}`,
      expectedState: 'active',
      to: 'disputed',
      reason: 'Conflicting retained evidence requires review.',
      evidenceSourceIds: ['knowledge_source_0123456789abcdef'],
    };
    knowledge.transitionClaim.mockResolvedValue({
      id: pageId,
      current: { claims: [{ id: claimId, lifecycleState: 'disputed' }] },
    });

    const response = await request(createApp())
      .post(
        `/api/knowledge/collections/${COLLECTION_ID}/pages/${pageId}/claims/${claimId}/transitions`
      )
      .send(input);

    expect(response.status).toBe(200);
    expect(knowledge.transitionClaim).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      pageId,
      claimId,
      { id: 'operator-1', role: 'admin' },
      input
    );
  });

  it('binds complete launch evidence headers and rejects partial evidence', async () => {
    knowledge.searchCollection.mockResolvedValue({
      query: 'architecture',
      backend: 'keyword',
      degraded: false,
      results: [],
      evidenceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const launchContext = {
      taskId: 'task-1',
      attemptId: 'attempt-1',
      launchManifestDigest: `sha256:${'f'.repeat(64)}`,
    };

    const response = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/search`)
      .set('x-veritas-task-id', launchContext.taskId)
      .set('x-veritas-attempt-id', launchContext.attemptId)
      .set('x-veritas-launch-manifest-digest', launchContext.launchManifestDigest)
      .send({ query: 'architecture' });

    expect(response.status).toBe(200);
    expect(knowledge.searchCollection).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      { id: 'operator-1', role: 'admin', launchContext },
      { query: 'architecture' }
    );

    const partial = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/search`)
      .set('x-veritas-task-id', launchContext.taskId)
      .send({ query: 'architecture' });

    expect(partial.status).toBe(400);
    expect(knowledge.searchCollection).toHaveBeenCalledTimes(1);
  });

  it('promotes digest-bound selected search results into the ingestion workflow', async () => {
    const evidenceDigest = `sha256:${'a'.repeat(64)}`;
    const sourceId = 'knowledge_source_0123456789abcdef';
    const evidence = {
      query: 'architecture',
      backend: 'keyword',
      degraded: false,
      results: [
        {
          id: sourceId,
          kind: 'raw-source',
          backend: 'keyword',
          title: 'Architecture source',
          snippet: 'Architecture evidence',
          score: 0.9,
          sourceId,
          classification: 'internal',
          citations: [{ sourceId }],
        },
      ],
      evidenceDigest,
    };
    const input = {
      operationId: 'promote-architecture-query',
      evidence,
      selectedResultIds: [sourceId],
      pages: PROPOSAL_INPUT.pages,
    };
    knowledge.createQueryPromotion.mockResolvedValue({
      id: 'knowledge_proposal_query',
      state: 'dry-run',
      queryPromotion: {
        query: evidence.query,
        evidenceDigest,
        selectedResultIds: [sourceId],
      },
    });

    const response = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/search/promotions`)
      .send(input);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ state: 'dry-run' });
    expect(knowledge.createQueryPromotion).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      { id: 'operator-1', role: 'admin' },
      input
    );
  });

  it('creates a citation-preserving work product export', async () => {
    const sourceId = 'knowledge_source_0123456789abcdef';
    const input = {
      title: 'Architecture evidence',
      evidence: {
        query: 'architecture',
        backend: 'keyword',
        degraded: false,
        results: [
          {
            id: sourceId,
            kind: 'raw-source',
            backend: 'keyword',
            title: 'Architecture source',
            snippet: 'Architecture evidence',
            score: 0.9,
            sourceId,
            classification: 'internal',
            citations: [{ sourceId }],
          },
        ],
        evidenceDigest: `sha256:${'a'.repeat(64)}`,
      },
      selectedResultIds: [sourceId],
      redaction: 'standard',
    };
    knowledge.createCitedExport.mockResolvedValue({
      id: 'wp_knowledge_export',
      kind: 'markdown',
      title: input.title,
    });

    const response = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/exports`)
      .send(input);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 'wp_knowledge_export', kind: 'markdown' });
    expect(knowledge.createCitedExport).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      { id: 'operator-1', role: 'admin' },
      input
    );
  });

  it('creates, applies, and reverses digest-bound ingestion proposals', async () => {
    const proposalId = 'knowledge_proposal_0123456789abcdef';
    const dryRunDigest = `sha256:${'a'.repeat(64)}`;
    const appliedDigest = `sha256:${'b'.repeat(64)}`;
    knowledge.createIngestionProposal.mockResolvedValue({
      id: proposalId,
      state: 'dry-run',
      digest: dryRunDigest,
    });
    knowledge.applyIngestionProposal.mockResolvedValue({
      id: proposalId,
      state: 'applied',
      digest: appliedDigest,
    });
    knowledge.reverseIngestionProposal.mockResolvedValue({
      id: proposalId,
      state: 'reversed',
      digest: `sha256:${'c'.repeat(64)}`,
    });

    const created = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/ingestion/proposals`)
      .send(PROPOSAL_INPUT);
    const applied = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/ingestion/proposals/${proposalId}/apply`)
      .send({ proposalDigest: dryRunDigest });
    const reversed = await request(createApp())
      .post(`/api/knowledge/collections/${COLLECTION_ID}/ingestion/proposals/${proposalId}/reverse`)
      .send({ proposalDigest: appliedDigest });

    expect(created.status).toBe(201);
    expect(applied.body).toMatchObject({ state: 'applied' });
    expect(reversed.body).toMatchObject({ state: 'reversed' });
    expect(knowledge.createIngestionProposal).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      { id: 'operator-1', role: 'admin' },
      PROPOSAL_INPUT
    );
    expect(knowledge.applyIngestionProposal).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      proposalId,
      { id: 'operator-1', role: 'admin' },
      { proposalDigest: dryRunDigest }
    );
    expect(knowledge.reverseIngestionProposal).toHaveBeenCalledWith(
      'workspace-a',
      COLLECTION_ID,
      proposalId,
      { id: 'operator-1', role: 'admin' },
      { proposalDigest: appliedDigest }
    );
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
