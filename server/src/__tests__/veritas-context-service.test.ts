import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VeritasContextService } from '../services/veritas-context-service.js';

const searchMock = vi.hoisted(() => vi.fn());

vi.mock('../services/search-service.js', () => ({
  getSearchService: () => ({
    search: searchMock,
  }),
}));

describe('VeritasContextService', () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it('formats retrieved tasks and docs as a compact context block', async () => {
    searchMock.mockResolvedValue({
      query: 'task_1 duplicate search',
      backend: 'qmd',
      degraded: false,
      elapsedMs: 5,
      results: [
        {
          id: 'tasks/active/task_1.md',
          title: 'Duplicate task search',
          path: 'tasks/active/task_1.md',
          collection: 'tasks-active',
          snippet: 'Find similar tasks before creating new work.',
          score: 0.91,
        },
      ],
    });

    const result = await new VeritasContextService().buildContext({
      taskId: 'task_1',
      message: 'duplicate search',
    });

    expect(searchMock).toHaveBeenCalledWith({
      query: 'task_1 duplicate search',
      backend: 'auto',
      collections: ['tasks-active', 'tasks-archive', 'docs'],
      limit: 4,
    });
    expect(result.contextBlock).toContain('<veritas_context>');
    expect(result.contextBlock).toContain('Duplicate task search');
    expect(result.contextBlock).toContain('tasks/active/task_1.md');
  });

  it('returns empty context when retrieval has no matches', async () => {
    searchMock.mockResolvedValue({
      query: 'nothing',
      backend: 'keyword',
      degraded: false,
      elapsedMs: 1,
      results: [],
    });

    const result = await new VeritasContextService().buildContext({ message: 'nothing' });

    expect(result.contextBlock).toBe('');
    expect(result.results).toEqual([]);
  });
});
