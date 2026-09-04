import { UiSurface, UiPill } from '@/components/ui/UiVocabulary';
import { useMemo } from 'react';
import { Activity as ActivityIcon, ArrowRight, ArrowRightLeft, Zap, Coffee } from 'lucide-react';
import { Group, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import { useDailySummary, useStatusHistory, formatDurationMs } from '@/hooks/useStatusHistory';
import { useActivityFeed, type Activity } from '@/hooks/useActivity';
import { cn } from '@/lib/utils';
import { PrimaryPageShell } from '@/components/layout/PrimaryPageShell';

function getStatusTone(status: string) {
  switch (status) {
    case 'todo':
      return 'neutral';
    case 'in-progress':
    case 'working':
    case 'thinking':
      return 'info';
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'success';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

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
    <Stack gap="lg">
      {/* Summary Cards */}
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        <UiSurface p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="transparent" color="green">
              <Zap className="h-5 w-5" />
            </ThemeIcon>
            <Text size="sm" c="dimmed">
              Active Time
            </Text>
          </Group>
          <Text size="xl" fw={700} c="green">
            {formatDurationMs(summary.activeMs)}
          </Text>
        </UiSurface>
        <UiSurface p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="transparent" color="gray">
              <Coffee className="h-5 w-5" />
            </ThemeIcon>
            <Text size="sm" c="dimmed">
              Idle Time
            </Text>
          </Group>
          <Text size="xl" fw={700} c="dimmed">
            {formatDurationMs(summary.idleMs)}
          </Text>
        </UiSurface>
        <UiSurface p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="transparent" color="violet">
              <ActivityIcon className="h-5 w-5" />
            </ThemeIcon>
            <Text size="sm" c="dimmed">
              Utilization
            </Text>
          </Group>
          <Text size="xl" fw={700}>
            {activePercent}%
          </Text>
        </UiSurface>
      </SimpleGrid>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-3 rounded-full overflow-hidden flex bg-muted">
          <div className="bg-green-500" style={{ width: `${(summary.activeMs / total) * 100}%` }} />
          <div className="bg-gray-400" style={{ width: `${(summary.idleMs / total) * 100}%` }} />
          {summary.errorMs > 0 && (
            <div className="bg-red-500" style={{ width: `${(summary.errorMs / total) * 100}%` }} />
          )}
        </div>
      )}
    </Stack>
  );
}

// ─── Status History ──────────────────────────────────────────────────────────

function StatusBadge({ status, isTaskStatus }: { status: string; isTaskStatus?: boolean }) {
  // Format task status for display
  const displayStatus = isTaskStatus ? (status === 'in-progress' ? 'in-progress' : status) : status;
  return (
    <UiPill kind="status" tone={getStatusTone(status)}>
      {displayStatus}
    </UiPill>
  );
}

interface StatusHistoryPanelProps {
  onTaskClick?: (taskId: string) => void;
}

// Unified entry type for both agent status and task status changes
interface UnifiedEntry {
  id: string;
  timestamp: string;
  type: 'agent' | 'task';
  previousStatus: string;
  newStatus: string;
  taskId?: string;
  taskTitle?: string;
  durationMs?: number;
}

function StatusHistoryPanel({ onTaskClick }: StatusHistoryPanelProps) {
  const { data: agentHistory, isLoading: agentLoading } = useStatusHistory(100);
  const { data: taskActivity, isLoading: taskLoading } = useActivityFeed(100, {
    type: 'status_changed',
  });

  const isLoading = agentLoading || taskLoading;

  // Merge and sort both types of status changes
  const allEntries = useMemo(() => {
    const entries: UnifiedEntry[] = [];

    // Add agent status entries
    (agentHistory || []).forEach((entry) => {
      entries.push({
        id: entry.id,
        timestamp: entry.timestamp,
        type: 'agent',
        previousStatus: entry.previousStatus,
        newStatus: entry.newStatus,
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        durationMs: entry.durationMs,
      });
    });

    // Add task status change entries
    const taskPages = taskActivity?.pages ?? [];
    taskPages.flat().forEach((activity: Activity) => {
      if (activity.type === 'status_changed' && activity.details) {
        entries.push({
          id: activity.id,
          timestamp: activity.timestamp,
          type: 'task',
          previousStatus: String(activity.details.from || 'unknown'),
          newStatus: String(activity.details.status || 'unknown'),
          taskId: activity.taskId,
          taskTitle: activity.taskTitle,
        });
      }
    });

    // Sort by timestamp descending
    return entries.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [agentHistory, taskActivity]);

  // Group by day
  const grouped = allEntries.reduce<Record<string, UnifiedEntry[]>>((acc, entry) => {
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
              {grouped[day].map((entry) => {
                const isTaskStatus = entry.type === 'task';
                // Status belongs in the semantic pill, not a second colored title.
                const titleColor = 'text-foreground';

                return (
                  <div
                    key={entry.id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 py-2.5 px-3 rounded-md transition-colors sm:flex-nowrap',
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
                    <StatusBadge status={entry.previousStatus} isTaskStatus={isTaskStatus} />
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <StatusBadge status={entry.newStatus} isTaskStatus={isTaskStatus} />
                    <div className="flex min-w-0 basis-full flex-col items-start gap-1 sm:flex-1 sm:flex-row sm:items-center sm:gap-2">
                      {entry.taskId && (
                        <span className="max-w-full break-all text-sm text-muted-foreground sm:shrink-0">
                          {entry.taskId}
                        </span>
                      )}
                      <span
                        className={cn(
                          'max-w-full break-words text-sm sm:truncate',
                          onTaskClick && 'hover:underline',
                          titleColor
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
                );
              })}
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
    <PrimaryPageShell title="Activity" onBack={onBack}>
      <Stack gap="lg">
        <DailySummaryPanel />
        <StatusHistoryPanel onTaskClick={onTaskClick} />
      </Stack>
    </PrimaryPageShell>
  );
}
