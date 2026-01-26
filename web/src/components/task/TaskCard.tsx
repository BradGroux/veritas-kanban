import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Task, TaskType, TaskPriority } from '@veritas-kanban/shared';
import { Code, Search, FileText, Zap } from 'lucide-react';

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  onClick?: () => void;
  isSelected?: boolean;
}

const typeIcons: Record<TaskType, React.ReactNode> = {
  code: <Code className="h-3.5 w-3.5" />,
  research: <Search className="h-3.5 w-3.5" />,
  content: <FileText className="h-3.5 w-3.5" />,
  automation: <Zap className="h-3.5 w-3.5" />,
};

const typeColors: Record<TaskType, string> = {
  code: 'border-l-violet-500',
  research: 'border-l-cyan-500',
  content: 'border-l-orange-500',
  automation: 'border-l-emerald-500',
};

const priorityColors: Record<TaskPriority, string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-slate-500/20 text-slate-400',
};

export function TaskCard({ task, isDragging, onClick, isSelected }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging: isCurrentlyDragging } = useDraggable({
    id: task.id,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const handleClick = () => {
    // Don't open detail panel if we're dragging
    if (isCurrentlyDragging || isDragging) return;
    onClick?.();
  };

  return (
    <TooltipProvider>
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={handleClick}
            className={cn(
              'group bg-card border border-border rounded-md p-3 cursor-grab active:cursor-grabbing',
              'hover:border-muted-foreground/50 hover:bg-card/80 transition-all',
              'border-l-2',
              typeColors[task.type],
              isDragging && 'opacity-50 shadow-lg rotate-2 scale-105',
              isCurrentlyDragging && 'opacity-50',
              isSelected && 'ring-2 ring-primary border-primary'
            )}
          >
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground mt-0.5 flex-shrink-0">
                {typeIcons[task.type]}
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium leading-tight truncate">
                  {task.title}
                </h3>
                {task.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {task.description}
                  </p>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {task.project && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {task.project}
                </span>
              )}
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded capitalize',
                priorityColors[task.priority]
              )}>
                {task.priority}
              </span>
              {task.tags && task.tags.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  +{task.tags.length} tags
                </span>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium">{task.title}</p>
          {task.description && (
            <p className="text-muted-foreground text-sm mt-1">{task.description}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
