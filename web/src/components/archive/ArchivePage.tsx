/**
 * ArchivePage - Full page view for archived tasks
 *
 * Replaces the ArchiveSidebar with a full-width, searchable,
 * filterable page consistent with Backlog and Activity.
 */

import { useState, useMemo } from 'react';
import { ArrowLeft, RotateCcw, Search, Calendar, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useArchivedTasks, useRestoreTask } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useTaskTypes } from '@/hooks/useTaskTypes';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { TaskType } from '@veritas-kanban/shared';

const typeIcons: Record<TaskType, string> = {
  code: '💻',
  research: '🔬',
  content: '📝',
  automation: '🤖',
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
      selectedIds.delete(taskId);
      setSelectedIds(new Set(selectedIds));
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Board
          </Button>
          <h1 className="text-2xl font-bold">Archive</h1>
          <Badge variant="secondary">{filteredTasks.length} tasks</Badge>
          {archivedTasks.length !== filteredTasks.length && (
            <span className="text-sm text-muted-foreground">of {archivedTasks.length} total</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Bulk Actions */}
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
              <Button size="sm" onClick={handleBulkRestore}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Restore to Board
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refetch()}
            disabled={isRefetching}
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search archived tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {taskTypes.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {archiveSprints.length > 0 && (
          <Select value={sprintFilter} onValueChange={setSprintFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Sprints" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sprints</SelectItem>
              {archiveSprints.map((sprint) => (
                <SelectItem key={sprint.id} value={sprint.id}>
                  {sprint.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Select All */}
      {filteredTasks.length > 0 && (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedIds.size === filteredTasks.length && filteredTasks.length > 0}
            onCheckedChange={handleSelectAll}
            id="select-all-archive"
          />
          <label htmlFor="select-all-archive" className="text-sm cursor-pointer">
            Select all
          </label>
        </div>
      )}

      {/* Task List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading archived tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search || projectFilter !== 'all' || typeFilter !== 'all'
            ? 'No tasks match your filters'
            : 'No archived tasks'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              className={cn(
                'p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer',
                selectedIds.has(task.id) && 'ring-2 ring-primary',
                expandedTaskId === task.id && 'ring-2 ring-accent'
              )}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedIds.has(task.id)}
                  onCheckedChange={() => handleToggleSelect(task.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />

                <div
                  className="flex-1 min-w-0"
                  onClick={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">
                        <span className="mr-2">{typeIcons[task.type] || '📋'}</span>
                        {task.title}
                      </h3>
                      {expandedTaskId !== task.id && task.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {task.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestore(task.id);
                        }}
                        disabled={restoringIds.has(task.id)}
                      >
                        <RotateCcw
                          className={cn(
                            'h-3 w-3 mr-1',
                            restoringIds.has(task.id) && 'animate-spin'
                          )}
                        />
                        Restore
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {task.id}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {task.type}
                    </Badge>
                    {task.project && (
                      <Badge variant="secondary" className="text-xs">
                        <FolderOpen className="h-3 w-3 mr-1" />
                        {projects.find((p) => p.id === task.project)?.label || task.project}
                      </Badge>
                    )}
                    {task.sprint && (
                      <Badge variant="secondary" className="text-xs">
                        {sprints.find((s) => s.id === task.sprint)?.label || task.sprint}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                      <Calendar className="h-3 w-3" />
                      {formatDate(task.updated)}
                    </span>
                  </div>

                  {/* Expanded detail view */}
                  {expandedTaskId === task.id && (
                    <div className="mt-4 pt-4 border-t space-y-3">
                      {task.description && (
                        <div>
                          <h4 className="text-sm font-medium mb-1">Description</h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {task.description}
                          </p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Created:</span>{' '}
                          {new Date(task.created).toLocaleDateString()}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Archived:</span>{' '}
                          {new Date(task.updated).toLocaleDateString()}
                        </div>
                        {task.agent && (
                          <div>
                            <span className="text-muted-foreground">Agent:</span> {task.agent}
                          </div>
                        )}
                        {task.status && (
                          <div>
                            <span className="text-muted-foreground">Final status:</span>{' '}
                            {task.status}
                          </div>
                        )}
                      </div>
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
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
