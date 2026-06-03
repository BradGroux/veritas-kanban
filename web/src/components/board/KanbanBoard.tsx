import { useTasks, useTasksByStatus, useUpdateTask, useReorderTasks } from '@/hooks/useTasks';
import { useBoardDragDrop } from '@/hooks/useBoardDragDrop';
import { KanbanColumn } from './KanbanColumn';
import { BoardLoadingSkeleton } from './BoardLoadingSkeleton';
import type { TaskStatus, Task } from '@veritas-kanban/shared';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
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
import { BoardSidebar } from './BoardSidebar';
import { useBulkActions } from '@/hooks/useBulkActions';
import { CheckSquare } from 'lucide-react';
import { Button } from '@mantine/core';
import { ArchiveSuggestionBanner } from './ArchiveSuggestionBanner';
import FeatureErrorBoundary from '@/components/shared/FeatureErrorBoundary';
import { useLiveAnnouncer } from '@/components/shared/LiveAnnouncer';
import { useView } from '@/contexts/ViewContext';
import { useIdentity } from '@/hooks/useIdentity';
import type { TaskDetailNavigationTarget } from '@/components/task/TaskDetailPanel';

// Lazy-load Dashboard to split recharts + d3 (~800KB) out of main bundle
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

const COLUMNS: { id: TaskStatus; title: string }[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'blocked', title: 'Blocked' },
  { id: 'done', title: 'Done' },
];

const STATUS_OPTIONS = COLUMNS.map((column) => ({ value: column.id, label: column.title }));

export function KanbanBoard() {
  const { data: tasks, isLoading, error } = useTasks();
  const { settings: featureSettings } = useFeatureSettings();
  const { announce } = useLiveAnnouncer();
  const { hasPermission } = useIdentity();
  const canWriteTasks = hasPermission('task:write');
  const isMobileLayout = useMediaQuery('(max-width: 767px)', false);
  const canDragTasks = featureSettings.board.enableDragAndDrop && canWriteTasks && !isMobileLayout;
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailPanelMounted, setDetailPanelMounted] = useState(false);
  const [detailNavigationTarget, setDetailNavigationTarget] =
    useState<TaskDetailNavigationTarget | null>(null);

  // Initialize filters from URL
  const [filters, setFilters] = useState<FilterState>(() => {
    if (typeof window !== 'undefined') {
      return searchParamsToFilters(new URLSearchParams(window.location.search));
    }
    return { search: '', project: null, type: null, agent: null };
  });

  const { selectedTaskId, setTasks, setOnOpenTask, setOnMoveTask } = useKeyboard();
  const { isSelecting, toggleSelecting } = useBulkActions();
  const { pendingTaskId, pendingTaskTarget, clearPendingTask } = useView();

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
  const tasksByStatus = useTasksByStatus(filteredTasks);

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
      const columnName = COLUMNS.find((c) => c.id === status)?.title || status;
      if (!canWriteTasks) {
        announce(`Task ${task?.title || taskId} cannot be moved with the current permissions`);
        return;
      }
      updateTask.mutate({ id: taskId, input: { status } });
      announce(`Task ${task?.title || taskId} moved to ${columnName}`);
    },
    [announce, canWriteTasks, filteredTasks, updateTask]
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
    columns: COLUMNS,
    onStatusChange: (taskId, status) => {
      if (!canWriteTasks) return;
      updateTask.mutate({ id: taskId, input: { status } });
    },
    onReorder: (taskIds) => {
      if (!canWriteTasks) return;
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
    return <BoardLoadingSkeleton columns={COLUMNS} />;
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
        <FilterBar tasks={tasks || []} filters={filters} onFiltersChange={setFilters} />
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

      {featureSettings.board.showArchiveSuggestions && <ArchiveSuggestionBanner />}

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
                  className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
                  role="group"
                  aria-label="Kanban columns"
                >
                  {COLUMNS.map((column) => (
                    <KanbanColumn
                      key={column.id}
                      id={column.id}
                      title={column.title}
                      tasks={liveTasksByStatus[column.id]}
                      allTasks={filteredTasks}
                      onTaskClick={handleTaskClick}
                      onTaskStatusChange={handleMoveTask}
                      selectedTaskId={selectedTaskId}
                      canChangeStatus={canWriteTasks}
                      dragEnabled={canDragTasks}
                      isDragActive={isDragActive}
                      statusOptions={STATUS_OPTIONS}
                    />
                  ))}
                </div>

                <DragOverlay>
                  {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <div
                className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
                role="group"
                aria-label="Kanban columns"
              >
                {COLUMNS.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    id={column.id}
                    title={column.title}
                    tasks={tasksByStatus[column.id]}
                    allTasks={filteredTasks}
                    onTaskClick={handleTaskClick}
                    onTaskStatusChange={handleMoveTask}
                    selectedTaskId={selectedTaskId}
                    canChangeStatus={canWriteTasks}
                    dragEnabled={false}
                    showStatusControls={isMobileLayout}
                    statusOptions={STATUS_OPTIONS}
                  />
                ))}
              </div>
            )}
          </section>

          <BoardSidebar
            onTaskClick={(taskId) => {
              void handleTaskIdClick(taskId);
            }}
          />
        </div>

        {featureSettings.board.showDashboard && (
          <Suspense
            fallback={
              <div
                className="mt-6 border-t pt-4 flex items-center justify-center py-8 text-muted-foreground"
                role="status"
              >
                Loading dashboard…
              </div>
            }
          >
            <div className="mt-6 border-t pt-4">
              <Dashboard
                onTaskClick={(taskId, target) => {
                  void handleTaskIdClick(taskId, target);
                }}
              />
            </div>
          </Suspense>
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
