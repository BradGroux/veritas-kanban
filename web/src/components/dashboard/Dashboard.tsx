import { useState } from 'react';
import { 
  useMetrics, 
  useTaskCost,
  useUtilization,
  formatTokens, 
  formatDuration, 
  formatPercent,
  type MetricsPeriod,
  type TrendDirection,
} from '@/hooks/useMetrics';
import { useTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
} from 'lucide-react';
import { ExportDialog } from './ExportDialog';
import { DashboardFilterBar } from './DashboardFilterBar';
import { cn } from '@/lib/utils';
import { DrillDownPanel, type DrillDownType } from './DrillDownPanel';
import { TasksDrillDown } from './TasksDrillDown';
import { ErrorsDrillDown } from './ErrorsDrillDown';
import { TokensDrillDown } from './TokensDrillDown';
import { DurationDrillDown } from './DurationDrillDown';
import { TrendsCharts } from './TrendsCharts';
import { StatusTimeline } from './StatusTimeline';
import { AgentComparison } from './AgentComparison';

// Trend indicator component
// direction: 'up' always means improvement, 'down' means decline (from backend)
// change: the actual percentage change in the value (can be negative)
function TrendIndicator({ 
  direction, 
  change, 
}: { 
  direction: TrendDirection; 
  change: number;
}) {
  if (direction === 'flat') {
    return (
      <span className="inline-flex items-center text-muted-foreground text-xs">
        <Minus className="h-3 w-3 mr-0.5" />
        <span>—</span>
      </span>
    );
  }
  
  // direction='up' means improvement, which is always green
  const isGood = direction === 'up';
  const colorClass = isGood ? 'text-green-500' : 'text-red-500';
  
  // Arrow direction based on actual value change
  const valueWentUp = change > 0;
  const Icon = valueWentUp ? TrendingUp : TrendingDown;
  
  return (
    <span className={cn('inline-flex items-center text-xs', colorClass)}>
      <Icon className="h-3 w-3 mr-0.5" />
      <span>{Math.abs(change)}%</span>
    </span>
  );
}
// BudgetCard moved to BoardSidebar

interface StatCardProps {
  title: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  clickable?: boolean;
}

function StatCard({ title, children, onClick, clickable }: StatCardProps) {
  return (
    <div 
      className={cn(
        'rounded-lg border bg-card p-4',
        clickable && 'cursor-pointer hover:ring-2 hover:ring-ring transition-all'
      )}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      } : undefined}
    >
      <h4 className="text-sm font-medium text-muted-foreground mb-3">{title}</h4>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}

interface StatRowProps {
  label: string;
  value: string | number;
  subLabel?: string;
  highlight?: boolean;
}

