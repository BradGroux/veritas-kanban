/**
 * WorkflowRunView - Live step-by-step workflow run visualization
 *
 * Features:
 * - Live step-by-step progress
 * - Color-coded step status (green=completed, blue=running, red=failed, yellow=blocked, gray=pending)
 * - Resume button for blocked runs
 * - Auto-updates via WebSocket workflow:status events
 * - Shows overall run progress
 */

import { useState, useEffect, useCallback } from 'react';
import {
  buildWorkflowPipelineSummary,
  type WorkflowDefinition as SharedWorkflowDefinition,
  type WorkflowPipelineSummary,
  type WorkflowSubagentRunStatus,
} from '@veritas-kanban/shared';
import { API_BASE } from '@/lib/config';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  Progress,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  PlayCircle,
  Clock,
  Pause,
  History,
  Users,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { useWebSocket, type WebSocketMessage } from '@/hooks/useWebSocket';
import { useView } from '@/contexts/ViewContext';

interface WorkflowRunViewProps {
  runId: string;
  onBack: () => void;
}

type WorkflowRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';
type StepRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface StepRun {
  stepId: string;
  status: StepRunStatus;
  agent?: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  retries: number;
  output?: string;
  error?: string;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  taskId?: string;
  status: WorkflowRunStatus;
  currentStep?: string;
  startedAt: string;
  completedAt?: string;
  context?: Record<string, unknown>;
  error?: string;
  steps: StepRun[];
}

interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  pipeline?: SharedWorkflowDefinition['pipeline'];
  steps: Array<{
    id: string;
    name: string;
    agent?: string;
  }>;
}

interface WorkflowStatusMessage extends WebSocketMessage {
  type: 'workflow:status';
  payload: WorkflowRun;
}

function isWorkflowStatusMessage(msg: WebSocketMessage): msg is WorkflowStatusMessage {
  return msg.type === 'workflow:status' && typeof msg.payload === 'object' && msg.payload !== null;
}

function safeContextString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function workflowTaskId(run: WorkflowRun): string | undefined {
  return run.taskId ?? safeContextString(run.context?.taskId);
}

function workflowTimelineAttemptId(run: WorkflowRun): string {
  return (
    safeContextString(run.context?.attemptId) ?? safeContextString(run.context?.runId) ?? run.id
  );
}

function isWorkflowPipelineSummary(value: unknown): value is WorkflowPipelineSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { roles?: unknown }).roles) &&
    typeof (value as { totals?: unknown }).totals === 'object'
  );
}

function pipelineStatusColor(status: WorkflowSubagentRunStatus): string {
  if (status === 'completed') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'blocked') return 'yellow';
  if (status === 'running') return 'blue';
  if (status === 'skipped') return 'gray';
  return 'gray';
}

function formatPipelineDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'time pending';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export function WorkflowRunView({ runId, onBack }: WorkflowRunViewProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(true);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const { toast } = useToast();
  const { navigateToTask } = useView();

  // Fetch run details
  const fetchRun = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/workflows/runs/${runId}`);
      if (!response.ok) throw new Error('Failed to fetch workflow run');
      const json = await response.json();
      setRun(json.data ?? json);
    } catch (error) {
      toast({
        title: '❌ Failed to load workflow run',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [runId, toast]);

  // Initial fetch
  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  const workflowId = run?.workflowId;

  // Fetch workflow definition when run loads
  useEffect(() => {
    if (!workflowId) return;

    setWorkflow(null);
    setIsWorkflowLoading(true);

    let isCancelled = false;
    const fetchWorkflow = async () => {
      try {
        const workflowResponse = await fetch(`${API_BASE}/workflows/${workflowId}`);
        if (!workflowResponse.ok) throw new Error('Failed to fetch workflow definition');
        const json = await workflowResponse.json();
        if (!isCancelled) {
          setWorkflow(json.data ?? json);
        }
      } catch (error) {
        console.error('Failed to fetch workflow definition:', error);
        if (!isCancelled) {
          setWorkflow(null);
        }
      } finally {
        if (!isCancelled) {
          setIsWorkflowLoading(false);
        }
      }
    };

    fetchWorkflow();

    return () => {
      isCancelled = true;
    };
  }, [workflowId]);

  // WebSocket subscription for live updates
  const handleWebSocketMessage = useCallback(
    (message: WebSocketMessage) => {
      if (isWorkflowStatusMessage(message) && message.payload.id === runId) {
        console.log('[WorkflowRunView] Received workflow:status update', message.payload);
        setRun(message.payload);
      }
    },
    [runId]
  );

  useWebSocket({
    autoConnect: true,
    onOpen: { type: 'workflow:subscribe', runId },
    onMessage: handleWebSocketMessage,
  });

  const handleResume = async () => {
    try {
      const response = await fetch(`${API_BASE}/workflows/runs/${runId}/resume`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to resume workflow run');

      toast({
        title: 'Workflow resumed',
        description: 'The workflow run has been resumed',
      });

      fetchRun();
    } catch (error) {
      toast({
        title: '❌ Failed to resume workflow run',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  if (isLoading || (run && isWorkflowLoading)) {
    return (
      <Stack gap="lg">
        <Skeleton h={48} />
        <Skeleton h={256} />
      </Stack>
    );
  }

  if (!run) {
    return (
      <Text ta="center" c="dimmed" py="xl">
        Workflow run not found
      </Text>
    );
  }

  const workflowName = workflow?.name ?? `Workflow ${run.workflowId}`;
  const taskTimelineId = workflowTaskId(run);
  const stepDefinitions =
    workflow?.steps ??
    run.steps?.map((step) => ({ id: step.stepId, name: step.stepId, agent: step.agent }));

  const completedSteps = run.steps?.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps?.length ?? 0;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  const duration = run.completedAt
    ? Math.floor((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000);

  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      progressColor: 'gray',
      label: 'Pending',
    },
    running: {
      icon: PlayCircle,
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      progressColor: 'blue',
      label: 'Running',
    },
    completed: {
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      progressColor: 'green',
      label: 'Completed',
    },
    failed: {
      icon: XCircle,
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      progressColor: 'red',
      label: 'Failed',
    },
    blocked: {
      icon: AlertCircle,
      color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      progressColor: 'yellow',
      label: 'Blocked',
    },
  };

  const config = statusConfig[run.status];
  const Icon = config.icon;
  const pipelineSummary = isWorkflowPipelineSummary(run.context?.pipeline)
    ? run.context.pipeline
    : workflow?.pipeline
      ? buildWorkflowPipelineSummary(workflow as SharedWorkflowDefinition)
      : undefined;

  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Group gap="md" align="center">
          <Button
            variant="subtle"
            size="sm"
            leftSection={<ArrowLeft className="h-4 w-4" />}
            onClick={onBack}
          >
            Back to Runs
          </Button>
          <div>
            <Title order={1} className="text-2xl">
              {workflowName}
            </Title>
            <Text size="sm" c="dimmed">
              Run: {run.id}
            </Text>
          </div>
        </Group>

        <Group gap="sm">
          <Badge className={cn('text-sm', config.color)}>
            <Icon className="h-4 w-4 mr-1" />
            {config.label}
          </Badge>
          {run.status === 'blocked' && (
            <Button
              size="sm"
              leftSection={<PlayCircle className="h-4 w-4" />}
              onClick={handleResume}
            >
              Resume
            </Button>
          )}
          {taskTimelineId && (
            <Button
              size="sm"
              variant="light"
              leftSection={<History className="h-4 w-4" />}
              onClick={() => {
                navigateToTask(taskTimelineId, {
                  tab: 'timeline',
                  timelineAttemptId: workflowTimelineAttemptId(run),
                });
              }}
            >
              Task Timeline
            </Button>
          )}
        </Group>
      </Group>

      {/* Progress Overview */}
      <Paper className="p-6" radius="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div className="space-y-1">
              <Title order={2} className="text-lg">
                Overall Progress
              </Title>
              <Text size="sm" c="dimmed">
                Step {completedSteps} of {totalSteps}
              </Text>
            </div>
            <Stack gap={4} align="flex-end">
              <Text size="sm" c="dimmed">
                Duration: {Math.floor(duration / 60)}m {duration % 60}s
              </Text>
              <Text size="sm" c="dimmed">
                Started: {new Date(run.startedAt).toLocaleString()}
              </Text>
            </Stack>
          </Group>

          <Progress value={progress} color={config.progressColor} size="md" radius="xl" />

          {run.error && (
            <Alert color="red" variant="light">
              <Text span fw={600}>
                Error:
              </Text>{' '}
              {run.error}
            </Alert>
          )}
        </Stack>
      </Paper>

      {pipelineSummary && <WorkflowPipelineCard pipeline={pipelineSummary} />}

      {/* Step Timeline */}
      <Stack gap="sm">
        <Title order={2} className="text-lg">
          Steps
        </Title>
        {stepDefinitions.map((stepDef, index) => {
          const stepRun = run.steps?.find((s) => s.stepId === stepDef.id);
          if (!stepRun) return null;

          return (
            <StepCard
              key={stepDef.id}
              stepDef={stepDef}
              stepRun={stepRun}
              index={index}
              isExpanded={expandedStepId === stepDef.id}
              onToggleExpand={() =>
                setExpandedStepId(expandedStepId === stepDef.id ? null : stepDef.id)
              }
            />
          );
        })}
      </Stack>
    </Stack>
  );
}

function WorkflowPipelineCard({ pipeline }: { pipeline: WorkflowPipelineSummary }) {
  return (
    <Paper className="p-6" radius="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div className="space-y-1">
            <Group gap="xs">
              <ThemeIcon variant="light" color="cyan">
                <Users className="h-4 w-4" />
              </ThemeIcon>
              <Title order={2} className="text-lg">
                Orchestration Pipeline
              </Title>
            </Group>
            <Text size="sm" c="dimmed">
              {pipeline.parentAgent ? `Parent: ${pipeline.parentAgent}` : 'No parent agent'} ·{' '}
              {pipeline.completion}
            </Text>
          </div>
          <Group gap="xs">
            <Badge variant="light">{pipeline.mode}</Badge>
            <Badge variant="outline">
              {pipeline.totals.completed}/{pipeline.totals.roles} complete
            </Badge>
          </Group>
        </Group>

        {pipeline.handoff && (
          <Text size="sm" c="dimmed">
            {pipeline.handoff}
          </Text>
        )}

        <Stack gap="xs">
          {pipeline.roles.map((role) => (
            <div key={role.id} className="rounded-md border bg-background/50 p-3">
              <Group justify="space-between" align="flex-start" gap="md">
                <div className="min-w-0 space-y-1">
                  <Group gap="xs">
                    <Text fw={600}>{role.label}</Text>
                    <Badge size="xs" variant="outline">
                      {role.agent}
                    </Badge>
                    {role.required !== false && (
                      <Badge size="xs" variant="light" color="gray">
                        required
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm" c="dimmed">
                    {role.scope}
                  </Text>
                  <Text size="sm">Deliverable: {role.deliverable}</Text>
                  <Text size="xs" c="dimmed">
                    {role.verification.length} verification step
                    {role.verification.length === 1 ? '' : 's'}
                    {role.dependsOn?.length ? ` · depends on ${role.dependsOn.join(', ')}` : ''}
                  </Text>
                </div>
                <Stack gap={4} align="flex-end">
                  <Badge color={pipelineStatusColor(role.status)} variant="light">
                    {role.status}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {formatPipelineDuration(role.telemetry.durationSeconds)}
                  </Text>
                  {role.telemetry.tokensUsed !== undefined && (
                    <Text size="xs" c="dimmed">
                      {role.telemetry.tokensUsed.toLocaleString()} tokens
                    </Text>
                  )}
                </Stack>
              </Group>
            </div>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

interface StepCardProps {
  stepDef: { id: string; name: string; agent?: string };
  stepRun: StepRun;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function StepCard({ stepDef, stepRun, index, isExpanded, onToggleExpand }: StepCardProps) {
  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      borderColor: 'border-gray-300',
    },
    running: {
      icon: PlayCircle,
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      borderColor: 'border-blue-500',
    },
    completed: {
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      borderColor: 'border-green-500',
    },
    failed: {
      icon: XCircle,
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      borderColor: 'border-red-500',
    },
    skipped: {
      icon: Pause,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      borderColor: 'border-gray-300',
    },
  };

  const config = statusConfig[stepRun.status];
  const Icon = config.icon;

  return (
    <Paper
      className={cn(
        'p-4 border-2 transition-colors cursor-pointer',
        config.borderColor,
        isExpanded && 'ring-2 ring-accent'
      )}
      radius="md"
      withBorder
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpand();
        }
      }}
    >
      <Group align="flex-start" gap="md">
        <ThemeIcon className="shrink-0" radius="xl" variant="light" color="gray">
          {index + 1}
        </ThemeIcon>

        <div className="flex-1 min-w-0">
          <Group gap="sm" mb="xs">
            <Title order={3} className="text-base">
              {stepDef.name}
            </Title>
            <Badge className={cn('text-xs', config.color)}>
              <Icon className="h-3 w-3 mr-1" />
              {stepRun.status}
            </Badge>
            {stepRun.agent && (
              <Badge variant="outline" className="text-xs">
                {stepRun.agent}
              </Badge>
            )}
            {stepRun.retries > 0 && (
              <Badge variant="light" className="text-xs">
                Retry {stepRun.retries}
              </Badge>
            )}
          </Group>

          <Group gap="md" className="text-sm text-muted-foreground">
            {stepRun.startedAt && (
              <Text span inherit>
                Started: {new Date(stepRun.startedAt).toLocaleTimeString()}
              </Text>
            )}
            {stepRun.completedAt && (
              <Text span inherit>
                Completed: {new Date(stepRun.completedAt).toLocaleTimeString()}
              </Text>
            )}
            {stepRun.duration !== undefined && (
              <Text span inherit>
                Duration: {stepRun.duration}s
              </Text>
            )}
          </Group>

          {stepRun.error && (
            <Alert mt="xs" color="red" variant="light">
              <Text span fw={600}>
                Error:
              </Text>{' '}
              {stepRun.error}
            </Alert>
          )}

          {isExpanded && stepRun.output && (
            <Paper mt="sm" p="sm" radius="sm" className="bg-secondary">
              <Text size="sm" fw={600}>
                Output:
              </Text>
              <Code block className="mt-2 whitespace-pre-wrap">
                {stepRun.output}
              </Code>
            </Paper>
          )}
        </div>
      </Group>
    </Paper>
  );
}
