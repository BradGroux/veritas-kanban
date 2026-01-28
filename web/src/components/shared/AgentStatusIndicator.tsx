import { useEffect, useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGlobalAgentStatus } from '@/hooks/useGlobalAgentStatus';
import { api, Activity } from '@/lib/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Clock, Users, AlertCircle, PlayCircle, PauseCircle, Brain, Cpu } from 'lucide-react';

type AgentState = 'idle' | 'working' | 'thinking' | 'subagents' | 'error';

interface StateConfig {
  color: string;
  bgColor: string;
  animation: string;
  label: string;
  icon: typeof Clock;
}

const STATE_CONFIG: Record<AgentState, StateConfig> = {
  idle: {
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.2)',
    animation: '',
    label: 'Idle',
    icon: PauseCircle,
  },
  working: {
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.2)',
    animation: 'pulse',
    label: 'Working',
    icon: PlayCircle,
  },
  thinking: {
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.2)',
    animation: 'breathe',
    label: 'Thinking',
    icon: Brain,
  },
  subagents: {
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.2)',
    animation: 'ripple',
    label: 'Sub-agents',
    icon: Cpu,
  },
  error: {
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.2)',
    animation: 'flash',
    label: 'Error',
    icon: AlertCircle,
  },
};

// CSS keyframes for animations
const styles = `
  @keyframes agent-pulse {
    0%, 100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.15);
      opacity: 0.8;
    }
  }

  @keyframes agent-breathe {
    0%, 100% {
      transform: scale(1);
      box-shadow: 0 0 0 0 currentColor;
    }
    50% {
      transform: scale(1.05);
      box-shadow: 0 0 8px 2px currentColor;
    }
  }

  @keyframes agent-ripple {
    0% {
      box-shadow: 0 0 0 0 currentColor;
    }
    70% {
      box-shadow: 0 0 0 6px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }

  @keyframes agent-flash {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .agent-status-dot {
    transition: background-color 300ms ease, color 300ms ease;
  }

  .agent-status-dot.animate-pulse-custom {
    animation: agent-pulse 1.5s ease-in-out infinite;
  }

  .agent-status-dot.animate-breathe {
    animation: agent-breathe 2s ease-in-out infinite;
  }

  .agent-status-dot.animate-ripple {
    animation: agent-ripple 1.2s ease-out infinite;
  }

  .agent-status-dot.animate-flash {
    animation: agent-flash 0.4s ease-in-out 2;
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-status-dot {
      animation: none !important;
    }
  }
`;

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

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

interface StatusHistoryEntry {
  status: string;
  taskTitle?: string;
  timestamp: string;
}

interface AgentStatusIndicatorProps {
  className?: string;
}

