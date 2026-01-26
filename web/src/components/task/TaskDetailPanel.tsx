import { useEffect, useState, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateTask, useDeleteTask } from '@/hooks/useTasks';
import { Trash2, Code, Search, FileText, Zap, Calendar, Clock } from 'lucide-react';
import type { Task, TaskType, TaskStatus, TaskPriority } from '@veritas-kanban/shared';
import { GitSection } from './GitSection';
import { AgentPanel } from './AgentPanel';

interface TaskDetailPanelProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const typeIcons: Record<TaskType, React.ReactNode> = {
  code: <Code className="h-4 w-4" />,
  research: <Search className="h-4 w-4" />,
  content: <FileText className="h-4 w-4" />,
  automation: <Zap className="h-4 w-4" />,
};

const typeLabels: Record<TaskType, string> = {
  code: 'Code',
  research: 'Research',
  content: 'Content',
  automation: 'Automation',
};

const statusLabels: Record<TaskStatus, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'review': 'Review',
  'done': 'Done',
};

const priorityLabels: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

function useDebouncedSave(task: Task | null, updateTask: ReturnType<typeof useUpdateTask>) {
  const [localTask, setLocalTask] = useState<Task | null>(task);
  const [isDirty, setIsDirty] = useState(false);

  // Sync with external task when it changes
  useEffect(() => {
    setLocalTask(task);
    setIsDirty(false);
  }, [task]);

  // Debounced save
  useEffect(() => {
    if (!isDirty || !localTask) return;

    const timeout = setTimeout(() => {
      updateTask.mutate({
        id: localTask.id,
        input: {
          title: localTask.title,
          description: localTask.description,
          type: localTask.type,
          status: localTask.status,
          priority: localTask.priority,
          project: localTask.project,
          tags: localTask.tags,
          git: localTask.git,
        },
      });
      setIsDirty(false);
    }, 500);

    return () => clearTimeout(timeout);
  }, [localTask, isDirty, updateTask]);

  const updateField = useCallback(<K extends keyof Task>(field: K, value: Task[K]) => {
    setLocalTask(prev => prev ? { ...prev, [field]: value } : null);
    setIsDirty(true);
  }, []);

  return { localTask, updateField, isDirty };
}

export function TaskDetailPanel({ task, open, onOpenChange }: TaskDetailPanelProps) {
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { localTask, updateField, isDirty } = useDebouncedSave(task, updateTask);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  const handleDelete = async () => {
    if (!task) return;
    await deleteTask.mutateAsync(task.id);
    onOpenChange(false);
  };

  if (!localTask) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
        <SheetHeader className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            {typeIcons[localTask.type]}
            <span className="text-xs uppercase tracking-wide">{typeLabels[localTask.type]} Task</span>
            {isDirty && (
              <span className="text-xs text-amber-500 ml-auto">Saving...</span>
            )}
          </div>
          <SheetTitle className="pr-8">
            <Input
              value={localTask.title}
              onChange={(e) => updateField('title', e.target.value)}
              className="text-xl font-semibold border-0 px-0 focus-visible:ring-0 bg-transparent"
              placeholder="Task title..."
            />
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Description */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Description</Label>
            <Textarea
              value={localTask.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Add a description..."
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Status, Type, Priority grid */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Status</Label>
              <Select
                value={localTask.status}
                onValueChange={(v) => updateField('status', v as TaskStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Type</Label>
              <Select
                value={localTask.type}
                onValueChange={(v) => updateField('type', v as TaskType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(typeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      <div className="flex items-center gap-2">
                        {typeIcons[value as TaskType]}
                        {label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Priority</Label>
              <Select
                value={localTask.priority}
                onValueChange={(v) => updateField('priority', v as TaskPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(priorityLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Project */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Project</Label>
            <Input
              value={localTask.project || ''}
              onChange={(e) => updateField('project', e.target.value || undefined)}
              placeholder="Add to a project..."
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">Tags</Label>
            <Input
              value={localTask.tags?.join(', ') || ''}
              onChange={(e) => {
                const tags = e.target.value
                  .split(',')
                  .map(t => t.trim())
                  .filter(Boolean);
                updateField('tags', tags.length > 0 ? tags : undefined);
              }}
              placeholder="Add tags (comma-separated)..."
            />
          </div>

          {/* Git Integration (code tasks only) */}
          {localTask.type === 'code' && (
            <GitSection
              task={localTask}
              onGitChange={(git) => updateField('git', git as Task['git'])}
            />
          )}

          {/* AI Agent (code tasks with worktree only) */}
          {localTask.type === 'code' && (
            <AgentPanel task={localTask} />
          )}

          {/* Metadata */}
          <div className="border-t pt-4 space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Created: {formatDate(localTask.created)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Updated: {formatDate(localTask.updated)}</span>
            </div>
            <div className="text-xs font-mono opacity-50">
              ID: {localTask.id}
            </div>
          </div>

          {/* Delete button */}
          <div className="border-t pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Task
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete "{localTask.title}". This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
