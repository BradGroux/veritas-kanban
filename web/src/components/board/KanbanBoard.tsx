import { useTasks, useTasksByStatus, useUpdateTask, useReorderTasks } from '@/hooks/useTasks';
import { useBoardDragDrop } from '@/hooks/useBoardDragDrop';
import { KanbanColumn } from './KanbanColumn';
import { BoardLoadingSkeleton } from './BoardLoadingSkeleton';
import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import type { TaskStatus, Task } from '@veritas-kanban/shared';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { DndContext, DragOverlay } from '@dnd-kit/core';
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
import { ArchiveSuggestionBanner } from './ArchiveSuggestionBanner';
import FeatureErrorBoundary from '@/components/shared/FeatureErrorBoundary';
import { useLiveAnnouncer } from '@/components/shared/LiveAnnouncer';

// Lazy-load DashboardSection to split recharts + d3 (~800KB) out of main bundle
const DashboardSection = lazy(() =>
  import('@/components/dashboard/DashboardSection').then((mod) => ({
    default: mod.DashboardSection,
  }))
);

const COLUMNS: { id: TaskStatus; title: string }[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'planning', title: 'Planning' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'blocked', title: 'Blocked' },
  { id: 'done', title: 'Done' },
];

export function KanbanBoard() {
  const { data: tasks, isLoading, error } = useTasks();
  const { settings: featureSettings } = useFeatureSettings();
  const { announce } = useLiveAnnouncer();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Initialize filters from URL
  const [filters, setFilters] = useState<FilterState>(() => {
    if (typeof window !== 'undefined') {
      return searchParamsToFilters(new URLSearchParams(window.location.search));
    }
    return { search: '', project: null, type: null, agent: null };
  });

  const { selectedTaskId, setTasks, setOnOpenTask, setOnMoveTask } = useKeyboard();

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
  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task);
    setDetailOpen(true);
  }, []);

  // Listen for open-task events from dashboard drill-downs
  useEffect(() => {
    const handler = async (e: Event) => {
      const taskId = (e as CustomEvent).detail?.taskId;
      if (!taskId) return;

      // Try local task list first
      const localTask = tasks?.find((t) => t.id === taskId);
      if (localTask) {
        setSelectedTask(localTask);
        setDetailOpen(true);
        return;
      }

      // Fallback: fetch from API (task may be archived or filtered out)
      try {
        const { api } = await import('@/lib/api');
        const fetchedTask = await api.tasks.get(taskId);
        if (fetchedTask) {
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
      updateTask.mutate({ id: taskId, input: { status } });
      announce(`Task ${task?.title || taskId} moved to ${columnName}`);
    },
    [updateTask, filteredTasks, announce]
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
      updateTask.mutate({ id: taskId, input: { status } });
    },
    onReorder: (taskIds) => {
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
      <FilterBar tasks={tasks || []} filters={filters} onFiltersChange={setFilters} />

      <BulkActionsBar tasks={filteredTasks} />

      {featureSettings.board.showArchiveSuggestions && <ArchiveSuggestionBanner />}

      <FeatureErrorBoundary fallbackTitle="Board failed to render">
        <section aria-label={`Kanban board, ${filteredTasks.length} tasks`}>
          {featureSettings.board.enableDragAndDrop ? (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div className="grid grid-cols-5 gap-4" role="group" aria-label="Kanban columns">
                {COLUMNS.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    id={column.id}
                    title={column.title}
                    tasks={liveTasksByStatus[column.id]}
                    allTasks={filteredTasks}
                    onTaskClick={handleTaskClick}
                    selectedTaskId={selectedTaskId}
                    isDragActive={isDragActive}
                  />
                ))}
              </div>

              <DragOverlay>
                {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <div className="grid grid-cols-5 gap-4" role="group" aria-label="Kanban columns">
              {COLUMNS.map((column) => (
                <KanbanColumn
                  key={column.id}
                  id={column.id}
                  title={column.title}
                  tasks={tasksByStatus[column.id]}
                  allTasks={filteredTasks}
                  onTaskClick={handleTaskClick}
                  selectedTaskId={selectedTaskId}
                />
              ))}
            </div>
          )}
        </section>

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
            <DashboardSection />
          </Suspense>
        )}
      </FeatureErrorBoundary>

      <TaskDetailPanel
        task={currentSelectedTask}
        open={detailOpen}
        onOpenChange={handleDetailClose}
      />
    </>
  );
}
