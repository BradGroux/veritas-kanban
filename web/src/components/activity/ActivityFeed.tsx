import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Activity as ActivityIcon,
  ArrowLeft,
  ArrowRight,
  List,
  LayoutList,
  RefreshCw,
  Trash2,
  Plus,
  Edit,
  ArrowRightLeft,
  Bot,
  Square,
  CheckCircle,
  Archive,
  Trash,
  GitBranch,
  GitMerge,
  FolderArchive,
  Timer,
  FileText,
  MessageSquare,
  MessageSquareOff,
  Filter,
  X,
  Zap,
  Coffee,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useActivityFeed,
  useActivityFilterOptions,
  useClearActivities,
  type Activity,
  type ActivityType,
  type ActivityFilters,
} from '@/hooks/useActivity';
import {
  useDailySummary,
  useStatusHistory,
  formatDurationMs,
  getStatusColor,
  type StatusHistoryEntry,
} from '@/hooks/useStatusHistory';
import { cn } from '@/lib/utils';

// ─── Icons ───────────────────────────────────────────────────────────────────

const activityIconMap: Record<ActivityType, typeof Plus> = {
  task_created: Plus,
  task_updated: Edit,
  status_changed: ArrowRightLeft,
  agent_started: Bot,
  agent_stopped: Square,
  agent_completed: CheckCircle,
  task_archived: Archive,
  task_deleted: Trash,
  worktree_created: GitBranch,
  worktree_merged: GitMerge,
  project_archived: FolderArchive,
  sprint_archived: Timer,
  template_applied: FileText,
  comment_added: MessageSquare,
  comment_deleted: MessageSquareOff,
};

const activityColorMap: Record<ActivityType, string> = {
  task_created: 'text-green-500',
  task_updated: 'text-blue-500',
  status_changed: 'text-amber-500',
  agent_started: 'text-violet-500',
  agent_stopped: 'text-gray-500',
  agent_completed: 'text-emerald-500',
  task_archived: 'text-orange-500',
  task_deleted: 'text-red-500',
  worktree_created: 'text-teal-500',
  worktree_merged: 'text-cyan-500',
  project_archived: 'text-orange-400',
  sprint_archived: 'text-yellow-500',
  template_applied: 'text-indigo-500',
  comment_added: 'text-sky-500',
  comment_deleted: 'text-gray-400',
};

const activityBgMap: Record<ActivityType, string> = {
  task_created: 'bg-green-500/10',
  task_updated: 'bg-blue-500/10',
  status_changed: 'bg-amber-500/10',
  agent_started: 'bg-violet-500/10',
  agent_stopped: 'bg-gray-500/10',
  agent_completed: 'bg-emerald-500/10',
  task_archived: 'bg-orange-500/10',
  task_deleted: 'bg-red-500/10',
  worktree_created: 'bg-teal-500/10',
  worktree_merged: 'bg-cyan-500/10',
  project_archived: 'bg-orange-400/10',
  sprint_archived: 'bg-yellow-500/10',
  template_applied: 'bg-indigo-500/10',
  comment_added: 'bg-sky-500/10',
  comment_deleted: 'bg-gray-400/10',
};

