import {
  useDailySummary,
  formatDurationMs,
  calculateActivePercent,
  type DailySummary,
} from '@/hooks/useStatusHistory';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, Activity, Coffee } from 'lucide-react';

interface StatusTimelineProps {
  date?: string;
}

function TimelineBar({ summary }: { summary: DailySummary }) {
  const total = summary.activeMs + summary.idleMs + summary.errorMs;

  if (total === 0) {
    return (
      <div className="h-8 bg-muted rounded-md flex items-center justify-center text-sm text-muted-foreground">
        No activity recorded
      </div>
    );
  }

  // Calculate percentages
  const activePercent = (summary.activeMs / total) * 100;
  const idlePercent = (summary.idleMs / total) * 100;
  const errorPercent = (summary.errorMs / total) * 100;

  return (
    <div className="h-8 rounded-md overflow-hidden flex">
      {activePercent > 0 && (
        <div
          className="bg-green-500 flex items-center justify-center text-xs text-white font-medium transition-all"
          style={{ width: `${activePercent}%` }}
          title={`Active: ${formatDurationMs(summary.activeMs)}`}
        >
          {activePercent >= 15 && formatDurationMs(summary.activeMs)}
        </div>
      )}
      {idlePercent > 0 && (
        <div
          className="bg-gray-400 flex items-center justify-center text-xs text-white font-medium transition-all"
          style={{ width: `${idlePercent}%` }}
          title={`Idle: ${formatDurationMs(summary.idleMs)}`}
        >
          {idlePercent >= 15 && formatDurationMs(summary.idleMs)}
        </div>
      )}
      {errorPercent > 0 && (
        <div
          className="bg-red-500 flex items-center justify-center text-xs text-white font-medium transition-all"
          style={{ width: `${errorPercent}%` }}
          title={`Error: ${formatDurationMs(summary.errorMs)}`}
        >
          {errorPercent >= 15 && formatDurationMs(summary.errorMs)}
        </div>
      )}
    </div>
  );
}

export function StatusTimeline({ date }: StatusTimelineProps) {
  const { data: summary, isLoading: summaryLoading } = useDailySummary(date);

  if (summaryLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center text-muted-foreground py-4">No status data available</div>;
  }

  const activePercent = calculateActivePercent(summary);

  return (
    <div className="space-y-4">
      {/* Daily Activity — full width */}
      <div className="space-y-4">
        {/* Timeline Bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Daily Activity ({summary.date})
            </h4>
            <span className="text-sm font-medium">{activePercent}% active</span>
          </div>
          <TimelineBar summary={summary} />
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border bg-green-500/10 border-green-500/20 p-3 text-center">
            <Activity className="h-4 w-4 mx-auto mb-1 text-green-500" />
            <div className="text-lg font-bold text-green-500">
              {formatDurationMs(summary.activeMs)}
            </div>
            <div className="text-xs text-muted-foreground">Active</div>
          </div>

          <div className="rounded-lg border bg-muted/50 p-3 text-center">
            <Coffee className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <div className="text-lg font-bold text-muted-foreground">
              {formatDurationMs(summary.idleMs)}
            </div>
            <div className="text-xs text-muted-foreground">Idle</div>
          </div>

          <div className="rounded-lg border bg-card p-3 text-center">
            <Clock className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <div className="text-lg font-bold">{summary.transitions}</div>
            <div className="text-xs text-muted-foreground">Transitions</div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground justify-center pt-2 border-t">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span>Working/Thinking</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span>Sub-agent</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-400" />
          <span>Idle</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span>Error</span>
        </div>
      </div>
    </div>
  );
}
