/**
 * WorkflowSection - Run workflows against a task
 *
 * Features:
 * - Shows available workflows
 * - Start workflow run with task context
 * - Shows active runs for this task
 */

import { useState, useEffect } from 'react';
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
  const [isStarting, setIsStarting] = useState<string | null>(null);
  const { toast } = useToast();
  const { hasPermission } = useIdentity();
  const isMobile = useMediaQuery('(max-width: 767px)', false);
  const canExecuteWorkflows = hasPermission('workflow:execute');

  useEffect(() => {
    if (!open) return;
    let isCancelled = false;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch available workflows
        const workflowsRes = await fetch(`${API_BASE}/workflows`);
        if (workflowsRes.ok) {
          const wJson = await workflowsRes.json();
          const workflowList = (wJson.data ?? wJson) as Workflow[];
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
                return [workflow.id, result.recommendations] as const;
              } catch {
                return [workflow.id, []] as const;
              }
            })
          );
          if (isCancelled) return;
          setRecommendationsByWorkflow(Object.fromEntries(recommendationEntries));
        }

        // Fetch active runs for this task
        const runsRes = await fetch(`${API_BASE}/workflows/runs?taskId=${task.id}`);
        if (runsRes.ok) {
          const rJson = await runsRes.json();
          const runs = rJson.data ?? rJson;
          if (isCancelled) return;
          setActiveRuns(
            runs.filter((r: WorkflowRun) => r.status === 'running' || r.status === 'blocked')
          );
        }
      } catch (error) {
        console.error('Failed to fetch workflows:', error);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    fetchData();
    return () => {
      isCancelled = true;
    };
  }, [open, task.id, task.project, task.type, task.git?.worktreePath]);

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
      onClose={() => onOpenChange(false)}
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
