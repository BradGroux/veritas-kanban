import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  CreateKnowledgeCollectionInput,
  RegisterKnowledgeSourceInput,
  UpsertKnowledgePageCandidate,
  UpsertKnowledgePagesInput,
} from '@veritas-kanban/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KnowledgeCollectionService,
  type KnowledgeCollectionActor,
} from '../services/knowledge-collection-service.js';
import type { KnowledgeQmdSearchAdapter } from '../services/knowledge-qmd-search-service.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SQLITE_BASE_MIGRATIONS } from '../storage/sqlite/migrations.js';

const ADMIN: KnowledgeCollectionActor = { id: 'operator-1', role: 'admin' };
const AGENT: KnowledgeCollectionActor = { id: 'agent-1', role: 'agent' };
const READER: KnowledgeCollectionActor = { id: 'reader-1', role: 'read-only' };
const WORKSPACE_ID = 'workspace-alpha';

const COLLECTION_INPUT: CreateKnowledgeCollectionInput = {
  operationId: 'create-product-knowledge',
  slug: 'product-knowledge',
  name: 'Product knowledge',
  description: 'Reviewed product facts and decisions.',
  definition: {
    schemaVersion: 'knowledge-collection-definition/v1',
    version: 1,
    pageKinds: ['concept', 'decision', 'overview'],
    requiredMetadata: ['owner', 'reviewState'],
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

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe.each(['file', 'sqlite'] as const)('%s knowledge collection repository', (storageType) => {
  it('creates collections idempotently and rejects reused identities or slugs', async () => {
    const service = await createService(storageType);
    const created = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const retried = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);

    expect(retried).toEqual(created);
    await expect(
      service.createCollection(WORKSPACE_ID, ADMIN, {
        ...COLLECTION_INPUT,
        name: 'Changed input',
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    await expect(
      service.createCollection(WORKSPACE_ID, ADMIN, {
        ...COLLECTION_INPUT,
        operationId: 'second-create-operation',
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('keeps source snapshots immutable and advances their supersession chain', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const firstInput = inlineSource({
      operationId: 'source-revision-1',
      content: 'Version one',
      capturedAt: '2026-07-25T12:00:00.000Z',
    });
    const first = await service.registerSource(WORKSPACE_ID, collection.id, AGENT, firstInput);
    const retried = await service.registerSource(WORKSPACE_ID, collection.id, AGENT, firstInput);
    const second = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      AGENT,
      inlineSource({
        operationId: 'source-revision-2',
        content: 'Version two',
        capturedAt: '2026-07-25T13:00:00.000Z',
      })
    );

    expect(retried).toEqual(first);
    expect(first.revision).toBe(1);
    expect(second).toMatchObject({
      revision: 2,
      supersedesSourceId: first.id,
      sourceKey: first.sourceKey,
    });
    expect(
      (await service.readSourceContent(WORKSPACE_ID, collection.id, first.id, ADMIN))?.toString()
    ).toBe('Version one');
    expect(
      (await service.readSourceContent(WORKSPACE_ID, collection.id, second.id, ADMIN))?.toString()
    ).toBe('Version two');
    expect(
      (await service.listSources(WORKSPACE_ID, collection.id, ADMIN)).map((source) => source.id)
    ).toEqual([second.id, first.id]);
  });

  it('supports content-addressed references without copying their content', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const source = await service.registerSource(WORKSPACE_ID, collection.id, AGENT, {
      operationId: 'register-external-reference',
      sourceKey: 'architecture-spec',
      uri: 'https://example.test/architecture.md',
      mediaType: 'text/markdown',
      owner: 'architecture',
      classification: 'internal',
      storage: 'content-addressed-reference',
      contentHash: `sha256:${'a'.repeat(64)}`,
      contentBytes: 4_096,
    });

    expect(source).toMatchObject({
      storage: 'content-addressed-reference',
      contentBytes: 4_096,
    });
    expect(
      await service.readSourceContent(WORKSPACE_ID, collection.id, source.id, ADMIN)
    ).toBeNull();
  });

  it('enforces collection roles, classification ceilings, and workspace isolation', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);

    expect(await service.listCollections(WORKSPACE_ID, READER)).toEqual([]);
    expect(await service.getCollection(WORKSPACE_ID, collection.id, READER)).toBeNull();
    expect(await service.getCollection('workspace-beta', collection.id, ADMIN)).toBeNull();
    await expect(
      service.registerSource(
        WORKSPACE_ID,
        collection.id,
        READER,
        inlineSource({ operationId: 'reader-write', content: 'Denied' })
      )
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    await expect(
      service.registerSource(
        WORKSPACE_ID,
        collection.id,
        AGENT,
        inlineSource({
          operationId: 'restricted-source',
          content: 'Too sensitive',
          classification: 'restricted',
        })
      )
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('creates linked derived pages with claim-level source citations and backlinks', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const source = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      inlineSource({ operationId: 'derived-page-source', content: 'Architecture evidence' })
    );
    const pages = await proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
      operationId: 'derive-architecture-pages',
      pages: [
        pageCandidate('architecture', source.id, {
          aliases: ['system-design'],
          links: ['decision-logging'],
        }),
        pageCandidate('decision-logging', source.id, {
          pageKind: 'decision',
          title: 'Decision logging',
          markdown: '# Decision logging\n\nDecisions are recorded.',
        }),
      ],
    });
    const architecture = pages.find((page) => page.stableKey === 'architecture');
    const decision = pages.find((page) => page.stableKey === 'decision-logging');

    expect(architecture).toBeDefined();
    expect(decision).toBeDefined();
    expect(architecture?.current.outgoingPageIds).toEqual([decision?.id]);
    expect(decision?.current.backlinkPageIds).toEqual([architecture?.id]);
    expect(architecture?.current.claims[0]).toMatchObject({
      claimKey: 'supported-claim',
      citations: [
        {
          sourceId: source.id,
          locator: { kind: 'line-range', startLine: 1, endLine: 1 },
        },
      ],
    });
    expect(await service.listPages(WORKSPACE_ID, collection.id, AGENT)).toHaveLength(2);
    expect(
      await service.getPage(WORKSPACE_ID, collection.id, architecture?.id ?? '', AGENT)
    ).toEqual(architecture);
  });

  it('uses aliases as stable identity and keeps bounded page history without duplication', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, {
      ...COLLECTION_INPUT,
      operationId: 'create-bounded-history',
      slug: 'bounded-history',
      definition: { ...COLLECTION_INPUT.definition, maxPageVersions: 2 },
    });
    const source = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      inlineSource({ operationId: 'bounded-history-source', content: 'Version evidence' })
    );
    const [first] = await proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
      operationId: 'page-version-1',
      pages: [
        pageCandidate('architecture', source.id, {
          aliases: ['system-design'],
          markdown: '# Architecture\n\nVersion one.',
        }),
      ],
    });
    const secondInput = {
      operationId: 'page-version-2',
      pages: [
        pageCandidate('system-design', source.id, {
          markdown: '# Architecture\n\nVersion two.',
        }),
      ],
    };
    const [second] = await proposeAndApplyPages(
      service,
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      secondInput
    );
    const [retried] = await proposeAndApplyPages(
      service,
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      secondInput
    );
    const [third] = await proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
      operationId: 'page-version-3',
      pages: [
        pageCandidate('architecture', source.id, {
          markdown: '# Architecture\n\nVersion three.',
        }),
      ],
    });

    expect(second.id).toBe(first.id);
    expect(second.stableKey).toBe('architecture');
    expect(second.current.aliases).toContain('system-design');
    expect(second.current.version).toBe(2);
    expect(retried).toEqual(second);
    expect(third.current.version).toBe(3);
    expect(third.history).toHaveLength(1);
    expect(third.history[0].version).toBe(2);
    expect(await service.listPages(WORKSPACE_ID, collection.id, ADMIN)).toHaveLength(1);
    await expect(
      proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
        ...secondInput,
        pages: [
          pageCandidate('system-design', source.id, {
            markdown: '# Architecture\n\nChanged retry.',
          }),
        ],
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('searches raw sources and derived pages with citations and explicit QMD degradation', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const source = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      inlineSource({
        operationId: 'search-source',
        title: 'Architecture specification',
        content: 'The gateway uses reviewed dispatch controls. token=private-search-secret',
      })
    );
    await proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
      operationId: 'search-derived-page',
      pages: [
        pageCandidate('gateway-architecture', source.id, {
          title: 'Gateway architecture',
          markdown: '# Gateway architecture\n\nReviewed dispatch is required.',
        }),
      ],
    });

    const response = await service.searchCollection(WORKSPACE_ID, collection.id, AGENT, {
      query: 'reviewed dispatch',
      backend: 'auto',
    });

    expect(response).toMatchObject({
      query: 'reviewed dispatch',
      backend: 'keyword',
      degraded: true,
    });
    expect(response.reason).toContain('qmd unavailable');
    expect(response.results.map((result) => result.snippet).join(' ')).not.toContain(
      'private-search-secret'
    );
    expect(response.results.map((result) => result.kind)).toEqual(['derived-page', 'raw-source']);
    expect(response.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'raw-source',
          sourceId: source.id,
          citations: [{ sourceId: source.id }],
        }),
        expect.objectContaining({
          kind: 'derived-page',
          stableKey: 'gateway-architecture',
          citations: [
            expect.objectContaining({
              sourceId: source.id,
              locator: { kind: 'line-range', startLine: 1, endLine: 1 },
            }),
          ],
        }),
      ])
    );
    await expect(
      service.searchCollection(WORKSPACE_ID, collection.id, READER, {
        query: 'dispatch',
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(
      await service.searchCollection(WORKSPACE_ID, collection.id, AGENT, {
        query: 'gateway',
        scope: 'derived-pages',
        backend: 'keyword',
      })
    ).toMatchObject({
      degraded: false,
      results: [expect.objectContaining({ kind: 'derived-page' })],
    });

    const derivedResult = response.results.find((result) => result.kind === 'derived-page');
    expect(derivedResult).toBeDefined();
    const promoted = await service.createQueryPromotion(WORKSPACE_ID, collection.id, AGENT, {
      operationId: 'promote-search-result',
      evidence: response,
      selectedResultIds: [derivedResult?.id ?? 'missing'],
      pages: [
        pageCandidate('dispatch-overview', source.id, {
          pageKind: 'overview',
          title: 'Dispatch overview',
          markdown: '# Dispatch overview\n\nReviewed dispatch is required.',
        }),
      ],
    });
    expect(promoted).toMatchObject({
      state: 'dry-run',
      queryPromotion: {
        query: 'reviewed dispatch',
        evidenceDigest: response.evidenceDigest,
        selectedResultIds: [derivedResult?.id],
      },
    });
    expect(
      await service.getPage(WORKSPACE_ID, collection.id, promoted.afterPages[0].id, ADMIN)
    ).toBeNull();
    await expect(
      service.createQueryPromotion(WORKSPACE_ID, collection.id, AGENT, {
        operationId: 'tampered-promotion',
        evidence: {
          ...response,
          results: response.results.map((result, index) =>
            index === 0 ? { ...result, snippet: 'Tampered evidence' } : result
          ),
        },
        selectedResultIds: [derivedResult?.id ?? 'missing'],
        pages: [pageCandidate('tampered-promotion', source.id)],
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    const qmdService = await createService(storageType, {
      search: async ({ pages }) => [
        {
          pageId: pages[0].id,
          score: 0.97,
          snippet: 'QMD ranked gateway architecture.',
        },
      ],
    });
    const qmdCollection = await qmdService.createCollection(WORKSPACE_ID, ADMIN, {
      ...COLLECTION_INPUT,
      operationId: 'create-qmd-search',
      slug: 'qmd-search',
    });
    const qmdSource = await qmdService.registerSource(
      WORKSPACE_ID,
      qmdCollection.id,
      ADMIN,
      inlineSource({ operationId: 'qmd-source', content: 'Gateway evidence' })
    );
    await proposeAndApplyPages(qmdService, WORKSPACE_ID, qmdCollection.id, ADMIN, {
      operationId: 'qmd-page',
      pages: [pageCandidate('qmd-gateway', qmdSource.id)],
    });
    expect(
      await qmdService.searchCollection(WORKSPACE_ID, qmdCollection.id, AGENT, {
        query: 'gateway',
        scope: 'derived-pages',
        backend: 'qmd',
      })
    ).toMatchObject({
      backend: 'qmd',
      degraded: false,
      results: [
        expect.objectContaining({
          kind: 'derived-page',
          backend: 'qmd',
          score: 0.97,
          citations: [expect.objectContaining({ sourceId: qmdSource.id })],
        }),
      ],
    });
  });

  it('fails closed on unknown citations, links, and unauthorized review decisions', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const source = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      inlineSource({ operationId: 'page-policy-source', content: 'Policy evidence' })
    );

    await expect(
      proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
        operationId: 'unknown-citation',
        pages: [pageCandidate('unknown-citation', 'knowledge_source_missing')],
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    await expect(
      proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
        operationId: 'unknown-link',
        pages: [
          pageCandidate('unknown-link', source.id, {
            links: ['missing-page'],
          }),
        ],
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    await expect(
      proposeAndApplyPages(service, WORKSPACE_ID, collection.id, AGENT, {
        operationId: 'agent-approval',
        pages: [
          pageCandidate('agent-approval', source.id, {
            reviewState: 'approved',
          }),
        ],
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(await service.listPages(WORKSPACE_ID, collection.id, ADMIN)).toEqual([]);
  });

  it('keeps ingestion dry-run, apply, retry, and reverse atomic and attributed', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const source = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      inlineSource({ operationId: 'proposal-source', content: 'Proposal evidence' })
    );
    const proposal = await service.createIngestionProposal(WORKSPACE_ID, collection.id, AGENT, {
      operationId: 'proposal-lifecycle',
      sourceIds: [source.id],
      pages: [
        pageCandidate('architecture', source.id, {
          links: ['decision-logging'],
        }),
        pageCandidate('decision-logging', source.id, {
          pageKind: 'decision',
        }),
      ],
    });

    expect(proposal).toMatchObject({
      state: 'dry-run',
      revision: 1,
      pageChanges: [
        expect.objectContaining({ action: 'create' }),
        expect.objectContaining({ action: 'create' }),
      ],
      activityChanges: [expect.objectContaining({ type: 'knowledge.ingestion.applied' })],
    });
    expect(proposal.indexChanges).toHaveLength(2);
    expect(await service.listPages(WORKSPACE_ID, collection.id, ADMIN)).toEqual([]);

    const applied = await service.applyIngestionProposal(
      WORKSPACE_ID,
      collection.id,
      proposal.id,
      ADMIN,
      { proposalDigest: proposal.digest }
    );
    const appliedRetry = await service.applyIngestionProposal(
      WORKSPACE_ID,
      collection.id,
      proposal.id,
      ADMIN,
      { proposalDigest: proposal.digest }
    );

    expect(applied).toMatchObject({ state: 'applied', revision: 2 });
    expect(appliedRetry).toEqual(applied);
    expect(await service.listPages(WORKSPACE_ID, collection.id, ADMIN)).toHaveLength(2);
    expect(await service.listKnowledgeActivity(WORKSPACE_ID, collection.id, ADMIN)).toEqual([
      expect.objectContaining({
        proposalId: proposal.id,
        type: 'knowledge.ingestion.applied',
        actorId: ADMIN.id,
      }),
    ]);

    const reversed = await service.reverseIngestionProposal(
      WORKSPACE_ID,
      collection.id,
      proposal.id,
      ADMIN,
      { proposalDigest: applied.digest }
    );
    const reversedRetry = await service.reverseIngestionProposal(
      WORKSPACE_ID,
      collection.id,
      proposal.id,
      ADMIN,
      { proposalDigest: applied.digest }
    );

    expect(reversed).toMatchObject({ state: 'reversed', revision: 3 });
    expect(reversedRetry).toEqual(reversed);
    expect(await service.listPages(WORKSPACE_ID, collection.id, ADMIN)).toEqual([]);
    expect(await service.listKnowledgeActivity(WORKSPACE_ID, collection.id, ADMIN)).toEqual([
      expect.objectContaining({ type: 'knowledge.ingestion.reversed' }),
      expect.objectContaining({ type: 'knowledge.ingestion.applied' }),
    ]);
  });

  it('detects stable-claim contradictions and reverses to the exact prior page', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const firstSource = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      inlineSource({ operationId: 'contradiction-source-1', content: 'Original evidence' })
    );
    const [original] = await proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
      operationId: 'original-derived-page',
      pages: [pageCandidate('architecture', firstSource.id)],
    });
    const secondSource = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      inlineSource({
        operationId: 'contradiction-source-2',
        content: 'Revised evidence',
      })
    );
    const proposal = await service.createIngestionProposal(WORKSPACE_ID, collection.id, AGENT, {
      operationId: 'contradictory-revision',
      sourceIds: [secondSource.id],
      pages: [
        pageCandidate('architecture', secondSource.id, {
          markdown: '# Architecture\n\nThe architecture changed.',
          claims: [
            {
              claimKey: 'supported-claim',
              text: 'The revised source supports a different architecture.',
              citations: [{ sourceId: secondSource.id }],
              confidence: 0.8,
            },
          ],
        }),
      ],
    });

    expect(proposal.contradictions).toEqual([
      expect.objectContaining({
        pageIdentity: 'architecture',
        claimKey: 'supported-claim',
        severity: 'warning',
        detectedBy: 'stable-claim-diff',
      }),
    ]);
    const applied = await service.applyIngestionProposal(
      WORKSPACE_ID,
      collection.id,
      proposal.id,
      ADMIN,
      { proposalDigest: proposal.digest }
    );
    await service.reverseIngestionProposal(WORKSPACE_ID, collection.id, proposal.id, ADMIN, {
      proposalDigest: applied.digest,
    });

    expect(await service.getPage(WORKSPACE_ID, collection.id, original.id, ADMIN)).toEqual(
      original
    );
  });

  it('rejects blocking, stale, and non-admin proposal application without partial changes', async () => {
    const service = await createService(storageType);
    const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
    const source = await service.registerSource(
      WORKSPACE_ID,
      collection.id,
      ADMIN,
      inlineSource({ operationId: 'blocked-proposal-source', content: 'Blocking evidence' })
    );
    const blocked = await service.createIngestionProposal(WORKSPACE_ID, collection.id, AGENT, {
      operationId: 'blocked-proposal',
      sourceIds: [source.id],
      pages: [pageCandidate('blocked-page', source.id)],
      contradictions: [
        {
          pageIdentity: 'blocked-page',
          description: 'The selected sources cannot be reconciled safely.',
          severity: 'blocking',
          sourceIds: [source.id],
        },
      ],
    });

    await expect(
      service.applyIngestionProposal(WORKSPACE_ID, collection.id, blocked.id, AGENT, {
        proposalDigest: blocked.digest,
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    await expect(
      service.applyIngestionProposal(WORKSPACE_ID, collection.id, blocked.id, ADMIN, {
        proposalDigest: blocked.digest,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(await service.listPages(WORKSPACE_ID, collection.id, ADMIN)).toEqual([]);

    const stale = await service.createIngestionProposal(WORKSPACE_ID, collection.id, AGENT, {
      operationId: 'stale-proposal',
      sourceIds: [source.id],
      pages: [pageCandidate('stale-page', source.id)],
    });
    await proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
      operationId: 'external-page-change',
      pages: [pageCandidate('stale-page', source.id, { markdown: '# External change' })],
    });
    const beforeApply = await service.listPages(WORKSPACE_ID, collection.id, ADMIN);

    await expect(
      service.applyIngestionProposal(WORKSPACE_ID, collection.id, stale.id, ADMIN, {
        proposalDigest: stale.digest,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(await service.listPages(WORKSPACE_ID, collection.id, ADMIN)).toEqual(beforeApply);
    expect(
      await service.getIngestionProposal(WORKSPACE_ID, collection.id, stale.id, ADMIN)
    ).toMatchObject({ state: 'dry-run', revision: 1 });
  });
});

it('fails closed when a file-backed source blob is corrupted', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'veritas-knowledge-corruption-'));
  const filePath = path.join(root, 'knowledge-collections.json');
  const service = new KnowledgeCollectionService({ storageType: 'file', filePath });
  cleanups.push(async () => {
    service.close();
    await rm(root, { recursive: true, force: true });
  });
  const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
  const source = await service.registerSource(
    WORKSPACE_ID,
    collection.id,
    ADMIN,
    inlineSource({ operationId: 'corrupt-me', content: 'Original' })
  );
  const state = JSON.parse(await readFile(filePath, 'utf8')) as {
    blobs: Record<string, string>;
  };
  state.blobs[source.contentHash] = Buffer.from('Tampered').toString('base64');
  await writeFile(filePath, JSON.stringify(state));

  await expect(
    service.readSourceContent(WORKSPACE_ID, collection.id, source.id, ADMIN)
  ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
});

it('upgrades a source-only SQLite database before applying ingestion proposals', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'veritas-knowledge-upgrade-'));
  const databasePath = path.join(root, 'knowledge.db');
  const sourceOnlyDatabase = new SqliteDatabase({
    databasePath,
    migrations: SQLITE_BASE_MIGRATIONS.filter((migration) => migration.version <= 30),
  });
  sourceOnlyDatabase.open();
  sourceOnlyDatabase.close();
  const service = new KnowledgeCollectionService({
    storageType: 'sqlite',
    sqliteConnectionOptions: { databasePath },
  });
  cleanups.push(async () => {
    service.close();
    await rm(root, { recursive: true, force: true });
  });
  const collection = await service.createCollection(WORKSPACE_ID, ADMIN, COLLECTION_INPUT);
  const source = await service.registerSource(
    WORKSPACE_ID,
    collection.id,
    ADMIN,
    inlineSource({ operationId: 'upgraded-page-source', content: 'Upgrade evidence' })
  );
  const [page] = await proposeAndApplyPages(service, WORKSPACE_ID, collection.id, ADMIN, {
    operationId: 'upgraded-derived-page',
    pages: [pageCandidate('upgrade-proof', source.id)],
  });
  const proposal = await service.createIngestionProposal(WORKSPACE_ID, collection.id, ADMIN, {
    operationId: 'upgraded-ingestion-proposal',
    sourceIds: [source.id],
    pages: [
      pageCandidate('upgrade-proof', source.id, {
        markdown: '# Upgrade proof\n\nApplied through migration 32.',
      }),
    ],
  });
  const applied = await service.applyIngestionProposal(
    WORKSPACE_ID,
    collection.id,
    proposal.id,
    ADMIN,
    { proposalDigest: proposal.digest }
  );

  expect(page.current.version).toBe(1);
  expect(applied.state).toBe('applied');
  expect(
    (await service.getPage(WORKSPACE_ID, collection.id, page.id, ADMIN))?.current.version
  ).toBe(2);
});

