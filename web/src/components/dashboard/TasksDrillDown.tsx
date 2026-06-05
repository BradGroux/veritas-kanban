import { useMemo } from 'react';
import { Badge, Group, Paper, Skeleton, Stack, Text } from '@mantine/core';
import { useTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { CheckCircle, Play, Ban, ListTodo, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskStatus, Task } from '@veritas-kanban/shared';

interface TasksDrillDownProps {
  project?: string;
  statusFilter?: TaskStatus | 'all';
  onTaskClick?: (taskId: string) => void;
}

const statusConfig: Record<
  string,
  {
    icon: React.ReactNode;
    color: string;
    iconClassName: string;
    label: string;
  }
> = {
  todo: {
    icon: <ListTodo className="h-4 w-4" />,
    color: 'gray',
    iconClassName: 'text-muted-foreground',
    label: 'To Do',
  },
  'in-progress': {
    icon: <Play className="h-4 w-4" />,
    color: 'blue',
    iconClassName: 'text-blue-500',
    label: 'In Progress',
  },
  blocked: {
    icon: <Ban className="h-4 w-4" />,
    color: 'red',
    iconClassName: 'text-red-500',
    label: 'Blocked',
  },
  done: {
    icon: <CheckCircle className="h-4 w-4" />,
    color: 'green',
    iconClassName: 'text-green-500',
    label: 'Done',
  },
  cancelled: {
    icon: <Ban className="h-4 w-4" />,
    color: 'gray',
    iconClassName: 'text-gray-400',
    label: 'Cancelled',
  },
};

const defaultStatusConfig = {
  icon: <Circle className="h-4 w-4" />,
  color: 'gray',
  iconClassName: 'text-muted-foreground',
  label: 'Custom',
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
    const counts: Record<string, number> = {
      todo: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
    };
    filteredTasks.forEach((t) => {
      counts[t.status] ??= 0;
      counts[t.status]++;
    });
    return counts;
  }, [filteredTasks]);

  if (isLoading) {
    return (
      <Stack gap="md">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} h={64} radius="md" />
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      {/* Summary Stats */}
      <Group gap="xs" wrap="wrap">
        {Object.entries(statusCounts).map(([status, count]) => {
          const config = statusConfig[status] ?? { ...defaultStatusConfig, label: status };
          return (
            <Badge key={status} variant="light" color={config.color} leftSection={config.icon}>
              {config.label}: {count}
            </Badge>
          );
        })}
      </Group>

      {/* Task List */}
      <Stack gap="xs">
        {filteredTasks.length === 0 ? (
          <Text ta="center" c="dimmed" py="xl">
            No tasks found
          </Text>
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
      </Stack>
    </Stack>
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
    <Paper
      component="button"
      type="button"
      withBorder
      radius="md"
      p="sm"
      onClick={onClick}
      className={cn(
        'w-full text-left',
        'hover:bg-muted/50 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
      )}
    >
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <div className={cn('mt-0.5', config.iconClassName)}>{config.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{task.title}</div>
          <Group gap="xs" mt={4} className="text-xs text-muted-foreground" wrap="wrap">
            {projectLabel && (
              <Badge variant="outline" color="gray" size="xs">
                {projectLabel}
              </Badge>
            )}
            <span>{new Date(task.updated).toLocaleDateString()}</span>
          </Group>
        </div>
        <Badge variant="light" color={config.color} size="xs">
          {config.label}
        </Badge>
      </Group>
    </Paper>
  );
}
