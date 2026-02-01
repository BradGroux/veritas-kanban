import { useMemo } from 'react';
import { useTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, Play, Ban, ListTodo, FileEdit } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskStatus, Task } from '@veritas-kanban/shared';

interface TasksDrillDownProps {
  project?: string;
  statusFilter?: TaskStatus | 'all';
  onTaskClick?: (taskId: string) => void;
}

const statusConfig: Record<
  TaskStatus,
  {
    icon: React.ReactNode;
    color: string;
    label: string;
  }
> = {
  todo: {
    icon: <ListTodo className="h-4 w-4" />,
    color: 'text-muted-foreground',
    label: 'To Do',
  },
  planning: {
    icon: <FileEdit className="h-4 w-4" />,
    color: 'text-violet-500',
    label: 'Planning',
  },
  'in-progress': {
    icon: <Play className="h-4 w-4" />,
    color: 'text-blue-500',
    label: 'In Progress',
  },
  blocked: {
    icon: <Ban className="h-4 w-4" />,
    color: 'text-red-500',
    label: 'Blocked',
  },
  done: {
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'text-green-500',
    label: 'Done',
  },
};

export function TasksDrillDown({
  project,
  statusFilter = 'all',
  onTaskClick,
}: TasksDrillDownProps) {
  const { data: tasks, isLoading } = useTasks();
  const { data: projects = [] } = useProjects();

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    let filtered = tasks;

    // Filter by project
    if (project) {
      filtered = filtered.filter((t) => t.project === project);
    }

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter((t) => t.status === statusFilter);
    }

    // Sort by updated date (most recent first)
    return [...filtered].sort(
      (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }, [tasks, project, statusFilter]);

  // Group by status for summary
  const statusCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      todo: 0,
      planning: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
    };
    filteredTasks.forEach((t) => counts[t.status]++);
    return counts;
  }, [filteredTasks]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(statusCounts).map(([status, count]) => {
          const config = statusConfig[status as TaskStatus];
          return (
            <Badge
              key={status}
              variant="secondary"
              className={cn('flex items-center gap-1', config.color)}
            >
              {config.icon}
              {config.label}: {count}
            </Badge>
          );
        })}
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {filteredTasks.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">No tasks found</div>
        ) : (
          filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projects={projects}
              onClick={() => onTaskClick?.(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  projects = [],
  onClick,
}: {
  task: Task;
  projects?: Array<{ id: string; label: string }>;
  onClick?: () => void;
}) {
  const config = statusConfig[task.status];
  const projectLabel = task.project
    ? projects.find((p) => p.id === task.project)?.label || task.project
    : null;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border p-3',
        'hover:bg-muted/50 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5', config.color)}>{config.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{task.title}</div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            {projectLabel && (
              <Badge variant="outline" className="text-xs">
                {projectLabel}
              </Badge>
            )}
            <span>{new Date(task.updated).toLocaleDateString()}</span>
          </div>
        </div>
        <Badge variant="secondary" className={cn('text-xs', config.color)}>
          {config.label}
        </Badge>
      </div>
    </button>
  );
}