async function createService(
  storageType: 'file' | 'sqlite',
  qmdSearch: KnowledgeQmdSearchAdapter = {
    search: async () => {
      throw new Error('qmd unavailable');
    },
  }
): Promise<KnowledgeCollectionService> {
  const root = await mkdtemp(path.join(tmpdir(), `veritas-knowledge-${storageType}-`));
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 6, 25, 12, 0, tick++));
  const service =
    storageType === 'file'
      ? new KnowledgeCollectionService({
          storageType,
          filePath: path.join(root, 'knowledge-collections.json'),
          qmdSearch,
          now,
        })
      : new KnowledgeCollectionService({
          storageType,
          sqliteConnectionOptions: { databasePath: path.join(root, 'knowledge.db') },
          qmdSearch,
          now,
        });
  cleanups.push(async () => {
    service.close();
    await rm(root, { recursive: true, force: true });
  });
  return service;
}

async function proposeAndApplyPages(
  service: KnowledgeCollectionService,
  workspaceId: string,
  collectionId: string,
  actor: KnowledgeCollectionActor,
  input: UpsertKnowledgePagesInput
) {
  const sourceIds = [
    ...new Set(
      input.pages.flatMap((page) =>
        page.claims.flatMap((claim) => claim.citations.map((citation) => citation.sourceId))
      )
    ),
  ];
  const proposal = await service.createIngestionProposal(workspaceId, collectionId, actor, {
    ...input,
    sourceIds,
  });
  if (proposal.state === 'dry-run') {
    await service.applyIngestionProposal(workspaceId, collectionId, proposal.id, ADMIN, {
      proposalDigest: proposal.digest,
    });
  }
  return proposal.afterPages;
}