export function AgentStatusIndicator({ className = '' }: AgentStatusIndicatorProps) {
  const { data, isLoading, error } = useGlobalAgentStatus();
  const [hasFlashed, setHasFlashed] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [uptimeStart, setUptimeStart] = useState<Date | null>(null);
  const [, forceUpdate] = useState(0);

  // Fetch recent agent-related activity for status history
  const { data: activities } = useQuery({
    queryKey: ['activity', 'agent-status'],
    queryFn: () => api.activity.list(20),
    refetchInterval: 10000,
    select: (data: Activity[]) => 
      data.filter(a => 
        a.type === 'agent_started' || 
        a.type === 'agent_stopped' || 
        a.type === 'agent_completed' ||
        a.type === 'status_changed'
      ).slice(0, 5),
  });

  // Inject styles once
  useEffect(() => {
    const styleId = 'agent-status-indicator-styles';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = styles;
      document.head.appendChild(styleEl);
    }
  }, []);

  // Track uptime - when status changes from idle to working
  useEffect(() => {
    if (data?.status !== 'idle' && !uptimeStart) {
      setUptimeStart(new Date(data?.lastUpdated || Date.now()));
    } else if (data?.status === 'idle' && uptimeStart) {
      setUptimeStart(null);
    }
  }, [data?.status, data?.lastUpdated, uptimeStart]);

  // Update status history when status changes
  useEffect(() => {
    if (data && data.status !== lastStatus) {
      setStatusHistory(prev => [
        {
          status: data.status,
          taskTitle: data.activeTaskTitle,
          timestamp: data.lastUpdated,
        },
        ...prev.slice(0, 4),
      ]);
      setLastStatus(data.status);
    }
  }, [data, lastStatus]);

  // Force update every second for uptime display
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Determine the visual state
  const state: AgentState = useMemo(() => {
    if (error) return 'error';
    if (!data) return 'idle';
    if (data.status === 'error') return 'error';
    if (data.subAgentCount > 0 || data.status === ('sub-agent' as string)) return 'subagents';
    const s = data.status as string;
    if (s === 'idle' || s === 'working' || s === 'thinking' || s === 'error') return s as AgentState;
    return 'idle';
  }, [data, error]);

  const config = STATE_CONFIG[state];

  // Reset flash animation when error occurs
  useEffect(() => {
    if (state === 'error' && lastStatus !== 'error') {
      setHasFlashed(false);
      const timer = setTimeout(() => setHasFlashed(true), 800);
      return () => clearTimeout(timer);
    }
  }, [state, lastStatus]);

  // Get animation class
  const animationClass = useMemo(() => {
    if (state === 'error' && hasFlashed) return '';
    if (state === 'idle') return '';
    const animName = config.animation;
    if (animName === 'pulse') return 'animate-pulse-custom';
    return animName ? `animate-${animName}` : '';
  }, [state, hasFlashed, config.animation]);

  // Build short label for header
  const shortLabel = useMemo(() => {
    if (state === 'subagents' && data?.subAgentCount) {
      return `${data.subAgentCount} agents`;
    }
    return config.label;
  }, [state, data?.subAgentCount, config.label]);

  // Calculate uptime
  const uptimeDisplay = useMemo(() => {
    if (!uptimeStart) return null;
    return formatDuration(uptimeStart.toISOString());
  }, [uptimeStart, forceUpdate]); // forceUpdate triggers recalc

  // Screen reader announcement
  const ariaLabel = useMemo(() => {
    let announcement = `Agent status: ${shortLabel}`;
    if (data?.activeTaskTitle) {
      announcement += `, working on ${data.activeTaskTitle}`;
    }
    return announcement;
  }, [shortLabel, data?.activeTaskTitle]);

  // Get status icon color for history
  const getStatusColor = useCallback((status: string) => {
    const statusMap: Record<string, string> = {
      idle: '#6b7280',
      working: '#22c55e',
      thinking: '#f59e0b',
      error: '#ef4444',
    };
    return statusMap[status] || '#6b7280';
  }, []);

  if (isLoading && !data) {
    return (
      <div className={`flex items-center gap-2 min-w-[140px] md:min-w-[180px] ${className}`}>
        <div 
          className="w-2.5 h-2.5 rounded-full bg-gray-400 opacity-50 shrink-0"
          aria-hidden="true"
        />
        <span className="text-sm text-muted-foreground hidden sm:inline">Loading...</span>
      </div>
    );
  }

  const Icon = config.icon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-2 min-w-[32px] sm:min-w-[140px] md:min-w-[200px] cursor-pointer hover:bg-muted/50 rounded-md px-2 py-1 transition-colors ${className}`}
          role="status"
          aria-live="polite"
          aria-label={ariaLabel}
        >
          {/* The pulsing dot */}
          <div
            className={`agent-status-dot w-2.5 h-2.5 rounded-full shrink-0 ${animationClass}`}
            style={{ 
              backgroundColor: config.color,
              color: config.color,
            }}
            aria-hidden="true"
          />
          
          {/* Status label - hidden on mobile */}
          <span 
            className="text-sm font-medium hidden sm:inline shrink-0"
            style={{ color: config.color }}
          >
            {shortLabel}
          </span>
          
          {/* Task name - truncated, hidden on small screens */}
          {data?.activeTaskTitle && state !== 'idle' && (
            <span className="text-sm text-muted-foreground truncate hidden md:inline max-w-[100px] lg:max-w-[150px]">
              {truncateText(data.activeTaskTitle, 25)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          {/* Current Status Header */}
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center`}
              style={{ backgroundColor: config.bgColor }}
            >
              <Icon className="w-5 h-5" style={{ color: config.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium" style={{ color: config.color }}>
                {shortLabel}
              </div>
              {uptimeDisplay && state !== 'idle' && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {uptimeDisplay}
                </div>
              )}
            </div>
          </div>

          {/* Current Task */}
          {data?.activeTaskTitle && state !== 'idle' && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Current Task
              </div>
              <div className="text-sm font-medium">
                {data.activeTaskTitle}
              </div>
              {data.activeTask && (
                <div className="text-xs text-muted-foreground">
                  ID: {data.activeTask}
                </div>
              )}
            </div>
          )}

          {/* Sub-agents */}
          {data?.subAgentCount && data.subAgentCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ backgroundColor: config.bgColor }}>
              <Users className="w-4 h-4" style={{ color: config.color }} />
              <span className="text-sm font-medium">
                {data.subAgentCount} sub-agent{data.subAgentCount > 1 ? 's' : ''} active
              </span>
            </div>
          )}

          {/* Error Message */}
          {data?.error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="text-sm">{data.error}</span>
            </div>
          )}

          {/* Status History */}
          {(statusHistory.length > 0 || (activities && activities.length > 0)) && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Recent Activity
              </div>
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto">
                {/* Use activities if available, otherwise use local status history */}
                {activities && activities.length > 0 ? (
                  activities.map((activity) => (
                    <div key={activity.id} className="flex items-center gap-2 text-xs">
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ 
                          backgroundColor: activity.type === 'agent_started' 
                            ? '#22c55e' 
                            : activity.type === 'agent_stopped' || activity.type === 'agent_completed'
                            ? '#6b7280'
                            : '#3b82f6'
                        }}
                      />
                      <span className="text-muted-foreground truncate flex-1">
                        {activity.type === 'agent_started' && 'Agent started'}
                        {activity.type === 'agent_stopped' && 'Agent stopped'}
                        {activity.type === 'agent_completed' && 'Agent completed'}
                        {activity.type === 'status_changed' && `Status → ${(activity.details as any)?.status}`}
                        {activity.taskTitle && `: ${truncateText(activity.taskTitle, 20)}`}
                      </span>
                      <span className="text-muted-foreground/60 shrink-0">
                        {formatTimeAgo(activity.timestamp)}
                      </span>
                    </div>
                  ))
                ) : (
                  statusHistory.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: getStatusColor(entry.status) }}
                      />
                      <span className="text-muted-foreground truncate flex-1">
                        {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                        {entry.taskTitle && `: ${truncateText(entry.taskTitle, 20)}`}
                      </span>
                      <span className="text-muted-foreground/60 shrink-0">
                        {formatTimeAgo(entry.timestamp)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Last Updated */}
          <div className="text-xs text-muted-foreground/60 pt-2 border-t border-border">
            Last updated: {data?.lastUpdated ? formatTimeAgo(data.lastUpdated) : 'never'}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