function StatRow({ label, value, subLabel, highlight }: StatRowProps) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className={cn('font-semibold', highlight && 'text-primary')}>
          {value}
        </span>
        {subLabel && (
          <span className="text-xs text-muted-foreground ml-1">({subLabel})</span>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const [period, setPeriod] = useState<MetricsPeriod>('3d');
  const [customFrom, setCustomFrom] = useState<string | undefined>();
  const [customTo, setCustomTo] = useState<string | undefined>();
  const [project, setProject] = useState<string | undefined>(undefined);
  const [drillDown, setDrillDown] = useState<DrillDownType>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  
  const { data: metrics, isLoading, isFetching, error, dataUpdatedAt } = useMetrics(period, project, customFrom, customTo);
  const { data: taskCost } = useTaskCost(period, project, customFrom, customTo);
  const { data: utilization } = useUtilization(period, customFrom, customTo);
  const { data: tasks } = useTasks();
  const { data: projectsList = [] } = useProjects();
  
  // Get unique project IDs from tasks, then map to project configs for labels
  const projectIds = tasks 
    ? [...new Set(tasks.filter(t => t.project).map(t => t.project!))]
    : [];
  const projects = projectsList.filter(p => projectIds.includes(p.id));

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        Failed to load metrics
      </div>
    );
  }

  // Color thresholds: green <10% error, yellow 10-25%, red >25%
  const getErrorRateColor = (rate: number): 'green' | 'yellow' | 'red' => {
    if (rate > 0.25) return 'red';
    if (rate > 0.1) return 'yellow';
    return 'green';
  };

  const getDrillDownTitle = () => {
    switch (drillDown) {
      case 'tasks': return 'Task Details';
      case 'errors': return 'Failed Runs';
      case 'tokens': return 'Token Usage Breakdown';
      case 'duration': return 'Run Duration Breakdown';
      default: return '';
    }
  };

  const handleTaskClick = (taskId: string) => {
    // Close drill-down and navigate to task (you may want to integrate with your task panel)
    setDrillDown(null);
    // This could dispatch an event or call a callback to open the task detail panel
    window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId } }));
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <DashboardFilterBar
        period={period}
        onPeriodChange={(p, from, to) => {
          setPeriod(p);
          setCustomFrom(from);
          setCustomTo(to);
        }}
        project={project}
        onProjectChange={setProject}
        projects={projects}
        onExportClick={() => setExportDialogOpen(true)}
      />

      {/* Updated timestamp */}
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground -mt-2">
        <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
        {isFetching ? 'Refreshing...' : `Updated ${new Date(dataUpdatedAt).toLocaleTimeString()}`}
      </div>
      
      {/* Export Dialog */}
      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        project={project}
        projects={projects}
      />

      {/* Agent Operations Row */}
      <div>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-lg" />
            ))}
          </div>
        ) : metrics ? (
          metrics.runs.runs === 0 ? (
            <div className="rounded-lg border bg-muted/20 p-8 text-center">
              <p className="text-muted-foreground">No agent runs recorded in this period</p>
              <p className="text-xs text-muted-foreground mt-1">Runs will appear here once telemetry data is collected</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {/* Error Rate Card */}
              <StatCard 
                title={
                  <div className="flex items-center justify-between">
                    <span>Success / Errors</span>
                    <TrendIndicator 
                      direction={metrics.trends.successRateTrend} 
                      change={metrics.trends.successRateChange}
                    />
                  </div>
                }
                onClick={() => setDrillDown('errors')}
                clickable
              >
                <StatRow 
                  label="Total Runs" 
                  value={metrics.runs.runs} 
                />
                <StatRow 
                  label="Successful" 
                  value={metrics.runs.successes}
                  subLabel={formatPercent(metrics.runs.successRate)}
                />
                <StatRow 
                  label="Failed" 
                  value={metrics.runs.failures + metrics.runs.errors}
                  highlight={metrics.runs.errorRate > 0.1}
                />
                <div className="pt-2 border-t mt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Error Rate</span>
                    <span className={cn(
                      'text-lg font-bold',
                      getErrorRateColor(metrics.runs.errorRate) === 'red' && 'text-red-500',
                      getErrorRateColor(metrics.runs.errorRate) === 'yellow' && 'text-yellow-500',
                      getErrorRateColor(metrics.runs.errorRate) === 'green' && 'text-green-500',
                    )}>
                      {formatPercent(metrics.runs.errorRate)}
                    </span>
                  </div>
                </div>
              </StatCard>

              {/* Tokens Card */}
              <StatCard 
                title={
                  <div className="flex items-center justify-between">
                    <span>Token Usage</span>
                    <TrendIndicator 
                      direction={metrics.trends.tokensTrend} 
                      change={metrics.trends.tokensChange}
                    />
                  </div>
                }
                onClick={() => setDrillDown('tokens')}
                clickable
              >
                <StatRow 
                  label="Total" 
                  value={formatTokens(metrics.tokens.totalTokens)} 
                />
                <StatRow 
                  label="Input" 
                  value={formatTokens(metrics.tokens.inputTokens)} 
                />
                <StatRow 
                  label="Output" 
                  value={formatTokens(metrics.tokens.outputTokens)} 
                />
                {metrics.tokens.cacheTokens > 0 && (
                  <StatRow 
                    label="Cache" 
                    value={formatTokens(metrics.tokens.cacheTokens)} 
                  />
                )}
                <div className="pt-2 border-t mt-2">
                  <div className="text-xs text-muted-foreground mb-1">Per Run</div>
                  <div className="flex justify-between text-sm">
                    <span>p50: {formatTokens(metrics.tokens.perSuccessfulRun.p50)}</span>
                    <span>p95: {formatTokens(metrics.tokens.perSuccessfulRun.p95)}</span>
                  </div>
                </div>
              </StatCard>

              {/* Duration Card */}
              <StatCard 
                title={
                  <div className="flex items-center justify-between">
                    <span>Run Duration</span>
                    <TrendIndicator 
                      direction={metrics.trends.durationTrend} 
                      change={metrics.trends.durationChange}
                    />
                  </div>
                }
                onClick={() => setDrillDown('duration')}
                clickable
              >
                <StatRow 
                  label="Runs" 
                  value={metrics.duration.runs} 
                />
                <StatRow 
                  label="Average" 
                  value={formatDuration(metrics.duration.avgMs)} 
                />
                <div className="pt-2 border-t mt-2">
                  <div className="flex justify-between text-sm">
                    <div>
                      <span className="text-muted-foreground">p50: </span>
                      <span className="font-medium">{formatDuration(metrics.duration.p50Ms)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">p95: </span>
                      <span className="font-medium">{formatDuration(metrics.duration.p95Ms)}</span>
                    </div>
                  </div>
                </div>
              </StatCard>
            </div>
          )
        ) : null}
      </div>

      {/* Budget moved to BoardSidebar */}

      {/* Agent Comparison (left) + Agent Activity (right) */}
      <div className="grid grid-cols-2 gap-4">
        <AgentComparison project={project} />
        <div className="rounded-lg border bg-card p-4">
          <StatusTimeline />
        </div>
      </div>

      {/* Cost per Task + Agent Utilization */}
      <div className="grid grid-cols-2 gap-4">
        {/* Cost per Task */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Cost per Task</h3>
          {taskCost ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Cost</span>
                <span className="font-bold text-lg">${taskCost.totalCost.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Avg per Task</span>
                <span className="font-semibold">${taskCost.avgCostPerTask.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm pb-2 border-b">
                <span className="text-muted-foreground">Tasks with Cost</span>
                <span className="font-semibold">{taskCost.tasks.length}</span>
              </div>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {taskCost.tasks.slice(0, 10).map((t) => (
                  <button
                    key={t.taskId}
                    className="flex items-center justify-between w-full text-left text-sm hover:bg-muted/50 rounded px-2 py-1 transition-colors"
                    onClick={() => handleTaskClick(t.taskId)}
                  >
                    <span className="truncate flex-1 mr-2 text-muted-foreground">
                      {t.taskTitle || t.taskId}
                    </span>
                    <span className="font-mono font-medium shrink-0">
                      ${t.estimatedCost.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Skeleton className="h-[200px]" />
          )}
        </div>

        {/* Agent Utilization */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Agent Utilization</h3>
          {utilization ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Overall</span>
                <span className={cn(
                  'font-bold text-lg',
                  utilization.utilizationPercent > 50 ? 'text-green-500' :
                  utilization.utilizationPercent > 20 ? 'text-yellow-500' : 'text-muted-foreground'
                )}>
                  {utilization.utilizationPercent.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Active Time</span>
                <span className="font-semibold">{formatDuration(utilization.totalActiveMs)}</span>
              </div>
              <div className="border-t pt-2 space-y-1.5 max-h-[200px] overflow-y-auto">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Daily</div>
                {utilization.daily.map((d) => (
                  <div key={d.date} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-20 shrink-0 text-xs">{d.date.slice(5)}</span>
                    <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-sm transition-all"
                        style={{ width: `${Math.min(100, d.utilizationPercent)}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs w-12 text-right shrink-0">
                      {d.utilizationPercent.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Skeleton className="h-[200px]" />
          )}
        </div>
      </div>

      {/* Historical Trends Charts */}
      <TrendsCharts project={project} />

      {/* Drill-Down Panel */}
      <DrillDownPanel
        type={drillDown}
        title={getDrillDownTitle()}
        onClose={() => setDrillDown(null)}
      >
        {drillDown === 'tasks' && (
          <TasksDrillDown 
            project={project} 
            onTaskClick={handleTaskClick}
          />
        )}
        {drillDown === 'errors' && (
          <ErrorsDrillDown 
            period={period} 
            project={project}
            onTaskClick={handleTaskClick}
          />
        )}
        {drillDown === 'tokens' && (
          <TokensDrillDown 
            period={period} 
            project={project}
          />
        )}
        {drillDown === 'duration' && (
          <DurationDrillDown 
            period={period} 
            project={project}
          />
        )}
      </DrillDownPanel>
    </div>
  );
}
