import { useState } from 'react';
import { useTaskMetrics, type AttemptMetrics } from '@/hooks/useTaskMetrics';
import { formatDuration, formatTokens } from '@/hooks/useMetrics';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Coins,
  Zap,
  ChevronDown,
  ChevronRight,
  Bot,
  AlertTriangle,
  TrendingUp,
  Download,
  Calendar,
  Timer,
  MessageSquare,
  ListChecks,
  Paperclip,
  BarChart3,
} from 'lucide-react';
import { ExportDialog } from '@/components/dashboard/ExportDialog';
import type { Task } from '@veritas-kanban/shared';

interface TaskMetricsPanelProps {
  task: Task;
}

// --- Helper functions for task-level metrics ---

function formatRelativeTime(ms: number): string {
  if (ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (weeks > 0) {
    const remainingDays = days % 7;
    return remainingDays > 0 ? `${weeks}w ${remainingDays}d` : `${weeks}w`;
  }
  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) return `${minutes}m`;
  return 'just now';
}

function formatAge(dateString: string): string {
  return formatRelativeTime(Date.now() - new Date(dateString).getTime());
}

function formatTimeBetween(startDate: string, endDate: string): string {
  return formatRelativeTime(new Date(endDate).getTime() - new Date(startDate).getTime());
}

function formatTrackedTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return minutes > 0 ? `${minutes}m` : '<1m';
}

