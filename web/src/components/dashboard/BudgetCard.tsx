import { useBudgetMetrics, formatBudgetTokens, formatCurrency } from '@/hooks/useBudgetMetrics';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { 
  Wallet, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle,
  XCircle,
  Coins,
} from 'lucide-react';

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
    if (pct >= 100) return 'bg-red-500';
    if (pct >= warningThreshold) return 'bg-yellow-500';
    if (pct >= 60) return 'bg-yellow-400';
    return 'bg-green-500';
  };

  const cappedValue = Math.min(value, 100);
  const cappedProjected = projected !== undefined ? Math.min(projected, 100) : undefined;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn(
          'font-medium',
          value >= 100 && 'text-red-500',
          value >= warningThreshold && value < 100 && 'text-yellow-500',
        )}>
          {value.toFixed(1)}%
          {subLabel && <span className="text-xs text-muted-foreground ml-1">({subLabel})</span>}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden relative">
        {/* Projected line (dashed marker) */}
        {cappedProjected !== undefined && cappedProjected > cappedValue && (
          <div 
            className="absolute top-0 h-full w-0.5 bg-foreground/30 z-10"
            style={{ left: `${cappedProjected}%` }}
          />
        )}
        {/* Warning threshold marker */}
        <div 
          className="absolute top-0 h-full w-px bg-yellow-500/50"
          style={{ left: `${warningThreshold}%` }}
        />
        {/* Actual progress */}
        <div 
          className={cn('h-full transition-all duration-500', getColor(value))}
          style={{ width: `${cappedValue}%` }}
        />
      </div>
    </div>
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
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 text-destructive">
          <XCircle className="h-4 w-4" />
          <span className="text-sm">Failed to load budget metrics</span>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-2 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  const StatusIcon = metrics.status === 'danger' 
    ? AlertTriangle 
    : metrics.status === 'warning' 
      ? AlertTriangle 
      : CheckCircle;

  const statusColor = metrics.status === 'danger'
    ? 'text-red-500'
    : metrics.status === 'warning'
      ? 'text-yellow-500'
      : 'text-green-500';

  const statusBg = metrics.status === 'danger'
    ? 'bg-red-500/10 border-red-500/20'
    : metrics.status === 'warning'
      ? 'bg-yellow-500/10 border-yellow-500/20'
      : 'bg-green-500/10 border-green-500/20';

  return (
    <div className={cn('rounded-lg border p-4 space-y-4', statusBg)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className={cn('h-5 w-5', statusColor)} />
          <h3 className="font-medium">Monthly Budget</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusIcon className={cn('h-4 w-4', statusColor)} />
          <span className={cn('text-sm font-medium capitalize', statusColor)}>
            {metrics.status === 'ok' ? 'On Track' : metrics.status}
          </span>
        </div>
      </div>

      {/* Period info */}
      <div className="text-xs text-muted-foreground">
        {new Date(metrics.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        {' • '}
        Day {metrics.daysElapsed} of {metrics.daysInMonth}
        {' • '}
        {metrics.daysRemaining} days remaining
      </div>

      {!hasBudget ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          <p>No budget limits set.</p>
          <p className="text-xs mt-1">Configure token or cost limits in Settings → Data.</p>
        </div>
      ) : (
        <>
          {/* Progress Bars */}
          <div className="space-y-3">
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
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground">
                <Coins className="h-3.5 w-3.5" />
                <span className="text-xs">Daily Burn</span>
              </div>
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
              <div className="flex items-center justify-center gap-1 text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-xs">Projected</span>
              </div>
              <div className={cn(
                'font-semibold text-sm mt-0.5',
                metrics.projectedTokenOverage > 100 && 'text-red-500',
                metrics.projectedTokenOverage > settings.budget.warningThreshold && metrics.projectedTokenOverage <= 100 && 'text-yellow-500',
              )}>
                {formatBudgetTokens(metrics.projectedMonthlyTokens)}
              </div>
              {metrics.projectedMonthlyCost > 0 && (
                <div className={cn(
                  'text-xs',
                  metrics.projectedCostOverage > 100 ? 'text-red-500' : 'text-muted-foreground',
                )}>
                  {formatCurrency(metrics.projectedMonthlyCost)}
                </div>
              )}
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" />
                <span className="text-xs">Budget</span>
              </div>
              <div className="font-semibold text-sm mt-0.5">
                {metrics.tokenBudget > 0 
                  ? formatBudgetTokens(metrics.tokenBudget) 
                  : '—'}
              </div>
              {metrics.costBudget > 0 && (
                <div className="text-xs text-muted-foreground">
                  {formatCurrency(metrics.costBudget)}
                </div>
              )}
            </div>
          </div>

          {/* Projected overage warning */}
          {(metrics.projectedTokenOverage > 100 || metrics.projectedCostOverage > 100) && (
            <div className="flex items-start gap-2 p-2 rounded bg-red-500/10 text-red-500 text-xs">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">Projected to exceed budget</span>
                {metrics.projectedTokenOverage > 100 && metrics.tokenBudget > 0 && (
                  <div>
                    Tokens: {formatBudgetTokens(metrics.projectedMonthlyTokens - metrics.tokenBudget)} over budget
                  </div>
                )}
                {metrics.projectedCostOverage > 100 && metrics.costBudget > 0 && (
                  <div>
                    Cost: {formatCurrency(metrics.projectedMonthlyCost - metrics.costBudget)} over budget
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
