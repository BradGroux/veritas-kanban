import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import { WorkflowSection } from './WorkflowSection';
import { shouldDefaultTaskDetailToWork } from './TaskWorkView';
import FeatureErrorBoundary from '@/components/shared/FeatureErrorBoundary';
import { useIdentity } from '@/hooks/useIdentity';
import { clientAllowsLocalAgentControls } from '@/lib/client-policy';
import { Monitor, FileCode, Archive, MessageSquare, Workflow, X } from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';
import { useAddObservation, useDeleteObservation } from '@/hooks/useTasks';
import { PreviewPanel } from './PreviewPanel';
import {
  getAvailableTaskDetailTabs,
  getFallbackTaskDetailTabId,
  isTaskDetailTabAvailable,
  isTaskDetailTabId,
  type TaskDetailObservationInput,
  type TaskDetailNavigationTarget,
  type TaskDetailRenderContext,
  type TaskDetailTabId,
} from './task-detail-tabs';

interface TaskDetailPanelProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
  onRestore?: (taskId: string) => void;
  navigationTarget?: TaskDetailNavigationTarget | null;
}

export type { TaskDetailNavigationTarget, TaskDetailTabId } from './task-detail-tabs';

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
  const { authContext } = useIdentity();
  const taskSettings = featureSettings.tasks;
  const agentSettings = featureSettings.agents;
  const canUseLocalAgentControls = clientAllowsLocalAgentControls(authContext);
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
  const tabAvailabilityContext = useMemo(
    () => ({
      isCodeTask,
      hasWorktree,
      attachmentsEnabled: taskSettings.enableAttachments,
    }),
    [hasWorktree, isCodeTask, taskSettings.enableAttachments]
  );
  const visibleTabs = useMemo(
    () => getAvailableTaskDetailTabs(tabAvailabilityContext),
    [tabAvailabilityContext]
  );
  const fallbackTab = getFallbackTaskDetailTabId(visibleTabs, defaultTab);

  const addObservationForTask = useMemo(
    () => async (data: TaskDetailObservationInput) => {
      if (!localTask) return;
      await addObservation.mutateAsync({ taskId: localTask.id, data });
    },
    [addObservation, localTask]
  );
  const deleteObservationForTask = useMemo(
    () => async (observationId: string) => {
      if (!localTask) return;
      await deleteObservation.mutateAsync({
        taskId: localTask.id,
        observationId,
      });
    },
    [deleteObservation, localTask]
  );

  useEffect(() => {
    const activeTabAvailable = isTaskDetailTabAvailable(visibleTabs, activeTab);
    if (!activeTabAvailable) {
      setActiveTab(fallbackTab);
    }
  }, [activeTab, fallbackTab, visibleTabs]);

  useEffect(() => {
    if (!activeTaskId) {
      lastDefaultedTaskIdRef.current = undefined;
      setTimelineAttemptId(null);
      return;
    }
    if (lastDefaultedTaskIdRef.current === activeTaskId) return;
    lastDefaultedTaskIdRef.current = activeTaskId;
    setTimelineAttemptId(null);
    setActiveTab(fallbackTab);
  }, [activeTaskId, fallbackTab]);

  useEffect(() => {
    if (!activeTaskId || !navigationTarget) return;
    if (navigationTarget.timelineAttemptId !== undefined) {
      setTimelineAttemptId(navigationTarget.timelineAttemptId ?? null);
    }
    if (navigationTarget.tab && isTaskDetailTabAvailable(visibleTabs, navigationTarget.tab)) {
      setActiveTab(navigationTarget.tab);
    }
  }, [activeTaskId, navigationTarget, visibleTabs]);

  if (!localTask) return null;

  // Get current type info
  const currentType = taskTypes.find((t) => t.id === localTask.type);
  const TypeIconComponent = currentType ? getTypeIcon(currentType.icon) : null;
  const typeLabel = currentType ? currentType.label : localTask.type;
  const tabRenderContext: TaskDetailRenderContext = {
    ...tabAvailabilityContext,
    task: localTask,
    readOnly,
    timelineAttemptId,
    updateField,
    onClose: () => onOpenChange(false),
    onRestore,
    setActiveTab,
    openTaskChat: () => setTaskChatOpen(true),
    openWorkflow: () => setWorkflowOpen(true),
    setTimelineAttemptId,
    addObservation: addObservationForTask,
    deleteObservation: deleteObservationForTask,
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
          data-testid="task-detail-panel"
          className="flex h-full max-h-[100dvh] w-[min(100vw,700px)] flex-col overflow-hidden border-l bg-background bg-clip-padding text-sm shadow-lg sm:max-w-[700px]"
        >
          <Drawer.Body className="contents">
            <Stack gap={0} className="h-full overflow-hidden">
              <header className="flex-shrink-0 border-b px-4 py-4 pr-12 sm:px-6">
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
                <Drawer.Title className="mt-1 pr-8 text-lg font-semibold text-foreground sm:text-xl">
                  {readOnly ? (
                    <Text component="span" size="lg" fw={600} className="sm:text-xl">
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
                        input: 'text-lg font-semibold text-foreground sm:text-xl',
                      }}
                    />
                  )}
                </Drawer.Title>
              </header>

              {/* Action buttons above tabs */}
              <SimpleGrid
                cols={{ base: 2, sm: 3 }}
                spacing="xs"
                className="flex-shrink-0 px-4 pt-3 sm:px-6 sm:pt-4"
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTaskChatOpen(true)}
                  leftSection={<MessageSquare className="h-3 w-3" />}
                >
                  Chat
                </Button>
                {!readOnly ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setApplyTemplateOpen(true)}
                      leftSection={<FileCode className="h-3 w-3" />}
                    >
                      Template
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
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
                {!readOnly &&
                  isCodeTask &&
                  localTask.git?.repo &&
                  agentSettings.enablePreview &&
                  canUseLocalAgentControls && (
                    <Button
                      variant="outline"
                      size="sm"
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
                  if (isTaskDetailTabId(value)) setActiveTab(value);
                }}
                className="flex flex-1 flex-col overflow-hidden px-4 pt-3 pb-6 sm:px-6"
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
                  {visibleTabs.map((tab) => {
                    const tabContent = (
                      <Suspense
                        fallback={
                          <Text size="sm" c="dimmed">
                            Loading {tab.label}...
                          </Text>
                        }
                      >
                        {tab.render(tabRenderContext)}
                      </Suspense>
                    );

                    return (
                      <Tabs.Panel key={tab.id} value={tab.id} className="mt-0">
                        {tab.fallbackTitle ? (
                          <FeatureErrorBoundary fallbackTitle={tab.fallbackTitle}>
                            {tabContent}
                          </FeatureErrorBoundary>
                        ) : (
                          tabContent
                        )}
                      </Tabs.Panel>
                    );
                  })}
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