function MetricCard({
  icon: Icon,
  label,
  value,
  subValue,
  variant = 'default',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}) {
  const variantClasses = {
    default: 'bg-muted/50',
    success: 'bg-green-500/10 border-green-500/20',
    warning: 'bg-yellow-500/10 border-yellow-500/20',
    error: 'bg-red-500/10 border-red-500/20',
  };

  const iconClasses = {
    default: 'text-muted-foreground',
    success: 'text-green-500',
    warning: 'text-yellow-500',
    error: 'text-red-500',
  };

  return (
    <div className={`rounded-lg border p-3 ${variantClasses[variant]}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${iconClasses[variant]}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
      {subValue && <div className="text-xs text-muted-foreground">{subValue}</div>}
    </div>
  );
}

function AttemptRow({ attempt, isExpanded, onToggle }: {
  attempt: AttemptMetrics;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return '-';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-left"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        
        {attempt.success === true && (
          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
        )}
        {attempt.success === false && (
          <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
        )}
        {attempt.success === undefined && (
          <Play className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{attempt.agent}</span>
            {attempt.model && (
              <Badge variant="secondary" className="text-xs">
                {attempt.model}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDate(attempt.startTime)}
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {attempt.durationMs !== undefined && (
            <span>{formatDuration(attempt.durationMs)}</span>
          )}
          {attempt.totalTokens > 0 && (
            <span>{formatTokens(attempt.totalTokens)} tokens</span>
          )}
          {attempt.cost > 0 && (
            <span>{formatCost(attempt.cost)}</span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t bg-muted/30 p-3 space-y-3">
          {/* Token breakdown */}
          {attempt.totalTokens > 0 && (
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Input:</span>{' '}
                <span className="font-mono">{formatTokens(attempt.inputTokens)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Output:</span>{' '}
                <span className="font-mono">{formatTokens(attempt.outputTokens)}</span>
              </div>
              {attempt.cacheTokens > 0 && (
                <div>
                  <span className="text-muted-foreground">Cache:</span>{' '}
                  <span className="font-mono">{formatTokens(attempt.cacheTokens)}</span>
                </div>
              )}
            </div>
          )}

          {/* Duration details */}
          {attempt.durationMs !== undefined && (
            <div className="text-sm">
              <span className="text-muted-foreground">Duration:</span>{' '}
              <span className="font-mono">{formatDuration(attempt.durationMs)}</span>
              <span className="text-muted-foreground ml-2">({attempt.durationMs.toLocaleString()}ms)</span>
            </div>
          )}

          {/* Error message */}
          {attempt.error && (
            <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-sm">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-red-400">{attempt.error}</span>
            </div>
          )}

          {/* Cost */}
          {attempt.cost > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">Estimated Cost:</span>{' '}
              <span className="font-mono">{formatCost(attempt.cost)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskMetricsPanel({ task }: TaskMetricsPanelProps) {
  const { data: metrics, isLoading, error } = useTaskMetrics(task.id);
  const [expandedAttempts, setExpandedAttempts] = useState<Set<string>>(new Set());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const toggleAttempt = (attemptId: string) => {
    setExpandedAttempts(prev => {
      const next = new Set(prev);
      if (next.has(attemptId)) {
        next.delete(attemptId);
      } else {
        next.add(attemptId);
      }
      return next;
    });
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return '$0';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  // Compute subtask metrics
  const subtaskTotal = task.subtasks?.length ?? 0;
  const subtaskCompleted = task.subtasks?.filter(s => s.completed).length ?? 0;
  const subtaskVariant: 'default' | 'success' | 'warning' =
    subtaskTotal === 0 ? 'default' :
    subtaskCompleted === subtaskTotal ? 'success' : 'warning';

  const hasAgentData = metrics && metrics.totalRuns > 0;

  return (
    <div className="space-y-6">
      {/* ── Task Overview — Always visible ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Task Overview
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <MetricCard
            icon={Clock}
            label="Time Tracked"
            value={task.timeTracking && task.timeTracking.totalSeconds > 0
              ? formatTrackedTime(task.timeTracking.totalSeconds)
              : '—'}
            subValue={task.timeTracking
              ? `${task.timeTracking.entries.length} ${task.timeTracking.entries.length === 1 ? 'entry' : 'entries'}${task.timeTracking.isRunning ? ' (running)' : ''}`
              : 'No time tracked'}
          />
          <MetricCard
            icon={Calendar}
            label="Task Age"
            value={formatAge(task.created)}
            subValue={new Date(task.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          />
          {task.status === 'done' ? (
            <MetricCard
              icon={CheckCircle}
              label="Time to Close"
              value={formatTimeBetween(task.created, task.updated)}
              variant="success"
              subValue={`Closed ${new Date(task.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
            />
          ) : (
            <MetricCard
              icon={Timer}
              label="In Current Status"
              value={formatAge(task.updated)}
              subValue={`Since ${new Date(task.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
            />
          )}
          <MetricCard
            icon={MessageSquare}
            label="Comments"
            value={task.comments?.length ?? 0}
          />
          <MetricCard
            icon={ListChecks}
            label="Subtasks"
            value={subtaskTotal > 0 ? `${subtaskCompleted}/${subtaskTotal}` : '—'}
            subValue={subtaskTotal > 0
              ? `${Math.round((subtaskCompleted / subtaskTotal) * 100)}% complete`
              : 'None'}
            variant={subtaskVariant}
          />
          <MetricCard
            icon={Paperclip}
            label="Attachments"
            value={task.attachments?.length ?? 0}
          />
        </div>
      </div>

      {/* ── Agent Run History — Conditional ── */}
      {isLoading && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Agent Run History
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <span className="text-red-400">Failed to load agent run metrics</span>
        </div>
      )}

      {hasAgentData && (
        <>
          {/* Header + Export */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Agent Run History
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportDialogOpen(true)}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>

          <ExportDialog
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            taskId={task.id}
            project={task.project}
          />

          {/* Run Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MetricCard
              icon={Play}
              label="Total Runs"
              value={metrics.totalRuns}
              subValue={`${metrics.successfulRuns} successful, ${metrics.failedRuns} failed`}
            />
            <MetricCard
              icon={TrendingUp}
              label="Success Rate"
              value={`${(metrics.successRate * 100).toFixed(0)}%`}
              variant={
                metrics.successRate >= 0.8 ? 'success' :
                metrics.successRate >= 0.5 ? 'warning' : 'error'
              }
            />
            <MetricCard
              icon={Clock}
              label="Total Duration"
              value={formatDuration(metrics.totalDurationMs)}
              subValue={`Avg: ${formatDuration(metrics.avgDurationMs)}`}
            />
            <MetricCard
              icon={Zap}
              label="Input Tokens"
              value={formatTokens(metrics.totalInputTokens)}
            />
            <MetricCard
              icon={Zap}
              label="Output Tokens"
              value={formatTokens(metrics.totalOutputTokens)}
            />
            <MetricCard
              icon={Coins}
              label="Estimated Cost"
              value={formatCost(metrics.totalCost)}
              subValue={metrics.totalCacheTokens > 0 ? `${formatTokens(metrics.totalCacheTokens)} cached` : undefined}
            />
          </div>

          {/* Last Run Summary */}
          {metrics.lastRun && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Last Run
              </h3>
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                {metrics.lastRun.success === true && (
                  <Badge variant="default" className="bg-green-500/20 text-green-500 border-green-500/30">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Success
                  </Badge>
                )}
                {metrics.lastRun.success === false && (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Failed
                  </Badge>
                )}
                <span className="text-sm">{metrics.lastRun.agent}</span>
                {metrics.lastRun.model && (
                  <Badge variant="secondary">{metrics.lastRun.model}</Badge>
                )}
                {metrics.lastRun.durationMs && (
                  <span className="text-sm text-muted-foreground">
                    {formatDuration(metrics.lastRun.durationMs)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Attempt History */}
          {metrics.attempts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Run History
                </h3>
                {metrics.attempts.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (expandedAttempts.size === metrics.attempts.length) {
                        setExpandedAttempts(new Set());
                      } else {
                        setExpandedAttempts(new Set(metrics.attempts.map(a => a.attemptId)));
                      }
                    }}
                  >
                    {expandedAttempts.size === metrics.attempts.length ? 'Collapse All' : 'Expand All'}
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {metrics.attempts.map(attempt => (
                  <AttemptRow
                    key={attempt.attemptId}
                    attempt={attempt}
                    isExpanded={expandedAttempts.has(attempt.attemptId)}
                    onToggle={() => toggleAttempt(attempt.attemptId)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
