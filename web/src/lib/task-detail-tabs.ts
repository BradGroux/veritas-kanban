export type TaskDetailTabId =
  | 'work'
  | 'details'
  | 'progress'
  | 'dependencies'
  | 'work-products'
  | 'observations'
  | 'attachments'
  | 'workflow'
  | 'access'
  | 'git'
  | 'agent'
  | 'timeline'
  | 'evidence'
  | 'changes'
  | 'review'
  | 'metrics';

export type TaskWorkspaceModeId = 'overview' | 'plan' | 'run' | 'results' | 'history';

export interface TaskWorkspaceNavigationTarget {
  version: 1;
  mode: TaskWorkspaceModeId;
  section?: TaskDetailTabId;
}

export interface TaskDetailNavigationTarget {
  tab?: TaskDetailTabId;
  workspace?: TaskWorkspaceNavigationTarget;
  timelineAttemptId?: string | null;
  timelineEventId?: string | null;
}

export interface TaskDetailAvailabilityContext {
  isCodeTask: boolean;
  hasWorktree: boolean;
  attachmentsEnabled: boolean;
  dependenciesEnabled: boolean;
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
  | 'Network'
  | 'NotebookPen'
  | 'Paperclip'
  | 'ShieldCheck'
  | 'Workflow';

export interface TaskDetailTabMetadata {
  id: TaskDetailTabId;
  label: string;
  icon?: TaskDetailTabIcon;
  fallbackTitle?: string;
  isVisible?: (context: TaskDetailAvailabilityContext) => boolean;
  isDisabled?: (context: TaskDetailAvailabilityContext) => boolean;
}

export type AvailableTaskDetailTabMetadata = TaskDetailTabMetadata & { disabled: boolean };

export interface TaskWorkspaceModeMetadata {
  id: TaskWorkspaceModeId;
  label: string;
  description: string;
  sections: readonly TaskDetailTabId[];
}

export type AvailableTaskWorkspaceModeMetadata = TaskWorkspaceModeMetadata & {
  disabled: boolean;
};

export interface TaskWorkspaceDestination {
  mode: TaskWorkspaceModeId;
  section: TaskDetailTabId;
}

export const TASK_WORKSPACE_MODE_METADATA: readonly TaskWorkspaceModeMetadata[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Current state, readiness, and the next useful action.',
    sections: ['work'],
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Task details, progress, observations, dependencies, and supporting context.',
    sections: ['details', 'progress', 'observations', 'dependencies', 'attachments'],
  },
  {
    id: 'run',
    label: 'Run',
    description: 'Agent session, workflow controls, and source context.',
    sections: ['agent', 'workflow', 'access', 'git'],
  },
  {
    id: 'results',
    label: 'Results',
    description: 'Work products, changes, review decisions, and evidence.',
    sections: ['work-products', 'evidence', 'changes', 'review'],
  },
  {
    id: 'history',
    label: 'History',
    description: 'Attempt timeline and task-level metrics.',
    sections: ['timeline', 'metrics'],
  },
];

const TASK_WORKSPACE_MODES_BY_ID = new Map(
  TASK_WORKSPACE_MODE_METADATA.map((mode) => [mode.id, mode])
);

const TASK_WORKSPACE_DESTINATIONS = new Map<TaskDetailTabId, TaskWorkspaceDestination>(
  TASK_WORKSPACE_MODE_METADATA.flatMap((mode) =>
    mode.sections.map((section) => [section, { mode: mode.id, section }] as const)
  )
);

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
    id: 'dependencies',
    label: 'Dependencies',
    icon: 'Network',
    fallbackTitle: 'Dependencies section failed to load',
    isVisible: ({ dependenciesEnabled }) => dependenciesEnabled,
  },
  {
    id: 'attachments',
    label: 'Attachments',
    icon: 'Paperclip',
    fallbackTitle: 'Attachments section failed to load',
    isVisible: ({ attachmentsEnabled }) => attachmentsEnabled,
  },
  {
    id: 'workflow',
    label: 'Workflow',
    icon: 'Workflow',
    fallbackTitle: 'Workflow section failed to load',
    isVisible: ({ isCodeTask }) => isCodeTask,
  },
  {
    id: 'access',
    label: 'Access',
    icon: 'ShieldCheck',
    fallbackTitle: 'Run access failed to load',
    isVisible: ({ isCodeTask }) => isCodeTask,
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
    id: 'evidence',
    label: 'Evidence',
    icon: 'History',
    fallbackTitle: 'Evidence timeline failed to load',
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

export function isTaskWorkspaceModeId(
  value: string | null | undefined
): value is TaskWorkspaceModeId {
  return Boolean(value && TASK_WORKSPACE_MODES_BY_ID.has(value as TaskWorkspaceModeId));
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

export function getTaskWorkspaceDestination(tabId: TaskDetailTabId): TaskWorkspaceDestination {
  return TASK_WORKSPACE_DESTINATIONS.get(tabId) ?? { mode: 'plan', section: 'details' };
}

export function getAvailableTaskWorkspaceModeMetadata(
  tabs: readonly AvailableTaskDetailTabMetadata[]
): AvailableTaskWorkspaceModeMetadata[] {
  return TASK_WORKSPACE_MODE_METADATA.map((mode) => ({
    ...mode,
    disabled: !mode.sections.some((section) => isTaskDetailTabAvailable(tabs, section)),
  }));
}

export function getTaskWorkspaceModeTabId(
  tabs: readonly AvailableTaskDetailTabMetadata[],
  modeId: TaskWorkspaceModeId,
  preferredTab?: TaskDetailTabId
): TaskDetailTabId | null {
  const mode = TASK_WORKSPACE_MODES_BY_ID.get(modeId);
  if (!mode) return null;
  if (
    preferredTab &&
    mode.sections.includes(preferredTab) &&
    isTaskDetailTabAvailable(tabs, preferredTab)
  ) {
    return preferredTab;
  }
  return mode.sections.find((section) => isTaskDetailTabAvailable(tabs, section)) ?? null;
}

export function resolveTaskDetailNavigationTab(
  target: TaskDetailNavigationTarget,
  tabs: readonly AvailableTaskDetailTabMetadata[]
): TaskDetailTabId | null {
  if (target.workspace?.version === 1) {
    const workspaceTab = getTaskWorkspaceModeTabId(
      tabs,
      target.workspace.mode,
      target.workspace.section
    );
    if (workspaceTab) return workspaceTab;
  }
  if (target.tab && isTaskDetailTabAvailable(tabs, target.tab)) return target.tab;
  return null;
}
