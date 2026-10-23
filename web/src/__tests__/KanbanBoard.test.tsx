/**
 * Tests for components/board/KanbanBoard.tsx — board rendering with mock data.
 * This tests the board's loading, error, and rendered states.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { KanbanBoard } from '@/components/board/KanbanBoard';
import { createMockTask, renderWithProviders } from './test-utils';
import { DEFAULT_FEATURE_SETTINGS, type FeatureSettings, type Task } from '@veritas-kanban/shared';
import type { FilterState } from '@/components/board/FilterBar';
import { DesktopShellProvider } from '@/components/layout/DesktopShellContext';
import { ViewProvider, useView } from '@/contexts/ViewContext';

// ── Mocks ────────────────────────────────────────────────────

const mockTasks: Task[] = [
  createMockTask({ id: 'k1', title: 'Todo Task', status: 'todo' }),
  createMockTask({ id: 'k2', title: 'In Progress Task', status: 'in-progress' }),
  createMockTask({ id: 'k3', title: 'Done Task', status: 'done' }),
];

let mockUseTasks: () => { data: Task[] | undefined; isLoading: boolean; error: Error | null };
let mockHistoryFilterControls = false;
let mockDragDropActiveTask: Task | null = null;
let mockDragDropMovePending = false;
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
  useBoardTasks: () => mockUseTasks(),
  useBoardSearch: () => ({ data: [], isFetching: false, error: null, refetch: vi.fn() }),
  useTask: (id: string) => ({ data: mockUseTasks().data?.find((task: Task) => task.id === id) }),
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
  useMoveTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/useBoardDragDrop', () => ({
  useBoardDragDrop: ({ tasksByStatus }: { tasksByStatus: Record<string, Task[]> }) => ({
    activeTask: mockDragDropActiveTask,
    isDragActive: mockDragDropActiveTask !== null,
    isMovePending: mockDragDropMovePending,
    liveTasksByStatus: tasksByStatus,
    sensors: [],
    collisionDetection: vi.fn(),
    announcements: {},
    screenReaderInstructions: {},
    handleDragStart: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
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

const keyboardRegistration = vi.hoisted(() => ({
  selectedTaskId: null,
  setTasks: vi.fn(),
  setOnOpenTask: vi.fn(),
  setOnMoveTask: vi.fn(),
}));
vi.mock('@/hooks/useKeyboard', () => ({ useKeyboard: () => keyboardRegistration }));

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
    dragEnabled,
    onTaskClick,
  }: {
    id: string;
    title: string;
    tasks: Task[];
    canChangeStatus?: boolean;
    dragEnabled?: boolean;
    onTaskClick?: (task: Task) => void;
  }) => (
    <div
      data-testid={`column-${id}`}
      data-can-change-status={String(canChangeStatus)}
      data-drag-enabled={String(dragEnabled)}
    >
      <h2>{title}</h2>
      {tasks.map((t: Task) => (
        <button
          type="button"
          key={t.id}
          data-testid={`task-${t.id}`}
          onClick={() => onTaskClick?.(t)}
        >
          {t.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/board/BoardLoadingSkeleton', () => ({
  BoardLoadingSkeleton: () => <div data-testid="loading-skeleton">Loading…</div>,
}));

vi.mock('@/components/task/TaskDetailPanel', () => ({
  TaskDetailPanel: ({
    task,
    open,
    onOpenChange,
  }: {
    task: Task | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open && task ? (
      <div role="dialog" aria-label={`Task details: ${task.title}`}>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close task details
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/board/FilterBar', async () => {
  const actual = await vi.importActual<typeof import('@/components/board/FilterBar')>(
    '@/components/board/FilterBar'
  );
  return {
    FilterBar: ({
      filters,
      onFiltersChange,
    }: {
      filters: FilterState;
      onFiltersChange: (filters: FilterState) => void;
    }) =>
      mockHistoryFilterControls ? (
        <button
          type="button"
          onClick={() => onFiltersChange({ ...filters, project: 'fixture-project' })}
        >
          Change history fixture filter
        </button>
      ) : null,
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
  TaskCard: ({
    task,
    dragEnabled,
    isDragActive,
  }: {
    task: Task;
    dragEnabled?: boolean;
    isDragActive?: boolean;
  }) => (
    <div
      data-testid="drag-preview-card"
      data-task-id={task.id}
      data-drag-enabled={String(dragEnabled)}
      data-drag-active={String(isDragActive)}
    />
  ),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dnd-overlay-layer">{children}</div>
  ),
  closestCorners: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(<KanbanBoard />, { queryClient });
}

function renderBoardWithView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <ViewProvider>
      <KanbanBoard />
    </ViewProvider>,
    { queryClient }
  );
}

function renderDesktopBoard() {
  Object.defineProperty(window, 'veritasDesktop', {
    configurable: true,
    value: {
      performTitlebarAction: vi.fn(),
    },
  });
  window.localStorage.setItem('veritas.desktop.rightRailOpen', 'false');
  document.documentElement.dataset.client = 'desktop';

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <DesktopShellProvider>
      <KanbanBoard />
    </DesktopShellProvider>,
    { queryClient }
  );
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockHistoryFilterControls = false;
  setOnline(true);
  delete (window as Window & { veritasDesktop?: unknown }).veritasDesktop;
  delete document.documentElement.dataset.client;
  window.localStorage.removeItem('veritas.desktop.rightRailOpen');
  mockFeatureSettingsResult = {
    isPlaceholderData: false,
    settings: createFeatureSettings(),
  };
  mockDragDropActiveTask = null;
  mockDragDropMovePending = false;
  document.documentElement.classList.remove('dark');
  window.history.replaceState({}, '', '/');
});

// ── Tests ────────────────────────────────────────────────────

describe('KanbanBoard', () => {
  it('removes task navigation and callbacks when the board unmounts', () => {
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    const view = renderBoard();
    expect(keyboardRegistration.setOnOpenTask).toHaveBeenLastCalledWith(expect.any(Function));
    expect(keyboardRegistration.setOnMoveTask).toHaveBeenLastCalledWith(expect.any(Function));
    view.unmount();
    expect(keyboardRegistration.setTasks).toHaveBeenLastCalledWith([]);
    expect(keyboardRegistration.setOnOpenTask).toHaveBeenLastCalledWith(null);
    expect(keyboardRegistration.setOnMoveTask).toHaveBeenLastCalledWith(null);
  });

  it('shows loading skeleton when data is loading', () => {
    mockUseTasks = () => ({ data: undefined, isLoading: true, error: null });
    renderBoard();
    expect(screen.getByTestId('loading-skeleton')).toBeDefined();
  });

  it('shows error message when fetching fails', () => {
    mockUseTasks = () => ({ data: undefined, isLoading: false, error: new Error('Network error') });
    renderBoard();
    expect(screen.getByText('Task sync unavailable')).toBeDefined();
    expect(screen.getByText('Network error')).toBeDefined();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Diagnostics/i })).toBeDefined();
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

  it('uses browser history to close a task back to the same Board state', async () => {
    const user = userEvent.setup();
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    renderBoardWithView();
    const boardState = window.history.state;

    await user.click(screen.getByTestId('task-k1'));

    expect(window.history.state.veritasTaskDetail).toBe('k1');
    expect(await screen.findByRole('dialog', { name: 'Task details: Todo Task' })).toBeDefined();

    vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState(boardState, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate', { state: boardState }));
    });
    await user.click(screen.getByRole('button', { name: 'Close task details' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Task details: Todo Task' })).toBeNull();
      expect(window.location.pathname).toBe('/');
    });
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

  it('collapses the board right rail in desktop mode by default', () => {
    mockUseTasks = () => ({ data: [], isLoading: false, error: null });
    renderDesktopBoard();

    expect(screen.getByTestId('column-todo')).toBeDefined();
    const rightRail = screen.getByLabelText('Board right sidebar');
    expect(rightRail.id).toBe('board-right-sidebar');
    expect(rightRail.hasAttribute('hidden')).toBe(true);
  });

  it('fits configured board columns across the desktop shell', () => {
    mockUseTasks = () => ({ data: [], isLoading: false, error: null });
    renderDesktopBoard();

    const columns = screen.getByRole('group', { name: 'Kanban columns' });
    expect(columns.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    expect(columns.closest('section')?.parentElement?.className).toContain('items-start');
  });

  it.each(['light', 'dark'])(
    'isolates one theme-token drag preview from board geometry in %s mode',
    (theme) => {
      if (theme === 'dark') document.documentElement.classList.add('dark');
      mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
      mockFeatureSettingsResult = {
        isPlaceholderData: false,
        settings: createFeatureSettings({ enableDragAndDrop: true }),
      };
      mockDragDropActiveTask = mockTasks[0];

      renderBoard();

      const grid = screen.getByRole('group', { name: 'Kanban columns' });
      const overlay = document.querySelector<HTMLElement>('[data-board-drag-overlay]');
      expect(overlay).not.toBeNull();
      expect(grid.contains(overlay)).toBe(false);
      expect(overlay?.className).toContain('pointer-events-none');
      expect(overlay?.className).toContain('h-full');
      expect(overlay?.className).toContain('w-full');
      expect(overlay?.className).toContain('bg-card');
      expect(overlay?.style.contain).toBe('layout paint');
      expect(screen.getAllByTestId('drag-preview-card')).toHaveLength(1);
      expect(screen.getByTestId('drag-preview-card').dataset.dragEnabled).toBe('false');
    }
  );

  it('disables task dragging while an authoritative move is pending', () => {
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    mockFeatureSettingsResult = {
      isPlaceholderData: false,
      settings: createFeatureSettings({ enableDragAndDrop: true }),
    };
    mockDragDropMovePending = true;

    renderBoard();

    expect(screen.getByTestId('column-todo').dataset.dragEnabled).toBe('false');
    expect(screen.getByTestId('column-done').dataset.dragEnabled).toBe('false');
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

function BoardSourceRouteHarness() {
  const { view, navigateToTask } = useView();
  return (
    <>
      <output data-testid="source-route-view">{view}</output>
      <button type="button" onClick={() => navigateToTask('k1')}>
        Open source task
      </button>
      {view === 'board' && <KanbanBoard />}
    </>
  );
}

for (const source of ['activity', 'evidence', 'workflows'])
  it(`preserves ${source} origin and scroll through the actual Board filter effect`, async () => {
    mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
    mockHistoryFilterControls = true;
    window.history.replaceState({}, '', `/${source}`);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithProviders(
      <div id="main-content">
        <ViewProvider>
          <BoardSourceRouteHarness />
        </ViewProvider>
      </div>,
      { queryClient }
    );
    const main = document.getElementById('main-content');
    if (!main) throw new Error('Missing scroll container');
    main.scrollTop = 420;
    fireEvent.scroll(main);
    await waitFor(() => expect(window.history.state.veritasKanbanNavigation.scrollTop).toBe(420));
    const originState = window.history.state;
    const push = vi.spyOn(window.history, 'pushState');
    await user.click(screen.getByRole('button', { name: 'Open source task' }));
    await screen.findByRole('dialog', { name: 'Task details: Todo Task' });
    expect(window.history.state.veritasTaskDetail).toBe('k1');
    expect(window.history.state.veritasKanbanNavigation.originView).toBe(source);
    const navigation = window.history.state.veritasKanbanNavigation;
    await user.click(screen.getByRole('button', { name: 'Change history fixture filter' }));
    expect(window.location.search).toBe('?project=fixture-project');
    expect(window.history.state.veritasTaskDetail).toBe('k1');
    expect(window.history.state.veritasKanbanNavigation).toEqual(navigation);
    expect(push).toHaveBeenCalledOnce();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.history.replaceState(originState, '', `/${source}`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: originState }));
    });
    await user.click(screen.getByRole('button', { name: 'Close task details' }));
    expect(back).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByTestId('source-route-view').textContent).toBe(source);
      expect(main.scrollTop).toBe(420);
    });
    expect(window.location.pathname).toBe(`/${source}`);
    expect(push).toHaveBeenCalledOnce();
  });

it('preserves unrelated and workflow history metadata for direct Board filters without pushing', async () => {
  mockUseTasks = () => ({ data: mockTasks, isLoading: false, error: null });
  mockHistoryFilterControls = true;
  const state = {
    veritasTaskDetail: 'k1',
    veritasTaskWorkflow: { id: 'workflow-fixture' },
    veritasWorkflowNavigation: { from: '/activity' },
    externalState: { retained: ['value'] },
  };
  window.history.replaceState(state, '', '/?q=existing');
  const push = vi.spyOn(window.history, 'pushState');
  renderBoard();
  expect(window.history.state).toEqual(state);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Change history fixture filter' }));
  expect(window.location.search).toContain('project=fixture-project');
  expect(window.history.state).toEqual(state);
  expect(push).not.toHaveBeenCalled();
});