function inlineSource(
  overrides: Partial<RegisterKnowledgeSourceInput> &
    Pick<RegisterKnowledgeSourceInput, 'operationId'>
): RegisterKnowledgeSourceInput {
  return {
    operationId: overrides.operationId,
    sourceKey: 'product-readme',
    uri: 'repo://README.md',
    mediaType: 'text/markdown',
    title: 'Product README',
    owner: 'product',
    classification: 'internal',
    capturedAt: '2026-07-25T12:00:00.000Z',
    storage: 'content-addressed-blob',
    content: 'Default content',
    ...overrides,
  } as RegisterKnowledgeSourceInput;
}

function pageCandidate(
  stableKey: string,
  sourceId: string,
  overrides: Partial<UpsertKnowledgePageCandidate> = {}
): UpsertKnowledgePageCandidate {
  return {
    stableKey,
    title: stableKey
      .split('-')
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' '),
    pageKind: 'concept',
    aliases: [],
    tags: ['product'],
    metadata: { owner: 'product', reviewState: 'pending' },
    markdown: `# ${stableKey}\n\nSupported synthesis.`,
    claims: [
      {
        claimKey: 'supported-claim',
        text: 'The synthesis is supported by a registered source revision.',
        citations: [
          {
            sourceId,
            locator: { kind: 'line-range', startLine: 1, endLine: 1 },
          },
        ],
        confidence: 0.9,
      },
    ],
    links: [],
    reviewState: 'review-required',
    confidence: 0.85,
    ...overrides,
  };
}
