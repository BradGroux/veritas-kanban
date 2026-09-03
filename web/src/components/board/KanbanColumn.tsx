import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { BadgeCheck, Ban, CircleDashed, CircleDot, OctagonAlert, Play } from 'lucide-react';
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
  onTaskStatusChange?: (taskId: string, status: TaskStatus) => void;
  selectedTaskId?: string | null;
  canChangeStatus?: boolean;
  dragEnabled?: boolean;
  isDragActive?: boolean;
  showStatusControls?: boolean;
  statusOptions?: Array<{ value: TaskStatus; label: string }>;
}

type StatusTone = 'todo' | 'active' | 'blocked' | 'done' | 'cancelled' | 'review' | 'custom';

const columnStatusPresentation: Record<string, { tone: StatusTone; icon: typeof CircleDot }> = {
  todo: { tone: 'todo', icon: CircleDashed },
  'in-progress': { tone: 'active', icon: Play },
  blocked: { tone: 'blocked', icon: OctagonAlert },
  done: { tone: 'done', icon: BadgeCheck },
  cancelled: { tone: 'cancelled', icon: Ban },
};

function getStatusPresentation(status: string) {
  return (
    columnStatusPresentation[status] ?? {
      tone: status.toLowerCase().includes('review') ? ('review' as const) : ('custom' as const),
      icon: CircleDot,
    }
  );
}

export function KanbanColumn({
  id,
  title,
  tasks,
  allTasks,
  onTaskClick,
  onTaskStatusChange,
  selectedTaskId,
  canChangeStatus = true,
  dragEnabled = true,
  isDragActive,
  showStatusControls = false,
  statusOptions,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !dragEnabled });
  const { settings: featureSettings } = useFeatureSettings();
  const { isSelecting, selectedIds, toggleGroup } = useBulkActions();
  const showDoneMetrics = featureSettings.board.showDoneMetrics;
  const statusPresentation = getStatusPresentation(id);
  const StatusIcon = statusPresentation.icon;

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
      data-column-status={id}
      data-drop-target={dragEnabled && isOver ? 'true' : undefined}
      className={cn(
        'vk-kanban-column flex flex-col rounded-lg transition-colors',
        dragEnabled && isOver && 'vk-kanban-column--drop-target'
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
          <div className="vk-column-status-plate" data-status-tone={statusPresentation.tone}>
            <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <h2 id={`column-heading-${id}`} className="text-xs font-semibold">
              {title}
            </h2>
            <span
              className="vk-column-status-count"
              aria-live="polite"
              aria-label={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
            >
              {tasks.length}
            </span>
          </div>
        </div>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 p-2 space-y-2 min-h-24 overflow-y-auto md:min-h-[calc(100vh-200px)]">
          {tasks.length === 0 ? (
            <div
              className={cn(
                'flex items-center justify-center h-24 text-sm text-muted-foreground rounded-md border-2 border-dashed',
                dragEnabled && isOver && 'border-primary/50 bg-primary/5'
              )}
            >
              {dragEnabled && isOver ? 'Drop here' : 'No tasks'}
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
                    dragEnabled={dragEnabled}
                    onClick={() => onTaskClick?.(task)}
                    onStatusChange={(status) => onTaskStatusChange?.(task.id, status)}
                    isSelected={task.id === selectedTaskId}
                    isBlocked={blocked}
                    blockerTitles={blockers.map((b) => b.title)}
                    cardMetrics={taskMetrics}
                    canChangeStatus={canChangeStatus}
                    isDragActive={isDragActive}
                    showStatusControl={showStatusControls}
                    statusOptions={statusOptions}
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
