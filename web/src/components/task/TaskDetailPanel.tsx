import { useEffect, useState, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
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
import { Trash2, Code, Search, FileText, Zap, Calendar, Clock, GitBranch, Bot, FileDiff, ClipboardCheck, Monitor, FileCode } from 'lucide-react';
import type { Task, TaskType, TaskStatus, TaskPriority, ReviewComment, ReviewState } from '@veritas-kanban/shared';
import { GitSection } from './GitSection';
import { AgentPanel } from './AgentPanel';
import { DiffViewer } from './DiffViewer';
import { ReviewPanel } from './ReviewPanel';
import { SubtasksSection } from './SubtasksSection';
import { DependenciesSection } from './DependenciesSection';
import { PreviewPanel } from './PreviewPanel';
import { TimeTrackingSection } from './TimeTrackingSection';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';

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
  const [changedFields, setChangedFields] = useState<Set<keyof Task>>(new Set());

  // Sync from server when task prop changes (e.g., refetch)
  useEffect(() => {
    setLocalTask(task);
    setChangedFields(new Set());
  }, [task]);

  // Debounced save - only send fields that were actually changed
  useEffect(() => {
    if (changedFields.size === 0 || !localTask) return;

    const timeout = setTimeout(() => {
      // Build input with only changed fields
      const input: Record<string, unknown> = {};
      changedFields.forEach(field => {
        input[field] = localTask[field];
      });

      updateTask.mutate({
        id: localTask.id,
        input,
      });
      setChangedFields(new Set());
    }, 500);

    return () => clearTimeout(timeout);
  }, [localTask, changedFields, updateTask]);

  const updateField = useCallback(<K extends keyof Task>(field: K, value: Task[K]) => {
    setLocalTask(prev => prev ? { ...prev, [field]: value } : null);
    setChangedFields(prev => new Set(prev).add(field));
  }, []);

  const isDirty = changedFields.size > 0;

  return { localTask, updateField, isDirty };
}

export function TaskDetailPanel({ task, open, onOpenChange }: TaskDetailPanelProps) {
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { localTask, updateField, isDirty } = useDebouncedSave(task, updateTask);
  const [activeTab, setActiveTab] = useState('details');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);

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

  const isCodeTask = localTask.type === 'code';
  const hasWorktree = !!localTask.git?.worktreePath;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[700px] sm:max-w-[700px] overflow-hidden flex flex-col">
        <SheetHeader className="space-y-1 flex-shrink-0">
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden mt-4">
          <div className="flex items-center gap-2">
            <TabsList className={`grid flex-1 ${isCodeTask ? 'grid-cols-5' : 'grid-cols-1'}`}>
              <TabsTrigger value="details">Details</TabsTrigger>
              {isCodeTask && (
                <>
                  <TabsTrigger value="git" className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    Git
                  </TabsTrigger>
                  <TabsTrigger value="agent" className="flex items-center gap-1">
                    <Bot className="h-3 w-3" />
                    Agent
                  </TabsTrigger>
                  <TabsTrigger value="changes" disabled={!hasWorktree} className="flex items-center gap-1">
                    <FileDiff className="h-3 w-3" />
                    Changes
                  </TabsTrigger>
                  <TabsTrigger value="review" className="flex items-center gap-1">
                    <ClipboardCheck className="h-3 w-3" />
                    Review
                  </TabsTrigger>
                </>
              )}
            </TabsList>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setApplyTemplateOpen(true)}
              className="flex items-center gap-1"
            >
              <FileCode className="h-3 w-3" />
              Template
            </Button>
            {isCodeTask && localTask.git?.repo && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                className="flex items-center gap-1"
              >
                <Monitor className="h-3 w-3" />
                Preview
              </Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto mt-4">
            {/* Details Tab */}
            <TabsContent value="details" className="mt-0 space-y-6">
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
                        <SelectItem key={value} value={value}>{label}</SelectItem>
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
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Project</Label>
                <Input
                  value={localTask.project || ''}
                  onChange={(e) => updateField('project', e.target.value || undefined)}
                  placeholder="Add to a project..."
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Tags</Label>
                <Input
                  value={localTask.tags?.join(', ') || ''}
                  onChange={(e) => {
                    const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                    updateField('tags', tags.length > 0 ? tags : undefined);
                  }}
                  placeholder="Add tags (comma-separated)..."
                />
              </div>

              {/* Subtasks */}
              <div className="border-t pt-4">
                <SubtasksSection
                  task={localTask}
                  onAutoCompleteChange={(value) => updateField('autoCompleteOnSubtasks', value || undefined)}
                />
              </div>

              {/* Dependencies */}
              <div className="border-t pt-4">
                <DependenciesSection
                  task={localTask}
                  onBlockedByChange={(blockedBy) => updateField('blockedBy', blockedBy)}
                />
              </div>

              {/* Time Tracking */}
              <div className="border-t pt-4">
                <TimeTrackingSection task={localTask} />
              </div>

              <div className="border-t pt-4 space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>Created: {formatDate(localTask.created)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>Updated: {formatDate(localTask.updated)}</span>
                </div>
                <div className="text-xs font-mono opacity-50">ID: {localTask.id}</div>
              </div>

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
                        This will permanently delete "{localTask.title}".
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
            </TabsContent>

            {/* Git Tab */}
            {isCodeTask && (
              <TabsContent value="git" className="mt-0">
                <GitSection
                  task={localTask}
                  onGitChange={(git) => updateField('git', git as Task['git'])}
                />
              </TabsContent>
            )}

            {/* Agent Tab */}
            {isCodeTask && (
              <TabsContent value="agent" className="mt-0">
                <AgentPanel task={localTask} />
              </TabsContent>
            )}

            {/* Changes Tab */}
            {isCodeTask && hasWorktree && (
              <TabsContent value="changes" className="mt-0">
                <DiffViewer
                  task={localTask}
                  onAddComment={(comment: ReviewComment) => {
                    const newComments = [...(localTask.reviewComments || []), comment];
                    updateField('reviewComments', newComments);
                  }}
                  onRemoveComment={(commentId: string) => {
                    const newComments = (localTask.reviewComments || []).filter(c => c.id !== commentId);
                    updateField('reviewComments', newComments.length > 0 ? newComments : undefined);
                  }}
                />
              </TabsContent>
            )}

            {/* Review Tab */}
            {isCodeTask && (
              <TabsContent value="review" className="mt-0">
                <ReviewPanel
                  task={localTask}
                  onReview={(review: ReviewState) => {
                    updateField('review', Object.keys(review).length > 0 ? review : undefined);
                  }}
                  onMergeComplete={() => {
                    // Close the panel after successful merge
                    onOpenChange(false);
                  }}
                />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </SheetContent>

      {/* Preview Panel */}
      {localTask && (
        <PreviewPanel
          task={localTask}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}

      {/* Apply Template Dialog */}
      {localTask && (
        <ApplyTemplateDialog
          task={localTask}
          open={applyTemplateOpen}
          onOpenChange={setApplyTemplateOpen}
        />
      )}
    </Sheet>
  );
}
