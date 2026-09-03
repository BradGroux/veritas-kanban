import {
  UiPill,
  UiAction,
  UiIconAction,
  semanticToneForLegacyColor,
} from '@/components/ui/UiVocabulary';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Group, Select, Stack, Tabs, Text, TextInput } from '@mantine/core';
import { useTaskTypes, getTypeIcon } from '@/hooks/useTaskTypes';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { useDebouncedSave } from '@/hooks/useDebouncedSave';
import { registerOpenTaskConflictSurface, resolveTaskConflict } from '@/hooks/useTaskConflicts';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { TaskConflictAlert } from './TaskConflictAlert';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import { WorkflowSection } from './WorkflowSection';
import { shouldDefaultTaskDetailToWork } from './TaskWorkView';
import FeatureErrorBoundary from '@/components/shared/FeatureErrorBoundary';
import { useIdentity } from '@/hooks/useIdentity';
import { clientAllowsLocalAgentControls } from '@/lib/client-policy';
import {
  Archive,
  CheckCircle2,
  ClipboardList,
  FileCode,
  History,
  LayoutDashboard,
  Maximize2,
  MessageSquare,
  Minimize2,
  Monitor,
  PlayCircle,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';
import { useAddObservation, useDeleteObservation } from '@/hooks/useTasks';
import { PreviewPanel } from './PreviewPanel';
import {
  getAvailableTaskDetailTabs,
  getAvailableTaskWorkspaceModeMetadata,
  getFallbackTaskDetailTabId,
  getTaskWorkspaceDestination,
  getTaskWorkspaceModeTabId,
  isTaskDetailTabAvailable,
  isTaskDetailTabId,
  isTaskWorkspaceModeId,
  resolveTaskDetailNavigationTab,
  type TaskDetailObservationInput,
  type TaskDetailNavigationTarget,
  type TaskDetailRenderContext,
  type TaskDetailTabId,
  type TaskWorkspaceModeId,
} from './task-detail-tabs';

interface TaskDetailPanelProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
  onRestore?: (taskId: string) => void;
  navigationTarget?: TaskDetailNavigationTarget | null;
}

export type {
  TaskDetailNavigationTarget,
  TaskDetailTabId,
  TaskWorkspaceModeId,
} from './task-detail-tabs';

