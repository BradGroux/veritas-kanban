import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useTaskTypes, getTypeIcon } from '@/hooks/useTaskTypes';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { useDebouncedSave } from '@/hooks/useDebouncedSave';
import { TaskDetailsTab } from './detail/TaskDetailsTab';
import { ProgressTab } from './detail/ProgressTab';
import { GitSection } from './GitSection';
import { AgentPanel } from './AgentPanel';
import { DiffViewer } from './DiffViewer';
import { ReviewPanel } from './ReviewPanel';
import { PreviewPanel } from './PreviewPanel';
import { AttachmentsSection } from './AttachmentsSection';
import { ObservationsSection } from './ObservationsSection';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import { TaskMetricsPanel } from './TaskMetricsPanel';
import { WorkflowSection } from './WorkflowSection';
import FeatureErrorBoundary from '@/components/shared/FeatureErrorBoundary';
import {
  GitBranch,
  Bot,
  FileDiff,
  ClipboardCheck,
  Monitor,
  FileCode,
  Paperclip,
  Archive,
  BarChart3,
  MessageSquare,
  NotebookPen,
  Workflow,
  Eye,
} from 'lucide-react';
import type { Task, ReviewComment, ReviewState } from '@veritas-kanban/shared';
import { useAddObservation, useDeleteObservation } from '@/hooks/useTasks';

interface TaskDetailPanelProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
  onRestore?: (taskId: string) => void;
}

