/**
 * WorkflowHealthMetrics - Per-workflow health statistics
 */

import { memo } from 'react';
import { Group, Paper, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { formatDuration } from '@/hooks/useMetrics';

interface WorkflowHealthMetricsProps {
  workflowStats: Array<{
    workflowId: string;
    workflowName: string;
    runs: number;
    completed: number;
    failed: number;
    successRate: number;
    avgDuration: number;
  }>;
}

export const WorkflowHealthMetrics = memo(function WorkflowHealthMetrics({
  workflowStats,
}: WorkflowHealthMetricsProps) {
  return (
    <Stack gap="sm">
      {workflowStats.map((stats) => (
        <WorkflowHealthCard key={stats.workflowId} stats={stats} />
      ))}
    </Stack>
  );
});

interface WorkflowHealthCardProps {
  stats: {
    workflowId: string;
    workflowName: string;
    runs: number;
    completed: number;
    failed: number;
    successRate: number;
    avgDuration: number;
  };
}

const WorkflowHealthCard = memo(function WorkflowHealthCard({ stats }: WorkflowHealthCardProps) {
  const successRatePercent = (stats.successRate * 100).toFixed(1);
  const healthColor =
    stats.successRate >= 0.8 ? 'green' : stats.successRate >= 0.5 ? 'yellow' : 'red';

  return (
    <Paper className="p-4" radius="md" withBorder>
      <Group align="flex-start" justify="space-between" gap="md">
        <Stack gap="sm" className="flex-1 min-w-0">
          <Title order={3} className="text-base">
            {stats.workflowName}
          </Title>

          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" className="text-sm">
            <div>
              <Text c="dimmed">Runs</Text>
              <Text fw={500}>{stats.runs}</Text>
            </div>
            <div>
              <Text c="dimmed">Success Rate</Text>
              <Text fw={500}>{successRatePercent}%</Text>
            </div>
            <div>
              <Text c="dimmed">Completed</Text>
              <Text fw={500} c="green">
                {stats.completed}
              </Text>
            </div>
            <div>
              <Text c="dimmed">Failed</Text>
              <Text fw={500} c="red">
                {stats.failed}
              </Text>
            </div>
          </SimpleGrid>

          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Avg Duration: {formatDuration(stats.avgDuration)}
            </Text>
            <Progress
              className="flex-1 max-w-xs"
              value={stats.successRate * 100}
              color={healthColor}
            />
          </Group>
        </Stack>
      </Group>
    </Paper>
  );
});