const activityLabels: Record<ActivityType, string> = {
  task_created: 'Task Created',
  task_updated: 'Task Updated',
  status_changed: 'Status Changed',
  agent_started: 'Agent Started',
  agent_stopped: 'Agent Stopped',
  agent_completed: 'Agent Completed',
  task_archived: 'Task Archived',
  task_deleted: 'Task Deleted',
  worktree_created: 'Worktree Created',
  worktree_merged: 'Worktree Merged',
  project_archived: 'Project Archived',
  sprint_archived: 'Sprint Archived',
  template_applied: 'Template Applied',
  comment_added: 'Comment Added',
  comment_deleted: 'Comment Deleted',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function formatAbsoluteTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildDetailsString(activity: Activity): string {
  const d = activity.details;
  if (!d) return '';

  switch (activity.type) {
    case 'status_changed':
      return d.from && d.status ? `${d.from} → ${d.status}` : d.status ? `→ ${d.status}` : '';
    case 'task_created':
      return [d.type, d.priority, d.project].filter(Boolean).join(' · ');
    case 'comment_added':
      return d.preview ? `"${d.preview}"` : '';
    case 'template_applied':
      return d.templateName ? `Template: ${d.templateName}` : '';
    case 'sprint_archived':
      return d.taskCount ? `${d.taskCount} tasks archived` : '';
    default:
      return '';
  }
}

// ─── Activity Card ───────────────────────────────────────────────────────────

interface ActivityCardProps {
  activity: Activity;
  compact: boolean;
  onTaskClick?: (taskId: string) => void;
  isNew?: boolean;
}

function ActivityCard({ activity, compact, onTaskClick, isNew }: ActivityCardProps) {
  const Icon = activityIconMap[activity.type] || ActivityIcon;
  const color = activityColorMap[activity.type] || 'text-muted-foreground';
  const bg = activityBgMap[activity.type] || 'bg-muted/10';
  const details = buildDetailsString(activity);

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 py-2 px-3 rounded-md transition-all hover:bg-muted/50',
          isNew && 'animate-in slide-in-from-top-2 fade-in duration-300'
        )}
      >
        <div className={cn('flex-shrink-0 p-1 rounded', bg)}>
          <Icon className={cn('h-3.5 w-3.5', color)} />
        </div>
        <span className="text-xs text-muted-foreground w-16 flex-shrink-0">
          {activityLabels[activity.type]?.replace('Task ', '').replace('Agent ', '') ||
            activity.type}
        </span>
        <button
          className="text-sm font-medium truncate hover:underline cursor-pointer text-left"
          onClick={() => onTaskClick?.(activity.taskId)}
          title={activity.taskTitle}
        >
          {activity.taskTitle}
        </button>
        {activity.agent && (
          <Badge variant="outline" className="text-xs flex-shrink-0 ml-auto">
            {activity.agent}
          </Badge>
        )}
        {details && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={details}>
            {details}
          </span>
        )}
        <span
          className="text-xs text-muted-foreground flex-shrink-0 ml-auto"
          title={formatAbsoluteTime(activity.timestamp)}
        >
          {formatRelativeTime(activity.timestamp)}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex gap-4 p-4 rounded-lg border border-border/50 transition-all hover:border-border hover:shadow-sm',
        isNew && 'animate-in slide-in-from-top-2 fade-in duration-300'
      )}
    >
      <div className={cn('flex-shrink-0 p-2 rounded-lg h-fit', bg)}>
        <Icon className={cn('h-5 w-5', color)} />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              className="text-sm font-semibold hover:underline cursor-pointer block truncate text-left"
              onClick={() => onTaskClick?.(activity.taskId)}
              title={activity.taskTitle}
            >
              {activity.taskTitle}
            </button>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="secondary" className={cn('text-xs', color)}>
                {activityLabels[activity.type] || activity.type}
              </Badge>
              {activity.agent && (
                <Badge variant="outline" className="text-xs">
                  {activity.agent}
                </Badge>
              )}
            </div>
          </div>
          <span
            className="text-xs text-muted-foreground flex-shrink-0 pt-0.5"
            title={formatAbsoluteTime(activity.timestamp)}
          >
            {formatRelativeTime(activity.timestamp)}
          </span>
        </div>
        {details && <p className="text-sm text-muted-foreground">{details}</p>}
        <p className="text-xs text-muted-foreground/60 font-mono">{activity.taskId}</p>
      </div>
    </div>
  );
}

// ─── Filter Bar ──────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: ActivityFilters;
  onFiltersChange: (filters: ActivityFilters) => void;
}

function ActivityFilterBar({ filters, onFiltersChange }: FilterBarProps) {
  const { data: filterOptions } = useActivityFilterOptions();

  const hasFilters = !!(filters.agent || filters.type || filters.since || filters.until);

  const clearFilters = () => {
    onFiltersChange({});
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Filter className="h-4 w-4" />
        <span className="text-sm font-medium">Filters</span>
      </div>

      <Select
        value={filters.agent || '_all'}
        onValueChange={(v) => onFiltersChange({ ...filters, agent: v === '_all' ? undefined : v })}
      >
        <SelectTrigger className="w-[150px] h-8 text-xs">
          <SelectValue placeholder="All agents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All agents</SelectItem>
          {filterOptions?.agents.map((agent) => (
            <SelectItem key={agent} value={agent}>
              {agent}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.type || '_all'}
        onValueChange={(v) =>
          onFiltersChange({ ...filters, type: v === '_all' ? undefined : (v as ActivityType) })
        }
      >
        <SelectTrigger className="w-[180px] h-8 text-xs">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All types</SelectItem>
          {filterOptions?.types.map((type) => (
            <SelectItem key={type} value={type}>
              {activityLabels[type] || type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <Input
          type="datetime-local"
          className="h-8 text-xs w-[170px]"
          value={filters.since ? filters.since.slice(0, 16) : ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              since: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            })
          }
          placeholder="Since"
          title="Activities since"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="datetime-local"
          className="h-8 text-xs w-[170px]"
          value={filters.until ? filters.until.slice(0, 16) : ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              until: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            })
          }
          placeholder="Until"
          title="Activities until"
        />
      </div>

      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearFilters}>
          <X className="h-3 w-3" />
          Clear
        </Button>
      )}
    </div>
  );
}

