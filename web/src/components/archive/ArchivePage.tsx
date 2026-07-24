/**
 * ArchivePage - Full page view for archived tasks
 *
 * Replaces the ArchiveSidebar with a full-width, searchable,
 * filterable page consistent with Backlog and Activity.
 */

import { useState, useMemo } from 'react';
import {
  ActionIcon,
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
  ThemeIcon,
} from '@mantine/core';
import {
  ArrowLeft,
  Bot,
  Calendar,
  ClipboardList,
  Code2,
  FileText,
  FolderOpen,
  Microscope,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useArchivedTasks, useRestoreTask } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useTaskTypes } from '@/hooks/useTaskTypes';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const typeIcons = {
  code: Code2,
  research: Microscope,
  content: FileText,
  automation: Bot,
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

interface ArchivePageProps {
  onBack: () => void;
}

export function ArchivePage({ onBack }: ArchivePageProps) {
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sprintFilter, setSprintFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());

  const { toast } = useToast();
  const { data: archivedTasks = [], isLoading, refetch, isRefetching } = useArchivedTasks();
  const { data: projects = [] } = useProjects();
  const { data: taskTypes = [] } = useTaskTypes();
  const { data: sprints = [] } = useSprints();
  const restoreTask = useRestoreTask();

  // Get unique sprints from archived tasks
  const archiveSprints = useMemo(() => {
    const sprintIds = new Set(archivedTasks.map((t) => t.sprint).filter(Boolean) as string[]);
    return sprints.filter((s) => sprintIds.has(s.id));
  }, [archivedTasks, sprints]);

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

  const sprintOptions = useMemo(
    () => [
      { value: 'all', label: 'All Sprints' },
      ...archiveSprints.map((sprint) => ({ value: sprint.id, label: sprint.label })),
    ],
    [archiveSprints]
  );

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return archivedTasks.filter((task) => {
      const matchesSearch =
        search === '' ||
        task.title.toLowerCase().includes(search.toLowerCase()) ||
        (task.description || '').toLowerCase().includes(search.toLowerCase()) ||
        task.id.toLowerCase().includes(search.toLowerCase());

      const matchesProject = projectFilter === 'all' || task.project === projectFilter;
      const matchesType = typeFilter === 'all' || task.type === typeFilter;
      const matchesSprint = sprintFilter === 'all' || task.sprint === sprintFilter;

      return matchesSearch && matchesProject && matchesType && matchesSprint;
    });
  }, [archivedTasks, search, projectFilter, typeFilter, sprintFilter]);

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

  const handleRestore = async (taskId: string) => {
    setRestoringIds((prev) => new Set(prev).add(taskId));
    try {
      await restoreTask.mutateAsync(taskId);
      toast({ title: 'Task restored', description: 'Task moved back to active board' });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    } catch (error) {
      toast({
        title: '❌ Failed to restore task',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleBulkRestore = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    let restored = 0;
    for (const id of ids) {
      try {
        await restoreTask.mutateAsync(id);
        restored++;
      } catch {
        // continue
      }
    }
    setSelectedIds(new Set());
    toast({
      title: 'Tasks restored',
      description: `${restored} task(s) moved back to active board`,
    });
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" gap="md" wrap="wrap">
        <Group gap="md" wrap="wrap">
          <Button variant="subtle" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Text component="h1" size="xl" fw={700} lh={1.1} m={0}>
            Archive
          </Text>
          <Badge variant="light" color="gray" tt="none">
            {filteredTasks.length} tasks
          </Badge>
          {archivedTasks.length !== filteredTasks.length && (
            <Text size="sm" c="dimmed">
              of {archivedTasks.length} total
            </Text>
          )}
        </Group>

        <Group gap="sm">
          {selectedIds.size > 0 && (
            <>
              <Text size="sm" c="dimmed">
                {selectedIds.size} selected
              </Text>
              <Button size="sm" onClick={handleBulkRestore}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Restore to Board
              </Button>
            </>
          )}
          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={() => refetch()}
            disabled={isRefetching}
            aria-label="Refresh archived tasks"
          >
            <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          </ActionIcon>
        </Group>
      </Group>

      <Paper withBorder radius="md" p="md">
        <Group gap="md" align="end" wrap="wrap">
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search archived tasks..."
            aria-label="Search archived tasks"
            leftSection={<Search className="h-4 w-4" aria-hidden="true" />}
            className="min-w-[240px] flex-1"
          />

          <Select
            value={projectFilter}
            onChange={(value) => setProjectFilter(value ?? 'all')}
            data={projectOptions}
            aria-label="Filter archive by project"
            checkIconPosition="right"
            className="w-[180px]"
          />

          <Select
            value={typeFilter}
            onChange={(value) => setTypeFilter(value ?? 'all')}
            data={taskTypeOptions}
            aria-label="Filter archive by type"
            checkIconPosition="right"
            className="w-[180px]"
          />

          {archiveSprints.length > 0 && (
            <Select
              value={sprintFilter}
              onChange={(value) => setSprintFilter(value ?? 'all')}
              data={sprintOptions}
              aria-label="Filter archive by sprint"
              checkIconPosition="right"
              className="w-[180px]"
            />
          )}

          {filteredTasks.length > 0 && (
            <Checkbox
              checked={selectedIds.size === filteredTasks.length && filteredTasks.length > 0}
              onChange={handleSelectAll}
              id="select-all-archive"
              label="Select all"
              className="shrink-0"
            />
          )}
        </Group>
      </Paper>

      {/* Task List */}
      {isLoading ? (
        <Text ta="center" py="xl" c="dimmed">
          Loading archived tasks...
        </Text>
      ) : filteredTasks.length === 0 ? (
        <Text ta="center" py="xl" c="dimmed">
          {search || projectFilter !== 'all' || typeFilter !== 'all'
            ? 'No tasks match your filters'
            : 'No archived tasks'}
        </Text>
      ) : (
        <Stack gap="sm">
          {filteredTasks.map((task) => (
            <Paper
              key={task.id}
              withBorder
              radius="md"
              p="md"
              className={cn(
                'overflow-visible bg-card transition-colors hover:bg-accent/50',
                selectedIds.has(task.id) && 'ring-2 ring-primary',
                expandedTaskId === task.id && 'ring-2 ring-accent'
              )}
              data-testid={`archive-task-card-${task.id}`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedIds.has(task.id)}
                  onChange={() => handleToggleSelect(task.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select archived task ${task.title}`}
                  className="mt-1"
                />

                <Stack
                  gap="sm"
                  className="flex-1 min-w-0"
                  onClick={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedTaskId === task.id}
                  aria-controls={`archive-task-detail-${task.id}`}
                  aria-label={`${
                    expandedTaskId === task.id ? 'Collapse' : 'Expand'
                  } archived task ${task.title}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedTaskId(expandedTaskId === task.id ? null : task.id);
                    }
                  }}
                >
                  <Group align="flex-start" gap="xs" wrap="nowrap">
                    <ThemeIcon size="sm" variant="light" color="violet" className="shrink-0">
                      {(() => {
                        const TypeIcon =
                          typeIcons[task.type as keyof typeof typeIcons] ?? ClipboardList;
                        return <TypeIcon className="h-3.5 w-3.5" aria-hidden="true" />;
                      })()}
                    </ThemeIcon>
                    <Text
                      fw={600}
                      title={expandedTaskId === task.id ? undefined : task.title}
                      className={cn(
                        'min-w-0 break-words [overflow-wrap:anywhere]',
                        expandedTaskId !== task.id && 'line-clamp-2'
                      )}
                      data-testid={`archive-task-title-${task.id}`}
                    >
                      {task.title}
                    </Text>
                  </Group>
                  {expandedTaskId !== task.id && task.description && (
                    <Text
                      size="sm"
                      c="dimmed"
                      mt={4}
                      title={task.description}
                      className="line-clamp-2 break-words [overflow-wrap:anywhere]"
                      data-testid={`archive-task-description-${task.id}`}
                    >
                      {task.description}
                    </Text>
                  )}

                  <Group gap="xs" wrap="wrap">
                    <Badge
                      variant="outline"
                      color="gray"
                      size="xs"
                      tt="none"
                      title={task.id}
                      className="max-w-full"
                    >
                      {task.id}
                    </Badge>
                    <Badge
                      variant="light"
                      color="gray"
                      size="xs"
                      tt="none"
                      title={task.type}
                      className="max-w-full"
                    >
                      {task.type}
                    </Badge>
                    {task.project && (
                      <Badge
                        variant="light"
                        color="gray"
                        size="xs"
                        tt="none"
                        title={
                          projects.find((project) => project.id === task.project)?.label ||
                          task.project
                        }
                        className="max-w-full"
                      >
                        <FolderOpen className="h-3 w-3 mr-1" />
                        {projects.find((p) => p.id === task.project)?.label || task.project}
                      </Badge>
                    )}
                    {task.sprint && (
                      <Badge
                        variant="light"
                        color="gray"
                        size="xs"
                        tt="none"
                        title={
                          sprints.find((sprint) => sprint.id === task.sprint)?.label || task.sprint
                        }
                        className="max-w-full"
                      >
                        {sprints.find((s) => s.id === task.sprint)?.label || task.sprint}
                      </Badge>
                    )}
                    <Text
                      size="xs"
                      c="dimmed"
                      className="flex min-w-0 items-center gap-1 sm:ml-auto"
                      title={`Archived ${new Date(task.updated).toLocaleDateString()}`}
                    >
                      <Calendar className="h-3 w-3" />
                      {formatDate(task.updated)}
                    </Text>
                  </Group>

                  {/* Expanded detail view */}
                  {expandedTaskId === task.id && (
                    <div
                      id={`archive-task-detail-${task.id}`}
                      className="mt-4 min-w-0 space-y-3 border-t pt-4"
                    >
                      {task.description && (
                        <div>
                          <h4 className="text-sm font-medium mb-1">Description</h4>
                          <Text
                            size="sm"
                            c="dimmed"
                            className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                            data-testid={`archive-task-expanded-description-${task.id}`}
                          >
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
                            Archived:
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
                        {task.status && (
                          <Text size="sm">
                            <Text component="span" c="dimmed" inherit>
                              Final status:
                            </Text>{' '}
                            {task.status}
                          </Text>
                        )}
                      </SimpleGrid>
                      {task.comments && task.comments.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-1">
                            Comments ({task.comments.length})
                          </h4>
                          {task.comments.slice(-3).map((comment, i) => (
                            <div
                              key={i}
                              className="text-sm text-muted-foreground mt-1 pl-2 border-l-2"
                            >
                              {typeof comment === 'string' ? comment : comment.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Stack>

                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 self-start"
                  onClick={() => handleRestore(task.id)}
                  disabled={restoringIds.has(task.id)}
                >
                  <RotateCcw
                    className={cn('h-3 w-3 mr-1', restoringIds.has(task.id) && 'animate-spin')}
                  />
                  Restore
                </Button>
              </div>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
