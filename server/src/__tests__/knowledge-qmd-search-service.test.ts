import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { KnowledgePage } from '@veritas-kanban/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import { KnowledgeQmdSearchService } from '../services/knowledge-qmd-search-service.js';
import { KnowledgeQmdProjectionStore } from '../storage/knowledge-qmd-projection-store.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  execFileMock.mockReset();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('KnowledgeQmdSearchService', () => {
  it('materializes an excluded scoped collection, refreshes changed pages, and reuses it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'veritas-knowledge-qmd-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const page = knowledgePage();
    let showCalls = 0;
    execFileMock.mockImplementation(
      (
        _binary: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout?: string) => void
      ) => {
        if (args[0] === 'collection' && args[1] === 'show' && showCalls++ === 0) {
          callback(new Error('collection missing'));
          return;
        }
        if (args[0] === 'query') {
          callback(
            null,
            JSON.stringify([
              {
                file: `qmd://${String(args.at(-1))}/${page.id}.md`,
                snippet: 'QMD gateway result',
                score: 0.93,
              },
            ])
          );
          return;
        }
        callback(null, '');
      }
    );
    const service = new KnowledgeQmdSearchService(
      new KnowledgeQmdProjectionStore(path.join(root, 'knowledge-qmd'))
    );

    const first = await service.search({
      workspaceId: 'workspace-a',
      collectionId: 'collection-a',
      query: 'gateway',
      limit: 5,
      pages: [page],
    });
    const second = await service.search({
      workspaceId: 'workspace-a',
      collectionId: 'collection-a',
      query: 'gateway',
      limit: 5,
      pages: [page],
    });

    expect(first).toEqual([{ pageId: page.id, snippet: 'QMD gateway result', score: 0.93 }]);
    expect(second).toEqual(first);
    const calls = execFileMock.mock.calls.map((call) => call[1] as string[]);
    expect(calls.filter((args) => args[0] === 'collection' && args[1] === 'add')).toHaveLength(1);
    expect(calls.filter((args) => args[0] === 'collection' && args[1] === 'exclude')).toHaveLength(
      1
    );
    expect(calls.filter((args) => args[0] === 'update')).toHaveLength(1);
    expect(calls.filter((args) => args[0] === 'query')).toEqual([
      expect.arrayContaining(['-c']),
      expect.arrayContaining(['-c']),
    ]);
    const addCall = calls.find((args) => args[0] === 'collection' && args[1] === 'add');
    const projectionPath = addCall?.[2] ?? '';
    expect(await readFile(path.join(projectionPath, `${page.id}.md`), 'utf8')).toContain(
      '# Gateway architecture'
    );
  });
});

function knowledgePage(): KnowledgePage {
  return {
    schemaVersion: 'knowledge-page/v1',
    id: 'knowledge_page_0123456789abcdef',
    workspaceId: 'workspace-a',
    collectionId: 'collection-a',
    stableKey: 'gateway-architecture',
    current: {
      schemaVersion: 'knowledge-page-revision/v1',
      version: 1,
      title: 'Gateway architecture',
      pageKind: 'concept',
      aliases: [],
      tags: ['gateway'],
      metadata: { owner: 'product' },
      markdown: '# Gateway architecture\n\nReviewed dispatch.',
      contentHash: `sha256:${'a'.repeat(64)}`,
      claims: [
        {
          id: 'knowledge_claim_0123456789abcdef',
          claimKey: 'reviewed-dispatch',
          text: 'Dispatch is reviewed.',
          citations: [{ sourceId: 'knowledge_source_0123456789abcdef' }],
          confidence: 0.9,
        },
      ],
      outgoingPageIds: [],
      backlinkPageIds: [],
      reviewState: 'approved',
      confidence: 0.9,
      operationIdDigest: `sha256:${'b'.repeat(64)}`,
      requestDigest: `sha256:${'c'.repeat(64)}`,
      updatedBy: 'operator-1',
      updatedAt: '2026-07-26T12:00:00.000Z',
      digest: `sha256:${'d'.repeat(64)}`,
    },
    history: [],
    createdBy: 'operator-1',
    createdAt: '2026-07-26T12:00:00.000Z',
    digest: `sha256:${'e'.repeat(64)}`,
  };
}
