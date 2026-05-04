import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SearchService } from '../services/search-service.js';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
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
  });

  afterEach(async () => {
    process.env = oldEnv;
    await fs.rm(root, { recursive: true, force: true });
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

    const result = await new SearchService().search({ query: 'semantic search' });

    expect(result.backend).toBe('qmd');
    expect(result.degraded).toBe(false);
    expect(result.results[0]).toMatchObject({
      title: 'Semantic search',
      score: 0.92,
      collection: 'tasks-active',
    });
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
