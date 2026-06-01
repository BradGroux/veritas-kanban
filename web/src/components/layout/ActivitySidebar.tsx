import { useState } from 'react';
import { Activity, Trash2, RefreshCw, Coffee, ArrowRight, Zap } from 'lucide-react';
import {
  ActionIcon,
  Badge,
  Box,
  Drawer,
  Group,
  ScrollArea,
  Select,
  Skeleton,
  Tabs,
  Text,
} from '@mantine/core';
import {
  useActivities,
  useClearActivities,
  type Activity as ActivityItem,
} from '@/hooks/useActivity';
import {
  useDailySummary,
  useStatusHistory,
  formatDurationMs,
  getStatusColor,
  type StatusHistoryEntry,
} from '@/hooks/useStatusHistory';
import { cn } from '@/lib/utils';

interface ActivitySidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const activityIcons: Record<string, string> = {
  task_created: '➕',
  task_updated: '✏️',
  status_changed: '🔄',
  agent_started: '🤖',
  agent_stopped: '⏹️',
  agent_completed: '✅',
  agent_event: '⚙️',
  task_archived: '📦',
  task_deleted: '🗑️',
  worktree_created: '🌳',
  worktree_merged: '🔀',
  project_archived: '📁',
  sprint_archived: '⏱️',
  template_applied: '📋',
  comment_added: '💬',
  comment_deleted: '🗨️',
};

