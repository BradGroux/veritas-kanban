import {
  Activity as ActivityIcon,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Zap,
  Coffee,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useDailySummary,
  useStatusHistory,
  formatDurationMs,
  getStatusColor,
  type StatusHistoryEntry,
} from '@/hooks/useStatusHistory';
import { cn } from '@/lib/utils';

// ─── Daily Summary ───────────────────────────────────────────────────────────

function DailySummaryPanel() {
  const { data: summary, isLoading } = useDailySummary();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-muted-foreground">Loading daily summary…</span>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="text-center py-16">
        <Coffee className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-lg font-medium text-muted-foreground">No data for today</p>
      </div>
    );
  }

  const total = summary.activeMs + summary.idleMs + summary.errorMs;
  const activePercent = total > 0 ? Math.round((summary.activeMs / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-5 w-5 text-green-500" />
            <span className="text-sm text-muted-foreground">Active Time</span>
          </div>
          <div className="text-2xl font-bold text-green-500">
            {formatDurationMs(summary.activeMs)}
          </div>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 mb-2">
            <Coffee className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Idle Time</span>
          </div>
          <div className="text-2xl font-bold text-muted-foreground">
            {formatDurationMs(summary.idleMs)}
          </div>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="flex items-center gap-2 mb-2">
            <ActivityIcon className="h-5 w-5 text-primary" />
            <span className="text-sm text-muted-foreground">Utilization</span>
          </div>
          <div className="text-2xl font-bold">{activePercent}%</div>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-3 rounded-full overflow-hidden flex bg-muted">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${(summary.activeMs / total) * 100}%` }}
          />
          <div
            className="bg-gray-400 transition-all"
            style={{ width: `${(summary.idleMs / total) * 100}%` }}
          />
          {summary.errorMs > 0 && (
            <div
              className="bg-red-500 transition-all"
              style={{ width: `${(summary.errorMs / total) * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Status History ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colorClass = getStatusColor(status);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-20 px-2 py-0.5 rounded text-xs font-medium text-white',
        colorClass
      )}
    >
      {status}
    </span>
  );
}

interface StatusHistoryPanelProps {
  onTaskClick?: (taskId: string) => void;
}

function StatusHistoryPanel({ onTaskClick }: StatusHistoryPanelProps) {
  const { data: history, isLoading } = useStatusHistory(100);

  // Group by day
  const grouped = (history || []).reduce<Record<string, StatusHistoryEntry[]>>((acc, entry) => {
    const day = entry.timestamp.slice(0, 10);
    if (!acc[day]) acc[day] = [];
    acc[day].push(entry);
    return acc;
  }, {});

  const days = Object.keys(grouped).sort().reverse();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-muted-foreground">Loading status history…</span>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div className="text-center py-16">
        <ArrowRightLeft className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-lg font-medium text-muted-foreground">No status changes recorded</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {days.map((day) => {
        const d = new Date(day);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        let label: string;
        if (d.toDateString() === today.toDateString()) label = 'Today';
        else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
        else
          label = d.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });

        return (
          <div key={day}>
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-muted-foreground">{label}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </div>
            <div className="space-y-1">
              {grouped[day].map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-center gap-3 py-2.5 px-3 rounded-md transition-colors',
                    entry.taskId && onTaskClick
                      ? 'hover:bg-muted/50 cursor-pointer'
                      : 'hover:bg-muted/30'
                  )}
                  onClick={() => entry.taskId && onTaskClick?.(entry.taskId)}
                  role={entry.taskId && onTaskClick ? 'button' : undefined}
                  tabIndex={entry.taskId && onTaskClick ? 0 : undefined}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && entry.taskId && onTaskClick) {
                      e.preventDefault();
                      onTaskClick(entry.taskId);
                    }
                  }}
                >
                  <span className="text-xs text-muted-foreground w-16 shrink-0 font-mono">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <StatusBadge status={entry.previousStatus} />
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <StatusBadge status={entry.newStatus} />
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {entry.taskId && (
                      <span className="text-sm text-muted-foreground shrink-0">{entry.taskId}</span>
                    )}
                    <span
                      className={cn(
                        'text-sm truncate',
                        entry.taskId && onTaskClick && 'hover:underline',
                        // Color based on newStatus
                        entry.newStatus === 'working' || entry.newStatus === 'thinking'
                          ? 'text-green-500'
                          : entry.newStatus === 'sub-agent'
                            ? 'text-blue-500'
                            : entry.newStatus === 'error'
                              ? 'text-red-500'
                              : 'text-gray-500'
                      )}
                      title={entry.taskTitle || 'No task'}
                    >
                      {entry.taskTitle || '—'}
                    </span>
                  </div>
                  {entry.durationMs && (
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {formatDurationMs(entry.durationMs)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface ActivityFeedProps {
  onBack: () => void;
  onTaskClick?: (taskId: string) => void;
}

export function ActivityFeed({ onBack, onTaskClick }: ActivityFeedProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={onBack} title="Back to board">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <ActivityIcon className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Activity</h2>
        </div>
      </div>

      {/* Daily Summary */}
      <DailySummaryPanel />

      {/* Status History — full width */}
      <StatusHistoryPanel onTaskClick={onTaskClick} />
    </div>
  );
}