// ─── Day Group Header ────────────────────────────────────────────────────────

function DayHeader({ date }: { date: string }) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  let label: string;
  if (d.toDateString() === today.toDateString()) {
    label = 'Today';
  } else if (d.toDateString() === yesterday.toDateString()) {
    label = 'Yesterday';
  } else {
    label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-muted-foreground">{label}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
    </div>
  );
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
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white',
        colorClass
      )}
    >
      {status}
    </span>
  );
}

function StatusHistoryPanel() {
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
                  className="flex items-center gap-3 py-2.5 px-3 rounded-md hover:bg-muted/50 transition-colors"
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
                  <span className="text-sm truncate flex-1" title={entry.taskTitle}>
                    {entry.taskTitle}
                  </span>
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
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [compact, setCompact] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const clearActivities = useClearActivities();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Track known IDs to detect new items for animation
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage, refetch, isRefetching } =
    useActivityFeed(30, Object.keys(filters).length > 0 ? filters : undefined);

  const allActivities = data?.pages.flat() ?? [];

  // Track new activities for animation
  useEffect(() => {
    if (allActivities.length === 0) return;
    const currentIds = new Set(allActivities.map((a) => a.id));
    const fresh = new Set<string>();
    for (const id of currentIds) {
      if (!knownIdsRef.current.has(id)) {
        fresh.add(id);
      }
    }
    if (fresh.size > 0 && knownIdsRef.current.size > 0) {
      // Only animate if we already had items (not first load)
      setNewIds(fresh);
      const timer = setTimeout(() => setNewIds(new Set()), 500);
      return () => clearTimeout(timer);
    }
    knownIdsRef.current = currentIds;
  }, [allActivities]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Group activities by day
  const groupedByDay = useCallback(() => {
    const groups: { date: string; activities: Activity[] }[] = [];
    let currentDate = '';
    for (const activity of allActivities) {
      const day = activity.timestamp.slice(0, 10); // YYYY-MM-DD
      if (day !== currentDate) {
        currentDate = day;
        groups.push({ date: day, activities: [] });
      }
      groups[groups.length - 1].activities.push(activity);
    }
    return groups;
  }, [allActivities])();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} title="Back to board">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <ActivityIcon className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold">Activity</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowFilters((v) => !v)}
          >
            <Filter className="h-4 w-4" />
            {showFilters ? 'Hide' : 'Filters'}
          </Button>
          <Button
            variant={compact ? 'default' : 'outline'}
            size="icon"
            className="h-8 w-8"
            onClick={() => setCompact(true)}
            title="Compact view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={!compact ? 'default' : 'outline'}
            size="icon"
            className="h-8 w-8"
            onClick={() => setCompact(false)}
            title="Detailed view"
          >
            <LayoutList className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refetch()}
            disabled={isRefetching}
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => clearActivities.mutate()}
            disabled={clearActivities.isPending || allActivities.length === 0}
            title="Clear all activities"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Daily Summary — always visible */}
      <DailySummaryPanel />

      {/* Filter bar */}
      {showFilters && (
        <div className="p-3 rounded-lg border border-border bg-card">
          <ActivityFilterBar filters={filters} onFiltersChange={setFilters} />
        </div>
      )}

      {/* Two-column layout: Activity Feed (left) + Status History (right) */}
      <div className="grid grid-cols-3 gap-6">
        {/* Activity Feed — 2/3 width */}
        <div className="col-span-2">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Activity Feed</h3>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse flex gap-4 p-4 rounded-lg border border-border/50"
                >
                  <div className="h-9 w-9 rounded-lg bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-2/3 bg-muted rounded" />
                    <div className="h-3 w-1/3 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : allActivities.length === 0 ? (
            <div className="text-center py-16">
              <ActivityIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-lg font-medium text-muted-foreground">No activity yet</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Events will appear here as tasks are created and updated
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {groupedByDay.map((group) => (
                <div key={group.date}>
                  <DayHeader date={group.date} />
                  <div className={cn(compact ? 'space-y-0.5' : 'space-y-2', 'pb-4')}>
                    {group.activities.map((activity) => (
                      <ActivityCard
                        key={activity.id}
                        activity={activity}
                        compact={compact}
                        onTaskClick={onTaskClick}
                        isNew={newIds.has(activity.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-1" />

              {isFetchingNextPage && (
                <div className="flex items-center justify-center py-4 gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading more…</span>
                </div>
              )}

              {!hasNextPage && allActivities.length > 0 && (
                <div className="flex items-center justify-center py-4">
                  <span className="text-xs text-muted-foreground">End of activity log</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status History — 1/3 width */}
        <div className="col-span-1">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Status History</h3>
          <StatusHistoryPanel />
        </div>
      </div>
    </div>
  );
}
