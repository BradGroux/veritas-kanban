import { useState } from 'react';
import { Activity, Trash2, RefreshCw, Clock, Coffee, ArrowRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useActivities, useClearActivities, type Activity as ActivityItem, type ActivityType } from '@/hooks/useActivity';
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

const activityIcons: Record<ActivityType, string> = {
  task_created: '➕',
  task_updated: '✏️',
  status_changed: '🔄',
  agent_started: '🤖',
  agent_stopped: '⏹️',
  agent_completed: '✅',
  task_archived: '📦',
  task_deleted: '🗑️',
  worktree_created: '🌳',
  worktree_merged: '🔀',
};

const activityLabels: Record<ActivityType, string> = {
  task_created: 'Created',
  task_updated: 'Updated',
  status_changed: 'Status changed',
  agent_started: 'Agent started',
  agent_stopped: 'Agent stopped',
  agent_completed: 'Agent completed',
  task_archived: 'Archived',
  task_deleted: 'Deleted',
  worktree_created: 'Worktree created',
  worktree_merged: 'Merged',
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
      <span className="text-lg flex-shrink-0">
        {activityIcons[activity.type]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {activity.taskTitle}
        </div>
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

export function ActivitySidebar({ open, onOpenChange }: ActivitySidebarProps) {
  const [filter, setFilter] = useState<string>('all');
  const { data: activities, isLoading, refetch, isRefetching } = useActivities(100);
  const clearActivities = useClearActivities();

  const filteredActivities = activities?.filter(a => {
    if (filter === 'all') return true;
    return a.type === filter;
  }) || [];

  const activityTypes = activities
    ? [...new Set(activities.map(a => a.type))]
    : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[450px] p-0">
        <SheetHeader className="px-4 py-3 border-b">
          <div className="flex items-center justify-between pr-8">
            <SheetTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Activity Log
            </SheetTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetch()}
                disabled={isRefetching}
                className="h-8 w-8"
              >
                <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => clearActivities.mutate()}
                disabled={clearActivities.isPending || !activities?.length}
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {activityTypes.length > 1 && (
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Filter activities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Activities</SelectItem>
                {activityTypes.map(type => (
                  <SelectItem key={type} value={type}>
                    {activityIcons[type]} {activityLabels[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)]">
          <div className="px-2 py-2">
            {isLoading ? (
              <div className="text-center text-muted-foreground py-8">
                Loading activities...
              </div>
            ) : filteredActivities.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No activities yet
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredActivities.map(activity => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
