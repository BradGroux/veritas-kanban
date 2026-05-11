/**
 * BoardSidebar - Right-side panel on the Kanban board
 *
 * Contains:
 * - Agent Status (always visible, no popover)
 * - Task counters in 2-column grid
 */

import { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeAgentStatus } from '@/hooks/useAgentStatus';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
import { api, Activity } from '@/lib/api';
import { useTaskCounts } from '@/hooks/useTaskCounts';
import { useView } from '@/contexts/ViewContext';
import {
  Clock,
  AlertCircle,
  PlayCircle,
  PauseCircle,
  Brain,
  Cpu,
  Inbox,
  ListTodo,
  Play,
  Ban,
  CheckCircle,
  Archive,
  ExternalLink,
  GitBranch,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BudgetCard } from '@/components/dashboard/BudgetCard';
import { MultiAgentPanel } from './MultiAgentPanel';

// ─── Agent State Types ───────────────────────────────────────────────

type AgentState = 'idle' | 'working' | 'thinking' | 'subagents' | 'error';

interface StateConfig {
  color: string;
  bgColor: string;
  label: string;
  icon: typeof Clock;
  description: string;
}

const STATE_CONFIG: Record<AgentState, StateConfig> = {
  idle: {
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.15)',
    label: 'Idle',
    icon: PauseCircle,
    description: 'No agent active',
  },
  working: {
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.15)',
    label: 'Working',
    icon: PlayCircle,
    description: 'Agent executing task',
  },
  thinking: {
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.15)',
    label: 'Thinking',
    icon: Brain,
    description: 'Planning next action',
  },
  subagents: {
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.15)',
    label: 'Sub-Agents',
    icon: Cpu,
    description: 'Parallel execution',
  },
  error: {
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.15)',
    label: 'Error',
    icon: AlertCircle,
    description: 'Something went wrong',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDuration(startTime: string): string {
  const start = new Date(startTime);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimeAgo(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ─── Task Counter ────────────────────────────────────────────────────

interface CounterProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
}

function Counter({ label, value, icon, color = 'text-muted-foreground' }: CounterProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/30">
      <span className={color}>{icon}</span>
      <div className="min-w-0">
        <div className="text-lg font-bold leading-tight">{value}</div>
        <div className="text-[10px] text-muted-foreground leading-tight truncate">{label}</div>
      </div>
    </div>
  );
}

// ─── Agent Status Panel ──────────────────────────────────────────────

