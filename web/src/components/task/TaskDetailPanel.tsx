import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Drawer,
  Group,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
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
import { WorkProductsSection } from './WorkProductsSection';
import { AgentRunTimelinePanel } from './AgentRunTimelinePanel';
import { shouldDefaultTaskDetailToWork, TaskWorkView } from './TaskWorkView';
import FeatureErrorBoundary from '@/components/shared/FeatureErrorBoundary';
import {
  BriefcaseBusiness,
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
  Files,
  History,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Task, ReviewComment, ReviewState } from '@veritas-kanban/shared';
import { useAddObservation, useDeleteObservation } from '@/hooks/useTasks';

interface TaskDetailPanelProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
  onRestore?: (taskId: string) => void;
  navigationTarget?: TaskDetailNavigationTarget | null;
}

export type TaskDetailTabId =
  | 'work'
  | 'details'
  | 'progress'
  | 'work-products'
  | 'observations'
  | 'attachments'
  | 'git'
  | 'agent'
  | 'timeline'
  | 'changes'
  | 'review'
  | 'metrics';

export interface TaskDetailNavigationTarget {
  tab?: TaskDetailTabId;
  timelineAttemptId?: string | null;
}

interface TaskDetailTabDefinition {
  id: TaskDetailTabId;
  label: string;
  Icon?: LucideIcon;
  fallbackTitle?: string;
  codeOnly?: boolean;
  feature?: 'attachments';
  disabledWithoutWorktree?: boolean;
}

const TASK_DETAIL_TABS: readonly TaskDetailTabDefinition[] = [
  {
    id: 'work',
    label: 'Work',
    Icon: BriefcaseBusiness,
    fallbackTitle: 'Work view failed to load',
  },
  { id: 'details', label: 'Details' },
  {
    id: 'progress',
    label: 'Progress',
    Icon: NotebookPen,
    fallbackTitle: 'Progress section failed to load',
  },
  {
    id: 'work-products',
    label: 'Work Products',
    Icon: Files,
    fallbackTitle: 'Work products section failed to load',
  },
  {
    id: 'observations',
    label: 'Observations',
    Icon: Eye,
    fallbackTitle: 'Observations section failed to load',
  },
  {
    id: 'attachments',
    label: 'Attachments',
    Icon: Paperclip,
    fallbackTitle: 'Attachments section failed to load',
    feature: 'attachments',
  },
  {
    id: 'git',
    label: 'Git',
    Icon: GitBranch,
    fallbackTitle: 'Git section failed to load',
    codeOnly: true,
  },
  {
    id: 'agent',
    label: 'Agent',
    Icon: Bot,
    fallbackTitle: 'Agent panel failed to load',
    codeOnly: true,
  },
  {
    id: 'timeline',
    label: 'Timeline',
    Icon: History,
    fallbackTitle: 'Run timeline failed to load',
    codeOnly: true,
  },
  {
    id: 'changes',
    label: 'Changes',
    Icon: FileDiff,
    fallbackTitle: 'Changes viewer failed to load',
    codeOnly: true,
    disabledWithoutWorktree: true,
  },
  {
    id: 'review',
    label: 'Review',
    Icon: ClipboardCheck,
    fallbackTitle: 'Review panel failed to load',
    codeOnly: true,
  },
  {
    id: 'metrics',
    label: 'Metrics',
    Icon: BarChart3,
    fallbackTitle: 'Metrics panel failed to load',
  },
];

