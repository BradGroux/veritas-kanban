import { useState, useMemo, useEffect } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Drawer,
  Group,
  ScrollArea,
  Select,
  TextInput,
} from '@mantine/core';
import {
  Archive,
  RefreshCw,
  Search,
  Calendar,
  FolderOpen,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import { useArchivedTasks, useRestoreTask } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import { cn } from '@/lib/utils';
import type { Task, TaskType } from '@veritas-kanban/shared';

interface ArchiveSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PAGE_SIZE = 25;

const typeIcons: Record<TaskType, string> = {
  code: '💻',
  research: '🔬',
  content: '📝',
  automation: '🤖',
};

const typeLabels: Record<TaskType, string> = {
  code: 'Code',
  research: 'Research',
  content: 'Content',
  automation: 'Automation',
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

interface ProjectConfig {
  id: string;
  label: string;
}

interface SprintConfig {
  id: string;
  label: string;
}

function ArchivedTaskItem({
  task,
  onClick,
  onRestore,
  isRestoring,
  projects = [],
  sprints = [],
}: {
  task: Task;
  onClick?: () => void;
  onRestore?: () => void;
  isRestoring?: boolean;
  projects?: ProjectConfig[];
  sprints?: SprintConfig[];
}) {
  const projectLabel = task.project
    ? projects.find((p) => p.id === task.project)?.label || task.project
    : null;
  const sprintLabel = task.sprint
    ? sprints.find((s) => s.id === task.sprint)?.label || task.sprint
    : null;

  return (
    <div
      className={cn(
        'flex items-start gap-3 py-3 px-2 rounded-md transition-colors group',
        'hover:bg-muted/50 cursor-pointer'
      )}
      onClick={onClick}
    >
      <span className="text-lg flex-shrink-0">{typeIcons[task.type] || '📋'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{task.title}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
          {projectLabel && (
            <span className="flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              {projectLabel}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(task.updated)}
          </span>
        </div>
        {sprintLabel && (
          <div className="flex flex-wrap gap-1 mt-1">
            <Badge variant="light" color="gray" size="xs" tt="none">
              {sprintLabel}
            </Badge>
          </div>
        )}
      </div>
      {onRestore && (
        <ActionIcon
          type="button"
          variant="subtle"
          color="gray"
          size="sm"
          className="veritas-secondary-action h-8 w-8 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRestore();
          }}
          disabled={isRestoring}
          title="Restore to board"
          aria-label={`Restore ${task.title} to board`}
        >
          <RotateCcw className={cn('h-4 w-4', isRestoring && 'animate-spin')} />
        </ActionIcon>
      )}
    </div>
  );
}

export function ArchiveSidebar({ open, onOpenChange }: ArchiveSidebarProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: archivedTasks, isLoading, refetch, isRefetching } = useArchivedTasks();
  const restoreTask = useRestoreTask();
  const { data: sprintsList = [] } = useSprints();

  const handleRestore = async (task: Task) => {
    setRestoringId(task.id);
    try {
      await restoreTask.mutateAsync(task.id);
      // If we were viewing this task, close the detail panel
      if (selectedTask?.id === task.id) {
        setDetailOpen(false);
        setSelectedTask(null);
      }
    } catch (error) {
      console.error('Failed to restore task:', error);
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreFromDetail = async (taskId: string) => {
    const task = archivedTasks?.find((t) => t.id === taskId);
    if (task) {
      await handleRestore(task);
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setDetailOpen(true);
  };

  const handleDetailClose = (isOpen: boolean) => {
    setDetailOpen(isOpen);
    if (!isOpen) {
      setTimeout(() => setSelectedTask(null), 200);
    }
  };

  // Get projects list for labels
  const { data: projectsList = [] } = useProjects();

  // Get unique projects for filter dropdown, with labels
  const projects = useMemo(() => {
    if (!archivedTasks) return [];
    const projectIds = new Set(archivedTasks.map((t) => t.project).filter(Boolean) as string[]);
    return projectsList
      .filter((p) => projectIds.has(p.id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [archivedTasks, projectsList]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    if (!archivedTasks) return [];

    return archivedTasks.filter((task) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(searchLower);
        const matchesDescription = task.description?.toLowerCase().includes(searchLower);
        const matchesSprint = task.sprint?.toLowerCase().includes(searchLower);
        const matchesId = task.id.toLowerCase().includes(searchLower);
        if (!matchesTitle && !matchesDescription && !matchesSprint && !matchesId) return false;
      }

      // Type filter
      if (typeFilter !== 'all' && task.type !== typeFilter) return false;

      // Project filter
      if (projectFilter !== 'all' && task.project !== projectFilter) return false;

      return true;
    });
  }, [archivedTasks, search, typeFilter, projectFilter]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, typeFilter, projectFilter]);

  // Paginated tasks
  const visibleTasks = filteredTasks.slice(0, visibleCount);
  const hasMore = visibleCount < filteredTasks.length;
  const remaining = filteredTasks.length - visibleCount;

  return (
    <>
      <Drawer
        opened={open}
        onClose={() => onOpenChange(false)}
        position="right"
        size={450}
        padding={0}
        withCloseButton={false}
      >
        <div className="px-4 py-3 border-b">
          <div className="flex items-center justify-between pr-8">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Archive className="h-5 w-5" />
              Archive
              {archivedTasks && archivedTasks.length > 0 && (
                <Badge variant="light" color="gray" size="sm" tt="none">
                  {archivedTasks.length}
                </Badge>
              )}
            </h2>
            <ActionIcon
              type="button"
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="h-8 w-8"
              aria-label="Refresh archive"
            >
              <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
            </ActionIcon>
          </div>

          {/* Search */}
          <div className="mt-2">
            <TextInput
              placeholder="Search archived tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftSection={<Search className="h-4 w-4" aria-hidden="true" />}
              aria-label="Search archived tasks"
            />
          </div>

          {/* Filters */}
          <Group gap="xs" mt="sm" grow>
            <Select
              value={typeFilter}
              onChange={(value) => setTypeFilter(value ?? 'all')}
              data={[
                { value: 'all', label: 'All Types' },
                ...Object.entries(typeLabels).map(([type, label]) => ({
                  value: type,
                  label: `${typeIcons[type as TaskType]} ${label}`,
                })),
              ]}
              aria-label="Filter archived tasks by type"
              allowDeselect={false}
            />

            {projects.length > 0 && (
              <Select
                value={projectFilter}
                onChange={(value) => setProjectFilter(value ?? 'all')}
                data={[
                  { value: 'all', label: 'All Projects' },
                  ...projects.map((project) => ({ value: project.id, label: project.label })),
                ]}
                aria-label="Filter archived tasks by project"
                allowDeselect={false}
              />
            )}
          </Group>

          {/* Results count */}
          {filteredTasks.length > 0 && filteredTasks.length !== archivedTasks?.length && (
            <div className="text-xs text-muted-foreground mt-1">
              Showing {Math.min(visibleCount, filteredTasks.length)} of {filteredTasks.length}{' '}
              filtered tasks
            </div>
          )}
        </div>

        <ScrollArea className="h-[calc(100vh-240px)]">
          <div className="px-2 py-2">
            {isLoading ? (
              <div className="text-center text-muted-foreground py-8">
                Loading archived tasks...
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                {archivedTasks?.length === 0
                  ? 'No archived tasks yet'
                  : 'No tasks match your filters'}
              </div>
            ) : (
              <>
                <div className="divide-y divide-border">
                  {visibleTasks.map((task) => (
                    <ArchivedTaskItem
                      key={task.id}
                      task={task}
                      onClick={() => handleTaskClick(task)}
                      onRestore={() => handleRestore(task)}
                      isRestoring={restoringId === task.id}
                      projects={projectsList}
                      sprints={sprintsList}
                    />
                  ))}
                </div>

                {/* Load More */}
                {hasMore && (
                  <div className="py-4 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                      className="flex items-center gap-1 mx-auto"
                    >
                      <ChevronDown className="h-4 w-4" />
                      Load More ({remaining} remaining)
                    </Button>
                  </div>
                )}

                {/* Page info */}
                {!hasMore && filteredTasks.length > PAGE_SIZE && (
                  <div className="py-3 text-center text-xs text-muted-foreground">
                    All {filteredTasks.length} tasks loaded
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </Drawer>

      {/* Read-only task detail panel for archived tasks */}
      <TaskDetailPanel
        task={selectedTask}
        open={detailOpen}
        onOpenChange={handleDetailClose}
        readOnly
        onRestore={handleRestoreFromDetail}
      />
    </>
  );
}
