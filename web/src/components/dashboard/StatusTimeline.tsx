import { useMemo } from 'react';
import { 
  useDailySummary, 
  formatDurationMs, 
  calculateActivePercent,
  getStatusColor,
  type DailySummary,
  type StatusHistoryEntry,
  useStatusHistory,
} from '@/hooks/useStatusHistory';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Clock, Activity, Coffee, ArrowRight } from 'lucide-react';

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

function StatusBadge({ status }: { status: string }) {
  const colorClass = getStatusColor(status);
  
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white',
      colorClass
    )}>
      {status}
    </span>
  );
}

function RecentTransitions({ entries }: { entries: StatusHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-2">
        No recent transitions
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {entries.slice(0, 10).map((entry) => (
        <div 
          key={entry.id}
          className="flex items-center gap-2 text-sm p-2 rounded hover:bg-muted/50"
        >
          <span className="text-xs text-muted-foreground w-16 shrink-0">
            {new Date(entry.timestamp).toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </span>
          <StatusBadge status={entry.previousStatus} />
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <StatusBadge status={entry.newStatus} />
          {entry.taskTitle && (
            <span className="text-xs text-muted-foreground truncate ml-auto">
              {entry.taskTitle}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatusTimeline({ date }: StatusTimelineProps) {
  const { data: summary, isLoading: summaryLoading } = useDailySummary(date);
  const { data: history, isLoading: historyLoading } = useStatusHistory(20);

  // Filter history to today's entries
  const todayEntries = useMemo(() => {
    if (!history) return [];
    const targetDate = date || new Date().toISOString().split('T')[0];
    return history.filter(entry => 
      entry.timestamp.startsWith(targetDate)
    );
  }, [history, date]);

  if (summaryLoading || historyLoading) {
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
    return (
      <div className="text-center text-muted-foreground py-4">
        No status data available
      </div>
    );
  }

  const activePercent = calculateActivePercent(summary);

  return (
    <div className="space-y-4">
      {/* Daily Timeline Bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Daily Activity ({summary.date})
          </h4>
          <span className="text-sm font-medium">
            {activePercent}% active
          </span>
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
          <div className="text-lg font-bold">
            {summary.transitions}
          </div>
          <div className="text-xs text-muted-foreground">Transitions</div>
        </div>
      </div>

      {/* Recent Transitions */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-2">
          Recent Status Changes
        </h4>
        <RecentTransitions entries={todayEntries} />
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
