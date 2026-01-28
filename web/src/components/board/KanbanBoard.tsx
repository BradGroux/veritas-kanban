import { useTasks, useTasksByStatus, useUpdateTask, useReorderTasks } from '@/hooks/useTasks';
import { KanbanColumn } from './KanbanColumn';
import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import { Skeleton } from '@/components/ui/skeleton';
import type { TaskStatus, Task } from '@veritas-kanban/shared';
import { useTaskTypes } from '@/hooks/useTaskTypes';
import { useProjects } from '@/hooks/useProjects';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { DashboardSection } from '@/components/dashboard/DashboardSection';

const COLUMNS: { id: TaskStatus; title: string }[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
];

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {COLUMNS.map(column => (
        <div
          key={column.id}
          className="flex flex-col rounded-lg bg-muted/50 border-t-2 border-t-muted-foreground/20"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-6 rounded-full" />
          </div>
          <div className="flex-1 p-2 space-y-2 min-h-[calc(100vh-200px)]">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-card border border-border rounded-md p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Skeleton className="h-4 w-4 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16 rounded" />
                  <Skeleton className="h-5 w-12 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function KanbanBoard() {
  const { data: tasks, isLoading, error } = useTasks();
  const { data: taskTypes = [] } = useTaskTypes();
  const { data: projects = [] } = useProjects();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  
  // Initialize filters from URL
  const [filters, setFilters] = useState<FilterState>(() => {
    if (typeof window !== 'undefined') {
      return searchParamsToFilters(new URLSearchParams(window.location.search));
    }
    return { search: '', project: null, type: null };
  });
  
  const {
    selectedTaskId,
    setTasks,
    setOnOpenTask,
    setOnMoveTask,
  } = useKeyboard();

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

  const updateTask = useUpdateTask();
  const reorderTasks = useReorderTasks();

  // Handler for moving a task
  const handleMoveTask = useCallback((taskId: string, status: TaskStatus) => {
    updateTask.mutate({ id: taskId, input: { status } });
  }, [updateTask]);

  // Register callbacks with keyboard context (refs, so no need for useEffect)
  setOnOpenTask(handleTaskClick);
  setOnMoveTask(handleMoveTask);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Find which column a task belongs to
  const findColumnForTask = useCallback((taskId: string): TaskStatus | null => {
    for (const col of COLUMNS) {
      if (tasksByStatus[col.id]?.some((t: Task) => t.id === taskId)) {
        return col.id;
      }
    }
    return null;
  }, [tasksByStatus]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = filteredTasks?.find(t => t.id === event.active.id);
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragOver = (_event: DragOverEvent) => {
    // We don't need real-time container switching since our columns
    // are droppable targets and tasks are sortable within them.
    // The visual reordering within a column is handled by SortableContext.
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column (status) directly
    const isOverColumn = COLUMNS.some(c => c.id === overId);
    
    if (isOverColumn) {
      // Dropped on empty column area — change status only
      const newStatus = overId as TaskStatus;
      const task = filteredTasks?.find(t => t.id === activeId);
      if (task && task.status !== newStatus) {
        updateTask.mutate({
          id: activeId,
          input: { status: newStatus },
        });
      }
      return;
    }

    // Dropped on another task — figure out source/destination columns
    const activeColumn = findColumnForTask(activeId);
    const overColumn = findColumnForTask(overId);
    
    if (!activeColumn || !overColumn) return;

    if (activeColumn === overColumn) {
      // Same column — reorder
      const columnTasks = tasksByStatus[activeColumn];
      const oldIndex = columnTasks.findIndex((t: Task) => t.id === activeId);
      const newIndex = columnTasks.findIndex((t: Task) => t.id === overId);
      
      if (oldIndex !== newIndex) {
        const reordered = arrayMove(columnTasks, oldIndex, newIndex);
        reorderTasks.mutate(reordered.map((t: Task) => t.id));
      }
    } else {
      // Cross-column: change status, then insert at the target position
      const destTasks = [...tasksByStatus[overColumn]];
      const overIndex = destTasks.findIndex((t: Task) => t.id === overId);
      
      // First update the task's status
      updateTask.mutate(
        { id: activeId, input: { status: overColumn } },
        {
          onSuccess: () => {
            // Build the new order for the destination column including the moved task
            const newOrder = destTasks.map((t: Task) => t.id);
            newOrder.splice(overIndex, 0, activeId);
            reorderTasks.mutate(newOrder);
          },
        }
      );
    }
  };

  const handleDetailClose = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      // Small delay to allow animation to complete
      setTimeout(() => setSelectedTask(null), 200);
    }
  };

  // Keep selected task in sync with updated data
  const currentSelectedTask = selectedTask 
    ? tasks?.find(t => t.id === selectedTask.id) || selectedTask
    : null;

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-2">
          <div className="text-destructive font-medium">
            Error loading tasks
          </div>
          <div className="text-sm text-muted-foreground">
            {error.message}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <FilterBar
        tasks={tasks || []}
        filters={filters}
        onFiltersChange={setFilters}
      />
      
      <BulkActionsBar allTaskIds={filteredTasks.map(t => t.id)} />
      
      <ArchiveSuggestionBanner />
      
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-4 gap-4">
          {COLUMNS.map(column => (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={column.title}
              tasks={tasksByStatus[column.id]}
              allTasks={filteredTasks}
              onTaskClick={handleTaskClick}
              selectedTaskId={selectedTaskId}
              taskTypes={taskTypes}
              projects={projects}
            />
          ))}
        </div>
        
        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} isDragging taskTypes={taskTypes} projects={projects} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <DashboardSection />

      <TaskDetailPanel
        task={currentSelectedTask}
        open={detailOpen}
        onOpenChange={handleDetailClose}
      />
    </>
  );
}
