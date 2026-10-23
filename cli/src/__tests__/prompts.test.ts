import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PromptTemplate } from '@veritas-kanban/shared';
import { runPromptTemplateImport } from '../commands/prompts.js';

interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeTemplate(
  input: Partial<PromptTemplate> & Pick<PromptTemplate, 'id' | 'name' | 'content'>
): PromptTemplate {
  return {
    category: 'agent',
    variables: [],
    created: '2026-06-04T08:00:00.000Z',
    updated: '2026-06-04T08:00:00.000Z',
    currentVersionId: `${input.id}_v1`,
    ...input,
  };
}

function promptRegistryFetch(initialTemplates: PromptTemplate[] = []) {
  const templates = [...initialTemplates];
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === '/api/prompt-registry' && method === 'GET') {
      return jsonResponse(templates);
    }

    if (url.pathname === '/api/prompt-registry' && method === 'POST') {
      templates.push(makeTemplate(body as PromptTemplate));
      return jsonResponse(templates.at(-1), 201);
    }

    const patchMatch = url.pathname.match(/^\/api\/prompt-registry\/([^/]+)$/);
    if (patchMatch && method === 'PATCH') {
      const id = patchMatch[1] as string;
      const index = templates.findIndex((template) => template.id === id);
      if (index === -1) return jsonResponse({ error: 'Template not found' }, 404);
      templates[index] = {
        ...templates[index],
        ...(body as Partial<PromptTemplate>),
        updated: '2026-06-04T08:05:00.000Z',
      };
      return jsonResponse(templates[index]);
    }

    return jsonResponse({ error: `No fixture for ${method} ${url.pathname}` }, 404);
  }) as unknown as typeof fetch;

  return { fetch: fetchMock, calls, templates };
}

describe('vk prompts import', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vk-prompts-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('plans filename-derived templates deterministically in dry-run mode', async () => {
    await writeFile(
      path.join(tmpDir, 'worker-handoff.md'),
      '# Worker Handoff\n\nHello {{agent_name}}.',
      'utf-8'
    );
    await writeFile(path.join(tmpDir, 'README.md'), '# Registry docs', 'utf-8');
    const api = promptRegistryFetch();

    const report = await runPromptTemplateImport(
      {
        sourceDir: tmpDir,
        apiBase: 'http://vk.test',
        dryRun: true,
      },
      { fetch: api.fetch, env: {} }
    );

    expect(report.counts).toMatchObject({ total: 1, created: 1, updated: 0, unchanged: 0 });
    expect(report.items).toEqual([
      {
        status: 'created',
        file: 'worker-handoff.md',
        id: 'worker-handoff',
        name: 'Worker Handoff',
      },
    ]);
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/prompt-registry',
    ]);
  });

  it('creates templates with stable frontmatter IDs when not dry-running', async () => {
    await writeFile(
      path.join(tmpDir, 'implementation.md'),
      [
        '---',
        'id: implementation-checklist',
        'name: Implementation Checklist',
        'category: agent',
        'description: Focused implementation checklist',
        '---',
        '# Ignored Heading',
        '',
        'Implement and verify {{task_id}}.',
      ].join('\n'),
      'utf-8'
    );
    const api = promptRegistryFetch();

    const report = await runPromptTemplateImport(
      {
        sourceDir: tmpDir,
        apiBase: 'http://vk.test',
      },
      { fetch: api.fetch, env: {} }
    );

    expect(report.counts).toMatchObject({ created: 1, updated: 0, conflict: 0, malformed: 0 });
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/prompt-registry',
      'POST /api/prompt-registry',
    ]);
    expect(api.calls[1]?.body).toMatchObject({
      id: 'implementation-checklist',
      name: 'Implementation Checklist',
      category: 'agent',
      description: 'Focused implementation checklist',
      content: '# Ignored Heading\n\nImplement and verify {{task_id}}.',
    });
  });

  it('reports runtime drift as a conflict unless force mode is enabled', async () => {
    await writeFile(
      path.join(tmpDir, 'bug-triage.md'),
      '# Bug Triage\n\nNew content for {{issue}}.',
      'utf-8'
    );
    const existing = makeTemplate({
      id: 'bug-triage',
      name: 'Bug Triage',
      content: '# Bug Triage\n\nOld content for {{issue}}.',
    });

    const conflict = await runPromptTemplateImport(
      {
        sourceDir: tmpDir,
        apiBase: 'http://vk.test',
        dryRun: true,
      },
      { fetch: promptRegistryFetch([existing]).fetch, env: {} }
    );

    expect(conflict.counts).toMatchObject({ conflict: 1, updated: 0 });
    expect(conflict.items[0]).toMatchObject({
      status: 'conflict',
      id: 'bug-triage',
      changedFields: ['content'],
    });

    const api = promptRegistryFetch([existing]);
    const forced = await runPromptTemplateImport(
      {
        sourceDir: tmpDir,
        apiBase: 'http://vk.test',
        force: true,
      },
      { fetch: api.fetch, env: {} }
    );

    expect(forced.counts).toMatchObject({ conflict: 0, updated: 1 });
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/prompt-registry',
      'PATCH /api/prompt-registry/bug-triage',
    ]);
    expect(api.calls[1]?.body).toMatchObject({
      content: '# Bug Triage\n\nNew content for {{issue}}.',
      changelog: 'Sync from bug-triage.md',
    });
  });

  it('reports unchanged, malformed frontmatter, and name conflicts without writes', async () => {
    await writeFile(path.join(tmpDir, 'same.md'), '# Same Prompt\n\nSame body.', 'utf-8');
    await writeFile(path.join(tmpDir, 'bad.md'), '---\nid bad\n---\nBad body.', 'utf-8');
    await writeFile(path.join(tmpDir, 'duplicate.md'), '# Existing Prompt\n\nNew body.', 'utf-8');
    const api = promptRegistryFetch([
      makeTemplate({
        id: 'same',
        name: 'Same Prompt',
        content: '# Same Prompt\n\nSame body.',
      }),
      makeTemplate({
        id: 'runtime-existing',
        name: 'Existing Prompt',
        content: '# Existing Prompt\n\nRuntime body.',
      }),
    ]);

    const report = await runPromptTemplateImport(
      {
        sourceDir: tmpDir,
        apiBase: 'http://vk.test',
      },
      { fetch: api.fetch, env: {} }
    );

    expect(report.counts).toMatchObject({
      total: 3,
      unchanged: 1,
      malformed: 1,
      conflict: 1,
      created: 0,
      updated: 0,
    });
    expect(report.items.map((item) => item.status).sort()).toEqual([
      'conflict',
      'malformed',
      'unchanged',
    ]);
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/prompt-registry',
    ]);
  });
});