const WORKSPACE_MODE_ICONS: Record<TaskWorkspaceModeId, LucideIcon> = {
  overview: LayoutDashboard,
  plan: ClipboardList,
  run: PlayCircle,
  results: CheckCircle2,
  history: History,
};

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
  const { localTask, updateField, isDirty, isSaving, conflict, retryConflict, discardConflict } =
    useDebouncedSave(task);
  const [activeTab, setActiveTab] = useState<TaskDetailTabId>('details');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);
  const [taskChatOpen, setTaskChatOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [timelineAttemptId, setTimelineAttemptId] = useState<string | null>(null);
  const [timelineEventId, setTimelineEventId] = useState<string | null>(null);
  const lastDefaultedTaskIdRef = useRef<string | undefined>(undefined);
  const lastTabByModeRef = useRef<Partial<Record<TaskWorkspaceModeId, TaskDetailTabId>>>({});
  const addObservation = useAddObservation();
  const deleteObservation = useDeleteObservation();
  const nestedOverlayOpen = previewOpen || applyTemplateOpen || taskChatOpen || workflowOpen;
  const activeTaskId = localTask?.id;

  useEffect(() => {
    if (!open || !activeTaskId) return;
    return registerOpenTaskConflictSurface(activeTaskId);
  }, [activeTaskId, open]);

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && !nestedOverlayOpen) {
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [nestedOverlayOpen, open, onOpenChange]);

  const isCodeTask = localTask?.type === 'code';
  const hasWorktree = !!localTask?.git?.worktreePath;
  const defaultTab = localTask && shouldDefaultTaskDetailToWork(localTask) ? 'work' : 'details';
  const tabAvailabilityContext = useMemo(
    () => ({
      isCodeTask,
      hasWorktree,
      attachmentsEnabled: taskSettings.enableAttachments,
      dependenciesEnabled: taskSettings.enableDependencies,
    }),
    [hasWorktree, isCodeTask, taskSettings.enableAttachments, taskSettings.enableDependencies]
  );
  const visibleTabs = useMemo(
    () => getAvailableTaskDetailTabs(tabAvailabilityContext),
    [tabAvailabilityContext]
  );
  const fallbackTab = getFallbackTaskDetailTabId(visibleTabs, defaultTab);
  const workspaceModes = useMemo(
    () => getAvailableTaskWorkspaceModeMetadata(visibleTabs),
    [visibleTabs]
  );
  const activeMode = getTaskWorkspaceDestination(activeTab).mode;
  const activeModeMetadata = workspaceModes.find((mode) => mode.id === activeMode);
  const activeModeTabs = useMemo(
    () =>
      activeModeMetadata?.sections.flatMap((section) => {
        const tab = visibleTabs.find((candidate) => candidate.id === section);
        return tab ? [tab] : [];
      }) ?? [],
    [activeModeMetadata, visibleTabs]
  );
  const activeTabMetadata = visibleTabs.find((tab) => tab.id === activeTab);

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
    lastTabByModeRef.current[activeMode] = activeTab;
  }, [activeMode, activeTab]);

  useEffect(() => {
    if (!activeTaskId) {
      lastDefaultedTaskIdRef.current = undefined;
      setTimelineAttemptId(null);
      setTimelineEventId(null);
      return;
    }
    if (lastDefaultedTaskIdRef.current === activeTaskId) return;
    lastDefaultedTaskIdRef.current = activeTaskId;
    lastTabByModeRef.current = {};
    setTimelineAttemptId(null);
    setTimelineEventId(null);
    setActiveTab(fallbackTab);
  }, [activeTaskId, fallbackTab]);

  useEffect(() => {
    if (!activeTaskId || !navigationTarget) return;
    if (navigationTarget.timelineAttemptId !== undefined) {
      setTimelineAttemptId(navigationTarget.timelineAttemptId ?? null);
      if (navigationTarget.timelineEventId === undefined) {
        setTimelineEventId(null);
      }
    }
    if (navigationTarget.timelineEventId !== undefined) {
      setTimelineEventId(navigationTarget.timelineEventId ?? null);
    }
    const targetTab = resolveTaskDetailNavigationTab(navigationTarget, visibleTabs);
    if (targetTab) setActiveTab(targetTab);
  }, [activeTaskId, navigationTarget, visibleTabs]);

  if (!localTask) return null;

  const resultsReviewStatus = !isCodeTask
    ? null
    : localTask.review?.decision === 'approved'
      ? { label: 'Approved', color: 'green' }
      : localTask.review?.decision === 'changes-requested'
        ? { label: 'Changes required', color: 'yellow' }
        : localTask.review?.decision === 'rejected'
          ? { label: 'Rejected', color: 'red' }
          : localTask.status === 'done'
            ? { label: 'Complete', color: 'green' }
            : !hasWorktree
              ? { label: 'Worktree required', color: 'gray' }
              : { label: 'Decision needed', color: 'yellow' };
  const openFindingCount = localTask.reviewComments?.length ?? 0;

  const selectWorkspaceMode = (mode: TaskWorkspaceModeId) => {
    const nextTab = getTaskWorkspaceModeTabId(visibleTabs, mode, lastTabByModeRef.current[mode]);
    if (nextTab) setActiveTab(nextTab);
  };

  const setTimelineAttemptTarget = (attemptId: string | null) => {
    setTimelineAttemptId(attemptId);
    setTimelineEventId(null);
  };

  // Get current type info
  const currentType = taskTypes.find((t) => t.id === localTask.type);
  const TypeIconComponent = currentType ? getTypeIcon(currentType.icon) : null;
  const typeLabel = currentType ? currentType.label : localTask.type;
  const tabRenderContext: TaskDetailRenderContext = {
    ...tabAvailabilityContext,
    task: localTask,
    readOnly,
    timelineAttemptId,
    timelineEventId,
    updateField,
    onClose: () => onOpenChange(false),
    onRestore,
    setActiveTab,
    openTaskChat: () => setTaskChatOpen(true),
    openWorkflow: () => setWorkflowOpen(true),
    setTimelineAttemptId: setTimelineAttemptTarget,
    addObservation: addObservationForTask,
    deleteObservation: deleteObservationForTask,
  };

  return (
    <>
      <Drawer.Root
        closeOnEscape={!nestedOverlayOpen}
        lockScroll
        onClose={() => onOpenChange(false)}
        opened={open}
        position="right"
        returnFocus
        size="auto"
        trapFocus
      >
        <Drawer.Overlay className="veritas-overlay fixed inset-0 z-50" />
        <Drawer.Content
          aria-label={`Task workspace: ${localTask.title}`}
          data-presentation={expanded ? 'expanded' : 'drawer'}
          data-testid="task-detail-panel"
          className={`veritas-overlay-surface flex h-full min-h-0 max-h-[100dvh] flex-col overflow-hidden bg-background bg-clip-padding text-sm shadow-lg ${
            expanded
              ? '!w-screen !max-w-none border-l-0'
              : 'w-[min(100vw,960px)] border-l sm:w-[min(92vw,960px)] lg:w-[min(62vw,960px)]'
          }`}
        >
          <Drawer.Body className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            <Stack gap={0} className="min-h-0 flex-1 overflow-hidden">
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
                      <UiPill leftSection={<Archive className="h-3 w-3" />}>Archived</UiPill>
                    )}
                    {!readOnly && isDirty && (
                      <Text size="xs" c="yellow.5">
                        {isSaving ? 'Saving...' : 'Unsaved changes'}
                      </Text>
                    )}
                    <UiAction
                      variant="quiet"
                      onClick={() => setTaskChatOpen(true)}
                      leftSection={<MessageSquare className="h-3.5 w-3.5" />}
                    >
                      Chat
                    </UiAction>
                    <UiIconAction
                      variant="quiet"
                      aria-label={
                        expanded ? 'Exit expanded task workspace' : 'Expand task workspace'
                      }
                      aria-pressed={expanded}
                      title={expanded ? 'Exit expanded workspace' : 'Expand workspace'}
                      onClick={() => setExpanded((current) => !current)}
                    >
                      {expanded ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </UiIconAction>
                    <UiIconAction
                      variant="quiet"
                      aria-label="Close task workspace"
                      onClick={() => onOpenChange(false)}
                    >
                      <X className="h-4 w-4" />
                    </UiIconAction>
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

              {conflict && (
                <TaskConflictAlert
                  conflict={conflict}
                  taskTitle={localTask.title}
                  onRetry={retryConflict}
                  onDiscard={discardConflict}
                  onDismiss={() => resolveTaskConflict(localTask.id)}
                />
              )}

              <div className="flex min-h-0 flex-1 overflow-hidden">
                <nav
                  aria-label="Task workspace modes"
                  data-testid="task-workspace-mode-navigation"
                  className="veritas-overlay-scroll hidden w-48 flex-shrink-0 flex-col gap-1 overflow-y-auto border-r px-3 py-4 sm:flex"
                >
                  <Text size="xs" tt="uppercase" c="dimmed" className="mb-1 px-2 tracking-wide">
                    Workspace
                  </Text>
                  {workspaceModes.map((mode, index) => {
                    const Icon = WORKSPACE_MODE_ICONS[mode.id];
                    const active = mode.id === activeMode;
                    return (
                      <UiAction
                        variant="quiet"
                        key={mode.id}
                        type="button"
                        disabled={mode.disabled}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => selectWorkspaceMode(mode.id)}
                        className="vk-ui-nav-action w-full text-left"
                      >
                        <span aria-hidden="true" className="w-4 font-mono text-[10px] opacity-70">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                        <span>{mode.label}</span>
                      </UiAction>
                    );
                  })}
                </nav>

                <Tabs
                  value={activeTab}
                  onChange={(value) => {
                    if (isTaskDetailTabId(value)) setActiveTab(value);
                  }}
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                  <div className="flex-shrink-0 border-b px-4 py-3 sm:px-5">
                    <Select
                      label="Task workspace mode"
                      value={activeMode}
                      data={workspaceModes.map((mode) => ({
                        value: mode.id,
                        label: mode.label,
                        disabled: mode.disabled,
                      }))}
                      onChange={(value) => {
                        if (isTaskWorkspaceModeId(value)) selectWorkspaceMode(value);
                      }}
                      allowDeselect={false}
                      className="mb-3 sm:hidden"
                    />

                    <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                      <div className="min-w-0">
                        <Text id="task-workspace-mode-heading" component="h2" fw={650} size="sm">
                          {activeModeMetadata?.label ?? 'Workspace'}
                        </Text>
                        <Text size="xs" c="dimmed" className="mt-0.5 max-w-xl">
                          {activeModeMetadata?.description}
                        </Text>
                      </div>
                      <Group gap="xs" wrap="wrap">
                        {activeMode === 'run' && (
                          <UiPill>Task: {localTask.status.replaceAll('-', ' ')}</UiPill>
                        )}
                        {activeMode === 'results' && resultsReviewStatus && (
                          <>
                            <UiPill
                              kind="status"
                              tone={semanticToneForLegacyColor(resultsReviewStatus.color)}
                            >
                              Review: {resultsReviewStatus.label}
                            </UiPill>
                            {openFindingCount > 0 && (
                              <UiPill kind="status" tone="warning">
                                {openFindingCount} open finding{openFindingCount === 1 ? '' : 's'}
                              </UiPill>
                            )}
                          </>
                        )}
                        {!readOnly && activeMode === 'plan' && (
                          <UiAction
                            variant="secondary"
                            onClick={() => setApplyTemplateOpen(true)}
                            leftSection={<FileCode className="h-3 w-3" />}
                          >
                            Template
                          </UiAction>
                        )}
                        {!readOnly &&
                          activeMode === 'run' &&
                          activeTab === 'git' &&
                          isCodeTask &&
                          localTask.git?.repo &&
                          agentSettings.enablePreview &&
                          canUseLocalAgentControls && (
                            <UiAction
                              variant="secondary"
                              onClick={() => setPreviewOpen(true)}
                              leftSection={<Monitor className="h-3 w-3" />}
                            >
                              Preview
                            </UiAction>
                          )}
                      </Group>
                    </Group>

                    {activeModeTabs.length > 1 && (
                      <>
                        <Tabs.List
                          aria-label={`${activeModeMetadata?.label ?? 'Workspace'} sections`}
                          className="mt-3 !hidden w-full justify-start overflow-x-auto sm:!flex"
                        >
                          {activeModeTabs.map((tab) => {
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
                        <Select
                          label={`${activeModeMetadata?.label ?? 'Workspace'} section`}
                          value={activeTab}
                          data={activeModeTabs.map((tab) => ({
                            value: tab.id,
                            label: tab.label,
                            disabled: tab.disabled,
                          }))}
                          onChange={(value) => {
                            if (isTaskDetailTabId(value)) setActiveTab(value);
                          }}
                          allowDeselect={false}
                          className="mt-3 sm:hidden"
                        />
                      </>
                    )}
                  </div>

                  <div
                    className="veritas-overlay-scroll min-h-0 flex-1 overflow-y-scroll overscroll-contain px-4 py-4 sm:px-5 sm:py-5"
                    data-testid="task-detail-scroll-region"
                    aria-labelledby="task-workspace-mode-heading task-workspace-section-heading"
                    tabIndex={0}
                  >
                    <Text id="task-workspace-section-heading" component="h3" className="sr-only">
                      {activeTabMetadata?.label ?? 'Task details'}
                    </Text>
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
                        <Tabs.Panel key={tab.id} value={tab.id} className="mt-0 min-h-full">
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
              </div>
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
