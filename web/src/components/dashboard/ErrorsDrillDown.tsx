import { useFailedRuns, formatDuration, type MetricsPeriod } from '@/hooks/useMetrics';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Clock, Bot, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ErrorsDrillDownProps {
  period: MetricsPeriod;
  project?: string;
  onTaskClick?: (taskId: string) => void;
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

export function ErrorsDrillDown({ period, project, onTaskClick, from, to }: ErrorsDrillDownProps) {
  const { data: failedRuns, isLoading } = useFailedRuns(period, project, 50, from, to);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!failedRuns || failedRuns.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="h-12 w-12 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
          <span className="text-green-500 text-xl">✓</span>
        </div>
        <p className="text-foreground font-medium">All runs successful</p>
        <p className="text-sm text-muted-foreground mt-1">No failures in the selected period</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 text-red-500" />
        <span>
          {failedRuns.length} failed run(s) in the {getPeriodLabel(period)}
        </span>
      </div>

      {/* Failed Runs List */}
      <div className="space-y-2">
        {failedRuns.map((run, index) => (
          <FailedRunRow key={`${run.timestamp}-${index}`} run={run} onTaskClick={onTaskClick} />
        ))}
      </div>
    </div>
  );
}

interface FailedRunRowProps {
  run: {
    timestamp: string;
    taskId?: string;
    project?: string;
    agent: string;
    errorMessage?: string;
    durationMs?: number;
  };
  onTaskClick?: (taskId: string) => void;
}

function FailedRunRow({ run, onTaskClick }: FailedRunRowProps) {
  const date = new Date(run.timestamp);
  const canNavigate = run.taskId && onTaskClick;

  const content = (
    <div
      className={cn(
        'rounded-lg border border-red-500/20 bg-red-500/5 p-3',
        canNavigate && 'hover:bg-red-500/10 transition-colors cursor-pointer'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
            <span className="font-medium truncate">{run.taskId || 'Unknown task'}</span>
            {canNavigate && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
          </div>

          {run.errorMessage && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{run.errorMessage}</p>
          )}

          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Bot className="h-3 w-3" />
              {run.agent}
            </span>
            {run.project && (
              <Badge variant="outline" className="text-xs">
                {run.project}
              </Badge>
            )}
            {run.durationMs && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(run.durationMs)}
              </span>
            )}
          </div>
        </div>

        <div className="text-xs text-muted-foreground text-right flex-shrink-0">
          <div>{date.toLocaleDateString()}</div>
          <div>{date.toLocaleTimeString()}</div>
        </div>
      </div>
    </div>
  );

  if (canNavigate) {
    return (
      <button
        onClick={() => onTaskClick(run.taskId!)}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-lg"
      >
        {content}
      </button>
    );
  }

  return content;
}
