import {
  UiSurface,
  UiHeading,
  UiPill,
  semanticToneForLegacyColor,
  UiAction,
  UiIconAction,
} from '@/components/ui/UiVocabulary';
import { useMemo, useState } from 'react';
import {
  Alert,
  Code,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  GitBranch,
  History,
  MessageSquare,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Square,
  Terminal,
  Wifi,
  WifiOff,
  Workflow,
  XCircle,
} from 'lucide-react';
import {
  evaluateTaskReadiness,
  getTaskReadinessChecks as getSharedTaskReadinessChecks,
  isExternalTargetHref,
  normalizeSafeHref,
} from '@veritas-kanban/shared';
import type {
  Task,
  TaskAttempt,
  TaskReadinessCheck,
  WorkProductPreview,
} from '@veritas-kanban/shared';
import { useAgentStatus, useAgentStream, useStopAgent } from '@/hooks/useAgent';
import { useIdentity } from '@/hooks/useIdentity';
import { useTaskWorkProducts } from '@/hooks/useWorkProducts';
import {
  useActiveRuns,
  useRecentRuns,
  type WorkflowRun,
  type WorkflowRunStatus,
} from '@/hooks/useWorkflowStats';
import { clientAllowsLocalAgentControls } from '@/lib/client-policy';
import { API_BASE } from '@/lib/config';
import { sanitizeText } from '@/lib/sanitize';
import { ArtifactPreviewModal } from './ArtifactPreviewModal';
import { RunAccessPanel } from './RunAccessPanel';

export function getTaskReadinessChecks(task: Task, isCodeTask: boolean): TaskReadinessCheck[] {
  return getSharedTaskReadinessChecks(task, { isCodeTask });
}

export type TaskWorkViewTarget =
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
  | 'verification'
  | 'metrics';

interface TaskWorkViewProps {
  task: Task;
  isCodeTask: boolean;
  readOnly?: boolean;
  onOpenTab: (target: TaskWorkViewTarget) => void;
  onOpenChat: () => void;
  onOpenWorkflow: () => void;
}

export type TaskOverviewState =
  'new' | 'ready' | 'active' | 'blocked' | 'failed' | 'review' | 'done' | 'cancelled';

export interface TaskOverviewComposition {
  state: TaskOverviewState;
  title: string;
  detail: string;
  color: string;
  action: {
    label: string;
    target: TaskWorkViewTarget | 'workflow' | 'chat';
  };
}

interface TaskOverviewCompositionOptions {
  activeRun?: boolean;
  effectiveAttemptStatus?: TaskAttempt['status'];
}

const TASK_STATUS_LABELS: Record<string, string> = {
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  done: 'Done',
  'in-progress': 'In progress',
  todo: 'To do',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  blocked: 'red',
  cancelled: 'gray',
  done: 'green',
  'in-progress': 'blue',
  todo: 'gray',
};

/**
 * Composes the Overview's single dominant state from authoritative task data.
 * Attempt and review outcomes remain separately labelled so they are not
 * misrepresented as task lifecycle values.
 */
