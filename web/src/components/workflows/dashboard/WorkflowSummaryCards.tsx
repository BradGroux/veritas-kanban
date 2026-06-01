/**
 * WorkflowSummaryCards - Summary metrics cards for workflow dashboard
 */

import { memo } from 'react';
import type { ElementType } from 'react';
import { Group, Paper, SimpleGrid, Text, ThemeIcon } from '@mantine/core';
import { BarChart3, Activity, CheckCircle2, XCircle, TrendingUp, Clock } from 'lucide-react';
import type { WorkflowStats, WorkflowPeriod } from '@/hooks/useWorkflowStats';
import { formatDuration } from '@/hooks/useMetrics';

interface WorkflowSummaryCardsProps {
  stats: WorkflowStats;
  period: WorkflowPeriod;
}

export const WorkflowSummaryCards = memo(function WorkflowSummaryCards({
  stats,
  period,
}: WorkflowSummaryCardsProps) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md">
      <SummaryCard
        title="Total Workflows"
        value={stats.totalWorkflows}
        icon={BarChart3}
        color="blue"
      />
      <SummaryCard title="Active Runs" value={stats.activeRuns} icon={Activity} color="blue" />
      <SummaryCard
        title="Completed"
        value={stats.completedRuns}
        subtitle={`(${period})`}
        icon={CheckCircle2}
        color="green"
      />
      <SummaryCard
        title="Failed"
        value={stats.failedRuns}
        subtitle={`(${period})`}
        icon={XCircle}
        color="red"
      />
      <SummaryCard
        title="Success Rate"
        value={`${(stats.successRate * 100).toFixed(1)}%`}
        icon={TrendingUp}
        color={stats.successRate >= 0.8 ? 'green' : stats.successRate >= 0.5 ? 'yellow' : 'red'}
      />
      <SummaryCard
        title="Avg Duration"
        value={formatDuration(stats.avgDuration)}
        icon={Clock}
        color="blue"
      />
    </SimpleGrid>
  );
});

interface SummaryCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ElementType;
  color: 'blue' | 'green' | 'red' | 'yellow';
}

function SummaryCard({ title, value, subtitle, icon: Icon, color }: SummaryCardProps) {
  return (
    <Paper className="p-6" radius="md" withBorder>
      <Group align="flex-start" justify="space-between">
        <div>
          <Text size="sm" c="dimmed" mb={4}>
            {title}
          </Text>
          <Text size="xl" fw={700} className="text-3xl">
            {value}{' '}
            {subtitle && (
              <Text span size="sm" c="dimmed">
                {subtitle}
              </Text>
            )}
          </Text>
        </div>
        <ThemeIcon variant="light" color={color} size="xl" radius="md">
          <Icon className="h-6 w-6" />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}
