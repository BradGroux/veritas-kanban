/**
 * WorkflowDashboard - Comprehensive workflow monitoring dashboard
 *
 * Features:
 * - Summary cards (total workflows, active runs, completed/failed runs, success rate, avg duration)
 * - Active runs table (live updates via WebSocket)
 * - Recent runs history (sortable/filterable)
 * - Per-workflow health metrics
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  PlayCircle,
  AlertCircle,
  BarChart3,
  Zap,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { WorkflowRunView } from './WorkflowRunView';
import { useWebSocket, type WebSocketMessage } from '@/hooks/useWebSocket';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';

interface WorkflowDashboardProps {
  onBack: () => void;
}

type WorkflowRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  currentStep?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  steps: Array<{
    stepId: string;
    status: string;
  }>;
}

interface WorkflowStats {
  period: string;
  totalWorkflows: number;
  activeRuns: number;
  completedRuns: number;
  failedRuns: number;
  avgDuration: number;
  successRate: number;
  perWorkflow: Array<{
    workflowId: string;
    workflowName: string;
    runs: number;
    completed: number;
    failed: number;
    successRate: number;
    avgDuration: number;
  }>;
}

interface WorkflowStatusMessage extends WebSocketMessage {
  type: 'workflow:status';
  data: WorkflowRun;
}

function isWorkflowStatusMessage(msg: WebSocketMessage): msg is WorkflowStatusMessage {
  return msg.type === 'workflow:status' && typeof msg.data === 'object' && msg.data !== null;
}

export function WorkflowDashboard({ onBack }: WorkflowDashboardProps) {
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [activeRuns, setActiveRuns] = useState<WorkflowRun[]>([]);
  const [recentRuns, setRecentRuns] = useState<WorkflowRun[]>([]);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [isActiveRunsLoading, setIsActiveRunsLoading] = useState(true);
  const [isRecentRunsLoading, setIsRecentRunsLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [period, setPeriod] = useState('7d');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { toast } = useToast();
  const { isConnected } = useWebSocketStatus();

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/workflow-runs/stats?period=${period}`);
      if (!response.ok) throw new Error('Failed to fetch workflow stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      toast({
        title: '❌ Failed to load workflow stats',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsStatsLoading(false);
    }
  }, [period, toast]);

  // Fetch active runs
  const fetchActiveRuns = useCallback(async () => {
    try {
      const response = await fetch('/api/workflow-runs/active');
      if (!response.ok) throw new Error('Failed to fetch active runs');
      const data = await response.json();
      setActiveRuns(data);
    } catch (error) {
      toast({
        title: '❌ Failed to load active runs',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsActiveRunsLoading(false);
    }
  }, [toast]);

  // Fetch recent runs
  const fetchRecentRuns = useCallback(async () => {
    try {
      const response = await fetch('/api/workflow-runs');
      if (!response.ok) throw new Error('Failed to fetch recent runs');
      const data = await response.json();
      // Sort by startedAt descending, take top 50
      const sorted = data.sort(
        (a: WorkflowRun, b: WorkflowRun) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      setRecentRuns(sorted.slice(0, 50));
    } catch (error) {
      toast({
        title: '❌ Failed to load recent runs',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsRecentRunsLoading(false);
    }
  }, [toast]);

  // Initial fetch
  useEffect(() => {
    fetchStats();
    fetchActiveRuns();
    fetchRecentRuns();
  }, [fetchStats, fetchActiveRuns, fetchRecentRuns]);

  // Refetch stats when period changes
  useEffect(() => {
    setIsStatsLoading(true);
    fetchStats();
  }, [fetchStats, period]);

  // WebSocket subscription for live updates
  const handleWebSocketMessage = useCallback(
    (message: WebSocketMessage) => {
      if (isWorkflowStatusMessage(message)) {
        const updatedRun = message.data;

        // Update active runs
        setActiveRuns((prev) => {
          if (updatedRun.status === 'running') {
            const exists = prev.find((r) => r.id === updatedRun.id);
            if (exists) {
              return prev.map((r) => (r.id === updatedRun.id ? updatedRun : r));
            } else {
              return [updatedRun, ...prev];
            }
          } else {
            // Remove from active runs if no longer running
            return prev.filter((r) => r.id !== updatedRun.id);
          }
        });

        // Update recent runs
        setRecentRuns((prev) => {
          const exists = prev.find((r) => r.id === updatedRun.id);
          if (exists) {
            return prev.map((r) => (r.id === updatedRun.id ? updatedRun : r));
          } else {
            return [updatedRun, ...prev].slice(0, 50);
          }
        });

        // Refetch stats on completion/failure
        if (updatedRun.status === 'completed' || updatedRun.status === 'failed') {
          fetchStats();
        }
      }
    },
    [fetchStats]
  );

  useWebSocket({
    autoConnect: true,
    onMessage: handleWebSocketMessage,
  });

  // Polling fallback (when WS disconnected)
  useEffect(() => {
    if (!isConnected) {
      const interval = setInterval(
        () => {
          fetchActiveRuns();
          fetchRecentRuns();
        },
        30_000 // 30s polling when disconnected
      );
      return () => clearInterval(interval);
    } else {
      // Safety net polling when connected
      const interval = setInterval(
        () => {
          fetchActiveRuns();
          fetchRecentRuns();
        },
        120_000 // 2min safety net
      );
      return () => clearInterval(interval);
    }
  }, [isConnected, fetchActiveRuns, fetchRecentRuns]);

  // Filter recent runs
  const filteredRecentRuns = useMemo(() => {
    return recentRuns.filter((run) => statusFilter === 'all' || run.status === statusFilter);
  }, [recentRuns, statusFilter]);

  if (selectedRunId) {
    return <WorkflowRunView runId={selectedRunId} onBack={() => setSelectedRunId(null)} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Workflows
          </Button>
          <h1 className="text-2xl font-bold">Workflow Dashboard</h1>
        </div>

        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      {isStatsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SummaryCard
            title="Total Workflows"
            value={stats.totalWorkflows}
            icon={BarChart3}
            color="blue"
          />
          <SummaryCard title="Active Runs" value={stats.activeRuns} icon={Activity} color="blue" />
          <SummaryCard
            title="Completed"
            value={stats.completedRuns}
            subtitle={`(${period})`}
            icon={CheckCircle2}
            color="green"
          />
          <SummaryCard
            title="Failed"
            value={stats.failedRuns}
            subtitle={`(${period})`}
            icon={XCircle}
            color="red"
          />
          <SummaryCard
            title="Success Rate"
            value={`${(stats.successRate * 100).toFixed(1)}%`}
            icon={TrendingUp}
            color={stats.successRate >= 0.8 ? 'green' : stats.successRate >= 0.5 ? 'yellow' : 'red'}
          />
          <SummaryCard
            title="Avg Duration"
            value={formatDuration(stats.avgDuration)}
            icon={Clock}
            color="blue"
          />
        </div>
      ) : null}

      {/* Active Runs */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Active Runs</h2>
          <Badge variant="secondary">{activeRuns.length}</Badge>
          {!isConnected && (
            <Badge variant="outline" className="text-yellow-600">
              <AlertCircle className="h-3 w-3 mr-1" />
              WebSocket disconnected
            </Badge>
          )}
        </div>

        {isActiveRunsLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : activeRuns.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No active runs</div>
        ) : (
          <div className="space-y-3">
            {activeRuns.map((run) => (
              <ActiveRunCard key={run.id} run={run} onClick={() => setSelectedRunId(run.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Recent Runs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Recent Runs</h2>
            <Badge variant="secondary">{filteredRecentRuns.length}</Badge>
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isRecentRunsLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : filteredRecentRuns.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {statusFilter !== 'all' ? 'No runs match your filter' : 'No recent runs'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecentRuns.map((run) => (
              <RecentRunCard key={run.id} run={run} onClick={() => setSelectedRunId(run.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Workflow Health */}
      {stats && stats.perWorkflow.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Workflow Health</h2>
          </div>

          <div className="space-y-3">
            {stats.perWorkflow.map((workflowStats) => (
              <WorkflowHealthCard key={workflowStats.workflowId} stats={workflowStats} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Helper Components =====

interface SummaryCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'red' | 'yellow';
}

function SummaryCard({ title, value, subtitle, icon: Icon, color }: SummaryCardProps) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  };

  return (
    <div className="p-6 rounded-lg border bg-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          <p className="text-3xl font-bold">
            {value} {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
          </p>
        </div>
        <div className={cn('p-3 rounded-lg', colorClasses[color])}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

interface ActiveRunCardProps {
  run: WorkflowRun;
  onClick: () => void;
}

function ActiveRunCard({ run, onClick }: ActiveRunCardProps) {
  const duration = Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000);
  const completedSteps = run.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps.length;

  return (
    <div
      className="p-4 rounded-lg border-2 border-blue-500 bg-card hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="outline" className="text-xs font-mono">
              {run.id}
            </Badge>
            <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              <PlayCircle className="h-3 w-3 mr-1" />
              Running
            </Badge>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
            <div>Started: {new Date(run.startedAt).toLocaleString()}</div>
            <div>
              Duration: {Math.floor(duration / 60)}m {duration % 60}s
            </div>
            {run.currentStep && <div className="font-medium">Current: {run.currentStep}</div>}
          </div>

          <div className="flex items-center gap-2">
            <div className="text-sm text-muted-foreground">
              Progress: {completedSteps}/{totalSteps} steps
            </div>
            <div className="flex-1 max-w-xs h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RecentRunCardProps {
  run: WorkflowRun;
  onClick: () => void;
}

function RecentRunCard({ run, onClick }: RecentRunCardProps) {
  const duration = run.completedAt
    ? Math.floor((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000);

  const completedSteps = run.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = run.steps.length;

  const statusConfig = {
    pending: {
      icon: Clock,
      color: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      label: 'Pending',
    },
    running: {
      icon: PlayCircle,
      color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      label: 'Running',
    },
    completed: {
      icon: CheckCircle2,
      color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      label: 'Completed',
    },
    failed: {
      icon: XCircle,
      color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      label: 'Failed',
    },
    blocked: {
      icon: AlertCircle,
      color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      label: 'Blocked',
    },
  };

  const config = statusConfig[run.status];
  const Icon = config.icon;

  return (
    <div
      className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="outline" className="text-xs font-mono">
              {run.id}
            </Badge>
            <Badge className={cn('text-xs', config.color)}>
              <Icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div>Started: {new Date(run.startedAt).toLocaleString()}</div>
            <div>
              Duration: {Math.floor(duration / 60)}m {duration % 60}s
            </div>
            <div>
              Steps: {completedSteps}/{totalSteps}
            </div>
          </div>

          {run.error && <div className="mt-2 text-sm text-destructive">Error: {run.error}</div>}
        </div>
      </div>
    </div>
  );
}

interface WorkflowHealthCardProps {
  stats: {
    workflowId: string;
    workflowName: string;
    runs: number;
    completed: number;
    failed: number;
    successRate: number;
    avgDuration: number;
  };
}

function WorkflowHealthCard({ stats }: WorkflowHealthCardProps) {
  const successRatePercent = (stats.successRate * 100).toFixed(1);
  const healthColor =
    stats.successRate >= 0.8 ? 'green' : stats.successRate >= 0.5 ? 'yellow' : 'red';

  const colorClasses = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  };

  return (
    <div className="p-4 rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold mb-2">{stats.workflowName}</h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Runs</p>
              <p className="font-medium">{stats.runs}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Success Rate</p>
              <p className="font-medium">{successRatePercent}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Completed</p>
              <p className="font-medium text-green-600">{stats.completed}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Failed</p>
              <p className="font-medium text-red-600">{stats.failed}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="text-sm text-muted-foreground">
              Avg Duration: {formatDuration(stats.avgDuration)}
            </div>
            <div className="flex-1 max-w-xs h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn('h-full transition-all', colorClasses[healthColor])}
                style={{ width: `${stats.successRate * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Helper Functions =====

function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