export function getTaskOverviewComposition(
  task: Task,
  readinessChecks: TaskReadinessCheck[],
  options: TaskOverviewCompositionOptions = {}
): TaskOverviewComposition {
  const activeRun =
    options.activeRun ?? (task.attempt?.status === 'running' || task.attempt?.status === 'pending');
  const attemptStatus = options.effectiveAttemptStatus ?? task.attempt?.status;

  if (task.status === 'blocked') {
    return {
      state: 'blocked',
      title: 'Blocked',
      detail: task.blockedReason?.note || 'This task has an unresolved blocker.',
      color: 'red',
      action: { label: 'Resolve blocker', target: 'details' },
    };
  }

  if (task.status === 'cancelled') {
    return {
      state: 'cancelled',
      title: 'Cancelled',
      detail: 'This task is closed without a completion handoff.',
      color: 'gray',
      action: { label: 'Review task', target: 'details' },
    };
  }

  if (task.status === 'done') {
    return {
      state: 'done',
      title: 'Done',
      detail: 'Execution is complete. Confirm the handoff and retained evidence.',
      color: 'green',
      action: { label: 'Review handoff', target: 'work-products' },
    };
  }

  if (activeRun) {
    return {
      state: 'active',
      title: 'Run in progress',
      detail: 'An execution attempt is active. Monitor its current step before intervening.',
      color: 'blue',
      action: { label: 'Monitor active run', target: 'agent' },
    };
  }

  if (attemptStatus === 'failed') {
    return {
      state: 'failed',
      title: 'Needs recovery',
      detail: 'The latest attempt failed. Inspect its evidence before retrying.',
      color: 'red',
      action: { label: 'Inspect failed run', target: 'agent' },
    };
  }

  const hasReviewSignal = Boolean(
    task.review || task.reviewComments?.length || attemptStatus === 'complete'
  );
  if (hasReviewSignal) {
    const needsChanges =
      task.review?.decision === 'changes-requested' || task.review?.decision === 'rejected';
    const hasUncheckedVerification = task.verificationSteps?.some((step) => !step.checked);

    if (needsChanges) {
      return {
        state: 'review',
        title: 'Changes requested',
        detail: task.review?.summary || 'Review requires follow-up before handoff.',
        color: 'yellow',
        action: { label: 'Address review decision', target: 'review' },
      };
    }

    if (hasUncheckedVerification) {
      return {
        state: 'review',
        title: 'Verification required',
        detail: 'Execution finished with verification steps still unchecked.',
        color: 'yellow',
        action: { label: 'Complete verification', target: 'verification' },
      };
    }

    return {
      state: 'review',
      title: task.review?.decision === 'approved' ? 'Approved for handoff' : 'Ready for review',
      detail: 'Execution has an outcome ready for review and handoff.',
      color: task.review?.decision === 'approved' ? 'green' : 'violet',
      action: { label: 'Review outcome', target: 'review' },
    };
  }

  const missingReadiness = readinessChecks.find((check) => !check.passed);
  if (missingReadiness) {
    return {
      state: 'new',
      title: 'Needs preparation',
      detail: missingReadiness.detail,
      color: 'yellow',
      action: { label: 'Fix readiness', target: 'details' },
    };
  }

  if (task.type === 'code' && !task.git?.worktreePath) {
    return {
      state: 'ready',
      title: 'Ready to prepare',
      detail: 'The task is defined. Prepare its isolated worktree before execution.',
      color: 'teal',
      action: { label: 'Prepare worktree', target: 'git' },
    };
  }

  return {
    state: 'ready',
    title: 'Ready to run',
    detail: 'The task has enough context and verification intent to begin execution.',
    color: 'teal',
    action: { label: 'Start execution', target: 'agent' },
  };
}

function formatDurationMs(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 'Not recorded';
  const seconds = Math.floor(value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function getAttemptDurationMs(attempt?: TaskAttempt): number | undefined {
  if (!attempt?.started) return undefined;
  const start = new Date(attempt.started).getTime();
  if (Number.isNaN(start)) return undefined;
  const end = attempt.ended ? new Date(attempt.ended).getTime() : Date.now();
  if (Number.isNaN(end) || end < start) return undefined;
  return end - start;
}

function formatTrackedSeconds(value?: number): string {
  if (!value || value <= 0) return 'Not recorded';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return minutes > 0 ? `${minutes}m` : '<1m';
}

function formatCost(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return 'Not recorded';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatAttemptStatus(status?: TaskAttempt['status']): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running';
    default:
      return 'No attempt';
  }
}

function getAttemptColor(status?: TaskAttempt['status']): string {
  switch (status) {
    case 'complete':
      return 'green';
    case 'failed':
      return 'red';
    case 'pending':
      return 'yellow';
    case 'running':
      return 'blue';
    default:
      return 'gray';
  }
}

function getVerificationSummary(task: Task): { complete: number; total: number } {
  const steps = task.verificationSteps ?? [];
  return {
    complete: steps.filter((step) => step.checked).length,
    total: steps.length,
  };
}

function getReviewLabel(task: Task): string {
  if (task.review?.decision) return task.review.decision;
  if ((task.reviewComments?.length ?? 0) > 0) return 'comments pending';
  return 'not started';
}

function getWorkflowStatusColor(status?: WorkflowRunStatus): string {
  switch (status) {
    case 'running':
      return 'blue';
    case 'blocked':
      return 'yellow';
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    default:
      return 'gray';
  }
}

function getWorkflowStatusLabel(status?: WorkflowRunStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'blocked':
      return 'Blocked';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'pending':
      return 'Pending';
    default:
      return 'No run';
  }
}

