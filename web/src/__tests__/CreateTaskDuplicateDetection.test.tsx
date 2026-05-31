import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { api } from '@/lib/api';
import { renderWithProviders } from './test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    search: {
      query: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/useTaskTypes', () => ({
  useTaskTypes: () => ({
    data: [{ id: 'code', label: 'Code', icon: 'Code', order: 0, created: '', updated: '' }],
  }),
  getTypeIcon: () => null,
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ data: [] }),
}));

vi.mock('@/hooks/useSprints', () => ({
  useSprints: () => ({ data: [] }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: { agents: [] } }),
}));

vi.mock('@/hooks/useTemplateForm', () => ({
  useTemplateForm: () => ({
    selectedTemplate: null,
    templates: [],
    subtasks: [],
    customVars: {},
    requiredCustomVars: [],
    applyTemplate: vi.fn(),
    clearTemplate: vi.fn(),
    removeSubtask: vi.fn(),
    setCustomVars: vi.fn(),
    createTasks: vi.fn(),
    isCreating: false,
  }),
}));

const navigateToTaskMock = vi.fn();

vi.mock('@/contexts/ViewContext', () => ({
  useView: () => ({
    navigateToTask: navigateToTaskMock,
  }),
}));

const queryMock = vi.mocked(api.search.query);

describe('CreateTaskDialog duplicate detection', () => {
  beforeEach(() => {
    queryMock.mockReset();
    navigateToTaskMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows likely duplicates without blocking task creation', async () => {
    queryMock.mockResolvedValue({
      query: 'Search duplicate',
      backend: 'keyword',
      degraded: false,
      elapsedMs: 3,
      results: [
        {
          id: 'tasks/active/task_20260504_match-search-duplicate.md',
          title: 'Existing Search Duplicate',
          path: 'tasks/active/task_20260504_match-search-duplicate.md',
          collection: 'tasks-active',
          snippet: 'Already covers duplicate detection.',
          score: 5,
        },
      ],
    });

    const onOpenChange = vi.fn();
    renderWithProviders(<CreateTaskDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Search duplicate' },
    });

    await waitFor(() => expect(queryMock).toHaveBeenCalledTimes(1));
    expect(queryMock).toHaveBeenCalledWith({
      query: 'Search duplicate',
      backend: 'auto',
      collections: ['tasks-active', 'tasks-archive'],
      limit: 5,
    });
    expect(await screen.findByText('Existing Search Duplicate')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: /^create task$/i }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('opens a duplicate result for inspection', async () => {
    queryMock.mockResolvedValue({
      query: 'Search duplicate',
      backend: 'keyword',
      degraded: false,
      elapsedMs: 3,
      results: [
        {
          id: 'tasks/archive/task_20260504_match-search-duplicate.md',
          title: 'Archived Search Duplicate',
          path: 'tasks/archive/task_20260504_match-search-duplicate.md',
          collection: 'tasks-archive',
          snippet: '',
          score: 4,
        },
      ],
    });

    const onOpenChange = vi.fn();
    renderWithProviders(<CreateTaskDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Search duplicate' },
    });

    fireEvent.click(await screen.findByText('Archived Search Duplicate'));

    expect(navigateToTaskMock).toHaveBeenCalledWith('task_20260504_match');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
