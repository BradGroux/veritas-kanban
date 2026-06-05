import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar, type FilterState } from '@/components/board/FilterBar';
import { BulkActionsBar } from '@/components/board/BulkActionsBar';
import {
  createMockProject,
  createMockTask,
  createMockTaskType,
  renderWithProviders,
} from './test-utils';
import type { AgentConfig, AgentType, BoardSavedView } from '@veritas-kanban/shared';

const agents: AgentConfig[] = [
  {
    type: 'codex' as AgentType,
    name: 'Codex',
    command: 'codex',
    args: ['exec'],
    enabled: true,
    provider: 'codex-cli',
  },
];

const mocks = vi.hoisted(() => ({
  bulkArchiveByIds: vi.fn(),
  bulkDemote: vi.fn(),
  bulkUpdate: vi.fn(),
  clearSelection: vi.fn(),
  deleteTask: vi.fn(),
  selectAll: vi.fn(),
  toast: vi.fn(),
  toggleGroup: vi.fn(),
  toggleSelecting: vi.fn(),
  useBulkActions: vi.fn(),
  useConfig: vi.fn(),
  useProjects: vi.fn(),
  useTaskTypes: vi.fn(),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: mocks.useConfig,
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: mocks.useProjects,
}));

vi.mock('@/hooks/useTaskTypes', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useTaskTypes')>('@/hooks/useTaskTypes');
  return {
    ...actual,
    useTaskTypes: mocks.useTaskTypes,
  };
});

vi.mock('@/hooks/useBulkActions', () => ({
  useBulkActions: mocks.useBulkActions,
}));

vi.mock('@/hooks/useTasks', () => ({
  useBulkArchiveByIds: () => ({
    mutateAsync: mocks.bulkArchiveByIds,
  }),
  useBulkUpdate: () => ({
    mutateAsync: mocks.bulkUpdate,
  }),
  useDeleteTask: () => ({
    mutateAsync: mocks.deleteTask,
  }),
}));

