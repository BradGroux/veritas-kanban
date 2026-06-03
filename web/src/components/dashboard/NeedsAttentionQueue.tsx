import { useMemo, useState } from 'react';
import { Badge, Button, Group, Select, Skeleton, Text, Tooltip } from '@mantine/core';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  Filter,
  GitPullRequest,
  Hourglass,
  RotateCcw,
  ShieldAlert,
  Workflow,
} from 'lucide-react';
import type { DriftAlert, Task } from '@veritas-kanban/shared';
import { usePendingAgentApprovals, type AgentApprovalRequest } from '@/hooks/useAgent';
import { useDriftAlerts, useAcknowledgeDriftAlert } from '@/hooks/useDrift';
import {
  useFailedRuns,
  useTaskCost,
  type FailedRunDetails,
  type MetricsPeriod,
  type TaskCostMetrics,
} from '@/hooks/useMetrics';
import {
  useMarkNotificationDelivered,
  useUndeliveredNotifications,
  type AgentNotification,
} from '@/hooks/useNotifications';
import { useTasks } from '@/hooks/useTasks';
import { useActiveRuns, useRecentRuns, type WorkflowRun } from '@/hooks/useWorkflowStats';
import { cn } from '@/lib/utils';

const DISMISSED_STORAGE_KEY = 'veritas-needs-attention-dismissed-v1';
const MAX_VISIBLE_ITEMS = 12;
const STALE_IN_PROGRESS_MS = 3 * 24 * 60 * 60 * 1000;
const VERY_STALE_IN_PROGRESS_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_WORKTREE_MS = 7 * 24 * 60 * 60 * 1000;
const VERY_STALE_WORKTREE_MS = 14 * 24 * 60 * 60 * 1000;
const STUCK_WORKFLOW_MS = 2 * 60 * 60 * 1000;

type NeedsAttentionSeverity = 'critical' | 'high' | 'medium' | 'low';

type NeedsAttentionSource =
  | 'approval'
  | 'blocked-task'
  | 'drift-alert'
  | 'expensive-run'
  | 'failed-run'
  | 'notification'
  | 'stale-task'
  | 'stale-worktree'
  | 'stuck-workflow'
  | 'unreviewed-diff';

type NeedsAttentionDestination = 'drift' | 'failed-runs' | 'task' | 'url' | 'workflows';

export interface NeedsAttentionItem {
  id: string;
  dedupeKey: string;
  title: string;
  reason: string;
  nextAction: string;
  severity: NeedsAttentionSeverity;
  source: NeedsAttentionSource;
  sourceLabel: string;
  timestamp: string;
  owner?: string;
  agent?: string;
  taskId?: string;
  taskTitle?: string;
  taskType?: string;
  project?: string;
  destination: NeedsAttentionDestination;
  destinationLabel: string;
  targetUrl?: string;
  notificationId?: string;
  driftAlertId?: string;
  workflowRunId?: string;
}

export interface BuildNeedsAttentionInput {
  activeRuns?: WorkflowRun[];
  approvals?: AgentApprovalRequest[];
  driftAlerts?: DriftAlert[];
  failedRuns?: FailedRunDetails[];
  notifications?: AgentNotification[];
  project?: string;
  recentRuns?: WorkflowRun[];
  taskCost?: TaskCostMetrics;
  tasks?: Task[];
}

interface NeedsAttentionQueueProps {
  period: MetricsPeriod;
  project?: string;
  from?: string;
  to?: string;
  onOpenDrift?: () => void;
  onOpenErrors?: () => void;
  onOpenTask?: (taskId: string) => void;
  onOpenWorkflows?: () => void;
}

const SEVERITY_RANK: Record<NeedsAttentionSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const SOURCE_LABELS: Record<NeedsAttentionSource, string> = {
  approval: 'Approval',
  'blocked-task': 'Blocked task',
  'drift-alert': 'Drift',
  'expensive-run': 'Cost',
  'failed-run': 'Failed run',
  notification: 'Notification',
  'stale-task': 'Stale task',
  'stale-worktree': 'Worktree',
  'stuck-workflow': 'Workflow',
  'unreviewed-diff': 'Review',
};

