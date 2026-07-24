/**
 * WorkflowSection - Run workflows against a task
 *
 * Features:
 * - Shows available workflows
 * - Start workflow run with task context
 * - Shows active runs for this task
 */

import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '@/lib/config';
import { Badge, Button, Group, Loader, Modal, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Play, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useIdentity } from '@/hooks/useIdentity';
import { workflowsApi } from '@/lib/api/workflows';
import type { LaunchRecommendation, Task } from '@veritas-kanban/shared';

interface WorkflowSectionProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Workflow {
  id: string;
  name: string;
  version: number;
  description: string;
  agents: Array<{ id: string; name: string }>;
  steps: Array<{ id: string; name: string }>;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'blocked' | 'completed' | 'failed';
  currentStep?: string;
  startedAt: string;
}

const TASK_WORKFLOW_HISTORY_KEY = 'veritasTaskWorkflow';

function workflowHistoryId(): string | null {
  const state = window.history.state;
  if (!state || typeof state !== 'object') return null;
  const workflowId = (state as Record<string, unknown>)[TASK_WORKFLOW_HISTORY_KEY];
  return typeof workflowId === 'string' ? workflowId : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function unwrapCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return Array.isArray(record?.data) ? record.data : [];
}

function normalizeWorkflows(value: unknown): Workflow[] {
  return unwrapCollection(value).flatMap((entry) => {
    const workflow = asRecord(entry);
    if (
      !workflow ||
      typeof workflow.id !== 'string' ||
      typeof workflow.name !== 'string' ||
      typeof workflow.version !== 'number'
    ) {
      return [];
    }

    return [
      {
        id: workflow.id,
        name: workflow.name,
        version: workflow.version,
        description: typeof workflow.description === 'string' ? workflow.description : '',
        agents: unwrapCollection(workflow.agents).flatMap((agent) => {
          const record = asRecord(agent);
          return record && typeof record.id === 'string' && typeof record.name === 'string'
            ? [{ id: record.id, name: record.name }]
            : [];
        }),
        steps: unwrapCollection(workflow.steps).flatMap((step) => {
          const record = asRecord(step);
          return record && typeof record.id === 'string' && typeof record.name === 'string'
            ? [{ id: record.id, name: record.name }]
            : [];
        }),
      },
    ];
  });
}

function normalizeActiveRuns(value: unknown): WorkflowRun[] {
  return unwrapCollection(value).flatMap((entry) => {
    const run = asRecord(entry);
    if (
      !run ||
      typeof run.id !== 'string' ||
      typeof run.workflowId !== 'string' ||
      typeof run.startedAt !== 'string' ||
      !['pending', 'running', 'blocked', 'completed', 'failed'].includes(String(run.status))
    ) {
      return [];
    }

    const normalized = {
      id: run.id,
      workflowId: run.workflowId,
      status: run.status as WorkflowRun['status'],
      startedAt: run.startedAt,
      ...(typeof run.currentStep === 'string' ? { currentStep: run.currentStep } : {}),
    };
    return normalized.status === 'running' || normalized.status === 'blocked' ? [normalized] : [];
  });
}

