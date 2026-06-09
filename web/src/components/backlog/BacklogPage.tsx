/**
 * BacklogPage - Browse and manage backlog tasks
 *
 * Features:
 * - Searchable, filterable list view
 * - Bulk select and promote to active board
 * - Click task to view/edit details
 */

import { useState, useMemo } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  useBacklogTasks,
  usePromoteTask,
  useBulkPromote,
  useDeleteBacklogTask,
} from '@/hooks/useBacklog';
import { useProjects } from '@/hooks/useProjects';
import { useTaskTypes } from '@/hooks/useTaskTypes';
import { ArrowLeft, ArrowUp, Search, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import type { Task } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';

interface BacklogPageProps {
  onBack: () => void;
}

export function BacklogPage({ onBack }: BacklogPageProps) {
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const { toast } = useToast();
  const { data: tasks = [], isLoading } = useBacklogTasks();
  const { data: projects = [] } = useProjects();
  const { data: taskTypes = [] } = useTaskTypes();

  const promoteTask = usePromoteTask();
  const bulkPromote = useBulkPromote();
  const deleteTask = useDeleteBacklogTask();

  const projectOptions = useMemo(
    () => [
      { value: 'all', label: 'All Projects' },
      ...projects.map((project) => ({ value: project.id, label: project.label })),
    ],
    [projects]
  );

  const taskTypeOptions = useMemo(
    () => [
      { value: 'all', label: 'All Types' },
      ...taskTypes.map((type) => ({ value: type.id, label: type.label })),
    ],
    [taskTypes]
  );

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesSearch =
        search === '' ||
        task.title.toLowerCase().includes(search.toLowerCase()) ||
        task.description.toLowerCase().includes(search.toLowerCase()) ||
        task.id.toLowerCase().includes(search.toLowerCase());

      const matchesProject = projectFilter === 'all' || task.project === projectFilter;
      const matchesType = typeFilter === 'all' || task.type === typeFilter;

      return matchesSearch && matchesProject && matchesType;
    });
  }, [tasks, search, projectFilter, typeFilter]);

  const handleToggleSelect = (taskId: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(taskId)) {
      newSelection.delete(taskId);
    } else {
      newSelection.add(taskId);
    }
    setSelectedIds(newSelection);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTasks.map((t) => t.id)));
    }
  };

  const handlePromote = async (taskId: string) => {
    try {
      await promoteTask.mutateAsync(taskId);
      toast({
        title: 'Task promoted',
        description: 'Task moved to active board',
      });
    } catch (error) {
      toast({
        title: '❌ Failed to promote task',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleBulkPromote = async () => {
    if (selectedIds.size === 0) return;

    try {
      const result = await bulkPromote.mutateAsync(Array.from(selectedIds));
      setSelectedIds(new Set());
      toast({
        title: 'Tasks promoted',
        description: `${result.promoted.length} task(s) moved to active board${result.failed.length > 0 ? `, ${result.failed.length} failed` : ''}`,
      });
    } catch (error) {
      toast({
        title: '❌ Failed to promote tasks',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task from the backlog?')) {
      return;
    }

    try {
      await deleteTask.mutateAsync(taskId);
      toast({
        title: 'Task deleted',
        description: 'Task removed from backlog',
      });
    } catch (error) {
      toast({
        title: '❌ Failed to delete task',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const priorityColors = {
    low: 'blue',
    medium: 'yellow',
    high: 'red',
    critical: 'pink',
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" gap="md" wrap="wrap">
        <Group gap="md" wrap="wrap">
          <Button variant="subtle" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Board
          </Button>
          <Text component="h1" size="xl" fw={700} lh={1.1} m={0}>
            Backlog
          </Text>
          <Badge variant="light" color="gray" tt="none">
            {filteredTasks.length} tasks
          </Badge>
        </Group>

        {selectedIds.size > 0 && (
          <Group gap="sm">
            <Text size="sm" c="dimmed">
              {selectedIds.size} selected
            </Text>
            <Button size="sm" onClick={handleBulkPromote} disabled={bulkPromote.isPending}>
              <ArrowUp className="h-4 w-4 mr-2" />
              Promote to Board
            </Button>
          </Group>
        )}
      </Group>

      <Paper withBorder radius="md" p="md">
        <Group gap="md" align="end" wrap="wrap">
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search tasks..."
            aria-label="Search backlog tasks"
            leftSection={<Search className="h-4 w-4" aria-hidden="true" />}
            className="min-w-[240px] flex-1"
          />

          <Select
            value={projectFilter}
            onChange={(value) => setProjectFilter(value ?? 'all')}
            data={projectOptions}
            aria-label="Filter backlog by project"
            checkIconPosition="right"
            className="w-[180px]"
          />

          <Select
            value={typeFilter}
            onChange={(value) => setTypeFilter(value ?? 'all')}
            data={taskTypeOptions}
            aria-label="Filter backlog by type"
            checkIconPosition="right"
            className="w-[180px]"
          />

          {filteredTasks.length > 0 && (
            <Checkbox
              checked={selectedIds.size === filteredTasks.length}
              onChange={handleSelectAll}
              id="select-all"
              label="Select all"
              className="shrink-0"
            />
          )}
        </Group>
      </Paper>

      {/* Task List */}
      {isLoading ? (
        <Text ta="center" py="xl" c="dimmed">
          Loading backlog tasks...
        </Text>
      ) : filteredTasks.length === 0 ? (
        <Text ta="center" py="xl" c="dimmed">
          {search || projectFilter !== 'all' || typeFilter !== 'all'
            ? 'No tasks match your filters'
            : 'No tasks in backlog'}
        </Text>
      ) : (
        <Stack gap="sm">
          {filteredTasks.map((task) => (
            <BacklogTaskCard
              key={task.id}
              task={task}
              isSelected={selectedIds.has(task.id)}
              isExpanded={expandedTaskId === task.id}
              onToggleSelect={() => handleToggleSelect(task.id)}
              onPromote={() => handlePromote(task.id)}
              onDelete={() => handleDelete(task.id)}
              onClick={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
              priorityColors={priorityColors}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

interface BacklogTaskCardProps {
  task: Task;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onPromote: () => void;
  onDelete: () => void;
  onClick: () => void;
  priorityColors: Record<string, string>;
}

function BacklogTaskCard({
  task,
  isSelected,
  isExpanded,
  onToggleSelect,
  onPromote,
  onDelete,
  onClick,
  priorityColors,
}: BacklogTaskCardProps) {
  return (
    <Paper
      withBorder
      radius="md"
      p="md"
      className={cn(
        'bg-card hover:bg-accent/50 transition-colors cursor-pointer',
        isSelected && 'ring-2 ring-primary',
        isExpanded && 'ring-2 ring-accent'
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select backlog task ${task.title}`}
          className="mt-1"
        />

        <Stack
          gap="sm"
          className="flex-1 min-w-0"
          onClick={onClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          }}
        >
          <Group align="flex-start" justify="space-between" gap="md" wrap="nowrap">
            <div className="flex-1 min-w-0">
              <Text fw={600} truncate>
                {task.title}
              </Text>
              {!isExpanded && task.description && (
                <Text size="sm" c="dimmed" lineClamp={2} mt={4}>
                  {task.description}
                </Text>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onPromote();
                }}
              >
                <ArrowUp className="h-3 w-3 mr-1" />
                Promote
              </Button>
              <Button
                size="sm"
                variant="subtle"
                color="gray"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </Group>

          <Group gap="xs" wrap="wrap">
            <Badge variant="outline" color="gray" size="xs" tt="none">
              {task.id}
            </Badge>
            <Badge color={priorityColors[task.priority] ?? 'gray'} size="xs" tt="none">
              {task.priority}
            </Badge>
            <Badge variant="light" color="gray" size="xs" tt="none">
              {task.type}
            </Badge>
            {task.project && (
              <Badge variant="light" color="gray" size="xs" tt="none">
                {task.project}
              </Badge>
            )}
            {task.sprint && (
              <Badge variant="light" color="gray" size="xs" tt="none">
                Sprint: {task.sprint}
              </Badge>
            )}
            {task.subtasks && task.subtasks.length > 0 && (
              <Badge variant="light" color="gray" size="xs" tt="none">
                {task.subtasks.filter((st) => st.completed).length}/{task.subtasks.length} subtasks
              </Badge>
            )}
          </Group>

          {/* Expanded detail view */}
          {isExpanded && (
            <div className="mt-4 pt-4 border-t space-y-3">
              {task.description && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Description</h4>
                  <Text size="sm" c="dimmed" className="whitespace-pre-wrap">
                    {task.description}
                  </Text>
                </div>
              )}
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Text size="sm">
                  <Text component="span" c="dimmed" inherit>
                    Created:
                  </Text>{' '}
                  {new Date(task.created).toLocaleDateString()}
                </Text>
                <Text size="sm">
                  <Text component="span" c="dimmed" inherit>
                    Updated:
                  </Text>{' '}
                  {new Date(task.updated).toLocaleDateString()}
                </Text>
                {task.agent && (
                  <Text size="sm">
                    <Text component="span" c="dimmed" inherit>
                      Agent:
                    </Text>{' '}
                    {task.agent}
                  </Text>
                )}
              </SimpleGrid>
              {task.comments && task.comments.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Comments ({task.comments.length})</h4>
                  {task.comments.slice(-3).map((comment, i) => (
                    <div key={i} className="text-sm text-muted-foreground mt-1 pl-2 border-l-2">
                      {typeof comment === 'string' ? comment : comment.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Stack>
      </div>
    </Paper>
  );
}
