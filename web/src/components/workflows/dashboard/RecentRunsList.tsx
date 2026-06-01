/**
 * RecentRunsList - List of recent workflow runs with status filtering
 */

import { memo, useMemo } from 'react';
import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import { Clock, PlayCircle, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowRun } from '@/hooks/useWorkflowStats';

interface RecentRunsListProps {
  runs: WorkflowRun[];
  statusFilter: string;
  onSelectRun: (runId: string) => void;
}

export const RecentRunsList = memo(function RecentRunsList({
  runs,
  statusFilter,
  onSelectRun,
}: RecentRunsListProps) {
  const filteredRuns = useMemo(() => {
    // Sort by startedAt descending, take top 50
    const sorted = [...runs].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    const limited = sorted.slice(0, 50);

    // Apply status filter
    return limited.filter((run) => statusFilter === 'all' || run.status === statusFilter);
  }, [runs, statusFilter]);

  if (filteredRuns.length === 0) {
    return (
      <Text ta="center" c="dimmed" py="xl">
        {statusFilter !== 'all' ? 'No runs match your filter' : 'No recent runs'}
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      {filteredRuns.map((run) => (
        <RecentRunCard key={run.id} run={run} onClick={() => onSelectRun(run.id)} />
      ))}
    </Stack>
  );
});

interface RecentRunCardProps {
  run: WorkflowRun;
  onClick: () => void;
}

const RecentRunCard = memo(function RecentRunCard({ run, onClick }: RecentRunCardProps) {
  const duration = run.completedAt
    ? Math.floor((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000);

  const completedSteps = run.steps?.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps?.length ?? 0;

  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      label: 'Pending',
    },
    running: {
      icon: PlayCircle,
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      label: 'Running',
    },
    completed: {
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      label: 'Completed',
    },
    failed: {
      icon: XCircle,
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      label: 'Failed',
    },
    blocked: {
      icon: AlertCircle,
      color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      label: 'Blocked',
    },
  };

  const config = statusConfig[run.status];
  const Icon = config.icon;

  return (
    <Paper
      className="p-4 transition-colors cursor-pointer hover:bg-accent/50"
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
            <Badge className={cn('text-xs', config.color)}>
              <Icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
          </Group>

          <Group gap="md" className="text-sm text-muted-foreground">
            <Text span inherit>
              Started: {new Date(run.startedAt).toLocaleString()}
            </Text>
            <Text span inherit>
              Duration: {Math.floor(duration / 60)}m {duration % 60}s
            </Text>
            <Text span inherit>
              Steps: {completedSteps}/{totalSteps}
            </Text>
          </Group>

          {run.error && (
            <Text mt="xs" size="sm" c="red">
              Error: {run.error}
            </Text>
          )}
        </div>
      </Group>
    </Paper>
  );
});