function getRunStatusColor(status: WorkflowRun['status']) {
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

export function WorkflowSection({ task, open, onOpenChange }: WorkflowSectionProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeRuns, setActiveRuns] = useState<WorkflowRun[]>([]);
  const [recommendationsByWorkflow, setRecommendationsByWorkflow] = useState<
    Record<string, LaunchRecommendation[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [isStarting, setIsStarting] = useState<string | null>(null);
  const ownsHistoryEntryRef = useRef(false);
  const { toast } = useToast();
  const { hasPermission } = useIdentity();
  const isMobile = useMediaQuery('(max-width: 767px)', false);
  const canExecuteWorkflows = hasPermission('workflow:execute');
  const historyId = `${task.id}:workflow`;

  useEffect(() => {
    if (!open) return;
    if (workflowHistoryId() !== historyId) {
      const nextState = {
        ...(window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {}),
        [TASK_WORKFLOW_HISTORY_KEY]: historyId,
      };
      window.history.pushState(
        nextState,
        '',
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      );
    }
    ownsHistoryEntryRef.current = true;

    const handlePopState = () => {
      if (!ownsHistoryEntryRef.current || workflowHistoryId() === historyId) return;
      ownsHistoryEntryRef.current = false;
      onOpenChange(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [historyId, onOpenChange, open]);

  const handleClose = () => {
    if (ownsHistoryEntryRef.current && workflowHistoryId() === historyId) {
      window.history.back();
      return;
    }
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open) return;
    let isCancelled = false;

    const fetchData = async () => {
      setIsLoading(true);
      setLoadError(null);
      setWorkflows([]);
      setActiveRuns([]);
      setRecommendationsByWorkflow({});
      try {
        // Fetch available workflows
        const workflowsRes = await fetch(`${API_BASE}/workflows`);
        if (!workflowsRes.ok) {
          throw new Error(`Unable to load workflows (${workflowsRes.status})`);
        }
        const workflowList = normalizeWorkflows(await workflowsRes.json());
        if (isCancelled) return;
        setWorkflows(workflowList);

        const recommendationEntries = await Promise.all(
          workflowList.map(async (workflow) => {
            try {
              const result = await workflowsApi.launchRecommendations({
                workflowId: workflow.id,
                taskId: task.id,
                project: task.project,
                taskType: task.type,
                cwd: task.git?.worktreePath,
              });
              return [
                workflow.id,
                Array.isArray(result.recommendations) ? result.recommendations : [],
              ] as const;
            } catch {
              return [workflow.id, []] as const;
            }
          })
        );
        if (isCancelled) return;
        setRecommendationsByWorkflow(Object.fromEntries(recommendationEntries));

        // Fetch active runs for this task
        const runsRes = await fetch(`${API_BASE}/workflows/runs?taskId=${task.id}`);
        if (!runsRes.ok) {
          throw new Error(`Unable to load workflow runs (${runsRes.status})`);
        }
        const runs = normalizeActiveRuns(await runsRes.json());
        if (isCancelled) return;
        setActiveRuns(runs);
      } catch (error) {
        if (isCancelled) return;
        const message = error instanceof Error ? error.message : 'Unknown workflow loading error';
        setLoadError(message);
        setWorkflows([]);
        setActiveRuns([]);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    fetchData();
    return () => {
      isCancelled = true;
    };
  }, [loadRevision, open, task.id, task.project, task.type, task.git?.worktreePath]);

  const handleStartWorkflow = async (workflowId: string) => {
    setIsStarting(workflowId);
    try {
      const response = await fetch(`${API_BASE}/workflows/${workflowId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      });

      if (!response.ok) throw new Error('Failed to start workflow run');

      const runJson = await response.json();
      const run = runJson.data ?? runJson;
      toast({
        title: 'Workflow run started',
        description: `Run ID: ${run.id}`,
      });

      // Add to active runs
      setActiveRuns((previousRuns) => [...previousRuns, run]);
    } catch (error) {
      toast({
        title: '❌ Failed to start workflow run',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsStarting(null);
    }
  };

  return (
    <Modal
      opened={open}
      onClose={handleClose}
      title="Run Workflow"
      centered
      size="xl"
      fullScreen={isMobile}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Select a workflow to run against this task
        </Text>

        {isLoading ? (
          <Group justify="center" className="py-12">
            <Loader color="gray" size="sm" />
          </Group>
        ) : loadError ? (
          <Paper className="bg-card p-4" radius="md" withBorder>
            <Stack gap="sm" align="flex-start">
              <Text size="sm" fw={500}>
                Workflows could not be loaded
              </Text>
              <Text size="sm" c="dimmed">
                {loadError}
              </Text>
              <Button
                size="xs"
                variant="outline"
                onClick={() => setLoadRevision((value) => value + 1)}
              >
                Retry
              </Button>
            </Stack>
          </Paper>
        ) : (
          <ScrollArea.Autosize mah="65vh" type="auto">
            <Stack gap="lg">
              {/* Active Runs */}
              {activeRuns.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Active Runs
                  </Text>
                  {activeRuns.map((run) => (
                    <Paper key={run.id} className="bg-card p-3" radius="md" withBorder>
                      <Group justify="space-between" align="center">
                        <Stack gap={4} className="min-w-0 flex-1">
                          <Group gap="xs">
                            <Badge variant="outline" className="font-mono">
                              {run.id}
                            </Badge>
                            <Badge variant="light" color={getRunStatusColor(run.status)}>
                              {run.status}
                            </Badge>
                          </Group>
                          {run.currentStep && (
                            <Text size="sm" c="dimmed">
                              Current: {run.currentStep}
                            </Text>
                          )}
                        </Stack>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              )}

              {/* Available Workflows */}
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Available Workflows
                </Text>
                {workflows.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" className="py-6">
                    No workflows available
                  </Text>
                ) : (
                  workflows.map((workflow) => (
                    <Paper
                      key={workflow.id}
                      className="bg-card p-4 transition-colors hover:bg-accent/50"
                      radius="md"
                      withBorder
                    >
                      <Group align="flex-start" justify="space-between" gap="md" wrap="wrap">
                        <Stack gap={4} className="min-w-0 flex-1">
                          <Group gap="xs">
                            <Text size="sm" fw={500}>
                              {workflow.name}
                            </Text>
                            <Badge variant="outline" size="sm">
                              v{workflow.version}
                            </Badge>
                          </Group>
                          <Text size="sm" c="dimmed">
                            {workflow.description}
                          </Text>
                          <Group gap="md">
                            <Text size="xs" c="dimmed">
                              {workflow.agents.length} agents
                            </Text>
                            <Text size="xs" c="dimmed">
                              {workflow.steps.length} steps
                            </Text>
                          </Group>
                          <LaunchRecommendationSummary
                            recommendations={recommendationsByWorkflow[workflow.id] ?? []}
                          />
                        </Stack>
                        <Button
                          size="sm"
                          onClick={() => handleStartWorkflow(workflow.id)}
                          disabled={!canExecuteWorkflows || isStarting === workflow.id}
                          title={
                            canExecuteWorkflows
                              ? 'Start run'
                              : 'Workflow execute permission required'
                          }
                          leftSection={
                            isStarting === workflow.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )
                          }
                        >
                          Start
                        </Button>
                      </Group>
                    </Paper>
                  ))
                )}
              </Stack>
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Stack>
    </Modal>
  );
}

function LaunchRecommendationSummary({
  recommendations,
}: {
  recommendations: LaunchRecommendation[];
}) {
  const topRecommendations = recommendations.slice(0, 2);
  if (topRecommendations.length === 0) return null;

  return (
    <Stack gap={4} className="rounded-md border bg-background/60 p-2">
      {topRecommendations.map((recommendation) => (
        <Stack key={recommendation.id} gap={3}>
          <Group gap="xs" wrap="wrap">
            <Badge size="xs" variant="light">
              {recommendation.kind}
            </Badge>
            <Text size="xs" className="min-w-0 flex-1">
              {recommendation.label}
            </Text>
            <Badge size="xs" color="green" variant="outline">
              {Math.round(recommendation.confidence * 100)}%
            </Badge>
            {recommendation.templateStatus === 'draft' && (
              <Badge size="xs" color="yellow" variant="light">
                draft
              </Badge>
            )}
          </Group>
          <Group gap={4} wrap="wrap">
            {recommendation.reasonCodes.slice(0, 3).map((reasonCode) => (
              <Badge key={reasonCode} size="xs" color="gray" variant="outline">
                {reasonCode}
              </Badge>
            ))}
            {recommendation.provenance.length > 0 && (
              <Text size="xs" c="dimmed">
                {recommendation.provenance.length} source
                {recommendation.provenance.length === 1 ? '' : 's'}
              </Text>
            )}
          </Group>
        </Stack>
      ))}
    </Stack>
  );
}
