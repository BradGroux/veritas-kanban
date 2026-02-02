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
  useBacklogTasks,
  usePromoteTask,
  useBulkPromote,
  useDeleteBacklogTask,
} from '@/hooks/useBacklog';
import { useProjects } from '@/hooks/useProjects';
import { useTaskTypes } from '@/hooks/useTaskTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
    low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
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
          <h1 className="text-2xl font-bold">Backlog</h1>
          <Badge variant="secondary">{filteredTasks.length} tasks</Badge>
        </div>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <Button size="sm" onClick={handleBulkPromote} disabled={bulkPromote.isPending}>
              <ArrowUp className="h-4 w-4 mr-2" />
              Promote to Board
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
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

        {filteredTasks.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <Checkbox
              checked={selectedIds.size === filteredTasks.length}
              onCheckedChange={handleSelectAll}
              id="select-all"
            />
            <label htmlFor="select-all" className="text-sm cursor-pointer whitespace-nowrap">
              Select all
            </label>
          </div>
        )}
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading backlog tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search || projectFilter !== 'all' || typeFilter !== 'all'
            ? 'No tasks match your filters'
            : 'No tasks in backlog'}
        </div>
      ) : (
        <div className="space-y-3">
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
        </div>
      )}
    </div>
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
    <div
      className={cn(
        'p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer',
        isSelected && 'ring-2 ring-primary',
        isExpanded && 'ring-2 ring-accent'
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="mt-1"
        />

        <div className="flex-1 min-w-0" onClick={onClick}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium truncate">{task.title}</h3>
              {!isExpanded && task.description && (
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
                  onPromote();
                }}
              >
                <ArrowUp className="h-3 w-3 mr-1" />
                Promote
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {task.id}
            </Badge>
            <Badge className={cn('text-xs', priorityColors[task.priority])}>{task.priority}</Badge>
            <Badge variant="secondary" className="text-xs">
              {task.type}
            </Badge>
            {task.project && (
              <Badge variant="secondary" className="text-xs">
                {task.project}
              </Badge>
            )}
            {task.sprint && (
              <Badge variant="secondary" className="text-xs">
                Sprint: {task.sprint}
              </Badge>
            )}
            {task.subtasks && task.subtasks.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {task.subtasks.filter((st) => st.completed).length}/{task.subtasks.length} subtasks
              </Badge>
            )}
          </div>

          {/* Expanded detail view */}
          {isExpanded && (
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
                  <span className="text-muted-foreground">Updated:</span>{' '}
                  {new Date(task.updated).toLocaleDateString()}
                </div>
                {task.agent && (
                  <div>
                    <span className="text-muted-foreground">Agent:</span> {task.agent}
                  </div>
                )}
              </div>
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
        </div>
      </div>
    </div>
  );
}
