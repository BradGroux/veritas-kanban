/**
 * WallTimeToggle — Toggle between wall time and active time views
 * GH #60: Dashboard wall time vs active time toggle
 *
 * Wall time = total elapsed time across all runs (sum of durations)
 * Active time = average run duration (how long a typical run takes)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { apiFetch } from '@/lib/api/helpers';
import { formatDuration, type MetricsPeriod } from '@/hooks/useMetrics';
import { Clock, Timer, ToggleLeft, ToggleRight, Info } from 'lucide-react';

interface WallTimeToggleProps {
  period: MetricsPeriod;
}

interface TaskCostEntry {
  taskId: string;
  totalDurationMs: number;
  runs: number;
}

interface TaskCostResult {
  tasks: TaskCostEntry[];
}

export function WallTimeToggle({ period }: WallTimeToggleProps) {
  const [showActive, setShowActive] = useState(false);

  // Get actual duration data from task-cost (which now includes totalDurationMs)
  const { data: taskCost } = useQuery<TaskCostResult>({
    queryKey: ['task-cost', period],
    queryFn: () => apiFetch<TaskCostResult>(`/api/metrics/task-cost?period=${period}`),
    staleTime: 60_000,
  });

  // Wall time = sum of all run durations
  const wallTime = taskCost?.tasks?.reduce((sum, t) => sum + (t.totalDurationMs || 0), 0) || 0;
  const totalRuns = taskCost?.tasks?.reduce((sum, t) => sum + t.runs, 0) || 0;
  // Active time = average per run
  const activeTime = totalRuns > 0 ? wallTime / totalRuns : 0;
  // Efficiency = ratio of tasks actually worked vs calendar time in period
  const periodHours =
    period === '24h'
      ? 24
      : period === '3d'
        ? 72
        : period === '7d'
          ? 168
          : period === '30d'
            ? 720
            : 168;
  const efficiency = periodHours > 0 ? (wallTime / 3600000 / periodHours) * 100 : 0;

  const displayTime = showActive ? activeTime : wallTime;
  const label = showActive ? 'Avg Run Duration' : 'Total Agent Time';
  const Icon = showActive ? Timer : Clock;

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <Text size="sm" fw={500}>
            {label}
          </Text>
          <Tooltip
            multiline
            w={260}
            label={
              <Stack gap={6}>
                <Text size="xs">
                  <strong>Total Agent Time:</strong> Sum of all run durations in the period.
                </Text>
                <Text size="xs">
                  <strong>Avg Run Duration:</strong> Average time per agent run.
                </Text>
                <Text size="xs">
                  <strong>Utilization:</strong> Percentage of calendar time with agent activity.
                </Text>
              </Stack>
            }
          >
            <ActionIcon aria-label="Wall time help" size="xs" variant="subtle">
              <Info className="w-3 h-3 text-muted-foreground" />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Button
          variant="subtle"
          size="compact-xs"
          className="text-muted-foreground"
          onClick={() => setShowActive(!showActive)}
          leftSection={
            showActive ? (
              <ToggleRight className="h-4 w-4 text-purple-500" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )
          }
        >
          {showActive ? 'Per Run' : 'Total'}
        </Button>
      </Group>

      <Text size="xl" fw={700} mb={4}>
        {formatDuration(displayTime)}
      </Text>

      <Stack gap={4} className="text-xs text-muted-foreground">
        <Group justify="space-between">
          <span>Total time</span>
          <span className={!showActive ? 'font-medium text-foreground' : ''}>
            {formatDuration(wallTime)}
          </span>
        </Group>
        <Group justify="space-between">
          <span>Avg per run</span>
          <span className={showActive ? 'font-medium text-foreground' : ''}>
            {formatDuration(activeTime)}
          </span>
        </Group>
        <Group justify="space-between">
          <span>Total runs</span>
          <span>{totalRuns}</span>
        </Group>
        <Group justify="space-between" className="border-t pt-1">
          <span>Utilization</span>
          <span
            className="font-medium"
            style={{ color: efficiency > 10 ? '#22c55e' : efficiency > 3 ? '#f59e0b' : '#6b7280' }}
          >
            {efficiency.toFixed(1)}%
          </span>
        </Group>
      </Stack>
    </Paper>
  );
}
