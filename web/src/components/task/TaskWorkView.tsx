import { useMemo } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  GitBranch,
  History,
  MessageSquare,
  PackageCheck,
  Play,
  Route,
  ShieldCheck,
  Workflow,
  XCircle,
} from 'lucide-react';
import {
  evaluateTaskReadiness,
  getTaskReadinessChecks as getSharedTaskReadinessChecks,
} from '@veritas-kanban/shared';
import type { Task, TaskAttempt, TaskReadinessCheck, TaskStatus } from '@veritas-kanban/shared';
import { useTaskWorkProducts } from '@/hooks/useWorkProducts';

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
  | 'metrics';

interface TaskWorkViewProps {
  task: Task;
  isCodeTask: boolean;
  readOnly?: boolean;
  onOpenTab: (target: TaskWorkViewTarget) => void;
  onOpenChat: () => void;
  onOpenWorkflow: () => void;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  blocked: 'red',
  cancelled: 'gray',
  done: 'green',
  'in-progress': 'blue',
  todo: 'gray',
};

function formatDate(value?: string): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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

function getNextAction(
  task: Task,
  readinessChecks: TaskReadinessCheck[]
): {
  label: string;
  detail: string;
  target: TaskWorkViewTarget | 'workflow' | 'chat';
} {
  if (task.status === 'blocked') {
    return {
      label: 'Resolve blocker',
      detail: task.blockedReason?.note || 'Review the blocker details before starting execution.',
      target: 'details',
    };
  }

  const missingReadiness = readinessChecks.find((check) => !check.passed);
  if (missingReadiness) {
    return {
      label: 'Fix readiness',
      detail: missingReadiness.detail,
      target: 'details',
    };
  }

  if (task.attempt?.status === 'running' || task.attempt?.status === 'pending') {
    return {
      label: 'Monitor active run',
      detail: 'An agent attempt is active. Watch the live session before changing task state.',
      target: 'agent',
    };
  }

  if (task.type === 'code' && !task.git?.worktreePath) {
    return {
      label: 'Prepare worktree',
      detail: 'Create a worktree before starting the agent.',
      target: 'git',
    };
  }

  const uncheckedVerification = task.verificationSteps?.some((step) => !step.checked);
  if (uncheckedVerification) {
    return {
      label: 'Complete verification',
      detail: 'There are unchecked verification steps.',
      target: 'details',
    };
  }

  if (task.review?.decision === 'changes-requested' || task.review?.decision === 'rejected') {
    return {
      label: 'Address review decision',
      detail: task.review.summary || 'Review requires follow-up before handoff.',
      target: 'review',
    };
  }

  if (task.status === 'done') {
    return {
      label: 'Review handoff',
      detail: 'Task is marked done. Confirm work products and completion evidence.',
      target: 'work-products',
    };
  }

  return {
    label: 'Start or continue execution',
    detail: 'Task is ready enough to start the agent or workflow.',
    target: 'agent',
  };
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
  const { data: workProducts = [], isLoading: workProductsLoading } = useTaskWorkProducts(task.id);
  const readinessSummary = useMemo(
    () => evaluateTaskReadiness(task, { isCodeTask }),
    [task, isCodeTask]
  );
  const readinessChecks = readinessSummary.checks;
  const passedReadiness = readinessSummary.passed;
  const readinessPercent = readinessSummary.percent;
  const nextAction = getNextAction(task, readinessChecks);
  const verification = getVerificationSummary(task);
  const latestWorkProducts = workProducts.slice(0, 3);

  const openNextAction = () => {
    if (nextAction.target === 'workflow') {
      onOpenWorkflow();
      return;
    }
    if (nextAction.target === 'chat') {
      onOpenChat();
      return;
    }
    onOpenTab(nextAction.target);
  };

  return (
    <Stack gap="md">
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
          <div className="min-w-0">
            <Group gap="xs" wrap="wrap">
              <ThemeIcon size="sm" radius="xl" variant="light">
                <Route className="h-4 w-4" />
              </ThemeIcon>
              <Text fw={700}>Work View</Text>
              <Badge color={STATUS_COLORS[task.status]} variant="light">
                {task.status}
              </Badge>
              <Badge color={readinessPercent === 100 ? 'green' : 'yellow'} variant="outline">
                {readinessPercent}% ready
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" mt={6}>
              {nextAction.detail}
            </Text>
          </div>
          {!readOnly && (
            <Button size="xs" onClick={openNextAction}>
              {nextAction.label}
            </Button>
          )}
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Paper withBorder p="md" radius="md">
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs">
                <Bot className="h-4 w-4 text-muted-foreground" />
                <Text fw={600} size="sm">
                  Live Session
                </Text>
              </Group>
              <Badge color={getAttemptColor(task.attempt?.status)} variant="light">
                {formatAttemptStatus(task.attempt?.status)}
              </Badge>
            </Group>
            {task.attempt ? (
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Attempt {task.attempt.id}
                </Text>
                <Text size="xs" c="dimmed">
                  {task.attempt.agent}
                  {task.attempt.model ? ` | ${task.attempt.model}` : ''}
                  {task.attempt.provider ? ` | ${task.attempt.provider}` : ''}
                </Text>
                <Text size="xs" c="dimmed">
                  Started {formatDate(task.attempt.started)}
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                No agent attempt has been started for this task.
              </Text>
            )}
            <Group gap="xs" mt="xs">
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<Play className="h-3 w-3" />}
                onClick={() => onOpenTab('agent')}
              >
                Open Agent
              </Button>
              {isCodeTask && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<History className="h-3 w-3" />}
                  onClick={() => onOpenTab('timeline')}
                >
                  Timeline
                </Button>
              )}
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<MessageSquare className="h-3 w-3" />}
                onClick={onOpenChat}
              >
                Chat
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <Text fw={600} size="sm">
                  Code and Review
                </Text>
              </Group>
              <Badge
                color={task.git?.worktreePath ? 'green' : task.git?.repo ? 'yellow' : 'gray'}
                variant="light"
              >
                {task.git?.worktreePath
                  ? 'worktree ready'
                  : task.git?.repo
                    ? 'repo set'
                    : 'not set'}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Repo: {task.git?.repo || 'Not configured'}
            </Text>
            <Text size="xs" c="dimmed">
              Branch: {task.git?.branch || task.git?.baseBranch || 'Not configured'}
            </Text>
            <Text size="xs" c="dimmed">
              Review: {getReviewLabel(task)}
            </Text>
            <Group gap="xs" mt="xs">
              {isCodeTask && (
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<GitBranch className="h-3 w-3" />}
                  onClick={() => onOpenTab('git')}
                >
                  Git
                </Button>
              )}
              {isCodeTask && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<ClipboardCheck className="h-3 w-3" />}
                  onClick={() => onOpenTab('review')}
                >
                  Review
                </Button>
              )}
            </Group>
          </Stack>
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap="xs">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <Text fw={600}>Readiness Gate</Text>
            </Group>
            <Text size="xs" c="dimmed">
              {passedReadiness}/{readinessChecks.length} checks
            </Text>
          </Group>
          <Progress
            value={readinessPercent}
            color={readinessPercent === 100 ? 'green' : 'yellow'}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            {readinessChecks.map((check) => (
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
                  <Text size="xs" c="dimmed">
                    {check.detail}
                  </Text>
                </div>
              </Group>
            ))}
          </SimpleGrid>
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Paper withBorder p="md" radius="md">
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs">
                <PackageCheck className="h-4 w-4 text-muted-foreground" />
                <Text fw={600} size="sm">
                  Handoff
                </Text>
              </Group>
              <Badge variant="light" color={verification.total ? 'blue' : 'gray'}>
                {verification.complete}/{verification.total} verified
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Deliverables: {task.deliverables?.length ?? 0}
            </Text>
            <Text size="xs" c="dimmed">
              Attachments: {task.attachments?.length ?? 0}
            </Text>
            {task.qaGate?.required && (
              <Alert
                color={task.qaGate.passed ? 'green' : 'yellow'}
                icon={<AlertTriangle className="h-4 w-4" />}
              >
                QA gate {task.qaGate.passed ? 'passed' : 'is required before completion'}.
              </Alert>
            )}
            <Group gap="xs" mt="xs">
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<PackageCheck className="h-3 w-3" />}
                onClick={() => onOpenTab('work-products')}
              >
                Work Products
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<Workflow className="h-3 w-3" />}
                onClick={onOpenWorkflow}
              >
                Workflow
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <Text fw={600} size="sm">
                  Work Products
                </Text>
              </Group>
              <Badge variant="light" color="gray">
                {workProducts.length}
              </Badge>
            </Group>
            {workProductsLoading ? (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">
                  Loading saved outputs...
                </Text>
              </Group>
            ) : latestWorkProducts.length > 0 ? (
              <Stack gap={6}>
                {latestWorkProducts.map((product) => (
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
                    </div>
                    {product.sourceLinks?.[0] && (
                      <Tooltip label={`Open ${product.sourceLinks[0].label}`}>
                        <ActionIcon
                          component="a"
                          href={product.sourceLinks[0].href}
                          target={
                            product.sourceLinks[0].href.startsWith('http') ? '_blank' : undefined
                          }
                          rel={
                            product.sourceLinks[0].href.startsWith('http')
                              ? 'noopener noreferrer'
                              : undefined
                          }
                          size="sm"
                          variant="subtle"
                          aria-label={`Open origin for ${product.title}`}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Reports, checklists, completion packets, and evidence summaries will appear here.
              </Text>
            )}
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
