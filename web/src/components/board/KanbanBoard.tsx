import { useTasks, useTasksByStatus, useUpdateTask, useReorderTasks } from '@/hooks/useTasks';
import { useBoardDragDrop } from '@/hooks/useBoardDragDrop';
import { KanbanColumn } from './KanbanColumn';
import { BoardLoadingSkeleton } from './BoardLoadingSkeleton';
import {
  DEFAULT_FEATURE_SETTINGS,
  type BoardSavedView,
  type BoardColumnConfig,
  type TaskStatus,
  type Task,
  normalizeBoardColumns,
} from '@veritas-kanban/shared';
import { useFeatureSettings, useUpdateFeatureSettings } from '@/hooks/useFeatureSettings';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { TaskCard } from '@/components/task/TaskCard';
import { useKeyboard } from '@/hooks/useKeyboard';
import {
  FilterBar,
  type FilterState,
  filterTasks,
  filtersToSearchParams,
  searchParamsToFilters,
} from './FilterBar';
import { BulkActionsBar } from './BulkActionsBar';
import { useBulkActions } from '@/hooks/useBulkActions';
import {
  areBoardViewFiltersEqual,
  createBoardSavedView,
  deleteBoardSavedView,
  findBoardSavedViewByFilters,
  hasBoardFilterSearchParams,
  renameBoardSavedView,
  updateBoardSavedViewFilters,
} from '@/lib/board-saved-views';
import { CheckSquare } from 'lucide-react';
import { Button } from '@mantine/core';
import { ArchiveSuggestionBanner } from './ArchiveSuggestionBanner';
import FeatureErrorBoundary from '@/components/shared/FeatureErrorBoundary';
import { LazyOnVisible } from '@/components/shared/LazyOnVisible';
import { useLiveAnnouncer } from '@/components/shared/LiveAnnouncer';
import { useView } from '@/contexts/ViewContext';
import { useIdentity } from '@/hooks/useIdentity';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import type { TaskDetailNavigationTarget } from '@/components/task/TaskDetailPanel';

// Lazy-load Dashboard so board startup does not include dashboard-heavy code paths.
const Dashboard = lazy(() =>
  import('@/components/dashboard/Dashboard').then((mod) => ({
    default: mod.Dashboard,
  }))
);

const TaskDetailPanel = lazy(() =>
  import('@/components/task/TaskDetailPanel').then((mod) => ({
    default: mod.TaskDetailPanel,
  }))
);

const BoardSidebar = lazy(() =>
  import('./BoardSidebar').then((mod) => ({
    default: mod.BoardSidebar,
  }))
);

const EMPTY_SAVED_VIEWS: BoardSavedView[] = [];

