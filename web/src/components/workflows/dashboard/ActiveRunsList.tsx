/**
 * ActiveRunsList - List of currently running workflow runs
 */

import { memo } from 'react';
import { Badge, Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { PlayCircle } from 'lucide-react';
import type { WorkflowRun } from '@/hooks/useWorkflowStats';

interface ActiveRunsListProps {
  runs: WorkflowRun[];
  onSelectRun: (runId: string) => void;
}

export const ActiveRunsList = memo(function ActiveRunsList({
  runs,
  onSelectRun,
}: ActiveRunsListProps) {
  return (
    <Stack gap="sm">
      {runs.map((run) => (
        <ActiveRunCard key={run.id} run={run} onClick={() => onSelectRun(run.id)} />
      ))}
    </Stack>
  );
});

interface ActiveRunCardProps {
  run: WorkflowRun;
  onClick: () => void;
}

const ActiveRunCard = memo(function ActiveRunCard({ run, onClick }: ActiveRunCardProps) {
  const duration = Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000);
  const completedSteps = run.steps?.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps?.length ?? 0;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <Paper
      className="p-4 border-2 border-blue-500 transition-colors cursor-pointer hover:bg-accent/50"
      radius="md"
      withBorder
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <Group align="flex-start" justify="space-between" gap="md">
        <div className="flex-1 min-w-0">
          <Group gap="sm" mb="xs">
            <Badge variant="outline" className="text-xs font-mono">
              {run.id}
            </Badge>
            <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              <PlayCircle className="h-3 w-3 mr-1" />
              Running
            </Badge>
          </Group>

          <Group gap="md" mb="xs" className="text-sm text-muted-foreground">
            <Text span inherit>
              Started: {new Date(run.startedAt).toLocaleString()}
            </Text>
            <Text span inherit>
              Duration: {Math.floor(duration / 60)}m {duration % 60}s
            </Text>
            {run.currentStep && (
              <Text span inherit fw={500}>
                Current: {run.currentStep}
              </Text>
            )}
          </Group>

          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Progress: {completedSteps}/{totalSteps} steps
            </Text>
            <Progress className="flex-1 max-w-xs" value={progress} color="blue" />
          </Group>
        </div>
      </Group>
    </Paper>
  );
});