const SOURCE_ICONS: Record<NeedsAttentionSource, typeof AlertTriangle> = {
  approval: ShieldAlert,
  'blocked-task': AlertTriangle,
  'drift-alert': ShieldAlert,
  'expensive-run': DollarSign,
  'failed-run': AlertTriangle,
  notification: Bell,
  'stale-task': Hourglass,
  'stale-worktree': GitPullRequest,
  'stuck-workflow': Workflow,
  'unreviewed-diff': GitPullRequest,
};

const AGE_FILTERS = [
  { value: 'all', label: 'Any age' },
  { value: '1d', label: '24h+' },
  { value: '3d', label: '3d+' },
  { value: '7d', label: '7d+' },
  { value: '30d', label: '30d+' },
] as const;

const AGE_FILTER_MS: Record<(typeof AGE_FILTERS)[number]['value'], number> = {
  all: 0,
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function parseTimestamp(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageMs(timestamp: string, now: Date): number {
  return Math.max(0, now.getTime() - parseTimestamp(timestamp));
}

function formatAge(timestamp: string, now: Date): string {
  const elapsed = ageMs(timestamp, now);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatSourceValue(value: string): string {
  return SOURCE_LABELS[value as NeedsAttentionSource] ?? value;
}

function getTaskOwner(task?: Task): string | undefined {
  if (!task) return undefined;
  if (task.agent && task.agent !== 'auto') return task.agent;
  return task.agents?.[0];
}

function getBlockedReason(task: Task): string {
  if (task.blockedReason?.note) return task.blockedReason.note;
  if (task.blockedReason?.category) {
    return `Blocked by ${task.blockedReason.category.replaceAll('-', ' ')}`;
  }
  if (task.blockedBy?.length) {
    return `Blocked by ${task.blockedBy.length} task${task.blockedBy.length === 1 ? '' : 's'}`;
  }
  return 'Task is marked blocked without a recorded reason';
}

function maybeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function itemProject(task: Task | undefined, sourceProject?: string): string | undefined {
  return sourceProject ?? task?.project;
}

function projectMatches(selectedProject: string | undefined, candidateProject: string | undefined) {
  return !selectedProject || candidateProject === selectedProject;
}

function isOpenTask(task: Task): boolean {
  return task.status !== 'done' && task.status !== 'cancelled';
}

function hasReviewDecision(task: Task): boolean {
  return Boolean(task.review?.decision);
}

function addItem(map: Map<string, NeedsAttentionItem>, item: NeedsAttentionItem) {
  const existing = map.get(item.dedupeKey);
  if (!existing || SEVERITY_RANK[item.severity] > SEVERITY_RANK[existing.severity]) {
    map.set(item.dedupeKey, item);
  }
}

export function buildNeedsAttentionItems(
  input: BuildNeedsAttentionInput,
  now = new Date()
): NeedsAttentionItem[] {
  const items = new Map<string, NeedsAttentionItem>();
  const tasks = input.tasks ?? [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  for (const task of tasks) {
    if (!projectMatches(input.project, task.project)) continue;

    const owner = getTaskOwner(task);
    if (task.status === 'blocked') {
      addItem(items, {
        id: `blocked-task:${task.id}`,
        dedupeKey: `blocked-task:${task.id}:${task.updated}`,
        title: task.title,
        reason: getBlockedReason(task),
        nextAction: 'Open task',
        severity: 'high',
        source: 'blocked-task',
        sourceLabel: SOURCE_LABELS['blocked-task'],
        timestamp: task.updated,
        owner,
        agent: owner,
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
        project: task.project,
        destination: 'task',
        destinationLabel: `task:${task.id}`,
      });
    }

    if (task.status === 'in-progress' && ageMs(task.updated, now) >= STALE_IN_PROGRESS_MS) {
      const severity = ageMs(task.updated, now) >= VERY_STALE_IN_PROGRESS_MS ? 'high' : 'medium';
      addItem(items, {
        id: `stale-task:${task.id}`,
        dedupeKey: `stale-task:${task.id}:${task.updated}`,
        title: task.title,
        reason: `In progress for ${formatAge(task.updated, now)} without an update`,
        nextAction: 'Check progress',
        severity,
        source: 'stale-task',
        sourceLabel: SOURCE_LABELS['stale-task'],
        timestamp: task.updated,
        owner,
        agent: owner,
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
        project: task.project,
        destination: 'task',
        destinationLabel: `task:${task.id}`,
      });
    }

    if (
      isOpenTask(task) &&
      task.git?.worktreePath &&
      ageMs(task.updated, now) >= STALE_WORKTREE_MS
    ) {
      const severity = ageMs(task.updated, now) >= VERY_STALE_WORKTREE_MS ? 'high' : 'medium';
      addItem(items, {
        id: `stale-worktree:${task.id}`,
        dedupeKey: `stale-worktree:${task.id}:${task.updated}:${task.git.worktreePath}`,
        title: task.title,
        reason: `Worktree has been open for ${formatAge(task.updated, now)}`,
        nextAction: 'Review worktree',
        severity,
        source: 'stale-worktree',
        sourceLabel: SOURCE_LABELS['stale-worktree'],
        timestamp: task.updated,
        owner,
        agent: owner,
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
        project: task.project,
        destination: 'task',
        destinationLabel: `task:${task.id}`,
      });
    }

    if (isOpenTask(task) && task.git && !hasReviewDecision(task)) {
      const hasReviewTarget = Boolean(task.git.prUrl || task.git.worktreePath || task.git.branch);
      if (hasReviewTarget) {
        addItem(items, {
          id: `unreviewed-diff:${task.id}`,
          dedupeKey: `unreviewed-diff:${task.id}:${task.updated}:${task.git.prUrl ?? task.git.branch}`,
          title: task.title,
          reason: task.git.prUrl
            ? 'Pull request is available without a recorded review decision'
            : 'Worktree or branch is available without a recorded review decision',
          nextAction: 'Review diff',
          severity: 'medium',
          source: 'unreviewed-diff',
          sourceLabel: SOURCE_LABELS['unreviewed-diff'],
          timestamp: task.updated,
          owner,
          agent: owner,
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          project: task.project,
          destination: 'task',
          destinationLabel: task.git.prUrl ?? `task:${task.id}`,
          targetUrl: task.git.prUrl,
        });
      }
    }
  }

  for (const run of input.failedRuns ?? []) {
    const task = run.taskId ? taskById.get(run.taskId) : undefined;
    const project = itemProject(task, run.project);
    if (!projectMatches(input.project, project)) continue;

    addItem(items, {
      id: `failed-run:${run.taskId ?? run.agent}:${run.timestamp}`,
      dedupeKey: `failed-run:${run.taskId ?? run.agent}:${run.timestamp}`,
      title: task?.title ?? (run.taskId ? `Task ${run.taskId}` : `Failed ${run.agent} run`),
      reason: run.errorMessage ?? 'Agent run failed without an error message',
      nextAction: task ? 'Open task' : 'Open failed runs',
      severity: 'high',
      source: 'failed-run',
      sourceLabel: SOURCE_LABELS['failed-run'],
      timestamp: run.timestamp,
      owner: getTaskOwner(task) ?? run.agent,
      agent: run.agent,
      taskId: run.taskId,
      taskTitle: task?.title,
      taskType: task?.type,
      project,
      destination: task ? 'task' : 'failed-runs',
      destinationLabel: task ? `task:${task.id}` : 'dashboard:failed-runs',
    });
  }

  for (const approval of input.approvals ?? []) {
    const task = approval.taskId ? taskById.get(approval.taskId) : undefined;
    const project = itemProject(task);
    if (!projectMatches(input.project, project)) continue;

    addItem(items, {
      id: `approval:${approval.id}`,
      dedupeKey: `approval:${approval.id}:${approval.createdAt}`,
      title: task?.title ?? `Approval requested by ${approval.agentId}`,
      reason: approval.details ?? `Agent requested permission for ${approval.action}`,
      nextAction: task ? 'Open task' : 'Review approval',
      severity: 'high',
      source: 'approval',
      sourceLabel: SOURCE_LABELS.approval,
      timestamp: approval.createdAt,
      owner: approval.agentId,
      agent: approval.agentId,
      taskId: approval.taskId,
      taskTitle: task?.title,
      taskType: task?.type,
      project,
      destination: task ? 'task' : 'workflows',
      destinationLabel: task ? `task:${task.id}` : `approval:${approval.id}`,
    });
  }

  for (const alert of input.driftAlerts ?? []) {
    if (input.project) continue;

    addItem(items, {
      id: `drift-alert:${alert.id}`,
      dedupeKey: `drift-alert:${alert.id}:${alert.timestamp}`,
      title: `${alert.agentId} drift alert`,
      reason: `${alert.metric.replaceAll('_', ' ')} moved to z-score ${alert.zScore.toFixed(1)}`,
      nextAction: 'Open drift monitor',
      severity:
        alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'high' : 'low',
      source: 'drift-alert',
      sourceLabel: SOURCE_LABELS['drift-alert'],
      timestamp: alert.timestamp,
      owner: alert.agentId,
      agent: alert.agentId,
      destination: 'drift',
      destinationLabel: 'view:drift',
      driftAlertId: alert.id,
    });
  }

  const avgCost = input.taskCost?.avgCostPerTask ?? 0;
  const expensiveThreshold = Math.max(1, avgCost > 0 ? avgCost * 2 : 1);
  for (const cost of input.taskCost?.tasks ?? []) {
    if (cost.estimatedCost < expensiveThreshold) continue;
    const task = taskById.get(cost.taskId);
    const project = itemProject(task);
    if (!projectMatches(input.project, project)) continue;

    addItem(items, {
      id: `expensive-run:${cost.taskId}`,
      dedupeKey: `expensive-run:${cost.taskId}:${cost.estimatedCost}:${cost.runs}`,
      title: task?.title ?? cost.taskTitle ?? `Task ${cost.taskId}`,
      reason: `$${cost.estimatedCost.toFixed(2)} across ${cost.runs} run${cost.runs === 1 ? '' : 's'}`,
      nextAction: 'Inspect task cost',
      severity: cost.estimatedCost >= expensiveThreshold * 2 ? 'high' : 'medium',
      source: 'expensive-run',
      sourceLabel: SOURCE_LABELS['expensive-run'],
      timestamp: task?.updated ?? new Date(now).toISOString(),
      owner: getTaskOwner(task),
      agent: getTaskOwner(task),
      taskId: cost.taskId,
      taskTitle: task?.title ?? cost.taskTitle,
      taskType: task?.type,
      project,
      destination: 'task',
      destinationLabel: `task:${cost.taskId}`,
    });
  }

  const runById = new Map<string, WorkflowRun>();
  for (const run of [...(input.activeRuns ?? []), ...(input.recentRuns ?? [])]) {
    if (!runById.has(run.id)) runById.set(run.id, run);
  }
  for (const run of runById.values()) {
    const taskId = run.taskId ?? maybeString(run.context?.taskId);
    const task = taskId ? taskById.get(taskId) : undefined;
    const contextProject = maybeString(run.context?.project);
    const project = itemProject(task, contextProject);
    if (!projectMatches(input.project, project)) continue;

    const isBlocked = run.status === 'blocked';
    const isStuckRunning =
      run.status === 'running' && ageMs(run.startedAt, now) >= STUCK_WORKFLOW_MS;
    if (!isBlocked && !isStuckRunning) continue;

    addItem(items, {
      id: `stuck-workflow:${run.id}`,
      dedupeKey: `stuck-workflow:${run.id}:${run.status}:${run.currentStep ?? ''}`,
      title: task?.title ?? `Workflow ${run.workflowId}`,
      reason: isBlocked
        ? `Workflow is blocked${run.currentStep ? ` at ${run.currentStep}` : ''}`
        : `Workflow has been running for ${formatAge(run.startedAt, now)}`,
      nextAction: task ? 'Open task' : 'Open workflows',
      severity: isBlocked ? 'high' : 'medium',
      source: 'stuck-workflow',
      sourceLabel: SOURCE_LABELS['stuck-workflow'],
      timestamp: run.lastCheckpoint ?? run.startedAt,
      owner: getTaskOwner(task),
      agent: getTaskOwner(task),
      taskId,
      taskTitle: task?.title,
      taskType: task?.type,
      project,
      destination: task ? 'task' : 'workflows',
      destinationLabel: task ? `task:${task.id}` : `workflow:${run.workflowId}`,
      workflowRunId: run.id,
    });
  }

  for (const notification of input.notifications ?? []) {
    const task = notification.taskId ? taskById.get(notification.taskId) : undefined;
    const project = itemProject(task, notification.project);
    if (!projectMatches(input.project, project)) continue;

    addItem(items, {
      id: `notification:${notification.id}`,
      dedupeKey: `notification:${notification.dedupeKey ?? notification.id}:${notification.createdAt}`,
      title:
        notification.title ??
        notification.taskTitle ??
        `Notification for ${notification.targetAgent}`,
      reason: notification.content,
      nextAction: notification.taskId ? 'Open task' : 'Open target',
      severity:
        notification.type.includes('failure') || notification.type.includes('review')
          ? 'high'
          : 'medium',
      source: 'notification',
      sourceLabel: SOURCE_LABELS.notification,
      timestamp: notification.createdAt,
      owner: notification.targetAgent,
      agent: notification.targetAgent,
      taskId: notification.taskId,
      taskTitle: task?.title ?? notification.taskTitle,
      taskType: task?.type,
      project,
      destination: notification.taskId ? 'task' : notification.targetUrl ? 'url' : 'failed-runs',
      destinationLabel:
        notification.targetUrl ??
        (notification.taskId ? `task:${notification.taskId}` : 'notification'),
      targetUrl: notification.targetUrl,
      notificationId: notification.id,
    });
  }

  return [...items.values()].sort((a, b) => {
    const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) return severityDelta;
    return parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp);
  });
}

function severityColor(severity: NeedsAttentionSeverity) {
  switch (severity) {
    case 'critical':
      return 'red';
    case 'high':
      return 'orange';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'gray';
  }
}

function readDismissedItems(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(DISMISSED_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeDismissedItems(next: Record<string, string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(next));
}

function filterItems(
  items: NeedsAttentionItem[],
  filters: {
    age: string;
    agent: string;
    severity: string;
    source: string;
    taskType: string;
  },
  dismissed: Record<string, string>,
  now: Date
) {
  return items.filter((item) => {
    if (dismissed[item.dedupeKey]) return false;
    if (filters.severity !== 'all' && item.severity !== filters.severity) return false;
    if (filters.source !== 'all' && item.source !== filters.source) return false;
    if (filters.agent !== 'all' && item.agent !== filters.agent && item.owner !== filters.agent) {
      return false;
    }
    if (filters.taskType !== 'all' && item.taskType !== filters.taskType) return false;

    const minimumAge = AGE_FILTER_MS[filters.age as keyof typeof AGE_FILTER_MS] ?? 0;
    if (minimumAge > 0 && ageMs(item.timestamp, now) < minimumAge) return false;
    return true;
  });
}

function uniqueOptions(values: Array<string | undefined>, allLabel: string) {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
  return [{ value: 'all', label: allLabel }, ...unique.map((value) => ({ value, label: value }))];
}

export function NeedsAttentionQueue({
  period,
  project,
  from,
  to,
  onOpenDrift,
  onOpenErrors,
  onOpenTask,
  onOpenWorkflows,
}: NeedsAttentionQueueProps) {
  const now = useMemo(() => new Date(), []);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [taskTypeFilter, setTaskTypeFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');
  const [dismissed, setDismissed] = useState<Record<string, string>>(() => readDismissedItems());

  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: failedRuns = [], isLoading: failedRunsLoading } = useFailedRuns(
    period,
    project,
    20,
    from,
    to
  );
  const { data: taskCost, isLoading: taskCostLoading } = useTaskCost(period, project, from, to);
  const { data: activeRuns = [], isLoading: activeRunsLoading } = useActiveRuns();
  const { data: recentRuns = [], isLoading: recentRunsLoading } = useRecentRuns();
  const { data: driftAlerts = [], isLoading: driftLoading } = useDriftAlerts({
    acknowledged: false,
  });
  const { data: approvals = [], isLoading: approvalsLoading } = usePendingAgentApprovals();
  const { data: notifications = [], isLoading: notificationsLoading } =
    useUndeliveredNotifications(50);
  const acknowledgeDrift = useAcknowledgeDriftAlert();
  const markNotificationDelivered = useMarkNotificationDelivered();

  const allItems = useMemo(
    () =>
      buildNeedsAttentionItems(
        {
          activeRuns,
          approvals,
          driftAlerts,
          failedRuns,
          notifications,
          project,
          recentRuns,
          taskCost,
          tasks,
        },
        now
      ),
    [
      activeRuns,
      approvals,
      driftAlerts,
      failedRuns,
      notifications,
      project,
      recentRuns,
      taskCost,
      tasks,
      now,
    ]
  );

  const visibleItems = useMemo(
    () =>
      filterItems(
        allItems,
        {
          age: ageFilter,
          agent: agentFilter,
          severity: severityFilter,
          source: sourceFilter,
          taskType: taskTypeFilter,
        },
        dismissed,
        now
      ),
    [ageFilter, agentFilter, allItems, dismissed, now, severityFilter, sourceFilter, taskTypeFilter]
  );

  const visibleLimited = visibleItems.slice(0, MAX_VISIBLE_ITEMS);
  const dismissedCount = allItems.filter((item) => dismissed[item.dedupeKey]).length;
  const isLoading =
    tasksLoading ||
    failedRunsLoading ||
    taskCostLoading ||
    activeRunsLoading ||
    recentRunsLoading ||
    driftLoading ||
    approvalsLoading ||
    notificationsLoading;

  const severityOptions = [
    { value: 'all', label: 'All severity' },
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];
  const sourceOptions = uniqueOptions(
    allItems.map((item) => item.source),
    'All sources'
  ).map((option) => ({
    value: option.value,
    label: option.value === 'all' ? option.label : formatSourceValue(option.value),
  }));
  const agentOptions = uniqueOptions(
    allItems.map((item) => item.agent ?? item.owner),
    'All owners'
  );
  const taskTypeOptions = uniqueOptions(
    allItems.map((item) => item.taskType),
    'All types'
  );

  const persistDismissed = (next: Record<string, string>) => {
    setDismissed(next);
    writeDismissedItems(next);
  };

  const dismissItem = (item: NeedsAttentionItem) => {
    persistDismissed({ ...dismissed, [item.dedupeKey]: new Date().toISOString() });
    if (item.notificationId) {
      markNotificationDelivered.mutate(item.notificationId);
    }
    if (item.driftAlertId) {
      acknowledgeDrift.mutate(item.driftAlertId);
    }
  };

  const restoreDismissed = () => {
    persistDismissed({});
  };

  const openItem = (item: NeedsAttentionItem) => {
    if (item.taskId) {
      onOpenTask?.(item.taskId);
      return;
    }
    if (item.destination === 'drift') {
      onOpenDrift?.();
      return;
    }
    if (item.destination === 'workflows') {
      onOpenWorkflows?.();
      return;
    }
    if (item.destination === 'failed-runs') {
      onOpenErrors?.();
      return;
    }
    if (item.destination === 'url' && item.targetUrl && typeof window !== 'undefined') {
      window.location.assign(item.targetUrl);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4" aria-labelledby="needs-attention-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            <h3 id="needs-attention-title" className="text-sm font-semibold">
              Needs Attention
            </h3>
            <Badge size="sm" variant="light" color={visibleItems.length ? 'orange' : 'green'}>
              {visibleItems.length}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Prioritized actions from tasks, runs, workflows, notifications, and drift.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5 lg:min-w-[680px]">
          <Select
            aria-label="Filter needs attention by severity"
            data={severityOptions}
            value={severityFilter}
            onChange={(value) => setSeverityFilter(value ?? 'all')}
            allowDeselect={false}
            leftSection={<Filter className="h-3.5 w-3.5" />}
            size="xs"
          />
          <Select
            aria-label="Filter needs attention by source"
            data={sourceOptions}
            value={sourceFilter}
            onChange={(value) => setSourceFilter(value ?? 'all')}
            allowDeselect={false}
            size="xs"
          />
          <Select
            aria-label="Filter needs attention by owner"
            data={agentOptions}
            value={agentFilter}
            onChange={(value) => setAgentFilter(value ?? 'all')}
            allowDeselect={false}
            size="xs"
          />
          <Select
            aria-label="Filter needs attention by task type"
            data={taskTypeOptions}
            value={taskTypeFilter}
            onChange={(value) => setTaskTypeFilter(value ?? 'all')}
            allowDeselect={false}
            size="xs"
          />
          <Select
            aria-label="Filter needs attention by age"
            data={AGE_FILTERS}
            value={ageFilter}
            onChange={(value) => setAgeFilter(value ?? 'all')}
            allowDeselect={false}
            size="xs"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : visibleLimited.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span>No matching action items.</span>
          {dismissedCount > 0 && (
            <Button
              leftSection={<RotateCcw className="h-3.5 w-3.5" />}
              size="compact-xs"
              variant="subtle"
              onClick={restoreDismissed}
            >
              Restore dismissed
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-4 divide-y rounded-md border" role="list">
          {visibleLimited.map((item) => {
            const Icon = SOURCE_ICONS[item.source];
            return (
              <div
                key={item.dedupeKey}
                className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                role="listitem"
              >
                <button
                  type="button"
                  className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openItem(item)}
                  aria-label={`${item.nextAction}: ${item.title}`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
                        item.severity === 'critical' && 'border-red-500/40 bg-red-500/10',
                        item.severity === 'high' && 'border-orange-500/40 bg-orange-500/10',
                        item.severity === 'medium' && 'border-yellow-500/40 bg-yellow-500/10',
                        item.severity === 'low' && 'border-muted bg-muted/40'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Text component="span" fw={600} size="sm" lineClamp={1}>
                          {item.title}
                        </Text>
                        <Badge size="xs" variant="light" color={severityColor(item.severity)}>
                          {item.severity}
                        </Badge>
                        <Badge size="xs" variant="outline">
                          {item.sourceLabel}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {item.reason}
                      </p>
                      <Group gap="xs" className="mt-2 text-xs text-muted-foreground">
                        <span>{formatAge(item.timestamp, now)} old</span>
                        {item.owner && <span>Owner: {item.owner}</span>}
                        {item.project && <span>Project: {item.project}</span>}
                        {item.taskType && <span>Type: {item.taskType}</span>}
                        <span>Destination: {item.destinationLabel}</span>
                      </Group>
                    </div>
                  </div>
                </button>

                <Group gap="xs" justify="flex-end" wrap="nowrap">
                  <Button
                    leftSection={<ExternalLink className="h-3.5 w-3.5" />}
                    size="compact-xs"
                    variant="light"
                    onClick={() => openItem(item)}
                  >
                    {item.nextAction}
                  </Button>
                  <Tooltip
                    label={
                      item.notificationId
                        ? 'Mark read'
                        : item.driftAlertId
                          ? 'Acknowledge'
                          : 'Dismiss'
                    }
                  >
                    <Button size="compact-xs" variant="subtle" onClick={() => dismissItem(item)}>
                      {item.notificationId
                        ? 'Mark read'
                        : item.driftAlertId
                          ? 'Acknowledge'
                          : 'Dismiss'}
                    </Button>
                  </Tooltip>
                </Group>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Showing {visibleLimited.length} of {visibleItems.length}
          {visibleItems.length > MAX_VISIBLE_ITEMS ? `, capped at ${MAX_VISIBLE_ITEMS}` : ''}
        </span>
        {dismissedCount > 0 && (
          <Button
            leftSection={<RotateCcw className="h-3.5 w-3.5" />}
            size="compact-xs"
            variant="subtle"
            onClick={restoreDismissed}
          >
            Restore dismissed ({dismissedCount})
          </Button>
        )}
      </div>
    </section>
  );
}