export function TaskDetailPanel({
  task,
  open,
  onOpenChange,
  readOnly = false,
  onRestore,
  navigationTarget,
}: TaskDetailPanelProps) {
  const { data: taskTypes = [] } = useTaskTypes();
  const { settings: featureSettings } = useFeatureSettings();
  const taskSettings = featureSettings.tasks;
  const agentSettings = featureSettings.agents;
  const { localTask, updateField, isDirty } = useDebouncedSave(task);
  const [activeTab, setActiveTab] = useState<TaskDetailTabId>('details');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);
  const [taskChatOpen, setTaskChatOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [timelineAttemptId, setTimelineAttemptId] = useState<string | null>(null);
  const lastDefaultedTaskIdRef = useRef<string | undefined>(undefined);
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

  const isCodeTask = localTask?.type === 'code';
  const hasWorktree = !!localTask?.git?.worktreePath;
  const activeTaskId = localTask?.id;
  const defaultTab = localTask && shouldDefaultTaskDetailToWork(localTask) ? 'work' : 'details';
  const visibleTabs = useMemo(
    () =>
      TASK_DETAIL_TABS.filter((tab) => {
        if (tab.codeOnly && !isCodeTask) return false;
        if (tab.feature === 'attachments' && !taskSettings.enableAttachments) return false;
        return true;
      }).map((tab) => ({
        ...tab,
        disabled: tab.disabledWithoutWorktree && !hasWorktree,
      })),
    [hasWorktree, isCodeTask, taskSettings.enableAttachments]
  );

  useEffect(() => {
    const activeTabAvailable = visibleTabs.some((tab) => tab.id === activeTab && !tab.disabled);
    if (!activeTabAvailable) {
      setActiveTab(defaultTab);
    }
  }, [activeTab, defaultTab, visibleTabs]);

  useEffect(() => {
    if (!activeTaskId) {
      lastDefaultedTaskIdRef.current = undefined;
      setTimelineAttemptId(null);
      return;
    }
    if (lastDefaultedTaskIdRef.current === activeTaskId) return;
    lastDefaultedTaskIdRef.current = activeTaskId;
    setTimelineAttemptId(null);
    setActiveTab(defaultTab);
  }, [activeTaskId, defaultTab]);

  useEffect(() => {
    if (!activeTaskId || !navigationTarget) return;
    if (navigationTarget.timelineAttemptId !== undefined) {
      setTimelineAttemptId(navigationTarget.timelineAttemptId ?? null);
    }
    if (
      navigationTarget.tab &&
      visibleTabs.some((tab) => tab.id === navigationTarget.tab && !tab.disabled)
    ) {
      setActiveTab(navigationTarget.tab);
    }
  }, [activeTaskId, navigationTarget, visibleTabs]);

  if (!localTask) return null;

  // Get current type info
  const currentType = taskTypes.find((t) => t.id === localTask.type);
  const TypeIconComponent = currentType ? getTypeIcon(currentType.icon) : null;
  const typeLabel = currentType ? currentType.label : localTask.type;
  const renderTabContent = (tabId: TaskDetailTabId) => {
    switch (tabId) {
      case 'work':
        return (
          <TaskWorkView
            task={localTask}
            isCodeTask={isCodeTask}
            readOnly={readOnly}
            onOpenTab={setActiveTab}
            onOpenChat={() => setTaskChatOpen(true)}
            onOpenWorkflow={() => setWorkflowOpen(true)}
          />
        );
      case 'details':
        return (
          <TaskDetailsTab
            task={localTask}
            onUpdate={updateField}
            onClose={() => onOpenChange(false)}
            readOnly={readOnly}
            onRestore={onRestore}
          />
        );
      case 'progress':
        return <ProgressTab task={localTask} />;
      case 'work-products':
        return <WorkProductsSection taskId={localTask.id} />;
      case 'observations':
        return (
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
        );
      case 'attachments':
        return <AttachmentsSection task={localTask} />;
      case 'git':
        return (
          <GitSection
            task={localTask}
            onGitChange={(git) => updateField('git', git as Task['git'])}
          />
        );
      case 'agent':
        return (
          <AgentPanel
            task={localTask}
            onOpenTimeline={(attemptId) => {
              setTimelineAttemptId(attemptId ?? null);
              setActiveTab('timeline');
            }}
          />
        );
      case 'timeline':
        return (
          <AgentRunTimelinePanel
            task={localTask}
            initialAttemptId={timelineAttemptId}
            onOpenTab={setActiveTab}
            onOpenWorkflow={() => setWorkflowOpen(true)}
          />
        );
      case 'changes':
        if (!hasWorktree) return null;
        return (
          <DiffViewer
            task={localTask}
            onAddComment={(comment: ReviewComment) => {
              const newComments = [...(localTask.reviewComments || []), comment];
              updateField('reviewComments', newComments);
            }}
            onRemoveComment={(commentId: string) => {
              const newComments = (localTask.reviewComments || []).filter(
                (comment) => comment.id !== commentId
              );
              updateField('reviewComments', newComments.length > 0 ? newComments : undefined);
            }}
          />
        );
      case 'review':
        return (
          <ReviewPanel
            task={localTask}
            onReview={(review: ReviewState) => {
              updateField('review', Object.keys(review).length > 0 ? review : undefined);
            }}
            onMergeComplete={() => onOpenChange(false)}
          />
        );
      case 'metrics':
        return <TaskMetricsPanel task={localTask} />;
    }
  };

  return (
    <>
      <Drawer.Root
        closeOnEscape
        lockScroll
        onClose={() => onOpenChange(false)}
        opened={open}
        position="right"
        returnFocus
        size="auto"
        trapFocus
      >
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" />
        <Drawer.Content
          aria-label={`Task details: ${localTask.title}`}
          className="flex h-full w-[700px] flex-col overflow-hidden border-l bg-background bg-clip-padding text-sm shadow-lg sm:max-w-[700px]"
        >
          <Drawer.Body className="contents">
            <Stack gap={0} className="h-full overflow-hidden">
              <header className="flex-shrink-0 border-b px-6 py-4 pr-12">
                <Group
                  gap="xs"
                  justify="space-between"
                  wrap="nowrap"
                  className="text-muted-foreground"
                >
                  <Group gap="xs" wrap="nowrap">
                    {TypeIconComponent && <TypeIconComponent className="h-4 w-4" />}
                    <Text size="xs" tt="uppercase" className="tracking-wide">
                      {typeLabel} Task
                    </Text>
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    {readOnly && (
                      <Badge
                        color="gray"
                        variant="light"
                        leftSection={<Archive className="h-3 w-3" />}
                      >
                        Archived
                      </Badge>
                    )}
                    {!readOnly && isDirty && (
                      <Text size="xs" c="yellow.5">
                        Saving...
                      </Text>
                    )}
                    <ActionIcon
                      aria-label="Close task details"
                      variant="subtle"
                      color="gray"
                      onClick={() => onOpenChange(false)}
                    >
                      <X className="h-4 w-4" />
                    </ActionIcon>
                  </Group>
                </Group>
                <Drawer.Title className="mt-1 pr-8 text-xl font-semibold text-foreground">
                  {readOnly ? (
                    <Text component="span" size="xl" fw={600}>
                      {localTask.title}
                    </Text>
                  ) : (
                    <TextInput
                      value={localTask.title}
                      onChange={(e) => updateField('title', e.currentTarget.value)}
                      variant="unstyled"
                      placeholder="Task title..."
                      aria-label="Task title"
                      classNames={{
                        input: 'text-xl font-semibold text-foreground',
                      }}
                    />
                  )}
                </Drawer.Title>
              </header>

              {/* Action buttons above tabs */}
              <SimpleGrid cols={3} spacing="xs" className="flex-shrink-0 px-6 pt-4">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setTaskChatOpen(true)}
                  leftSection={<MessageSquare className="h-3 w-3" />}
                >
                  Chat
                </Button>
                {!readOnly ? (
                  <>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setApplyTemplateOpen(true)}
                      leftSection={<FileCode className="h-3 w-3" />}
                    >
                      Template
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setWorkflowOpen(true)}
                      leftSection={<Workflow className="h-3 w-3" />}
                    >
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
                    size="xs"
                    onClick={() => setPreviewOpen(true)}
                    className="col-span-2"
                    leftSection={<Monitor className="h-3 w-3" />}
                  >
                    Preview
                  </Button>
                )}
              </SimpleGrid>

              <Tabs
                value={activeTab}
                onChange={(value) => {
                  if (value) setActiveTab(value as TaskDetailTabId);
                }}
                className="flex flex-1 flex-col overflow-hidden px-6 pt-3 pb-6"
              >
                <Tabs.List className="w-full flex-shrink-0 justify-start overflow-x-auto">
                  {visibleTabs.map((tab) => {
                    const Icon = tab.Icon;
                    return (
                      <Tabs.Tab
                        key={tab.id}
                        value={tab.id}
                        disabled={tab.disabled}
                        className="flex-none px-3"
                        leftSection={Icon ? <Icon className="h-3 w-3" /> : undefined}
                      >
                        {tab.label}
                      </Tabs.Tab>
                    );
                  })}
                </Tabs.List>

                <div className="mt-4 flex-1 overflow-y-auto pr-1">
                  {visibleTabs.map((tab) => (
                    <Tabs.Panel key={tab.id} value={tab.id} className="mt-0">
                      {tab.fallbackTitle ? (
                        <FeatureErrorBoundary fallbackTitle={tab.fallbackTitle}>
                          {renderTabContent(tab.id)}
                        </FeatureErrorBoundary>
                      ) : (
                        renderTabContent(tab.id)
                      )}
                    </Tabs.Panel>
                  ))}
                </div>
              </Tabs>
            </Stack>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>

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
    </>
  );
}
