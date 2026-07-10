import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AnyTelemetryEvent } from '@veritas-kanban/shared';
import { SearchService } from '../services/search-service.js';

const execFileMock = vi.hoisted(() => vi.fn());
const telemetryEventsMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({
    getEvents: telemetryEventsMock,
  }),
}));

describe('SearchService', () => {
  let root: string;
  let oldEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    oldEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-search-'));
    await fs.mkdir(path.join(root, 'tasks', 'active'), { recursive: true });
    await fs.mkdir(path.join(root, 'tasks', 'archive'), { recursive: true });
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    process.env.VERITAS_SEARCH_ROOT = root;
    process.env.VERITAS_SEARCH_BACKEND = 'keyword';
    execFileMock.mockReset();
    telemetryEventsMock.mockReset();
    telemetryEventsMock.mockResolvedValue([]);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    process.env = oldEnv;
  });

  it('searches task and docs markdown with keyword fallback', async () => {
    await fs.writeFile(
      path.join(root, 'tasks', 'active', 'task_1.md'),
      '# Add semantic search\n\nWire QMD retrieval into Veritas.',
      'utf-8'
    );
    await fs.writeFile(
      path.join(root, 'docs', 'search.md'),
      '# Search Guide\n\nQMD setup notes.',
      'utf-8'
    );

    const result = await new SearchService().search({ query: 'QMD retrieval', limit: 5 });

    expect(result.backend).toBe('keyword');
    expect(result.degraded).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].path).toContain('tasks/active/task_1.md');
  });

  it('searches expanded local collections with redacted snippets and targets', async () => {
    await fs.mkdir(path.join(root, 'tasks', 'backlog'), { recursive: true });
    await fs.mkdir(path.join(root, 'prompt-registry'), { recursive: true });
    await fs.mkdir(path.join(root, '.veritas-kanban', 'logs'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'tasks', 'backlog', 'task_20260601_abc123-recovery.md'),
      '# Recovery task\n\nInvestigate recovery flow.',
      'utf-8'
    );
    await fs.writeFile(
      path.join(root, 'prompt-registry', 'recovery.md'),
      '# Recovery Prompt\n\nUse this prompt for recovery handoffs.',
      'utf-8'
    );
    await fs.writeFile(
      path.join(root, '.veritas-kanban', 'logs', 'server.log'),
      'recovery failed token=super-secret-value',
      'utf-8'
    );

    const result = await new SearchService().search({
      query: 'recovery',
      collections: ['tasks-backlog', 'prompts', 'logs-diagnostics'],
      limit: 10,
    });

    expect(result.results.map((item) => item.collection)).toEqual(
      expect.arrayContaining(['tasks-backlog', 'prompts', 'logs-diagnostics'])
    );
    expect(
      result.results.find((item) => item.collection === 'tasks-backlog')?.metadata?.target
    ).toMatchObject({
      type: 'task',
      taskId: 'task_20260601_abc123',
    });
    expect(result.results.find((item) => item.collection === 'logs-diagnostics')?.snippet).toBe(
      'recovery failed token: [redacted]'
    );
  });

  it('falls back to keyword search when qmd fails', async () => {
    process.env.VERITAS_SEARCH_BACKEND = 'qmd';
    execFileMock.mockImplementation((_bin, _args, _options, callback) => {
      callback(new Error('qmd not found'), '', '');
    });
    await fs.writeFile(path.join(root, 'docs', 'qmd.md'), '# QMD\n\nlocal retrieval', 'utf-8');

    const result = await new SearchService().search({ query: 'retrieval', limit: 5 });

    expect(result.backend).toBe('keyword');
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain('qmd not found');
    expect(result.results[0].path).toContain('docs/qmd.md');
  });

  it('normalizes qmd json results', async () => {
    process.env.VERITAS_SEARCH_BACKEND = 'qmd';
    execFileMock.mockImplementation((_bin, _args, _options, callback) => {
      callback(
        null,
        JSON.stringify({
          results: [
            {
              path: 'tasks/active/task_1.md',
              title: 'Semantic search',
              snippet: 'QMD result',
              score: 0.92,
              collection: 'tasks-active',
            },
          ],
        }),
        ''
      );
    });

    const result = await new SearchService().search({
      query: 'semantic search',
      collections: ['tasks-active'],
    });

    expect(result.backend).toBe('qmd');
    expect(result.degraded).toBe(false);
    expect(result.results[0]).toMatchObject({
      title: 'Semantic search',
      score: 0.92,
      collection: 'tasks-active',
    });
  });

  it('searches telemetry events as agent run results with timeline targets', async () => {
    const telemetryEvents: AnyTelemetryEvent[] = [
      {
        id: 'evt-error-1',
        type: 'run.error',
        timestamp: '2026-06-04T18:00:00.000Z',
        taskId: 'task_20260604_search',
        project: 'veritas',
        agent: 'codex',
        attemptId: 'attempt-search-1',
        error: 'Playwright login failed token=super-secret-value',
        stackTrace: 'Error: Playwright login failed',
      },
      {
        id: 'evt-tokens-1',
        type: 'run.tokens',
        timestamp: '2026-06-04T18:01:00.000Z',
        taskId: 'task_20260604_search',
        project: 'veritas',
        agent: 'codex',
        attemptId: 'attempt-search-1',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    ];
    telemetryEventsMock.mockResolvedValue(telemetryEvents);

    const result = await new SearchService().search({
      query: 'playwright login',
      collections: ['agent-runs'],
      limit: 5,
    });

    expect(telemetryEventsMock).toHaveBeenCalledWith({ limit: 250 });
    expect(result.results[0]).toMatchObject({
      id: 'telemetry:evt-error-1',
      title: 'codex run.error for task_20260604_search',
      collection: 'agent-runs',
      metadata: {
        source: 'telemetry-event',
        eventId: 'evt-error-1',
        eventType: 'run.error',
        taskId: 'task_20260604_search',
        agent: 'codex',
        attemptId: 'attempt-search-1',
        target: {
          type: 'task',
          taskId: 'task_20260604_search',
          tab: 'timeline',
          timelineAttemptId: 'attempt-search-1',
          timelineEventId: 'evt-error-1',
        },
      },
    });
    expect(result.results[0].snippet).toContain('Playwright login failed');
    expect(result.results[0].snippet).toContain('token: [redacted]');
    expect(result.results[0].snippet).not.toContain('super-secret-value');
  });

  it('refreshes qmd index and embeddings', async () => {
    execFileMock.mockImplementation((_bin, _args, _options, callback) => {
      callback(null, '', '');
    });

    const result = await new SearchService().refreshIndex();

    expect(result).toMatchObject({
      backend: 'qmd',
      updated: true,
      embedded: true,
      commands: ['update', 'embed'],
    });
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'qmd',
      ['update'],
      expect.objectContaining({ cwd: root }),
      expect.any(Function)
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'qmd',
      ['embed'],
      expect.objectContaining({ cwd: root }),
      expect.any(Function)
    );
  });

  it('can refresh qmd index without embedding', async () => {
    execFileMock.mockImplementation((_bin, _args, _options, callback) => {
      callback(null, '', '');
    });

    const result = await new SearchService().refreshIndex({ embed: false });

    expect(result.embedded).toBe(false);
    expect(result.commands).toEqual(['update']);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
