/**
 * Tests for components/board/KanbanBoard.tsx — board rendering with mock data.
 * This tests the board's loading, error, and rendered states.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/board/KanbanBoard';
import { createMockTask, renderWithProviders } from './test-utils';
import { DEFAULT_FEATURE_SETTINGS, type FeatureSettings, type Task } from '@veritas-kanban/shared';

// ── Mocks ────────────────────────────────────────────────────

const mockTasks: Task[] = [
  createMockTask({ id: 'k1', title: 'Todo Task', status: 'todo' }),
  createMockTask({ id: 'k2', title: 'In Progress Task', status: 'in-progress' }),
  createMockTask({ id: 'k3', title: 'Done Task', status: 'done' }),
];

let mockUseTasks: () => { data: Task[] | undefined; isLoading: boolean; error: Error | null };
let mockFeatureSettingsResult: { isPlaceholderData: boolean; settings: FeatureSettings } = {
  isPlaceholderData: false,
  settings: createFeatureSettings(),
};

function createFeatureSettings(
  boardOverrides: Partial<FeatureSettings['board']> = {}
): FeatureSettings {
  return {
    ...DEFAULT_FEATURE_SETTINGS,
    board: {
      ...DEFAULT_FEATURE_SETTINGS.board,
      enableDragAndDrop: false,
      showDashboard: false,
      showArchiveSuggestions: false,
      showDoneMetrics: false,
      ...boardOverrides,
    },
  };
}

vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => mockUseTasks(),
  useTasksByStatus: (tasks: Task[], columns?: Array<{ id: string }>) => {
    const result: Record<string, Task[]> = Object.fromEntries(
      (columns ?? [{ id: 'todo' }, { id: 'in-progress' }, { id: 'blocked' }, { id: 'done' }]).map(
        (column) => [column.id, [] as Task[]]
      )
    );
    for (const t of tasks) {
      if (result[t.status]) result[t.status].push(t);
    }
    return result;
  },
  useUpdateTask: () => ({ mutate: vi.fn() }),
  useReorderTasks: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/hooks/useBoardDragDrop', () => ({
  useBoardDragDrop: () => ({
    activeTask: null,
    sensors: [],
    handleDragStart: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragEnd: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAgentStatus', () => ({
  useRealtimeAgentStatus: () => ({
    status: 'idle',
    subAgentCount: 0,
    activeAgents: [],
    lastUpdated: new Date().toISOString(),
    isConnected: true,
    isStale: false,
  }),
}));

vi.mock('@/hooks/useKeyboard', () => ({
  useKeyboard: () => ({
    selectedTaskId: null,
    setTasks: vi.fn(),
    setOnOpenTask: vi.fn(),
    setOnMoveTask: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => mockFeatureSettingsResult,
  useUpdateFeatureSettings: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/hooks/useBulkActions', () => ({
  useBulkActions: () => ({
    isSelecting: false,
    toggleSelect: vi.fn(),
    toggleGroup: vi.fn(),
    isSelected: () => false,
    selectedIds: new Set(),
  }),
}));

vi.mock('@/contexts/TaskConfigContext', () => ({
  useTaskConfig: () => ({
    taskTypes: [
      { id: 'feature', label: 'Feature', icon: 'Code', order: 0, created: '', updated: '' },
    ],
    projects: [],
    sprints: [],
    isLoading: false,
  }),
}));

// Mock KanbanColumn to simplify — just renders task titles
vi.mock('@/components/board/KanbanColumn', () => ({
  KanbanColumn: ({
    id,
    title,
    tasks,
    canChangeStatus,
  }: {
    id: string;
    title: string;
    tasks: Task[];
    canChangeStatus?: boolean;
  }) => (
    <div data-testid={`column-${id}`} data-can-change-status={String(canChangeStatus)}>
      <h2>{title}</h2>
      {tasks.map((t: Task) => (
        <div key={t.id} data-testid={`task-${t.id}`}>
          {t.title}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/board/BoardLoadingSkeleton', () => ({
  BoardLoadingSkeleton: () => <div data-testid="loading-skeleton">Loading…</div>,
}));

vi.mock('@/components/task/TaskDetailPanel', () => ({
  TaskDetailPanel: () => null,
}));

vi.mock('@/components/board/FilterBar', async () => {
  const actual = await vi.importActual<typeof import('@/components/board/FilterBar')>(
    '@/components/board/FilterBar'
  );
  return {
    FilterBar: () => null,
    filterTasks: actual.filterTasks,
    filtersToSearchParams: actual.filtersToSearchParams,
    searchParamsToFilters: actual.searchParamsToFilters,
  };
});

vi.mock('@/components/board/BulkActionsBar', () => ({
  BulkActionsBar: () => null,
}));

vi.mock('@/components/board/ArchiveSuggestionBanner', () => ({
  ArchiveSuggestionBanner: () => null,
}));

vi.mock('@/components/shared/FeatureErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/shared/LiveAnnouncer', () => ({
  useLiveAnnouncer: () => ({ announce: vi.fn() }),
}));

vi.mock('@/components/task/TaskCard', () => ({
  TaskCard: () => null,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: () => null,
  closestCorners: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(<KanbanBoard />, { queryClient });
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  cleanup();
  setOnline(true);
  mockFeatureSettingsResult = {
    isPlaceholderData: false,
    settings: createFeatureSettings(),
  };
  window.history.replaceState({}, '', '/');
});

// ── Tests ────────────────────────────────────────────────────

describe('KanbanBoard', () => {
  it('shows loading skeleton when data is loading', () => {
    mockUseTasks = () => ({ data: undefined, isLoading: true, error: null });
    renderBoard();
    expect(screen.getByTestId('loading-skeleton')).toBeDefined();
  });

  it('shows error message when fetching fails', () => {
    mockUseTasks = () => ({ data: undefined, isLoading: false, error: new Error('Network error') });
    renderBoard();
    expect(screen.getByText('Error loading tasks')).toBeDefined();
    expect(screen.getByText('Network error')).toBeDefined();
  });

  it('renders four columns when data is available', () => {
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    renderBoard();

    expect(screen.getByTestId('column-todo')).toBeDefined();
    expect(screen.getByTestId('column-in-progress')).toBeDefined();
    expect(screen.getByTestId('column-blocked')).toBeDefined();
    expect(screen.getByTestId('column-done')).toBeDefined();
  });

  it('distributes tasks to correct columns', () => {
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    renderBoard();

    expect(screen.getByTestId('task-k1')).toBeDefined();
    expect(screen.getByTestId('task-k2')).toBeDefined();
    expect(screen.getByTestId('task-k3')).toBeDefined();
  });

  it('renders column titles', () => {
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    renderBoard();

    expect(screen.getAllByText('To Do').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
  });

  it('renders configured custom board columns', () => {
    mockUseTasks = () => ({
      data: [
        createMockTask({ id: 'k-custom', title: 'Ready Task', status: 'ready' }),
        ...mockTasks,
      ],
      isLoading: false,
      error: null,
    });
    mockFeatureSettingsResult = {
      isPlaceholderData: false,
      settings: createFeatureSettings({
        columns: [
          { id: 'triage', title: 'Triage' },
          { id: 'ready', title: 'Ready' },
          { id: 'done', title: 'Done' },
        ],
        defaultStatus: 'triage',
      }),
    };

    renderBoard();

    expect(screen.getByTestId('column-triage')).toBeDefined();
    expect(screen.getByTestId('column-ready')).toBeDefined();
    expect(screen.getByTestId('task-k-custom')).toBeDefined();
  });

  it('renders empty board when no tasks', () => {
    mockUseTasks = () => ({ data: [], isLoading: false, error: null });
    renderBoard();

    // Columns should still exist
    expect(screen.getByTestId('column-todo')).toBeDefined();
    expect(screen.getByTestId('column-done')).toBeDefined();
  });

  it('disables explicit status changes while the browser is offline', () => {
    setOnline(false);
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });

    renderBoard();

    expect(screen.getByTestId('column-todo').dataset.canChangeStatus).toBe('false');
    expect(screen.getByTestId('column-in-progress').dataset.canChangeStatus).toBe('false');
  });

  it('applies the default saved view when no board filters are in the URL', async () => {
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    mockFeatureSettingsResult = {
      isPlaceholderData: false,
      settings: createFeatureSettings({
        savedViews: [
          {
            id: 'view-review',
            name: 'Review Queue',
            filters: { search: 'review', project: 'veritas', type: null, agent: null },
            createdAt: '2026-06-03T12:00:00.000Z',
            updatedAt: '2026-06-03T12:00:00.000Z',
          },
        ],
        defaultSavedViewId: 'view-review',
      }),
    };

    renderBoard();

    await waitFor(() => {
      expect(window.location.search).toBe('?q=review&project=veritas');
    });
  });

  it('keeps explicit URL filters instead of applying the default saved view', async () => {
    window.history.replaceState({}, '', '/?q=existing');
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    mockFeatureSettingsResult = {
      isPlaceholderData: false,
      settings: createFeatureSettings({
        savedViews: [
          {
            id: 'view-review',
            name: 'Review Queue',
            filters: { search: 'review', project: 'veritas', type: null, agent: null },
            createdAt: '2026-06-03T12:00:00.000Z',
            updatedAt: '2026-06-03T12:00:00.000Z',
          },
        ],
        defaultSavedViewId: 'view-review',
      }),
    };

    renderBoard();

    await waitFor(() => {
      expect(window.location.search).toBe('?q=existing');
    });
  });
});