const activityLabels: Record<string, string> = {
  task_created: 'Created',
  task_updated: 'Updated',
  status_changed: 'Status changed',
  agent_started: 'Agent started',
  agent_stopped: 'Agent stopped',
  agent_completed: 'Agent completed',
  agent_event: 'Agent event',
  task_archived: 'Archived',
  task_deleted: 'Deleted',
  worktree_created: 'Worktree created',
  worktree_merged: 'Merged',
  project_archived: 'Project archived',
  sprint_archived: 'Sprint archived',
  template_applied: 'Template applied',
  comment_added: 'Comment added',
  comment_deleted: 'Comment deleted',
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  return (
    <div className="flex items-start gap-3 py-3 px-2 hover:bg-muted/50 rounded-md transition-colors">
      <span className="text-lg flex-shrink-0">{activityIcons[activity.type]}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{activity.taskTitle}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>{activityLabels[activity.type]}</span>
          {typeof activity.details?.status === 'string' && (
            <span className="text-primary">→ {activity.details.status}</span>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground flex-shrink-0">
        {formatTimestamp(activity.timestamp)}
      </div>
    </div>
  );
}

// Status Badge component
function StatusBadge({ status }: { status: string }) {
  const colorClass = getStatusColor(status);

  return (
    <Badge size="sm" radius="sm" tt="none" className={cn('text-white', colorClass)}>
      {status}
    </Badge>
  );
}

// Daily Summary Card
function DailySummaryCard() {
  const { data: summary, isLoading } = useDailySummary();

  if (isLoading || !summary) {
    return (
      <Box px="md" py="sm" className="border-b bg-muted/30">
        <Group gap="md">
          <Skeleton h={40} w={80} radius="sm" />
          <Skeleton h={40} w={80} radius="sm" />
          <Skeleton h={40} w={80} radius="sm" />
        </Group>
      </Box>
    );
  }

  const total = summary.activeMs + summary.idleMs + summary.errorMs;
  const activePercent = total > 0 ? Math.round((summary.activeMs / total) * 100) : 0;

  return (
    <Box px="md" py="sm" className="border-b bg-muted/30">
      <Text size="xs" fw={500} c="dimmed" mb="xs">
        Today's Summary
      </Text>
      <Group gap="sm">
        <Group gap={6}>
          <Zap className="h-4 w-4 text-green-500" />
          <div>
            <div className="text-sm font-bold text-green-500">
              {formatDurationMs(summary.activeMs)}
            </div>
            <div className="text-xs text-muted-foreground">Active</div>
          </div>
        </Group>
        <Group gap={6}>
          <Coffee className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-bold text-muted-foreground">
              {formatDurationMs(summary.idleMs)}
            </div>
            <div className="text-xs text-muted-foreground">Idle</div>
          </div>
        </Group>
        <Group gap={6} ml="auto">
          <div className="text-right">
            <div className="text-sm font-bold">{activePercent}%</div>
            <div className="text-xs text-muted-foreground">Utilization</div>
          </div>
        </Group>
      </Group>
      {/* Mini progress bar */}
      {total > 0 && (
        <div className="mt-2 h-1.5 rounded-full overflow-hidden flex bg-muted">
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
    </Box>
  );
}

// Status Transition Row
function StatusTransitionRow({ entry }: { entry: StatusHistoryEntry }) {
  return (
    <div className="flex items-center gap-2 py-3 px-2 hover:bg-muted/50 rounded-md transition-colors">
      <span className="text-xs text-muted-foreground w-14 shrink-0">
        {new Date(entry.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
      <StatusBadge status={entry.previousStatus} />
      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
      <StatusBadge status={entry.newStatus} />
      {entry.durationMs && (
        <span className="text-xs text-muted-foreground ml-auto">
          {formatDurationMs(entry.durationMs)}
        </span>
      )}
    </div>
  );
}

// Status History List
function StatusHistoryList() {
  const { data: history, isLoading } = useStatusHistory(50);

  // Filter to today's entries
  const today = new Date().toISOString().split('T')[0];
  const todayEntries = history?.filter((entry) => entry.timestamp.startsWith(today)) || [];

  if (isLoading) {
    return <div className="text-center text-muted-foreground py-8">Loading status history...</div>;
  }

  if (todayEntries.length === 0) {
    return <div className="text-center text-muted-foreground py-8">No status changes today</div>;
  }

  return (
    <div className="divide-y divide-border">
      {todayEntries.map((entry) => (
        <StatusTransitionRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

export function ActivitySidebar({ open, onOpenChange }: ActivitySidebarProps) {
  const [filter, setFilter] = useState<string>('all');
  const [tab, setTab] = useState<string>('tasks');
  const { data: activities, isLoading, refetch, isRefetching } = useActivities(100);
  const clearActivities = useClearActivities();

  const filteredActivities =
    activities?.filter((a) => {
      if (filter === 'all') return true;
      return a.type === filter;
    }) || [];

  const activityTypes = activities ? [...new Set(activities.map((a) => a.type))] : [];

  return (
    <Drawer
      opened={open}
      onClose={() => onOpenChange(false)}
      position="right"
      size={450}
      padding={0}
      title={
        <Group justify="space-between" wrap="nowrap" className="w-full pr-8">
          <Group gap="xs" wrap="nowrap">
            <Activity className="h-5 w-5" />
            <Text fw={600}>Activity Log</Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            <ActionIcon
              variant="subtle"
              onClick={() => refetch()}
              disabled={isRefetching}
              aria-label="Refresh activity log"
            >
              <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="red"
              onClick={() => clearActivities.mutate()}
              disabled={clearActivities.isPending || !activities?.length}
              aria-label="Clear activity log"
            >
              <Trash2 className="h-4 w-4" />
            </ActionIcon>
          </Group>
        </Group>
      }
      styles={{
        content: { display: 'flex', flexDirection: 'column' },
        body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
      }}
    >
      {/* Daily Summary always visible at top */}
      <DailySummaryCard />

      <Tabs
        value={tab}
        onChange={(value) => setTab(value ?? 'tasks')}
        className="flex flex-col h-[calc(100vh-200px)]"
      >
        <Tabs.List grow mx="md" mt="sm">
          <Tabs.Tab value="tasks">Task Activity</Tabs.Tab>
          <Tabs.Tab value="status">Status History</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="tasks" className="flex-1 mt-0">
          {activityTypes.length > 1 && (
            <div className="px-4 py-2">
              <Select
                value={filter}
                onChange={(value) => setFilter(value ?? 'all')}
                allowDeselect={false}
                placeholder="Filter activities"
                data={[
                  { value: 'all', label: 'All Activities' },
                  ...activityTypes.map((type) => ({
                    value: type,
                    label: `${activityIcons[type]} ${activityLabels[type]}`,
                  })),
                ]}
              />
            </div>
          )}
          <ScrollArea className="h-full">
            <div className="px-2 py-2">
              {isLoading ? (
                <div className="text-center text-muted-foreground py-8">Loading activities...</div>
              ) : filteredActivities.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No activities yet</div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredActivities.map((activity) => (
                    <ActivityRow key={activity.id} activity={activity} />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </Tabs.Panel>

        <Tabs.Panel value="status" className="flex-1 mt-0">
          <ScrollArea className="h-full">
            <div className="px-2 py-2">
              <StatusHistoryList />
            </div>
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
    </Drawer>
  );
}
