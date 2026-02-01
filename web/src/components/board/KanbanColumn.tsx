import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { TaskCard } from '@/components/task/TaskCard';
import { isTaskBlocked, getTaskBlockers } from '@/hooks/useTasks';
import { useBulkTaskMetrics } from '@/hooks/useBulkTaskMetrics';
import { useBulkActions } from '@/hooks/useBulkActions';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import type { Task, TaskStatus } from '@veritas-kanban/shared';

interface KanbanColumnProps {
  id: TaskStatus;
  title: string;
  tasks: Task[];
  allTasks: Task[];
  onTaskClick?: (task: Task) => void;
  selectedTaskId?: string | null;
  isDragActive?: boolean;
}

const columnColors: Record<TaskStatus, string> = {
  todo: 'border-t-slate-500',
  planning: 'border-t-violet-500',
  'in-progress': 'border-t-blue-500',
  blocked: 'border-t-red-500',
  done: 'border-t-green-500',
};

export function KanbanColumn({
  id,
  title,
  tasks,
  allTasks,
  onTaskClick,
  selectedTaskId,
  isDragActive,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const { settings: featureSettings } = useFeatureSettings();
  const { isSelecting, selectedIds, toggleGroup } = useBulkActions();
  const showDoneMetrics = featureSettings.board.showDoneMetrics;

  // Get task IDs for done column to fetch bulk metrics
  const doneTaskIds = useMemo(() => {
    if (id !== 'done' || !showDoneMetrics) return [];
    return tasks.map((t) => t.id);
  }, [id, tasks, showDoneMetrics]);

  // Fetch bulk metrics only for done column
  const { data: metricsMap } = useBulkTaskMetrics(doneTaskIds, id === 'done' && showDoneMetrics);

  // Column selection state
  const columnTaskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const allColumnSelected =
    columnTaskIds.length > 0 && columnTaskIds.every((tid) => selectedIds.has(tid));
  const someColumnSelected =
    !allColumnSelected && columnTaskIds.some((tid) => selectedIds.has(tid));

  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-labelledby={`column-heading-${id}`}
      aria-roledescription="kanban column"
      className={cn(
        'flex flex-col rounded-lg bg-muted/50 border-t-2 transition-all',
        columnColors[id],
        isOver && 'ring-2 ring-primary/50 bg-muted/70'
      )}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {isSelecting && tasks.length > 0 && (
            <input
              type="checkbox"
              checked={allColumnSelected}
              ref={(el) => {
                if (el) el.indeterminate = someColumnSelected;
              }}
              onChange={() => toggleGroup(columnTaskIds)}
              className="h-3.5 w-3.5 rounded border-muted-foreground/50 cursor-pointer accent-primary"
              aria-label={`Select all ${title} tasks`}
            />
          )}
          <h2 id={`column-heading-${id}`} className="text-sm font-medium text-muted-foreground">
            {title}
          </h2>
        </div>
        <span
          className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full"
          aria-live="polite"
          aria-label={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
        >
          {tasks.length}
        </span>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 p-2 space-y-2 min-h-[calc(100vh-200px)] overflow-y-auto">
          {tasks.length === 0 ? (
            <div
              className={cn(
                'flex items-center justify-center h-24 text-sm text-muted-foreground rounded-md border-2 border-dashed',
                isOver && 'border-primary/50 bg-primary/5'
              )}
            >
              {isOver ? 'Drop here' : 'No tasks'}
            </div>
          ) : (
            tasks.map((task) => {
              const blocked = isTaskBlocked(task, allTasks);
              const blockers = blocked ? getTaskBlockers(task, allTasks) : [];
              const taskMetrics =
                id === 'done' && showDoneMetrics ? metricsMap?.get(task.id) : undefined;
              return (
                <ErrorBoundary key={task.id} level="widget">
                  <TaskCard
                    task={task}
                    onClick={() => onTaskClick?.(task)}
                    isSelected={task.id === selectedTaskId}
                    isBlocked={blocked}
                    blockerTitles={blockers.map((b) => b.title)}
                    cardMetrics={taskMetrics}
                    isDragActive={isDragActive}
                  />
                </ErrorBoundary>
              );
            })
          )}
        </div>
      </SortableContext>
    </div>
  );
}
