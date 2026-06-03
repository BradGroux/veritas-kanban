import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchDialog, extractTaskId } from '@/components/search';
import { api } from '@/lib/api';
import { renderWithProviders } from './test-utils';

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
        {
          id: 'wp-search-brief',
          title: 'Search implementation brief',
          path: '/work-products/wp-search-brief',
          collection: 'work-products',
          snippet: 'Durable work product with evidence and follow-up notes.',
          score: 3,
        },
      ],
    });

    const { baseElement } = renderWithProviders(<SearchDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Universal Search' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Search Veritas' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Search backend' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Active' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Work Products' })).toBeDefined();
    expect(baseElement.querySelector('.mantine-Modal-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Select-root')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Checkbox-root').length).toBe(16);
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="checkbox"]')).toBeNull();

    await userEvent.type(screen.getByPlaceholderText(/search tasks/i), 'qmd');
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(queryMock).toHaveBeenCalledTimes(1));
    expect(queryMock).toHaveBeenCalledWith({
      query: 'qmd',
      backend: 'auto',
      collections: [
        'tasks-active',
        'tasks-archive',
        'tasks-backlog',
        'docs',
        'prompts',
        'work-products',
        'workflows',
        'workflow-runs',
        'policies',
        'decisions',
        'settings',
        'logs-diagnostics',
        'agent-runs',
        'notifications',
        'maintenance',
        'scheduled-runs',
      ],
      limit: 20,
    });
    expect(await screen.findByText('Build search UI')).toBeDefined();
    expect(await screen.findByText('Search implementation brief')).toBeDefined();
    expect(screen.getByText('/work-products/wp-search-brief')).toBeDefined();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Work Products').length).toBeGreaterThan(0);
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

    renderWithProviders(<SearchDialog open onOpenChange={onOpenChange} onTaskOpen={onTaskOpen} />);

    await userEvent.type(screen.getByPlaceholderText(/search tasks/i), 'task');
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    fireEvent.click(await screen.findByText('Build search UI'));

    expect(onTaskOpen).toHaveBeenCalledWith('task_20260504_abc123', undefined);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens settings results through the supplied settings callback', async () => {
    const onSettingsOpen = vi.fn();
    const onOpenChange = vi.fn();
    queryMock.mockResolvedValue({
      query: 'security',
      backend: 'keyword',
      degraded: false,
      elapsedMs: 2,
      results: [
        {
          id: 'settings-security',
          title: 'Security Settings',
          path: '/settings/security',
          collection: 'settings',
          snippet: 'API access and authentication.',
          score: 4,
          metadata: {
            target: {
              type: 'settings',
              section: 'security',
              href: '/settings/security',
            },
            actions: [
              {
                id: 'open-settings',
                label: 'Open settings',
                target: {
                  type: 'settings',
                  section: 'security',
                  href: '/settings/security',
                },
              },
            ],
          },
        },
      ],
    });

    renderWithProviders(
      <SearchDialog open onOpenChange={onOpenChange} onSettingsOpen={onSettingsOpen} />
    );

    await userEvent.type(screen.getByPlaceholderText(/search tasks/i), 'security');
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    fireEvent.click(await screen.findByText('Security Settings'));

    expect(onSettingsOpen).toHaveBeenCalledWith('security');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