function workflowRunMatchesTask(run: WorkflowRun, taskId: string): boolean {
  const contextTaskId = run.context?.taskId ?? run.context?.task_id;
  return run.taskId === taskId || contextTaskId === taskId;
}

function getWorkflowProgress(run?: WorkflowRun): {
  complete: number;
  total: number;
  percent: number;
} {
  const steps = run?.steps ?? [];
  const total = steps.length;
  const complete = steps.filter((step) => step.status === 'completed').length;
  return { complete, total, percent: total > 0 ? Math.round((complete / total) * 100) : 0 };
}

function workflowRunSortWeight(status: WorkflowRunStatus): number {
  switch (status) {
    case 'running':
      return 0;
    case 'blocked':
      return 1;
    case 'pending':
      return 2;
    case 'failed':
      return 3;
    case 'completed':
      return 4;
  }
}

function compareWorkflowRuns(a: WorkflowRun, b: WorkflowRun): number {
  const statusDelta = workflowRunSortWeight(a.status) - workflowRunSortWeight(b.status);
  if (statusDelta !== 0) return statusDelta;
  return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
}

export function shouldDefaultTaskDetailToWork(task: Task): boolean {
  if (task.type !== 'code') return false;
  return Boolean(
    task.git ||
    task.attempt ||
    task.review ||
    task.reviewComments?.length ||
    task.verificationSteps?.length ||
    task.deliverables?.length ||
    task.status === 'blocked'
  );
}

