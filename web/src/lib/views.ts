import type { ComponentType } from 'react';

export type AppView =
  | 'board'
  | 'activity'
  | 'backlog'
  | 'archive'
  | 'templates'
  | 'workflows'
  | 'operations'
  | 'evidence'
  | 'time'
  | 'policies'
  | 'drift'
  | 'decisions'
  | 'scoring';

export type NavigationView = Exclude<AppView, 'board'>;

export type ViewIcon =
  | 'Activity'
  | 'Archive'
  | 'Clock'
  | 'ClipboardList'
  | 'FileText'
  | 'GitBranch'
  | 'Inbox'
  | 'LayoutDashboard'
  | 'ListOrdered'
  | 'Scale'
  | 'ShieldAlert'
  | 'Workflow';

export interface ViewComponentProps {
  onBack: () => void;
  onTaskClick?: (taskId: string) => void;
}

export interface ViewDefinition {
  view: AppView;
  path: string;
  label: string;
  order: number;
  showInNavigation: boolean;
  featureFlag?: string;
  title?: string;
  commandLabel: string;
  loadingLabel?: string;
  icon: ViewIcon;
  keywords: readonly string[];
  loadComponent?: () => Promise<{ default: ComponentType<ViewComponentProps> }>;
}

const VIEW_DEFINITION_LIST = [
  {
    view: 'board',
    path: '/',
    label: 'Board',
    order: 0,
    showInNavigation: false,
    commandLabel: 'Go to Board',
    icon: 'LayoutDashboard',
    keywords: ['kanban', 'home', 'main'],
  },
  {
    view: 'activity',
    path: '/activity',
    label: 'Activity',
    order: 10,
    showInNavigation: true,
    commandLabel: 'Go to Activity',
    loadingLabel: 'Loading activity feed...',
    icon: 'ListOrdered',
    keywords: ['feed', 'log', 'history'],
    loadComponent: () =>
      import('@/components/activity/ActivityFeed').then((mod) => ({
        default: mod.ActivityFeed,
      })),
  },
  {
    view: 'backlog',
    path: '/backlog',
    label: 'Backlog',
    order: 20,
    showInNavigation: true,
    commandLabel: 'Go to Backlog',
    loadingLabel: 'Loading backlog...',
    icon: 'Inbox',
    keywords: ['someday', 'maybe', 'later'],
    loadComponent: () =>
      import('@/components/backlog/BacklogPage').then((mod) => ({
        default: mod.BacklogPage,
      })),
  },
  {
    view: 'archive',
    path: '/archive',
    label: 'Archive',
    order: 30,
    showInNavigation: true,
    commandLabel: 'Go to Archive',
    loadingLabel: 'Loading archive...',
    icon: 'Archive',
    keywords: ['done', 'completed', 'old'],
    loadComponent: () =>
      import('@/components/archive/ArchivePage').then((mod) => ({
        default: mod.ArchivePage,
      })),
  },
  {
    view: 'templates',
    path: '/templates',
    label: 'Templates',
    order: 40,
    showInNavigation: true,
    commandLabel: 'Go to Templates',
    loadingLabel: 'Loading templates...',
    icon: 'FileText',
    keywords: ['templates', 'repeatable', 'task'],
    loadComponent: () =>
      import('@/components/templates/TemplatesPage').then((mod) => ({
        default: mod.TemplatesPage,
      })),
  },
  {
    view: 'workflows',
    path: '/workflows',
    label: 'Workflows',
    order: 50,
    showInNavigation: true,
    commandLabel: 'Go to Workflows',
    loadingLabel: 'Loading workflows...',
    icon: 'Workflow',
    keywords: ['automation', 'runs', 'workflow'],
    loadComponent: () =>
      import('@/components/workflows/WorkflowsPage').then((mod) => ({
        default: mod.WorkflowsPage,
      })),
  },
  {
    view: 'operations',
    path: '/operations',
    label: 'Operations',
    order: 55,
    showInNavigation: true,
    title: 'Operations Digest',
    commandLabel: 'Go to Operations',
    loadingLabel: 'Loading operations digest...',
    icon: 'ClipboardList',
    keywords: ['digest', 'standup', 'briefing', 'operations', 'schedule'],
    loadComponent: () =>
      import('@/components/digest/OperationsDigestPage').then((mod) => ({
        default: mod.OperationsDigestPage,
      })),
  },
  {
    view: 'evidence',
    path: '/evidence',
    label: 'Evidence',
    order: 57,
    showInNavigation: true,
    title: 'Evidence Timeline',
    commandLabel: 'Go to Evidence',
    loadingLabel: 'Loading evidence timeline...',
    icon: 'ListOrdered',
    keywords: ['audit', 'evidence', 'timeline', 'recap', 'source'],
    loadComponent: () =>
      import('@/components/evidence/EvidenceTimelinePage').then((mod) => ({
        default: mod.EvidenceTimelinePage,
      })),
  },
  {
    view: 'time',
    path: '/time',
    label: 'Time',
    order: 58,
    showInNavigation: true,
    title: 'Time Breakdowns',
    commandLabel: 'Go to Time',
    loadingLabel: 'Loading time breakdowns...',
    icon: 'Clock',
    keywords: ['time', 'breakdown', 'export', 'billing', 'report'],
    loadComponent: () =>
      import('@/components/time/TimeBreakdownPage').then((mod) => ({
        default: mod.TimeBreakdownPage,
      })),
  },
  {
    view: 'drift',
    path: '/drift',
    label: 'Drift Monitor',
    order: 60,
    showInNavigation: true,
    commandLabel: 'Go to Drift Monitor',
    loadingLabel: 'Loading drift monitor...',
    icon: 'Activity',
    keywords: ['behavior', 'anomaly', 'z-score', 'alerts'],
    loadComponent: () =>
      import('@/components/drift/DriftMonitor').then((mod) => ({
        default: mod.DriftMonitor,
      })),
  },
  {
    view: 'decisions',
    path: '/decisions',
    label: 'Decisions',
    order: 70,
    showInNavigation: true,
    title: 'Decision Audit Trail',
    commandLabel: 'Go to Decisions',
    loadingLabel: 'Loading decisions...',
    icon: 'GitBranch',
    keywords: ['audit', 'reasoning', 'assumptions'],
    loadComponent: () =>
      import('@/components/decisions/DecisionExplorer').then((mod) => ({
        default: mod.DecisionExplorer,
      })),
  },
  {
    view: 'scoring',
    path: '/scoring',
    label: 'Scoring',
    order: 80,
    showInNavigation: true,
    commandLabel: 'Go to Scoring',
    loadingLabel: 'Loading scoring...',
    icon: 'Scale',
    keywords: ['score', 'prioritize', 'value'],
    loadComponent: () =>
      import('@/components/scoring/ScoringProfiles').then((mod) => ({
        default: mod.ScoringProfiles,
      })),
  },
  {
    view: 'policies',
    path: '/policies',
    label: 'Policies',
    order: 90,
    showInNavigation: true,
    commandLabel: 'Go to Policies',
    loadingLabel: 'Loading policies...',
    icon: 'ShieldAlert',
    keywords: ['governance', 'rules', 'guardrails'],
    loadComponent: () =>
      import('@/components/policies/PolicyManager').then((mod) => ({
        default: mod.PolicyManager,
      })),
  },
] satisfies ViewDefinition[];

export const VIEW_DEFINITIONS: readonly ViewDefinition[] = VIEW_DEFINITION_LIST.sort(
  (a, b) => a.order - b.order
);

export const VIEW_PATHS = Object.fromEntries(
  VIEW_DEFINITIONS.map((definition) => [definition.view, definition.path])
) as Record<AppView, string>;

export const VIEW_BY_ID = Object.fromEntries(
  VIEW_DEFINITIONS.map((definition) => [definition.view, definition])
) as Record<AppView, ViewDefinition>;

export const NAVIGATION_VIEWS = VIEW_DEFINITIONS.filter(
  (definition): definition is ViewDefinition & { view: NavigationView } =>
    definition.showInNavigation && definition.view !== 'board'
);