function AgentStatusPanel({ onTaskClick }: { onTaskClick?: (taskId: string) => void }) {
  const data = useRealtimeAgentStatus();
  const [uptimeStart, setUptimeStart] = useState<Date | null>(null);
  const [, forceUpdate] = useState(0);

  // Track uptime
  useEffect(() => {
    if (data.status !== 'idle' && !uptimeStart) {
      setUptimeStart(new Date(data.lastUpdated || Date.now()));
    } else if (data.status === 'idle' && uptimeStart) {
      setUptimeStart(null);
    }
  }, [data.status, data.lastUpdated, uptimeStart]);

  // Tick every second for uptime
  useEffect(() => {
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const state: AgentState = useMemo(() => {
    if (data.status === 'error') return 'error';
    if (data.subAgentCount > 0) return 'subagents';
    const s = data.status as string;
    if (s === 'idle' || s === 'working' || s === 'thinking' || s === 'error')
      return s as AgentState;
    return 'idle';
  }, [data.status, data.subAgentCount]);

  const config = STATE_CONFIG[state];
  const Icon = config.icon;

  const uptimeDisplay = useMemo(() => {
    if (!uptimeStart) return null;
    return formatDuration(uptimeStart.toISOString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uptimeStart, forceUpdate]);

  return (
    <div className="space-y-3 min-h-[220px]">
      {/* Status header — large icon + state */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ring-2 transition-all"
          style={{ backgroundColor: config.bgColor, ['--tw-ring-color' as string]: config.color }}
        >
          <Icon className="w-5 h-5 transition-colors" style={{ color: config.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-semibold flex items-center gap-2"
            style={{ color: config.color }}
          >
            {state !== 'idle' && (
              <span
                className="inline-block w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: config.color }}
              />
            )}
            {data.subAgentCount > 0 ? `${data.subAgentCount} Agents` : config.label}
          </div>
          <div className="text-[11px] text-muted-foreground">{config.description}</div>
        </div>
      </div>

      {/* Uptime / timer */}
      {uptimeDisplay && state !== 'idle' && (
        <div
          className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md"
          style={{ backgroundColor: config.bgColor }}
        >
          <Clock className="w-3.5 h-3.5" style={{ color: config.color }} />
          <span className="font-mono font-medium" style={{ color: config.color }}>
            {uptimeDisplay}
          </span>
        </div>
      )}

      {/* Active agents list — shows each agent + their task */}
      {state !== 'idle' && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {(data.activeAgents?.length || 0) > 1 ? 'Active Agents' : 'Current Task'}
          </div>
          {data.activeAgents && data.activeAgents.length > 0 ? (
            <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
              {data.activeAgents.map((agent, i) => {
                const agentState = STATE_CONFIG[agent.status as AgentState] || STATE_CONFIG.working;
                return (
                  <button
                    key={agent.agent || i}
                    className="flex items-start gap-2 w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
                    onClick={() => agent.taskId && onTaskClick?.(agent.taskId)}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mt-1 shrink-0 animate-pulse"
                      style={{ backgroundColor: agentState.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-[11px] font-semibold truncate"
                        style={{ color: agentState.color }}
                      >
                        {agent.agent}
                      </div>
                      {agent.taskTitle && (
                        <div className="text-[11px] text-foreground/80 truncate leading-snug">
                          {agent.taskTitle}
                        </div>
                      )}
                      {agent.taskId && (
                        <div className="text-[10px] text-muted-foreground/60 font-mono truncate">
                          {agent.taskId}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : data.activeTaskTitle ? (
            /* Fallback: single task (no activeAgents array) */
            <button
              className="text-xs font-medium leading-snug text-left hover:underline cursor-pointer w-full"
              onClick={() => data.activeTask && onTaskClick?.(data.activeTask)}
            >
              {data.activeTaskTitle}
              {data.activeTask && (
                <span className="block text-[10px] text-muted-foreground font-mono mt-0.5">
                  {data.activeTask}
                </span>
              )}
            </button>
          ) : null}
        </div>
      )}

      {/* Error message */}
      {data.error && (
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-destructive/10 text-destructive">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="text-xs">{data.error}</span>
        </div>
      )}

      {/* Connection indicator */}
      {!data.isConnected && (
        <div className="text-[10px] text-amber-500/70 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500/50" />
          Polling (WebSocket disconnected)
        </div>
      )}

      {/* Last updated */}
      <div className="text-[10px] text-muted-foreground/40 pt-1 border-t border-border/50">
        Updated {data.lastUpdated ? formatTimeAgo(data.lastUpdated) : 'never'}
        {data.isStale && data.status !== 'idle' && ' (stale)'}
      </div>
    </div>
  );
}

// ─── Recent Status Changes ───────────────────────────────────────────

function RecentStatusChanges({
  onOpenActivityLog,
  onTaskClick,
}: {
  onOpenActivityLog: () => void;
  onTaskClick?: (taskId: string) => void;
}) {
  const { isConnected } = useWebSocketStatus();

  const { data: activities } = useQuery({
    queryKey: ['activity', 'agent-status'],
    queryFn: () => api.activity.list(20),
    // Activity is invalidated by WebSocket task:changed events
    // - Connected: 120s safety-net polling
    // - Disconnected: 10s fallback polling
    refetchInterval: isConnected ? 120_000 : 10_000,
    staleTime: isConnected ? 60_000 : 5_000,
    select: (data: Activity[]) => data.slice(0, 7),
  });

  return (
    <div className="rounded-lg border bg-card p-3 min-h-[220px]">
      <button
        onClick={onOpenActivityLog}
        className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground mb-2 uppercase tracking-wider hover:text-foreground transition-colors group w-full text-left"
      >
        Recent Status Changes
        <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {activities && activities.length > 0 ? (
          activities.map((activity) => (
            <button
              key={activity.id}
              className="flex items-center gap-1.5 text-[11px] w-full text-left hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
              onClick={() => activity.taskId && onTaskClick?.(activity.taskId)}
            >
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor: (() => {
                    const t = activity.type as string;
                    if (t === 'agent_started' || t === 'task_created') return '#22c55e';
                    if (t === 'agent_stopped' || t === 'agent_completed' || t === 'task_archived')
                      return '#6b7280';
                    if (t === 'agent_event') return '#06b6d4';
                    if (t === 'task_demoted') return '#f59e0b';
                    if (t === 'task_promoted') return '#8b5cf6';
                    return '#3b82f6';
                  })(),
                }}
              />
              <span className="text-muted-foreground truncate flex-1">
                <span className="font-medium">
                  {(() => {
                    const t = activity.type as string;
                    if (t === 'agent_started') return 'Agent Started';
                    if (t === 'agent_stopped') return 'Agent Stopped';
                    if (t === 'agent_completed') return 'Agent Completed';
                    if (t === 'agent_event') return 'Agent Event';
                    if (t === 'status_changed')
                      return `→ ${String(activity.details?.status ?? '')}`;
                    if (t === 'task_created') return 'Created';
                    if (t === 'task_demoted') return 'Demoted';
                    if (t === 'task_promoted') return 'Promoted';
                    if (t === 'task_archived') return 'Archived';
                    if (t === 'task_updated') return 'Updated';
                    return t;
                  })()}
                </span>
                {activity.taskTitle && (
                  <span className="ml-1 text-foreground/70">{activity.taskTitle}</span>
                )}
              </span>
              <span className="text-muted-foreground/50 shrink-0 text-[10px]">
                {formatTimeAgo(activity.timestamp)}
              </span>
            </button>
          ))
        ) : (
          <div className="text-[11px] text-muted-foreground/40 py-2">No recent changes</div>
        )}
      </div>
    </div>
  );
}

// ─── Main Sidebar ────────────────────────────────────────────────────

interface BoardSidebarProps {
  onTaskClick?: (taskId: string) => void;
}

export function BoardSidebar({ onTaskClick }: BoardSidebarProps) {
  const { setView } = useView();
  const { data: counts } = useTaskCounts(); // Use new counts endpoint for sidebar counters

  return (
    <div className="flex flex-col gap-4">
      {/* Task Counters */}
      <div className="rounded-lg border bg-card p-3 min-h-[220px]">
        <h3 className="text-[10px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
          Tasks
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Counter
            label="Backlog"
            value={counts?.backlog || 0}
            icon={<Inbox className="h-3.5 w-3.5" />}
          />
          <Counter
            label="To Do"
            value={counts?.todo || 0}
            icon={<ListTodo className="h-3.5 w-3.5" />}
          />
          <Counter
            label="In Progress"
            value={counts?.['in-progress'] || 0}
            icon={<Play className="h-3.5 w-3.5" />}
            color="text-blue-500"
          />
          <Counter
            label="Blocked"
            value={counts?.blocked || 0}
            icon={<Ban className="h-3.5 w-3.5" />}
            color="text-red-500"
          />
          <Counter
            label="Done"
            value={counts?.done || 0}
            icon={<CheckCircle className="h-3.5 w-3.5" />}
            color="text-green-500"
          />
          <Counter
            label="Archived"
            value={counts?.archived || 0}
            icon={<Archive className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {/* Agent Status — fully expanded, always visible */}
      <div className="rounded-lg border bg-card p-3">
        <AgentStatusPanel onTaskClick={onTaskClick} />
      </div>

      {/* Multi-Agent Registry — all registered agents */}
      <div className="rounded-lg border bg-card p-3">
        <h3 className="text-[10px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
          Agent Registry
        </h3>
        <MultiAgentPanel onTaskClick={onTaskClick} />
      </div>

      {/* Recent Status Changes */}
      <RecentStatusChanges
        onOpenActivityLog={() => setView('activity')}
        onTaskClick={onTaskClick}
      />

      <div className="rounded-lg border bg-card p-3">
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Audit Trail
        </h3>
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={() => setView('decisions')}
        >
          <span className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Decision Explorer
          </span>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <button
          className="flex w-full items-center justify-between rounded-md border px-3 py-3 text-left transition-colors hover:bg-muted/40"
          onClick={() => setView('policies')}
        >
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Policy Engine
            </div>
            <div className="mt-1 text-sm font-medium">Manage guard policies</div>
            <div className="text-xs text-muted-foreground">
              Review policy packs, approvals, rate limits, and action blocks.
            </div>
          </div>
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>

      {/* Monthly Budget */}
      <BudgetCard />
    </div>
  );
}
