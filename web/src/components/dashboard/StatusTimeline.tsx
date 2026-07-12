import {
  useDailySummary,
  formatDurationMs,
  calculateActivePercent,
  type DailySummary,
} from '@/hooks/useStatusHistory';
import { Box, Group, Paper, SimpleGrid, Skeleton, Stack, Text, ThemeIcon } from '@mantine/core';
import { Clock, Activity, Coffee } from 'lucide-react';

interface StatusTimelineProps {
  date?: string;
}

function TimelineBar({ summary }: { summary: DailySummary }) {
  const total = summary.activeMs + summary.idleMs + summary.errorMs;

  if (total === 0) {
    return (
      <Box className="flex h-8 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
        No activity recorded
      </Box>
    );
  }

  // Calculate percentages
  const activePercent = (summary.activeMs / total) * 100;
  const idlePercent = (summary.idleMs / total) * 100;
  const errorPercent = (summary.errorMs / total) * 100;

  return (
    <Group className="h-8 overflow-hidden rounded-md" gap={0} wrap="nowrap">
      {activePercent > 0 && (
        <div
          className="flex items-center justify-center bg-green-500 text-xs font-medium text-white"
          style={{ width: `${activePercent}%` }}
          title={`Active: ${formatDurationMs(summary.activeMs)}`}
        >
          {activePercent >= 15 && formatDurationMs(summary.activeMs)}
        </div>
      )}
      {idlePercent > 0 && (
        <div
          className="flex items-center justify-center bg-gray-400 text-xs font-medium text-white"
          style={{ width: `${idlePercent}%` }}
          title={`Idle: ${formatDurationMs(summary.idleMs)}`}
        >
          {idlePercent >= 15 && formatDurationMs(summary.idleMs)}
        </div>
      )}
      {errorPercent > 0 && (
        <div
          className="flex items-center justify-center bg-red-500 text-xs font-medium text-white"
          style={{ width: `${errorPercent}%` }}
          title={`Error: ${formatDurationMs(summary.errorMs)}`}
        >
          {errorPercent >= 15 && formatDurationMs(summary.errorMs)}
        </div>
      )}
    </Group>
  );
}

export function StatusTimeline({ date }: StatusTimelineProps) {
  const { data: summary, isLoading: summaryLoading } = useDailySummary(date);

  if (summaryLoading) {
    return (
      <Stack gap="md">
        <Skeleton h={32} radius="md" />
        <SimpleGrid cols={3} spacing="md">
          <Skeleton h={80} radius="md" />
          <Skeleton h={80} radius="md" />
          <Skeleton h={80} radius="md" />
        </SimpleGrid>
      </Stack>
    );
  }

  if (!summary) {
    return (
      <Text ta="center" c="dimmed" py="md">
        No status data available
      </Text>
    );
  }

  const activePercent = calculateActivePercent(summary);

  return (
    <Stack gap="md">
      {/* Daily Activity — full width */}
      <Stack gap="md">
        {/* Timeline Bar */}
        <div>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={500} c="dimmed">
              Daily Activity ({summary.date})
            </Text>
            <Text size="sm" fw={500}>
              {activePercent}% active
            </Text>
          </Group>
          <TimelineBar summary={summary} />
        </div>

        {/* Summary Stats */}
        <SimpleGrid cols={3} spacing="md">
          <Paper
            withBorder
            p="sm"
            radius="md"
            ta="center"
            className="border-green-500/20 bg-green-500/10"
          >
            <ThemeIcon color="green" variant="transparent" mx="auto" mb={4} size="sm">
              <Activity className="h-4 w-4" />
            </ThemeIcon>
            <div className="text-lg font-bold text-green-500">
              {formatDurationMs(summary.activeMs)}
            </div>
            <div className="text-xs text-muted-foreground">Active</div>
          </Paper>

          <Paper withBorder p="sm" radius="md" ta="center" className="bg-muted/50">
            <ThemeIcon color="gray" variant="transparent" mx="auto" mb={4} size="sm">
              <Coffee className="h-4 w-4" />
            </ThemeIcon>
            <div className="text-lg font-bold text-muted-foreground">
              {formatDurationMs(summary.idleMs)}
            </div>
            <div className="text-xs text-muted-foreground">Idle</div>
          </Paper>

          <Paper withBorder p="sm" radius="md" ta="center">
            <ThemeIcon color="gray" variant="transparent" mx="auto" mb={4} size="sm">
              <Clock className="h-4 w-4" />
            </ThemeIcon>
            <div className="text-lg font-bold">{summary.transitions}</div>
            <div className="text-xs text-muted-foreground">Transitions</div>
          </Paper>
        </SimpleGrid>
      </Stack>

      {/* Legend */}
      <Group gap="md" justify="center" className="border-t pt-2 text-xs text-muted-foreground">
        <Group gap={4}>
          <div className="w-3 h-3 rounded bg-green-500" />
          <span>Working/Thinking</span>
        </Group>
        <Group gap={4}>
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span>Sub-agent</span>
        </Group>
        <Group gap={4}>
          <div className="w-3 h-3 rounded bg-gray-400" />
          <span>Idle</span>
        </Group>
        <Group gap={4}>
          <div className="w-3 h-3 rounded bg-red-500" />
          <span>Error</span>
        </Group>
      </Group>
    </Stack>
  );
}
