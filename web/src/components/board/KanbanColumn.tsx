import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { TaskCard } from '@/components/task/TaskCard';
import { isTaskBlocked, getTaskBlockers } from '@/hooks/useTasks';
import type { Task, TaskStatus, TaskTypeConfig, ProjectConfig } from '@veritas-kanban/shared';

interface KanbanColumnProps {
  id: TaskStatus;
  title: string;
  tasks: Task[];
  allTasks: Task[];
  onTaskClick?: (task: Task) => void;
  selectedTaskId?: string | null;
  taskTypes?: TaskTypeConfig[];
  projects?: ProjectConfig[];
}

const columnColors: Record<TaskStatus, string> = {
  'todo': 'border-t-slate-500',
  'in-progress': 'border-t-blue-500',
  'review': 'border-t-amber-500',
  'done': 'border-t-green-500',
};

export function KanbanColumn({ id, title, tasks, allTasks, onTaskClick, selectedTaskId, taskTypes = [], projects = [] }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-lg bg-muted/50 border-t-2 transition-all',
        columnColors[id],
        isOver && 'ring-2 ring-primary/50 bg-muted/70'
      )}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {title}
        </h2>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 p-2 space-y-2 min-h-[calc(100vh-200px)] overflow-y-auto">
          {tasks.length === 0 ? (
            <div className={cn(
              'flex items-center justify-center h-24 text-sm text-muted-foreground rounded-md border-2 border-dashed',
              isOver && 'border-primary/50 bg-primary/5'
            )}>
              {isOver ? 'Drop here' : 'No tasks'}
            </div>
          ) : (
            tasks.map(task => {
              const blocked = isTaskBlocked(task, allTasks);
              const blockers = blocked ? getTaskBlockers(task, allTasks) : [];
              return (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  onClick={() => onTaskClick?.(task)}
                  taskTypes={taskTypes}
                  projects={projects}
                  isSelected={task.id === selectedTaskId}
                  isBlocked={blocked}
                  blockerTitles={blockers.map(b => b.title)}
                />
              );
            })
          )}
        </div>
      </SortableContext>
    </div>
  );
}
