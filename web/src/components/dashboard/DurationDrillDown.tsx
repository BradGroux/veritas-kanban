import { useDurationMetrics, formatDuration, type MetricsPeriod } from '@/hooks/useMetrics';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Clock, Bot, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DurationDrillDownProps {
  period: MetricsPeriod;
  project?: string;
  from?: string;
  to?: string;
}

function getPeriodLabel(period: MetricsPeriod): string {
  const labels: Record<MetricsPeriod, string> = {
    today: 'today',
    '24h': 'last 24 hours',
    '3d': 'last 3 days',
    wtd: 'this week',
    mtd: 'this month',
    ytd: 'this year',
    '7d': 'last 7 days',
    '30d': 'last 30 days',
    '3m': 'last 3 months',
    '6m': 'last 6 months',
    '12m': 'last 12 months',
    all: 'all time',
    custom: 'custom period',
  };
  return labels[period];
}

export function DurationDrillDown({ period, project, from, to }: DurationDrillDownProps) {
  const { data: metrics, isLoading } = useDurationMetrics(period, project, from, to);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-8">
        <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No duration data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-medium text-muted-foreground mb-3">
          Run Duration Summary ({getPeriodLabel(period)})
        </h4>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <div className="text-2xl font-bold text-primary">{metrics.runs}</div>
            <div className="text-xs text-muted-foreground">Total Runs</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{formatDuration(metrics.avgMs)}</div>
            <div className="text-xs text-muted-foreground">Average</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-500">{formatDuration(metrics.p50Ms)}</div>
            <div className="text-xs text-muted-foreground">Median (p50)</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-yellow-500">
              {formatDuration(metrics.p95Ms)}
            </div>
            <div className="text-xs text-muted-foreground">95th Percentile</div>
          </div>
        </div>
      </div>

      {/* Per-Agent Breakdown */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Bot className="h-4 w-4" />
          Breakdown by Agent
        </h4>

        {metrics.byAgent.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">No agent data available</div>
        ) : (
          <div className="space-y-2">
            {metrics.byAgent.map((agent, index) => {
              // Find fastest and slowest
              const isFastest =
                index === metrics.byAgent.length - 1 ||
                agent.avgMs === Math.min(...metrics.byAgent.map((a) => a.avgMs));
              const isSlowest =
                index === 0 &&
                metrics.byAgent.length > 1 &&
                agent.avgMs === Math.max(...metrics.byAgent.map((a) => a.avgMs));

              return (
                <AgentDurationRow
                  key={agent.agent}
                  agent={agent}
                  overallAvg={metrics.avgMs}
                  isFastest={isFastest}
                  isSlowest={isSlowest}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface AgentDurationRowProps {
  agent: {
    agent: string;
    runs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
  };
  overallAvg: number;
  isFastest: boolean;
  isSlowest: boolean;
}

function AgentDurationRow({ agent, overallAvg, isFastest, isSlowest }: AgentDurationRowProps) {
  const diff = agent.avgMs - overallAvg;
  const diffPercent = overallAvg > 0 ? (diff / overallAvg) * 100 : 0;
  const isAboveAvg = diff > 0;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        isFastest && 'border-green-500/30 bg-green-500/5',
        isSlowest && 'border-yellow-500/30 bg-yellow-500/5'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{agent.agent}</span>
          {isFastest && (
            <Badge variant="secondary" className="text-xs flex items-center gap-1 text-green-500">
              <TrendingDown className="h-3 w-3" />
              Fastest
            </Badge>
          )}
          {isSlowest && (
            <Badge variant="secondary" className="text-xs flex items-center gap-1 text-yellow-500">
              <TrendingUp className="h-3 w-3" />
              Slowest
            </Badge>
          )}
        </div>
        <Badge variant="outline" className="text-xs">
          {agent.runs} runs
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground text-xs block">Average</span>
          <span className="font-medium">{formatDuration(agent.avgMs)}</span>
        </div>
        <div>
          <span className="text-muted-foreground text-xs block">Median</span>
          <span className="font-medium text-green-500">{formatDuration(agent.p50Ms)}</span>
        </div>
        <div>
          <span className="text-muted-foreground text-xs block">p95</span>
          <span className="font-medium text-yellow-500">{formatDuration(agent.p95Ms)}</span>
        </div>
        <div className="text-right">
          <span className="text-muted-foreground text-xs block">vs Avg</span>
          <span className={cn('font-medium', isAboveAvg ? 'text-red-500' : 'text-green-500')}>
            {isAboveAvg ? '+' : ''}
            {diffPercent.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}