export function KanbanBoard() {
  const { data: tasks, isLoading, error } = useTasks();
  const { settings: featureSettings, isPlaceholderData } = useFeatureSettings();
  const updateFeatureSettings = useUpdateFeatureSettings();
  const boardSettings = featureSettings.board ?? DEFAULT_FEATURE_SETTINGS.board;
  const columns = useMemo<BoardColumnConfig[]>(
    () => normalizeBoardColumns(boardSettings.columns),
    [boardSettings.columns]
  );
  const statusOptions = useMemo(
    () => columns.map((column) => ({ value: column.id, label: column.title })),
    [columns]
  );
  const savedViews = boardSettings.savedViews ?? EMPTY_SAVED_VIEWS;
  const defaultSavedViewId = boardSettings.defaultSavedViewId ?? null;
  const { announce } = useLiveAnnouncer();
  const { hasPermission } = useIdentity();
  const { isOnline } = useNetworkStatus();
  const canWriteTasks = hasPermission('task:write');
  const isMobileLayout = useMediaQuery('(max-width: 767px)', false);
  const canDragTasks =
    boardSettings.enableDragAndDrop && canWriteTasks && isOnline && !isMobileLayout;
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailPanelMounted, setDetailPanelMounted] = useState(false);
  const [detailNavigationTarget, setDetailNavigationTarget] =
    useState<TaskDetailNavigationTarget | null>(null);
  const defaultSavedViewAppliedRef = useRef(false);

  // Initialize filters from URL
  const [filters, setFilters] = useState<FilterState>(() => {
    if (typeof window !== 'undefined') {
      return searchParamsToFilters(new URLSearchParams(window.location.search));
    }
    return { search: '', project: null, type: null, agent: null };
  });
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(null);

  const { selectedTaskId, setTasks, setOnOpenTask, setOnMoveTask } = useKeyboard();
  const { isSelecting, toggleSelecting } = useBulkActions();
  const { pendingTaskId, pendingTaskTarget, clearPendingTask } = useView();

  const matchingSavedView = useMemo(
    () => findBoardSavedViewByFilters(savedViews, filters),
    [filters, savedViews]
  );
  const selectedSavedView = useMemo(
    () => savedViews.find((view) => view.id === selectedSavedViewId) ?? null,
    [savedViews, selectedSavedViewId]
  );
  const activeSavedView = selectedSavedView ?? matchingSavedView ?? null;
  const hasUnsavedSavedViewChanges = Boolean(
    selectedSavedView && !areBoardViewFiltersEqual(selectedSavedView.filters, filters)
  );

  const persistBoardSavedViews = useCallback(
    (nextSavedViews: BoardSavedView[], nextDefaultSavedViewId = defaultSavedViewId) => {
      updateFeatureSettings.mutate({
        board: {
          savedViews: nextSavedViews,
          defaultSavedViewId: nextDefaultSavedViewId,
        },
      });
    },
    [defaultSavedViewId, updateFeatureSettings]
  );

  const handleFiltersChange = useCallback(
    (nextFilters: FilterState) => {
      setFilters(nextFilters);
      const nextMatchingView = findBoardSavedViewByFilters(savedViews, nextFilters);
      if (nextMatchingView) {
        setSelectedSavedViewId(nextMatchingView.id);
      }
    },
    [savedViews]
  );

  const handleApplySavedView = useCallback(
    (viewId: string) => {
      const view = savedViews.find((savedView) => savedView.id === viewId);
      if (!view) return;
      setSelectedSavedViewId(view.id);
      setFilters({
        search: view.filters.search,
        project: view.filters.project,
        type: view.filters.type,
        agent: view.filters.agent,
      });
    },
    [savedViews]
  );

  const handleSaveSavedView = useCallback(
    (name: string) => {
      const view = createBoardSavedView({
        name,
        filters,
        existingIds: savedViews.map((savedView) => savedView.id),
      });
      persistBoardSavedViews([...savedViews, view]);
      setSelectedSavedViewId(view.id);
    },
    [filters, persistBoardSavedViews, savedViews]
  );

  const handleUpdateSavedView = useCallback(
    (viewId: string) => {
      persistBoardSavedViews(updateBoardSavedViewFilters(savedViews, viewId, filters));
      setSelectedSavedViewId(viewId);
    },
    [filters, persistBoardSavedViews, savedViews]
  );

  const handleRenameSavedView = useCallback(
    (viewId: string, name: string) => {
      persistBoardSavedViews(renameBoardSavedView(savedViews, viewId, name));
      setSelectedSavedViewId(viewId);
    },
    [persistBoardSavedViews, savedViews]
  );

  const handleDeleteSavedView = useCallback(
    (viewId: string) => {
      const result = deleteBoardSavedView(savedViews, defaultSavedViewId, viewId);
      persistBoardSavedViews(result.savedViews, result.defaultSavedViewId);
      if (selectedSavedViewId === viewId) {
        setSelectedSavedViewId(null);
      }
    },
    [defaultSavedViewId, persistBoardSavedViews, savedViews, selectedSavedViewId]
  );

  const handleSetDefaultSavedView = useCallback(
    (viewId: string | null) => {
      persistBoardSavedViews(savedViews, viewId);
    },
    [persistBoardSavedViews, savedViews]
  );

  useEffect(() => {
    if (selectedSavedViewId && !savedViews.some((view) => view.id === selectedSavedViewId)) {
      setSelectedSavedViewId(null);
    }
  }, [savedViews, selectedSavedViewId]);

  // Handle navigation from other views (e.g., Activity page clicking on a task)
  useEffect(() => {
    if (!pendingTaskId) return;

    const openPendingTask = async () => {
      // Try local task list first
      const localTask = tasks?.find((t) => t.id === pendingTaskId);
      if (localTask) {
        setDetailPanelMounted(true);
        setDetailNavigationTarget(pendingTaskTarget);
        setSelectedTask(localTask);
        setDetailOpen(true);
        clearPendingTask();
        return;
      }

      // Fallback: fetch from API (task may be archived or filtered out)
      try {
        const { api } = await import('@/lib/api');
        const fetchedTask = await api.tasks.get(pendingTaskId);
        if (fetchedTask) {
          setDetailPanelMounted(true);
          setDetailNavigationTarget(pendingTaskTarget);
          setSelectedTask(fetchedTask);
          setDetailOpen(true);
        }
      } catch {
        // Task no longer exists — ignore silently
      }
      clearPendingTask();
    };

    openPendingTask();
  }, [pendingTaskId, pendingTaskTarget, tasks, clearPendingTask]);

  // Apply the configured default saved view only when the current URL has no board filters.
  useEffect(() => {
    if (defaultSavedViewAppliedRef.current || isPlaceholderData) return;
    if (typeof window === 'undefined') {
      defaultSavedViewAppliedRef.current = true;
      return;
    }

    if (hasBoardFilterSearchParams(new URLSearchParams(window.location.search))) {
      defaultSavedViewAppliedRef.current = true;
      return;
    }

    if (!defaultSavedViewId) {
      defaultSavedViewAppliedRef.current = true;
      return;
    }

    const defaultView = savedViews.find((view) => view.id === defaultSavedViewId);
    if (!defaultView) {
      defaultSavedViewAppliedRef.current = true;
      return;
    }

    setSelectedSavedViewId(defaultView.id);
    setFilters({
      search: defaultView.filters.search,
      project: defaultView.filters.project,
      type: defaultView.filters.type,
      agent: defaultView.filters.agent,
    });
    defaultSavedViewAppliedRef.current = true;
  }, [defaultSavedViewId, isPlaceholderData, savedViews]);

  // Sync filters to URL
  useEffect(() => {
    const params = filtersToSearchParams(filters);
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }, [filters]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks ? filterTasks(tasks, filters) : [];
  }, [tasks, filters]);

  // Group filtered tasks by status
  const tasksByStatus = useTasksByStatus(filteredTasks, columns);

  // Register filtered tasks with keyboard context
  useEffect(() => {
    setTasks(filteredTasks);
  }, [filteredTasks, setTasks]);

  // Handler for opening a task
  const handleTaskClick = useCallback((task: Task, target?: TaskDetailNavigationTarget) => {
    setDetailPanelMounted(true);
    setDetailNavigationTarget(target ?? null);
    setSelectedTask(task);
    setDetailOpen(true);
  }, []);

  const handleTaskIdClick = useCallback(
    async (taskId: string, target?: TaskDetailNavigationTarget) => {
      const localTask = tasks?.find((t) => t.id === taskId);
      if (localTask) {
        handleTaskClick(localTask, target);
        return;
      }

      try {
        const { api } = await import('@/lib/api');
        const fetchedTask = await api.tasks.get(taskId);
        if (fetchedTask) {
          handleTaskClick(fetchedTask, target);
        }
      } catch {
        // Task no longer exists — ignore silently
      }
    },
    [handleTaskClick, tasks]
  );

  // Listen for open-task events from dashboard drill-downs
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const taskId = detail?.taskId;
      if (!taskId) return;
      const target: TaskDetailNavigationTarget = {
        tab: detail?.tab,
        timelineAttemptId: detail?.timelineAttemptId,
      };

      // Try local task list first
      const localTask = tasks?.find((t) => t.id === taskId);
      if (localTask) {
        setDetailPanelMounted(true);
        setDetailNavigationTarget(target);
        setSelectedTask(localTask);
        setDetailOpen(true);
        return;
      }

      // Fallback: fetch from API (task may be archived or filtered out)
      try {
        const { api } = await import('@/lib/api');
        const fetchedTask = await api.tasks.get(taskId);
        if (fetchedTask) {
          setDetailPanelMounted(true);
          setDetailNavigationTarget(target);
          setSelectedTask(fetchedTask);
          setDetailOpen(true);
        }
      } catch {
        // Task no longer exists — ignore silently
      }
    };
    window.addEventListener('open-task', handler);
    return () => window.removeEventListener('open-task', handler);
  }, [tasks]);

  const updateTask = useUpdateTask();
  const reorderTasks = useReorderTasks();

  // Handler for moving a task (with screen reader announcement)
  const handleMoveTask = useCallback(
    (taskId: string, status: TaskStatus) => {
      const task = filteredTasks.find((t) => t.id === taskId);
      const columnName = columns.find((c) => c.id === status)?.title || status;
      if (!canWriteTasks) {
        announce(`Task ${task?.title || taskId} cannot be moved with the current permissions`);
        return;
      }
      if (!isOnline) {
        announce(`Task ${task?.title || taskId} cannot be moved while this client is offline`);
        return;
      }
      updateTask.mutate({ id: taskId, input: { status } });
      announce(`Task ${task?.title || taskId} moved to ${columnName}`);
    },
    [announce, canWriteTasks, columns, filteredTasks, isOnline, updateTask]
  );

  // Register callbacks with keyboard context (refs, so no need for useEffect)
  setOnOpenTask(handleTaskClick);
  setOnMoveTask(handleMoveTask);

  // Drag and drop logic
  const {
    activeTask,
    isDragActive,
    liveTasksByStatus,
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useBoardDragDrop({
    tasks: filteredTasks,
    tasksByStatus,
    columns,
    onStatusChange: (taskId, status) => {
      if (!canWriteTasks || !isOnline) return;
      updateTask.mutate({ id: taskId, input: { status } });
    },
    onReorder: (taskIds) => {
      if (!canWriteTasks || !isOnline) return;
      reorderTasks.mutate(taskIds);
    },
  });

  const handleDetailClose = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      // Small delay to allow animation to complete
      setTimeout(() => setSelectedTask(null), 200);
    }
  };

  // Keep selected task in sync with updated data
  const currentSelectedTask = selectedTask
    ? tasks?.find((t) => t.id === selectedTask.id) || selectedTask
    : null;

  if (isLoading) {
    return <BoardLoadingSkeleton columns={columns} />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96" role="alert">
        <div className="text-center space-y-2">
          <div className="text-destructive font-medium">Error loading tasks</div>
          <div className="text-sm text-muted-foreground">{error.message}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <FilterBar
          tasks={tasks || []}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          savedViews={savedViews}
          selectedSavedViewId={activeSavedView?.id ?? null}
          defaultSavedViewId={defaultSavedViewId}
          hasUnsavedSavedViewChanges={hasUnsavedSavedViewChanges}
          isSavingSavedView={updateFeatureSettings.isPending}
          onApplySavedView={handleApplySavedView}
          onClearSelectedSavedView={() => setSelectedSavedViewId(null)}
          onSaveSavedView={handleSaveSavedView}
          onUpdateSavedView={handleUpdateSavedView}
          onRenameSavedView={handleRenameSavedView}
          onDeleteSavedView={handleDeleteSavedView}
          onSetDefaultSavedView={handleSetDefaultSavedView}
        />
        {!isSelecting && (
          <Button
            variant="subtle"
            size="sm"
            onClick={toggleSelecting}
            disabled={!canWriteTasks}
            title={canWriteTasks ? 'Select tasks' : 'Task write permission required'}
            className="min-h-8 shrink-0 self-start text-muted-foreground sm:self-auto"
            leftSection={<CheckSquare className="h-4 w-4" aria-hidden="true" />}
          >
            Select
          </Button>
        )}
      </div>

      <BulkActionsBar tasks={filteredTasks} />

      {boardSettings.showArchiveSuggestions && <ArchiveSuggestionBanner />}

      <FeatureErrorBoundary fallbackTitle="Board failed to render">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <section
            id="mobile-board-columns"
            className="min-w-0 xl:col-span-4"
            aria-label={`Kanban board, ${filteredTasks.length} tasks`}
          >
            {canDragTasks ? (
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              >
                <div
                  className="grid grid-cols-1 gap-4 md:grid-cols-2"
                  style={
                    isMobileLayout
                      ? undefined
                      : { gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }
                  }
                  role="group"
                  aria-label="Kanban columns"
                >
                  {columns.map((column) => (
                    <KanbanColumn
                      key={column.id}
                      id={column.id}
                      title={column.title}
                      tasks={liveTasksByStatus[column.id] ?? []}
                      allTasks={filteredTasks}
                      onTaskClick={handleTaskClick}
                      onTaskStatusChange={handleMoveTask}
                      selectedTaskId={selectedTaskId}
                      canChangeStatus={canWriteTasks && isOnline}
                      dragEnabled={canDragTasks}
                      isDragActive={isDragActive}
                      statusOptions={statusOptions}
                    />
                  ))}
                </div>

                <DragOverlay>
                  {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <div
                className="grid grid-cols-1 gap-4 md:grid-cols-2"
                style={
                  isMobileLayout
                    ? undefined
                    : { gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }
                }
                role="group"
                aria-label="Kanban columns"
              >
                {columns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    id={column.id}
                    title={column.title}
                    tasks={tasksByStatus[column.id] ?? []}
                    allTasks={filteredTasks}
                    onTaskClick={handleTaskClick}
                    onTaskStatusChange={handleMoveTask}
                    selectedTaskId={selectedTaskId}
                    canChangeStatus={canWriteTasks && isOnline}
                    dragEnabled={false}
                    showStatusControls={isMobileLayout}
                    statusOptions={statusOptions}
                  />
                ))}
              </div>
            )}
          </section>

          <Suspense
            fallback={
              <aside className="min-h-24 rounded-md border border-dashed border-border/70" />
            }
          >
            <BoardSidebar
              onTaskClick={(taskId) => {
                void handleTaskIdClick(taskId);
              }}
            />
          </Suspense>
        </div>

        {boardSettings.showDashboard && (
          <LazyOnVisible
            className="mt-6 border-t pt-4"
            fallback={<DashboardLoadingFallback />}
            minHeight={192}
            rootMargin="0px 0px"
          >
            <Suspense fallback={<DashboardLoadingFallback />}>
              <Dashboard
                onTaskClick={(taskId, target) => {
                  void handleTaskIdClick(taskId, target);
                }}
              />
            </Suspense>
          </LazyOnVisible>
        )}
      </FeatureErrorBoundary>

      {detailPanelMounted && (
        <Suspense fallback={null}>
          <TaskDetailPanel
            task={currentSelectedTask}
            open={detailOpen}
            onOpenChange={handleDetailClose}
            readOnly={!canWriteTasks}
            navigationTarget={detailNavigationTarget}
          />
        </Suspense>
      )}
    </>
  );
}

function DashboardLoadingFallback() {
  return (
    <div
      className="flex min-h-48 items-center justify-center py-8 text-muted-foreground"
      role="status"
    >
      Loading dashboard…
    </div>
  );
}