export function TaskDetailPanel({
  task,
  open,
  onOpenChange,
  readOnly = false,
  onRestore,
}: TaskDetailPanelProps) {
  const { data: taskTypes = [] } = useTaskTypes();
  const { settings: featureSettings } = useFeatureSettings();
  const taskSettings = featureSettings.tasks;
  const agentSettings = featureSettings.agents;
  const { localTask, updateField, isDirty } = useDebouncedSave(task);
  const [activeTab, setActiveTab] = useState('details');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);
  const [taskChatOpen, setTaskChatOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const addObservation = useAddObservation();
  const deleteObservation = useDeleteObservation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  if (!localTask) return null;

  const isCodeTask = localTask.type === 'code';
  const hasWorktree = !!localTask.git?.worktreePath;

  // Get current type info
  const currentType = taskTypes.find((t) => t.id === localTask.type);
  const TypeIconComponent = currentType ? getTypeIcon(currentType.icon) : null;
  const typeLabel = currentType ? currentType.label : localTask.type;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="!w-[92vw] sm:!w-[min(92vw,1120px)] sm:!max-w-none overflow-hidden flex flex-col p-0"
        aria-label={`Task details: ${localTask.title}`}
      >
        <SheetHeader className="space-y-1 flex-shrink-0 border-b px-6 py-4 pr-12">
          <div className="flex items-center gap-2 text-muted-foreground">
            {TypeIconComponent && <TypeIconComponent className="h-4 w-4" />}
            <span className="text-xs uppercase tracking-wide">{typeLabel} Task</span>
            {readOnly && (
              <Badge variant="secondary" className="flex items-center gap-1 ml-auto">
                <Archive className="h-3 w-3" />
                Archived
              </Badge>
            )}
            {!readOnly && isDirty && (
              <span className="text-xs text-amber-500 ml-auto">Saving...</span>
            )}
          </div>
          <SheetTitle className="pr-8">
            {readOnly ? (
              <span className="text-xl font-semibold">{localTask.title}</span>
            ) : (
              <Input
                value={localTask.title}
                onChange={(e) => updateField('title', e.target.value)}
                className="text-xl font-semibold border-0 px-0 focus-visible:ring-0 bg-transparent"
                placeholder="Task title..."
                aria-label="Task title"
              />
            )}
          </SheetTitle>
        </SheetHeader>

        {/* Action buttons above tabs */}
        <div className="grid grid-cols-3 gap-2 px-6 pt-4 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTaskChatOpen(true)}
            className="flex items-center justify-center gap-1 w-full"
          >
            <MessageSquare className="h-3 w-3" />
            Chat
          </Button>
          {!readOnly ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setApplyTemplateOpen(true)}
                className="flex items-center justify-center gap-1 w-full"
              >
                <FileCode className="h-3 w-3" />
                Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWorkflowOpen(true)}
                className="flex items-center justify-center gap-1 w-full"
              >
                <Workflow className="h-3 w-3" />
                Workflow
              </Button>
            </>
          ) : (
            <>
              <div />
              <div />
            </>
          )}
          {!readOnly && isCodeTask && localTask.git?.repo && agentSettings.enablePreview && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(true)}
              className="flex items-center justify-center gap-1 w-full col-span-2"
            >
              <Monitor className="h-3 w-3" />
              Preview
            </Button>
          )}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden px-6 pt-3 pb-6"
        >
          <TabsList className="w-full flex-shrink-0 justify-start overflow-x-auto">
            <TabsTrigger value="details" className="flex-none px-3">
              Details
            </TabsTrigger>
            <TabsTrigger value="progress" className="flex-none px-3">
              <NotebookPen className="h-3 w-3" />
              Progress
            </TabsTrigger>
            <TabsTrigger value="observations" className="flex-none px-3">
              <Eye className="h-3 w-3" />
              Observations
            </TabsTrigger>
            {taskSettings.enableAttachments && (
              <TabsTrigger value="attachments" className="flex-none px-3">
                <Paperclip className="h-3 w-3" />
                Attachments
              </TabsTrigger>
            )}
            {isCodeTask && (
              <>
                <TabsTrigger value="git" className="flex-none px-3">
                  <GitBranch className="h-3 w-3" />
                  Git
                </TabsTrigger>
                <TabsTrigger value="agent" className="flex-none px-3">
                  <Bot className="h-3 w-3" />
                  Agent
                </TabsTrigger>
                <TabsTrigger value="changes" disabled={!hasWorktree} className="flex-none px-3">
                  <FileDiff className="h-3 w-3" />
                  Changes
                </TabsTrigger>
                <TabsTrigger value="review" className="flex-none px-3">
                  <ClipboardCheck className="h-3 w-3" />
                  Review
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="metrics" className="flex-none px-3">
              <BarChart3 className="h-3 w-3" />
              Metrics
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4 pr-1">
            {/* Details Tab */}
            <TabsContent value="details" className="mt-0">
              <TaskDetailsTab
                task={localTask}
                onUpdate={updateField}
                onClose={() => onOpenChange(false)}
                readOnly={readOnly}
                onRestore={onRestore}
              />
            </TabsContent>

            {/* Progress Tab */}
            <TabsContent value="progress" className="mt-0">
              <FeatureErrorBoundary fallbackTitle="Progress section failed to load">
                <ProgressTab task={localTask} />
              </FeatureErrorBoundary>
            </TabsContent>

            {/* Observations Tab */}
            <TabsContent value="observations" className="mt-0">
              <FeatureErrorBoundary fallbackTitle="Observations section failed to load">
                <ObservationsSection
                  task={localTask}
                  onAddObservation={async (data) => {
                    await addObservation.mutateAsync({ taskId: localTask.id, data });
                  }}
                  onDeleteObservation={async (observationId) => {
                    await deleteObservation.mutateAsync({
                      taskId: localTask.id,
                      observationId,
                    });
                  }}
                />
              </FeatureErrorBoundary>
            </TabsContent>

            {/* Attachments Tab */}
            {taskSettings.enableAttachments && (
              <TabsContent value="attachments" className="mt-0">
                <FeatureErrorBoundary fallbackTitle="Attachments section failed to load">
                  <AttachmentsSection task={localTask} />
                </FeatureErrorBoundary>
              </TabsContent>
            )}

            {/* Git Tab */}
            {isCodeTask && (
              <TabsContent value="git" className="mt-0">
                <FeatureErrorBoundary fallbackTitle="Git section failed to load">
                  <GitSection
                    task={localTask}
                    onGitChange={(git) => updateField('git', git as Task['git'])}
                  />
                </FeatureErrorBoundary>
              </TabsContent>
            )}

            {/* Agent Tab */}
            {isCodeTask && (
              <TabsContent value="agent" className="mt-0">
                <FeatureErrorBoundary fallbackTitle="Agent panel failed to load">
                  <AgentPanel task={localTask} />
                </FeatureErrorBoundary>
              </TabsContent>
            )}

            {/* Changes Tab */}
            {isCodeTask && hasWorktree && (
              <TabsContent value="changes" className="mt-0">
                <FeatureErrorBoundary fallbackTitle="Changes viewer failed to load">
                  <DiffViewer
                    task={localTask}
                    onAddComment={(comment: ReviewComment) => {
                      const newComments = [...(localTask.reviewComments || []), comment];
                      updateField('reviewComments', newComments);
                    }}
                    onRemoveComment={(commentId: string) => {
                      const newComments = (localTask.reviewComments || []).filter(
                        (c) => c.id !== commentId
                      );
                      updateField(
                        'reviewComments',
                        newComments.length > 0 ? newComments : undefined
                      );
                    }}
                  />
                </FeatureErrorBoundary>
              </TabsContent>
            )}

            {/* Review Tab */}
            {isCodeTask && (
              <TabsContent value="review" className="mt-0">
                <FeatureErrorBoundary fallbackTitle="Review panel failed to load">
                  <ReviewPanel
                    task={localTask}
                    onReview={(review: ReviewState) => {
                      updateField('review', Object.keys(review).length > 0 ? review : undefined);
                    }}
                    onMergeComplete={() => onOpenChange(false)}
                  />
                </FeatureErrorBoundary>
              </TabsContent>
            )}

            {/* Metrics Tab */}
            <TabsContent value="metrics" className="mt-0">
              <FeatureErrorBoundary fallbackTitle="Metrics panel failed to load">
                <TaskMetricsPanel task={localTask} />
              </FeatureErrorBoundary>
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>

      {/* Preview Panel */}
      {localTask && (
        <PreviewPanel task={localTask} open={previewOpen} onOpenChange={setPreviewOpen} />
      )}

      {/* Apply Template Dialog */}
      {localTask && (
        <ApplyTemplateDialog
          task={localTask}
          open={applyTemplateOpen}
          onOpenChange={setApplyTemplateOpen}
        />
      )}

      {/* Task-Scoped Chat Panel */}
      {localTask && (
        <ChatPanel open={taskChatOpen} onOpenChange={setTaskChatOpen} taskId={localTask.id} />
      )}

      {/* Workflow Section */}
      {localTask && (
        <WorkflowSection task={localTask} open={workflowOpen} onOpenChange={setWorkflowOpen} />
      )}
    </Sheet>
  );
}
