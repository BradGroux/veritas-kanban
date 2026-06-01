import {
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { useBudgetMetrics, formatBudgetTokens, formatCurrency } from '@/hooks/useBudgetMetrics';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { cn } from '@/lib/utils';
import { Wallet, TrendingUp, AlertTriangle, CheckCircle, XCircle, Coins } from 'lucide-react';

interface BudgetCardProps {
  project?: string;
}

interface ProgressBarProps {
  value: number;
  projected?: number;
  warningThreshold: number;
  label: string;
  subLabel?: string;
}

function ProgressBar({ value, projected, warningThreshold, label, subLabel }: ProgressBarProps) {
  const getColor = (pct: number) => {
    if (pct >= 100) return 'red';
    if (pct >= warningThreshold) return 'yellow';
    if (pct >= 60) return 'yellow';
    return 'green';
  };

  const cappedValue = Math.min(value, 100);
  const cappedProjected = projected !== undefined ? Math.min(projected, 100) : undefined;

  return (
    <Stack gap={4}>
      <Group justify="space-between" className="text-sm">
        <Text component="span" size="sm" c="dimmed">
          {label}
        </Text>
        <span
          className={cn(
            'font-medium',
            value >= 100 && 'text-red-500',
            value >= warningThreshold && value < 100 && 'text-yellow-500'
          )}
        >
          {value.toFixed(1)}%
          {subLabel && <span className="text-xs text-muted-foreground ml-1">({subLabel})</span>}
        </span>
      </Group>
      <div className="relative">
        {/* Projected line (dashed marker) */}
        {cappedProjected !== undefined && cappedProjected > cappedValue && (
          <div
            className="absolute top-0 z-10 h-full w-0.5 bg-foreground/30"
            style={{ left: `${cappedProjected}%` }}
          />
        )}
        {/* Warning threshold marker */}
        <div
          className="absolute top-0 z-10 h-full w-px bg-yellow-500/50"
          style={{ left: `${warningThreshold}%` }}
        />
        <Progress value={cappedValue} color={getColor(value)} size="sm" />
      </div>
    </Stack>
  );
}

export function BudgetCard({ project }: BudgetCardProps) {
  const { settings } = useFeatureSettings();
  const { data: metrics, isLoading, error } = useBudgetMetrics(project);

  // Don't render if budget tracking is disabled
  if (!settings.budget.enabled) {
    return null;
  }

  // Show message if no budget is set
  const hasBudget = settings.budget.monthlyTokenLimit > 0 || settings.budget.monthlyCostLimit > 0;

  if (error) {
    return (
      <Paper withBorder p="md" radius="md">
        <Group gap="xs" c="red">
          <XCircle className="h-4 w-4" />
          <Text size="sm">Failed to load budget metrics</Text>
        </Group>
      </Paper>
    );
  }

  if (isLoading) {
    return (
      <Paper withBorder p="md" radius="md">
        <Stack gap="md">
          <Group gap="xs">
            <Skeleton h={20} w={20} radius="sm" />
            <Skeleton h={20} w={96} radius="sm" />
          </Group>
          <Skeleton h={8} radius="xl" />
          <Skeleton h={8} radius="xl" />
          <SimpleGrid cols={3} spacing="md">
            <Skeleton h={48} radius="md" />
            <Skeleton h={48} radius="md" />
            <Skeleton h={48} radius="md" />
          </SimpleGrid>
        </Stack>
      </Paper>
    );
  }

  if (!metrics) {
    return null;
  }

  const StatusIcon =
    metrics.status === 'danger'
      ? AlertTriangle
      : metrics.status === 'warning'
        ? AlertTriangle
        : CheckCircle;

  const statusColor =
    metrics.status === 'danger'
      ? 'text-red-500'
      : metrics.status === 'warning'
        ? 'text-yellow-500'
        : 'text-green-500';

  const statusBg =
    metrics.status === 'danger'
      ? 'bg-red-500/10 border-red-500/20'
      : metrics.status === 'warning'
        ? 'bg-yellow-500/10 border-yellow-500/20'
        : 'bg-green-500/10 border-green-500/20';

  return (
    <Paper withBorder p="md" radius="md" className={cn(statusBg)}>
      <Stack gap="md">
        {/* Header */}
        <Group justify="space-between">
          <Group gap="xs">
            <Wallet className={cn('h-5 w-5', statusColor)} />
            <Text fw={500}>Monthly Budget</Text>
          </Group>
          <Group gap={6}>
            <StatusIcon className={cn('h-4 w-4', statusColor)} />
            <span className={cn('text-sm font-medium capitalize', statusColor)}>
              {metrics.status === 'ok' ? 'On Track' : metrics.status}
            </span>
          </Group>
        </Group>

        {/* Period info */}
        <Text size="xs" c="dimmed">
          {(() => {
            // Parse as local date to avoid timezone issues (YYYY-MM-DD format)
            const [year, month] = metrics.periodStart.split('-').map(Number);
            const date = new Date(year, month - 1, 1);
            return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          })()}
          {' • '}
          Day {metrics.daysElapsed} of {metrics.daysInMonth}
          {' • '}
          {metrics.daysRemaining} days remaining
        </Text>

        {!hasBudget ? (
          <Stack gap={4} py="md" ta="center">
            <Text size="sm" c="dimmed">
              No budget limits set.
            </Text>
            <Text size="xs" c="dimmed">
              Configure token or cost limits in Settings → Data.
            </Text>
          </Stack>
        ) : (
          <>
            {/* Progress Bars */}
            <Stack gap="sm">
              {metrics.tokenBudget > 0 && (
                <ProgressBar
                  value={metrics.tokenBudgetUsed}
                  projected={metrics.projectedTokenOverage}
                  warningThreshold={settings.budget.warningThreshold}
                  label="Token Usage"
                  subLabel={`${formatBudgetTokens(metrics.totalTokens)} / ${formatBudgetTokens(metrics.tokenBudget)}`}
                />
              )}
              {metrics.costBudget > 0 && (
                <ProgressBar
                  value={metrics.costBudgetUsed}
                  projected={metrics.projectedCostOverage}
                  warningThreshold={settings.budget.warningThreshold}
                  label="Cost"
                  subLabel={`${formatCurrency(metrics.estimatedCost)} / ${formatCurrency(metrics.costBudget)}`}
                />
              )}
            </Stack>

            {/* Stats Grid */}
            <SimpleGrid cols={3} spacing="sm" className="border-t pt-2">
              <div className="text-center">
                <Group justify="center" gap={4} c="dimmed">
                  <ThemeIcon variant="transparent" color="gray" size="xs">
                    <Coins className="h-3.5 w-3.5" />
                  </ThemeIcon>
                  <Text size="xs">Daily Burn</Text>
                </Group>
                <div className="font-semibold text-sm mt-0.5">
                  {formatBudgetTokens(metrics.tokensPerDay)}/day
                </div>
                {metrics.costPerDay > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(metrics.costPerDay)}/day
                  </div>
                )}
              </div>

              <div className="text-center">
                <Group justify="center" gap={4} c="dimmed">
                  <ThemeIcon variant="transparent" color="gray" size="xs">
                    <TrendingUp className="h-3.5 w-3.5" />
                  </ThemeIcon>
                  <Text size="xs">Projected</Text>
                </Group>
                <div
                  className={cn(
                    'font-semibold text-sm mt-0.5',
                    metrics.projectedTokenOverage > 100 && 'text-red-500',
                    metrics.projectedTokenOverage > settings.budget.warningThreshold &&
                      metrics.projectedTokenOverage <= 100 &&
                      'text-yellow-500'
                  )}
                >
                  {formatBudgetTokens(metrics.projectedMonthlyTokens)}
                </div>
                {metrics.projectedMonthlyCost > 0 && (
                  <div
                    className={cn(
                      'text-xs',
                      metrics.projectedCostOverage > 100 ? 'text-red-500' : 'text-muted-foreground'
                    )}
                  >
                    {formatCurrency(metrics.projectedMonthlyCost)}
                  </div>
                )}
              </div>

              <div className="text-center">
                <Group justify="center" gap={4} c="dimmed">
                  <ThemeIcon variant="transparent" color="gray" size="xs">
                    <Wallet className="h-3.5 w-3.5" />
                  </ThemeIcon>
                  <Text size="xs">Budget</Text>
                </Group>
                <div className="font-semibold text-sm mt-0.5">
                  {metrics.tokenBudget > 0 ? formatBudgetTokens(metrics.tokenBudget) : '—'}
                </div>
                {metrics.costBudget > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {formatCurrency(metrics.costBudget)}
                  </div>
                )}
              </div>
            </SimpleGrid>

            {/* Projected overage warning */}
            {(metrics.projectedTokenOverage > 100 || metrics.projectedCostOverage > 100) && (
              <Group
                align="flex-start"
                gap="xs"
                p="xs"
                className="rounded bg-red-500/10 text-xs text-red-500"
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">Projected to exceed budget</span>
                  {metrics.projectedTokenOverage > 100 && metrics.tokenBudget > 0 && (
                    <div>
                      Tokens:{' '}
                      {formatBudgetTokens(metrics.projectedMonthlyTokens - metrics.tokenBudget)}{' '}
                      over budget
                    </div>
                  )}
                  {metrics.projectedCostOverage > 100 && metrics.costBudget > 0 && (
                    <div>
                      Cost: {formatCurrency(metrics.projectedMonthlyCost - metrics.costBudget)} over
                      budget
                    </div>
                  )}
                </div>
              </Group>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
