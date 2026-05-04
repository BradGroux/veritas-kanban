import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchDialog, extractTaskId } from '@/components/search';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    search: {
      query: vi.fn(),
    },
  },
}));

const queryMock = vi.mocked(api.search.query);

describe('SearchDialog', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('extracts task ids from task markdown paths', () => {
    expect(extractTaskId('tasks/active/task_20260504_abc123-build-search.md')).toBe(
      'task_20260504_abc123'
    );
    expect(extractTaskId('docs/features/qmd-search.md')).toBeNull();
  });

  it('searches selected collections and renders fallback status', async () => {
    queryMock.mockResolvedValue({
      query: 'qmd',
      backend: 'keyword',
      degraded: true,
      reason: 'qmd unavailable',
      elapsedMs: 4,
      results: [
        {
          id: 'tasks/active/task_20260504_abc123-build-search.md',
          title: 'Build search UI',
          path: 'tasks/active/task_20260504_abc123-build-search.md',
          collection: 'tasks-active',
          snippet: 'Search active tasks, archive, and docs.',
          score: 4,
        },
      ],
    });

    render(<SearchDialog open onOpenChange={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/search task titles/i), 'qmd');
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(queryMock).toHaveBeenCalledTimes(1));
    expect(queryMock).toHaveBeenCalledWith({
      query: 'qmd',
      backend: 'auto',
      collections: ['tasks-active', 'tasks-archive', 'docs'],
      limit: 12,
    });
    expect(await screen.findByText('Build search UI')).toBeDefined();
    expect(screen.getByText('Fallback')).toBeDefined();
    expect(screen.getByText('qmd unavailable')).toBeDefined();
  });

  it('opens task results through the supplied navigation callback', async () => {
    const onTaskOpen = vi.fn();
    const onOpenChange = vi.fn();
    queryMock.mockResolvedValue({
      query: 'task',
      backend: 'keyword',
      degraded: false,
      elapsedMs: 2,
      results: [
        {
          id: 'tasks/active/task_20260504_abc123-build-search.md',
          title: 'Build search UI',
          path: 'tasks/active/task_20260504_abc123-build-search.md',
          collection: 'tasks-active',
          snippet: '',
          score: 2,
        },
      ],
    });

    render(<SearchDialog open onOpenChange={onOpenChange} onTaskOpen={onTaskOpen} />);

    await userEvent.type(screen.getByPlaceholderText(/search task titles/i), 'task');
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    fireEvent.click(await screen.findByText('Build search UI'));

    expect(onTaskOpen).toHaveBeenCalledWith('task_20260504_abc123');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
