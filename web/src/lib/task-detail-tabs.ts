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

export interface TaskDetailAvailabilityContext {
  isCodeTask: boolean;
  hasWorktree: boolean;
  attachmentsEnabled: boolean;
}

export type TaskDetailTabIcon =
  | 'BarChart3'
  | 'Bot'
  | 'BriefcaseBusiness'
  | 'ClipboardCheck'
  | 'Eye'
  | 'FileDiff'
  | 'Files'
  | 'GitBranch'
  | 'History'
  | 'NotebookPen'
  | 'Paperclip';

export interface TaskDetailTabMetadata {
  id: TaskDetailTabId;
  label: string;
  icon?: TaskDetailTabIcon;
  fallbackTitle?: string;
  isVisible?: (context: TaskDetailAvailabilityContext) => boolean;
  isDisabled?: (context: TaskDetailAvailabilityContext) => boolean;
}

export type AvailableTaskDetailTabMetadata = TaskDetailTabMetadata & { disabled: boolean };

export const TASK_DETAIL_TAB_METADATA: readonly TaskDetailTabMetadata[] = [
  {
    id: 'work',
    label: 'Work',
    icon: 'BriefcaseBusiness',
    fallbackTitle: 'Work view failed to load',
  },
  { id: 'details', label: 'Details' },
  {
    id: 'progress',
    label: 'Progress',
    icon: 'NotebookPen',
    fallbackTitle: 'Progress section failed to load',
  },
  {
    id: 'work-products',
    label: 'Work Products',
    icon: 'Files',
    fallbackTitle: 'Work products section failed to load',
  },
  {
    id: 'observations',
    label: 'Observations',
    icon: 'Eye',
    fallbackTitle: 'Observations section failed to load',
  },
  {
    id: 'attachments',
    label: 'Attachments',
    icon: 'Paperclip',
    fallbackTitle: 'Attachments section failed to load',
    isVisible: ({ attachmentsEnabled }) => attachmentsEnabled,
  },
  {
    id: 'git',
    label: 'Git',
    icon: 'GitBranch',
    fallbackTitle: 'Git section failed to load',
    isVisible: ({ isCodeTask }) => isCodeTask,
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: 'Bot',
    fallbackTitle: 'Agent panel failed to load',
    isVisible: ({ isCodeTask }) => isCodeTask,
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: 'History',
    fallbackTitle: 'Run timeline failed to load',
    isVisible: ({ isCodeTask }) => isCodeTask,
  },
  {
    id: 'changes',
    label: 'Changes',
    icon: 'FileDiff',
    fallbackTitle: 'Changes viewer failed to load',
    isVisible: ({ isCodeTask }) => isCodeTask,
    isDisabled: ({ hasWorktree }) => !hasWorktree,
  },
  {
    id: 'review',
    label: 'Review',
    icon: 'ClipboardCheck',
    fallbackTitle: 'Review panel failed to load',
    isVisible: ({ isCodeTask }) => isCodeTask,
  },
  {
    id: 'metrics',
    label: 'Metrics',
    icon: 'BarChart3',
    fallbackTitle: 'Metrics panel failed to load',
  },
];

const TASK_DETAIL_TAB_IDS = new Set(TASK_DETAIL_TAB_METADATA.map((tab) => tab.id));

export function isTaskDetailTabId(value: string | null | undefined): value is TaskDetailTabId {
  return Boolean(value && TASK_DETAIL_TAB_IDS.has(value as TaskDetailTabId));
}

export function getAvailableTaskDetailTabMetadata(
  context: TaskDetailAvailabilityContext
): AvailableTaskDetailTabMetadata[] {
  return TASK_DETAIL_TAB_METADATA.filter((tab) => tab.isVisible?.(context) ?? true).map((tab) => ({
    ...tab,
    disabled: tab.isDisabled?.(context) ?? false,
  }));
}

export function isTaskDetailTabAvailable(
  tabs: readonly AvailableTaskDetailTabMetadata[],
  tabId: TaskDetailTabId
): boolean {
  return tabs.some((tab) => tab.id === tabId && !tab.disabled);
}

export function getFallbackTaskDetailTabId(
  tabs: readonly AvailableTaskDetailTabMetadata[],
  preferredTab: TaskDetailTabId
): TaskDetailTabId {
  if (isTaskDetailTabAvailable(tabs, preferredTab)) return preferredTab;
  const detailsTab = tabs.find((tab) => tab.id === 'details' && !tab.disabled);
  if (detailsTab) return detailsTab.id;
  return tabs.find((tab) => !tab.disabled)?.id ?? 'details';
}