vi.mock('@/hooks/useBacklog', () => ({
  useBulkDemote: () => ({
    mutateAsync: mocks.bulkDemote,
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function defaultFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    search: '',
    project: null,
    type: null,
    agent: null,
    ...overrides,
  };
}

describe('Board chrome Mantine migration', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    mocks.useProjects.mockReturnValue({
      data: [createMockProject({ id: 'veritas', label: 'Veritas' })],
      isLoading: false,
    });
    mocks.useTaskTypes.mockReturnValue({
      data: [createMockTaskType({ id: 'feature', label: 'Feature', icon: 'Code' })],
      isLoading: false,
    });
    mocks.useConfig.mockReturnValue({
      data: { agents },
      isLoading: false,
    });
    mocks.bulkArchiveByIds.mockResolvedValue({ archived: ['VK-1'], failed: [] });
    mocks.bulkDemote.mockResolvedValue({ demoted: ['VK-1'], failed: [] });
    mocks.bulkUpdate.mockResolvedValue({ updated: ['VK-1'], failed: [] });
    mocks.deleteTask.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders board filters through direct Mantine primitives', () => {
    const onFiltersChange = vi.fn();
    const { container } = renderWithProviders(
      <FilterBar
        tasks={[]}
        filters={defaultFilters({
          search: 'docs',
          project: 'veritas',
          type: 'feature',
          agent: 'codex',
        })}
        onFiltersChange={onFiltersChange}
      />
    );

    expect(screen.getByRole('search', { name: 'Filter tasks' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Search tasks' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Filter by project' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Filter by type' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Filter by agent' })).toBeDefined();
    expect(screen.getByText('4 active filters')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Select-root').length).toBe(3);
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(container.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(container.querySelector('[data-slot="input"]')).toBeNull();
    expect(container.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
    expect(container.querySelector('[data-slot="button"]')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), {
      target: { value: 'release' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'release',
        project: 'veritas',
        type: 'feature',
        agent: 'codex',
      })
    );
    expect(onFiltersChange).toHaveBeenCalledWith({
      search: '',
      project: null,
      type: null,
      agent: null,
    });
  });

  it('manages saved board views through Mantine primitives', () => {
    const savedView: BoardSavedView = {
      id: 'view-review',
      name: 'Review Queue',
      filters: defaultFilters({ search: 'review' }),
      createdAt: '2026-06-03T12:00:00.000Z',
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    const onApplySavedView = vi.fn();
    const onSaveSavedView = vi.fn();
    const onUpdateSavedView = vi.fn();
    const onRenameSavedView = vi.fn();
    const onDeleteSavedView = vi.fn();
    const onSetDefaultSavedView = vi.fn();

    const { baseElement } = renderWithProviders(
      <FilterBar
        tasks={[]}
        filters={defaultFilters({ search: 'review', project: 'veritas' })}
        onFiltersChange={vi.fn()}
        savedViews={[savedView]}
        selectedSavedViewId={savedView.id}
        hasUnsavedSavedViewChanges
        onApplySavedView={onApplySavedView}
        onSaveSavedView={onSaveSavedView}
        onUpdateSavedView={onUpdateSavedView}
        onRenameSavedView={onRenameSavedView}
        onDeleteSavedView={onDeleteSavedView}
        onSetDefaultSavedView={onSetDefaultSavedView}
      />
    );

    expect(screen.getByRole('combobox', { name: 'Saved board view' })).toBeDefined();
    expect(screen.getByText('Modified')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Select-root').length).toBe(4);

    fireEvent.click(screen.getByRole('button', { name: 'Update saved view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set saved view as default' }));

    expect(onUpdateSavedView).toHaveBeenCalledWith('view-review');
    expect(onSetDefaultSavedView).toHaveBeenCalledWith('view-review');

    fireEvent.click(screen.getByRole('button', { name: 'Rename saved view' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: 'Review Focus' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onRenameSavedView).toHaveBeenCalledWith('view-review', 'Review Focus');

    fireEvent.click(screen.getByRole('button', { name: 'Delete saved view' }));
    expect(screen.getByText('Delete saved view?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDeleteSavedView).toHaveBeenCalledWith('view-review');

    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'View name' }), {
      target: { value: 'Project Bugs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSaveSavedView).toHaveBeenCalledWith('Project Bugs');
    expect(onApplySavedView).not.toHaveBeenCalled();
  });

  it('applies a saved board view from the saved view selector', async () => {
    const user = userEvent.setup();
    const savedView: BoardSavedView = {
      id: 'view-review',
      name: 'Review Queue',
      filters: defaultFilters({ search: 'review' }),
      createdAt: '2026-06-03T12:00:00.000Z',
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    const onApplySavedView = vi.fn();

    renderWithProviders(
      <FilterBar
        tasks={[]}
        filters={defaultFilters()}
        onFiltersChange={vi.fn()}
        savedViews={[savedView]}
        onSaveSavedView={vi.fn()}
        onApplySavedView={onApplySavedView}
      />
    );

    await user.click(screen.getByRole('combobox', { name: 'Saved board view' }));
    await user.click(screen.getByRole('option', { name: 'Review Queue' }));

    expect(onApplySavedView).toHaveBeenCalledWith('view-review');
  });

  it('renders bulk selection actions through direct Mantine primitives', () => {
    mocks.useBulkActions.mockReturnValue({
      selectedIds: new Set(['VK-1']),
      isSelecting: true,
      toggleSelecting: mocks.toggleSelecting,
      toggleSelect: vi.fn(),
      selectAll: mocks.selectAll,
      toggleGroup: mocks.toggleGroup,
      clearSelection: mocks.clearSelection,
      isSelected: (id: string) => id === 'VK-1',
    });

    const tasks = [
      createMockTask({ id: 'VK-1', status: 'todo', title: 'Selected todo' }),
      createMockTask({ id: 'VK-2', status: 'done', title: 'Completed task' }),
    ];

    const { baseElement, container } = renderWithProviders(<BulkActionsBar tasks={tasks} />);

    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Exit selection mode' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Select all tasks' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Move selected tasks to status' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'To Backlog' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined();
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Select all tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all To Do tasks (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mocks.selectAll).toHaveBeenCalledWith(['VK-1', 'VK-2']);
    expect(mocks.toggleGroup).toHaveBeenCalledWith(['VK-1']);
    expect(screen.getByText('Delete 1 task?')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Modal-root')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete 1 task?')).toBeNull();
  });
});
