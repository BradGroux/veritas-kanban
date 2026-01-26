import { useTasks, useTasksByStatus, useUpdateTask } from '@/hooks/useTasks';
import { KanbanColumn } from './KanbanColumn';
import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import { Skeleton } from '@/components/ui/skeleton';
import type { TaskStatus, Task } from '@veritas-kanban/shared';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useState, useEffect, useCallback } from 'react';
import { TaskCard } from '@/components/task/TaskCard';
import { useKeyboard } from '@/hooks/useKeyboard';

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
  const tasksByStatus = useTasksByStatus(tasks);
  const updateTask = useUpdateTask();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  
  const {
    selectedTaskId,
    setTasks,
    setOnOpenTask,
    setOnMoveTask,
  } = useKeyboard();

  // Register tasks with keyboard context
  useEffect(() => {
    if (tasks) {
      setTasks(tasks);
    }
  }, [tasks, setTasks]);

  // Handler for opening a task
  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task);
    setDetailOpen(true);
  }, []);

  // Handler for moving a task
  const handleMoveTask = useCallback((taskId: string, status: TaskStatus) => {
    updateTask.mutate({ id: taskId, input: { status } });
  }, [updateTask]);

  // Register callbacks with keyboard context
  useEffect(() => {
    setOnOpenTask(handleTaskClick);
  }, [handleTaskClick, setOnOpenTask]);

  useEffect(() => {
    setOnMoveTask(handleMoveTask);
  }, [handleMoveTask, setOnMoveTask]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks?.find(t => t.id === event.active.id);
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;
    
    const task = tasks?.find(t => t.id === taskId);
    if (task && task.status !== newStatus) {
      updateTask.mutate({
        id: taskId,
        input: { status: newStatus },
      });
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-4 gap-4">
          {COLUMNS.map(column => (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={column.title}
              tasks={tasksByStatus[column.id]}
              onTaskClick={handleTaskClick}
              selectedTaskId={selectedTaskId}
            />
          ))}
        </div>
        
        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} isDragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDetailPanel
        task={currentSelectedTask}
        open={detailOpen}
        onOpenChange={handleDetailClose}
      />
    </>
  );
}