export function TaskWorkView({
  task,
  isCodeTask,
  readOnly = false,
  onOpenTab,
  onOpenChat,
  onOpenWorkflow,
}: TaskWorkViewProps) {
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [previewProduct, setPreviewProduct] = useState<WorkProductPreview | null>(null);
  const { data: workProducts = [], isLoading: workProductsLoading } = useTaskWorkProducts(task.id);
  const {
    data: agentStatus,
    error: agentStatusError,
    isFetching: isAgentStatusFetching,
  } = useAgentStatus(task.id);
  const { outputs, isConnected, isRunning } = useAgentStream(task.id, agentStatus?.attemptId);
  const { data: activeWorkflowRuns = [] } = useActiveRuns();
  const { data: recentWorkflowRuns = [] } = useRecentRuns();
  const stopAgent = useStopAgent();
  const { authContext, hasPermission } = useIdentity();
  const canControlAgents =
    clientAllowsLocalAgentControls(authContext) && hasPermission('agent:write');
  const readinessSummary = useMemo(
    () => evaluateTaskReadiness(task, { isCodeTask }),
    [task, isCodeTask]
  );
  const latestWorkProducts = workProducts.slice(0, 3);
  const latestOutputs = outputs.slice(-6);
  const taskAttemptActive =
    task.attempt?.status === 'running' || task.attempt?.status === 'pending';
  const activeRun =
    agentStatus?.running === true ||
    ((agentStatus === undefined || isAgentStatusFetching) && (isRunning || taskAttemptActive));
  const effectiveAttemptStatus =
    !activeRun && taskAttemptActive ? ('failed' as const) : task.attempt?.status;
  const overview = getTaskOverviewComposition(task, readinessSummary.checks, {
    activeRun,
    effectiveAttemptStatus,
  });
  const retryableRun = effectiveAttemptStatus === 'failed' || effectiveAttemptStatus === 'complete';
  const stopControl = agentStatus?.controls?.controls.find((control) => control.action === 'stop');
  const canStop =
    !agentStatusError && Boolean(agentStatus?.attemptId) && stopControl?.available === true;
  const stopReason =
    (agentStatusError instanceof Error
      ? agentStatusError.message
      : agentStatusError
        ? 'Provider runtime status could not be validated.'
        : undefined) ??
    stopControl?.reason ??
    'Validated stop capability evidence is not available for this run.';
  const verification = getVerificationSummary(task);
  const attemptDuration = getAttemptDurationMs(task.attempt);
  const taskWorkflowRuns = useMemo(() => {
    const byId = new Map<string, WorkflowRun>();
    for (const run of [...activeWorkflowRuns, ...recentWorkflowRuns]) {
      if (workflowRunMatchesTask(run, task.id)) byId.set(run.id, run);
    }
    return [...byId.values()].sort(compareWorkflowRuns);
  }, [activeWorkflowRuns, recentWorkflowRuns, task.id]);
  const workflowRun = taskWorkflowRuns[0];
  const workflowProgress = getWorkflowProgress(workflowRun);
  const nextActionRestricted =
    overview.action.target === 'agent' || (overview.action.target === 'git' && !canControlAgents);
  const effectiveAction =
    nextActionRestricted && !canControlAgents
      ? {
          label: isCodeTask ? 'Review timeline' : 'Review details',
          target: isCodeTask ? ('timeline' as const) : ('details' as const),
        }
      : overview.action;
  const currentStep =
    latestOutputs.length > 0
      ? sanitizeText(latestOutputs[latestOutputs.length - 1].content).slice(0, 180)
      : activeRun
        ? 'Waiting for agent output.'
        : effectiveAttemptStatus === 'failed'
          ? 'The latest run failed. Inspect its timeline before retrying.'
          : 'No live output is available.';
  const showReadiness = overview.state === 'new' || overview.state === 'ready';
  const showReviewHandoff = Boolean(
    overview.state === 'review' ||
    overview.state === 'done' ||
    task.review ||
    task.reviewComments?.length ||
    task.deliverables?.length ||
    task.attachments?.length ||
    workProducts.length
  );

  const openNextAction = () => {
    if (effectiveAction.target === 'workflow') {
      onOpenWorkflow();
      return;
    }
    if (effectiveAction.target === 'chat') {
      onOpenChat();
      return;
    }
    onOpenTab(effectiveAction.target);
  };

  const handleStopAgent = () => {
    if (!canStop || !agentStatus?.attemptId) return;
    stopAgent.mutate({ taskId: task.id, attemptId: agentStatus.attemptId });
    setStopConfirmOpen(false);
  };

  return (
    <>
      <Stack gap="md">
        <UiSurface
          p={{ base: 'md', sm: 'lg' }}
          data-testid="task-overview-primary"
          data-state={overview.state}
        >
          <Group justify="space-between" align="flex-start" gap="lg" wrap="wrap">
            <Stack gap={6} className="min-w-0 flex-1">
              <Group gap="xs" wrap="wrap">
                <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                  Task state
                </Text>
                <UiPill
                  kind="status"
                  tone={
                    task.status === 'blocked'
                      ? 'blocked'
                      : semanticToneForLegacyColor(TASK_STATUS_COLORS[task.status] ?? 'gray')
                  }
                  aria-label={`Task lifecycle ${TASK_STATUS_LABELS[task.status] ?? task.status}`}
                >
                  {TASK_STATUS_LABELS[task.status] ?? task.status}
                </UiPill>
              </Group>
              <UiHeading>{overview.title}</UiHeading>
              <Text size="sm" c="dimmed" maw={680}>
                {overview.detail}
              </Text>
            </Stack>
            {!readOnly && (
              <UiAction
                variant="primary"
                onClick={openNextAction}
                data-testid="task-overview-primary-action"
              >
                {effectiveAction.label}
              </UiAction>
            )}
          </Group>
        </UiSurface>

        {!canControlAgents && (
          <Alert color="blue" icon={<Smartphone className="h-4 w-4" />}>
            Agent start, stop, and retry controls are hidden for this client. Review, comments,
            gates, timelines, and work products remain available.
          </Alert>
        )}

        {overview.state === 'blocked' && (
          <Alert
            color="red"
            title="What is blocking this task"
            icon={<AlertTriangle className="h-4 w-4" />}
          >
            <Stack gap="xs">
              <Text size="sm">
                {task.blockedReason?.note || 'The task is blocked without a recorded explanation.'}
              </Text>
              {(task.blockedBy?.length ?? 0) > 0 && (
                <Text size="xs" c="dimmed">
                  {task.blockedBy?.length} blocking task link
                  {task.blockedBy?.length === 1 ? '' : 's'} recorded.
                </Text>
              )}
            </Stack>
          </Alert>
        )}

        {(task.attempt || activeRun) && (
          <UiSurface p="md" aria-label="Current execution">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                <Stack gap={4} className="min-w-0">
                  <Group gap="xs" wrap="wrap">
                    <Terminal className="h-4 w-4 text-muted-foreground" />
                    <Text fw={650}>Current execution</Text>
                    <UiPill
                      kind="status"
                      tone={semanticToneForLegacyColor(getAttemptColor(effectiveAttemptStatus))}
                    >
                      Latest attempt: {formatAttemptStatus(effectiveAttemptStatus)}
                    </UiPill>
                  </Group>
                  <Text size="sm" fw={600}>
                    Current step: {currentStep}
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    <Text size="xs" c="dimmed">
                      Attempt <Code>{agentStatus?.attemptId || task.attempt?.id || 'none'}</Code>
                    </Text>
                    <Text size="xs" c="dimmed">
                      {isConnected ? (
                        <Wifi className="mr-1 inline h-3 w-3 text-green-500" />
                      ) : (
                        <WifiOff className="mr-1 inline h-3 w-3" />
                      )}
                      Event stream {isConnected ? 'connected' : 'disconnected'}
                    </Text>
                  </Group>
                </Stack>
                <Group gap="xs" wrap="wrap">
                  {activeRun && !readOnly && canControlAgents && (
                    <UiAction
                      variant="destructive"
                      leftSection={<Square className="h-3 w-3" />}
                      loading={stopAgent.isPending}
                      onClick={() => setStopConfirmOpen(true)}
                      disabled={!canStop}
                      aria-label={
                        canStop ? 'Stop active run' : `Stop active run unavailable: ${stopReason}`
                      }
                      title={canStop ? 'Stop active run' : stopReason}
                    >
                      Stop
                    </UiAction>
                  )}
                  {retryableRun && !activeRun && !readOnly && canControlAgents && (
                    <UiAction
                      variant="secondary"
                      leftSection={<RotateCcw className="h-3 w-3" />}
                      onClick={() => onOpenTab('agent')}
                    >
                      Retry in Agent
                    </UiAction>
                  )}
                  {task.attempt?.id && (
                    <UiAction
                      variant="quiet"
                      leftSection={<History className="h-3 w-3" />}
                      onClick={() => onOpenTab('timeline')}
                    >
                      Timeline
                    </UiAction>
                  )}
                  <UiAction
                    variant="quiet"
                    leftSection={<MessageSquare className="h-3 w-3" />}
                    onClick={onOpenChat}
                  >
                    Chat
                  </UiAction>
                </Group>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                <div className="rounded-md border border-border p-3">
                  <Text size="xs" c="dimmed">
                    Duration
                  </Text>
                  <Text size="sm" fw={600}>
                    {formatDurationMs(attemptDuration)}
                  </Text>
                </div>
                <div className="rounded-md border border-border p-3">
                  <Text size="xs" c="dimmed">
                    Tracked time
                  </Text>
                  <Text size="sm" fw={600}>
                    {formatTrackedSeconds(task.timeTracking?.totalSeconds)}
                  </Text>
                </div>
                <div className="rounded-md border border-border p-3">
                  <Text size="xs" c="dimmed">
                    Cost
                  </Text>
                  <Text size="sm" fw={600}>
                    {formatCost(task.actualCost)}
                  </Text>
                </div>
              </SimpleGrid>

              {latestOutputs.length > 0 && (
                <details className="rounded-md border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                    Recent run output ({outputs.length} events)
                  </summary>
                  <ScrollArea h={180} type="auto">
                    <Stack
                      gap={4}
                      className="bg-zinc-950 p-3 font-mono text-xs text-zinc-200"
                      aria-live="polite"
                    >
                      {latestOutputs.map((output, index) => (
                        <Text
                          key={`${output.timestamp}:${index}`}
                          component="pre"
                          size="xs"
                          c={
                            output.type === 'stderr'
                              ? 'red.3'
                              : output.type === 'system'
                                ? 'yellow.3'
                                : 'gray.2'
                          }
                          className="m-0 whitespace-pre-wrap break-words font-mono"
                        >
                          {output.type === 'stdin' ? 'You: ' : ''}
                          {sanitizeText(output.content)}
                        </Text>
                      ))}
                    </Stack>
                  </ScrollArea>
                </details>
              )}
            </Stack>
          </UiSurface>
        )}

        {workflowRun && (
          <UiSurface p="md" aria-label="Workflow execution">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                <Stack gap={4}>
                  <Group gap="xs" wrap="wrap">
                    <Workflow className="h-4 w-4 text-muted-foreground" />
                    <Text fw={650}>Workflow execution</Text>
                    <UiPill
                      kind="status"
                      tone={semanticToneForLegacyColor(getWorkflowStatusColor(workflowRun.status))}
                    >
                      {getWorkflowStatusLabel(workflowRun.status)}
                    </UiPill>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Workflow {workflowRun.workflowId} v{workflowRun.workflowVersion}
                  </Text>
                </Stack>
                <UiAction variant="secondary" onClick={onOpenWorkflow}>
                  Open Workflow
                </UiAction>
              </Group>
              <Group gap="xs" wrap="wrap">
                <UiPill className="font-mono">{workflowRun.id}</UiPill>
                {workflowRun.currentStep && (
                  <UiPill kind="status" tone="info">
                    {workflowRun.currentStep}
                  </UiPill>
                )}
                <Text size="xs" c="dimmed">
                  Steps {workflowProgress.complete}/{workflowProgress.total}
                </Text>
              </Group>
              <Progress
                value={workflowProgress.percent}
                color={getWorkflowStatusColor(workflowRun.status)}
              />
              {workflowRun.error && (
                <Alert color="red" icon={<AlertTriangle className="h-4 w-4" />}>
                  {workflowRun.error}
                </Alert>
              )}
            </Stack>
          </UiSurface>
        )}

        {showReadiness && (
          <UiSurface p="md" aria-label="Readiness">
            <Stack gap="sm">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Group gap="xs">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <Text fw={650}>Readiness</Text>
                </Group>
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(readinessSummary.ready ? 'green' : 'yellow')}
                >
                  {readinessSummary.passed}/{readinessSummary.total} checks
                </UiPill>
              </Group>
              <Progress
                value={readinessSummary.percent}
                color={readinessSummary.ready ? 'green' : 'yellow'}
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {readinessSummary.checks.map((check) => (
                  <Group key={check.id} gap="xs" align="flex-start" wrap="nowrap">
                    {check.passed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                    )}
                    <div className="min-w-0">
                      <Text size="sm" fw={500}>
                        {check.label}
                      </Text>
                      {!check.passed && (
                        <Text size="xs" c="dimmed">
                          {check.detail}
                        </Text>
                      )}
                    </div>
                  </Group>
                ))}
              </SimpleGrid>
            </Stack>
          </UiSurface>
        )}

        {showReviewHandoff && (
          <UiSurface p="md" aria-label="Review and handoff">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                <Group gap="xs" wrap="wrap">
                  <PackageCheck className="h-4 w-4 text-muted-foreground" />
                  <Text fw={650}>Review and handoff</Text>
                  {task.review?.decision && (
                    <UiPill
                      kind="status"
                      tone={semanticToneForLegacyColor(
                        task.review.decision === 'approved' ? 'green' : 'yellow'
                      )}
                    >
                      Review: {getReviewLabel(task)}
                    </UiPill>
                  )}
                </Group>
                <Group gap="xs">
                  {isCodeTask && (
                    <UiAction variant="secondary" onClick={() => onOpenTab('review')}>
                      Review
                    </UiAction>
                  )}
                  <UiAction variant="quiet" onClick={() => onOpenTab('work-products')}>
                    Work Products
                  </UiAction>
                </Group>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                <div className="rounded-md border border-border p-3">
                  <Text size="xs" c="dimmed">
                    Verification
                  </Text>
                  <Text size="sm" fw={600}>
                    {verification.complete}/{verification.total} complete
                  </Text>
                </div>
                <div className="rounded-md border border-border p-3">
                  <Text size="xs" c="dimmed">
                    Deliverables
                  </Text>
                  <Text size="sm" fw={600}>
                    {task.deliverables?.length ?? 0}
                  </Text>
                </div>
                <div className="rounded-md border border-border p-3">
                  <Text size="xs" c="dimmed">
                    Saved work products
                  </Text>
                  <Text size="sm" fw={600}>
                    {workProducts.length}
                  </Text>
                </div>
              </SimpleGrid>

              {task.qaGate?.required && !task.qaGate.passed && (
                <Alert color="yellow" icon={<AlertTriangle className="h-4 w-4" />}>
                  QA gate is required before completion.
                </Alert>
              )}

              {workProductsLoading ? (
                <Group gap="xs">
                  <Loader size="xs" />
                  <Text size="xs" c="dimmed">
                    Loading saved outputs...
                  </Text>
                </Group>
              ) : latestWorkProducts.length > 0 ? (
                <Stack gap={6}>
                  <Group gap="xs">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <Text size="sm" fw={600}>
                      Latest work products
                    </Text>
                  </Group>
                  {latestWorkProducts.map((product) => {
                    const sourceLink = product.sourceLinks?.find((link) =>
                      normalizeSafeHref(link.href)
                    );
                    const href = normalizeSafeHref(sourceLink?.href);
                    const external = isExternalTargetHref(href);
                    const artifactHref =
                      product.artifact?.state === 'available'
                        ? `${API_BASE}/work-products/${encodeURIComponent(product.id)}/artifact/download?version=${product.version}`
                        : undefined;

                    return (
                      <Group key={product.id} gap="xs" wrap="nowrap" align="flex-start">
                        <History className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <Text size="sm" truncate>
                            {product.title}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            v{product.version} | {product.kind}
                            {product.sourceRunId ? ` | run ${product.sourceRunId}` : ''}
                          </Text>
                          {product.artifact && (
                            <Text size="xs" c="dimmed" truncate>
                              {product.artifact.safeName} | {product.artifact.byteSize} bytes |{' '}
                              {product.artifact.state}
                            </Text>
                          )}
                        </div>
                        {product.artifact && (
                          <Tooltip label={`Preview ${product.artifact.safeName}`}>
                            <UiIconAction
                              variant="quiet"
                              aria-label={`Preview ${product.title}`}
                              onClick={() => setPreviewProduct(product)}
                            >
                              <Eye className="h-3 w-3" />
                            </UiIconAction>
                          </Tooltip>
                        )}
                        {artifactHref && (
                          <Tooltip label={`Download ${product.artifact?.safeName}`}>
                            <UiIconAction
                              variant="quiet"
                              component="a"
                              href={artifactHref}
                              aria-label={`Download ${product.title}`}
                            >
                              <Download className="h-3 w-3" />
                            </UiIconAction>
                          </Tooltip>
                        )}
                        {sourceLink && href && (
                          <Tooltip label={`Open ${sourceLink.label}`}>
                            <UiIconAction
                              variant="quiet"
                              component="a"
                              href={href}
                              target={external ? '_blank' : undefined}
                              rel={external ? 'noopener noreferrer' : undefined}
                              aria-label={`Open origin for ${product.title}`}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </UiIconAction>
                          </Tooltip>
                        )}
                      </Group>
                    );
                  })}
                </Stack>
              ) : null}
            </Stack>
          </UiSurface>
        )}

        {task.attempt?.id && (
          <details className="rounded-md border border-border bg-card">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Technical run and governance evidence
            </summary>
            <div className="border-t border-border p-3">
              <RunAccessPanel
                taskId={task.id}
                attemptId={task.attempt.id}
                live={task.attempt.status === 'running'}
              />
            </div>
          </details>
        )}

        {isCodeTask && overview.state === 'ready' && (
          <UiSurface p="md">
            <Group justify="space-between" gap="sm" wrap="wrap">
              <Group gap="xs">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Text size="sm" fw={600}>
                    Repository context
                  </Text>
                  <Text size="xs" c="dimmed">
                    {task.git?.repo || 'Repository not configured'} |{' '}
                    {task.git?.branch || task.git?.baseBranch || 'Branch not configured'}
                  </Text>
                </div>
              </Group>
              <UiAction variant="quiet" onClick={() => onOpenTab('git')}>
                Open Git
              </UiAction>
            </Group>
          </UiSurface>
        )}

        {!isCodeTask && !workflowRun && overview.state === 'ready' && (
          <UiSurface p="md">
            <Group justify="space-between" gap="sm" wrap="wrap">
              <Group gap="xs">
                <Workflow className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Text size="sm" fw={600}>
                    Workflow
                  </Text>
                  <Text size="xs" c="dimmed">
                    Start a recipe or inspect the workflows available to this task.
                  </Text>
                </div>
              </Group>
              <UiAction variant="quiet" onClick={onOpenWorkflow}>
                Open Workflow
              </UiAction>
            </Group>
          </UiSurface>
        )}
      </Stack>

      <ArtifactPreviewModal
        opened={Boolean(previewProduct)}
        productId={previewProduct?.id ?? null}
        version={previewProduct?.version}
        title={previewProduct?.title}
        onClose={() => setPreviewProduct(null)}
      />

      <Modal
        opened={stopConfirmOpen}
        onClose={() => setStopConfirmOpen(false)}
        title="Stop the active run?"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This stops the running agent attempt and marks it failed so it can be inspected or
            retried from the Agent tab.
          </Text>
          <Group justify="flex-end" gap="xs">
            <UiAction variant="secondary" onClick={() => setStopConfirmOpen(false)}>
              Cancel
            </UiAction>
            <UiAction
              variant="destructive"
              loading={stopAgent.isPending}
              onClick={handleStopAgent}
              disabled={!canStop}
              title={canStop ? 'Stop agent' : stopReason}
            >
              Stop Agent
            </UiAction>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
