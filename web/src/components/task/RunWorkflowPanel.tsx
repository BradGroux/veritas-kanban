import { Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { Play, Workflow } from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';
import { useActiveRuns, useRecentRuns, type WorkflowRun } from '@/hooks/useWorkflowStats';

interface RunWorkflowPanelProps {
  task: Task;
  readOnly: boolean;
  onOpenWorkflow: () => void;
}

const STATUS_COLOR: Record<WorkflowRun['status'], string> = {
  pending: 'gray',
  running: 'blue',
  blocked: 'yellow',
  completed: 'green',
  failed: 'red',
};

export function RunWorkflowPanel({ task, readOnly, onOpenWorkflow }: RunWorkflowPanelProps) {
  const { data: activeRuns = [] } = useActiveRuns();
  const { data: recentRuns = [] } = useRecentRuns();
  const taskRuns = [...activeRuns, ...recentRuns]
    .filter((run) => run.taskId === task.id)
    .filter((run, index, runs) => runs.findIndex((candidate) => candidate.id === run.id) === index)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  const currentRun = taskRuns[0];

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
        <div>
          <Group gap="xs">
            <Workflow className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Text size="sm" fw={600}>
              Workflow execution
            </Text>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            Launch a reviewed workflow with this task as its execution context.
          </Text>
        </div>
        {!readOnly && (
          <Button
            size="compact-sm"
            onClick={onOpenWorkflow}
            leftSection={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            Choose workflow
          </Button>
        )}
      </Group>

      <Paper withBorder p="md" radius="md">
        {currentRun ? (
          <Stack gap={6}>
            <Group gap="xs" wrap="wrap">
              <Badge color={STATUS_COLOR[currentRun.status]} variant="light">
                Workflow: {currentRun.status}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {currentRun.id}
              </Badge>
            </Group>
            <Text size="sm" fw={500}>
              {currentRun.workflowId} v{currentRun.workflowVersion}
            </Text>
            {currentRun.currentStep && (
              <Text size="xs" c="dimmed">
                Current step: {currentRun.currentStep}
              </Text>
            )}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            No workflow run is associated with this task.
          </Text>
        )}
      </Paper>
    </Stack>
  );
}
