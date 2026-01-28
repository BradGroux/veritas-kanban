import { useState } from 'react';
import { 
  useMetrics, 
  formatTokens, 
  formatDuration, 
  formatPercent,
  type MetricsPeriod,
  type TrendDirection,
} from '@/hooks/useMetrics';
import { useTasks } from '@/hooks/useTasks';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  CheckCircle, 
  Archive,
  ListTodo,
  Play,
  Ban,
  RefreshCw,
  MessageSquare,
  Wrench,
  Link2,
  HelpCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
} from 'lucide-react';
import { ExportDialog } from './ExportDialog';
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
import { BudgetCard } from './BudgetCard';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color?: 'default' | 'blue' | 'yellow' | 'green' | 'red' | 'muted';
  subValue?: string;
  onClick?: () => void;
  clickable?: boolean;
}

function MetricCard({ label, value, icon, color = 'default', subValue, onClick, clickable }: MetricCardProps) {
  const colorClasses = {
    default: 'bg-card border-border',
    blue: 'bg-blue-500/10 border-blue-500/20',
    yellow: 'bg-yellow-500/10 border-yellow-500/20',
    green: 'bg-green-500/10 border-green-500/20',
    red: 'bg-red-500/10 border-red-500/20',
    muted: 'bg-muted/50 border-muted-foreground/20',
  };

  const textClasses = {
    default: 'text-foreground',
    blue: 'text-blue-500',
    yellow: 'text-yellow-500',
    green: 'text-green-500',
    red: 'text-red-500',
    muted: 'text-muted-foreground',
  };

  const Component = clickable ? 'button' : 'div';

  return (
    <Component 
      className={cn(
        'rounded-lg border p-4 flex flex-col items-center justify-center min-w-[100px]',
        colorClasses[color],
        clickable && 'cursor-pointer hover:ring-2 hover:ring-ring transition-all focus:outline-none focus:ring-2 focus:ring-ring'
      )}
      onClick={onClick}
    >
      {icon && <div className={cn('mb-1', textClasses[color])}>{icon}</div>}
      <div className={cn('text-2xl font-bold', textClasses[color])}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground text-center">{label}</div>
      {subValue && (
        <div className="text-xs text-muted-foreground mt-1">{subValue}</div>
      )}
    </Component>
  );
}

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
  const [period, setPeriod] = useState<MetricsPeriod>('24h');
  const [project, setProject] = useState<string | undefined>(undefined);
  const [drillDown, setDrillDown] = useState<DrillDownType>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  
  const { data: metrics, isLoading, isFetching, error, dataUpdatedAt } = useMetrics(period, project);
  const { data: tasks } = useTasks();
  
  // Get unique projects from tasks
  const projects = tasks 
    ? [...new Set(tasks.filter(t => t.project).map(t => t.project!))]
    : [];

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
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Select value={project || 'all'} onValueChange={(v) => setProject(v === 'all' ? undefined : v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={period} onValueChange={(v) => setPeriod(v as MetricsPeriod)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setExportDialogOpen(true)}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
            {isFetching ? 'Refreshing...' : `Updated ${new Date(dataUpdatedAt).toLocaleTimeString()}`}
          </div>
        </div>
      </div>
      
      {/* Export Dialog */}
      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        project={project}
        projects={projects}
      />

      {/* Task Counts Row */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Tasks</h3>
        {isLoading ? (
          <div className="grid grid-cols-7 gap-3">
            {[...Array(7)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : metrics && (
          <div className="grid grid-cols-7 gap-3">
            <MetricCard 
              label="Total" 
              value={metrics.tasks.total}
              icon={<ListTodo className="h-4 w-4" />}
              onClick={() => setDrillDown('tasks')}
              clickable
            />
            <MetricCard 
              label="To Do" 
              value={metrics.tasks.byStatus['todo'] || 0}
              color="muted"
            />
            <MetricCard 
              label="In Progress" 
              value={metrics.tasks.byStatus['in-progress'] || 0}
              icon={<Play className="h-4 w-4" />}
              color="blue"
            />
            <MetricCard 
              label="Blocked" 
              value={metrics.tasks.byStatus['blocked'] || 0}
              icon={<Ban className="h-4 w-4" />}
              color="red"
            />
            <MetricCard 
              label="Done" 
              value={metrics.tasks.byStatus['done'] || 0}
              icon={<CheckCircle className="h-4 w-4" />}
              color="green"
            />
            <MetricCard 
              label="Archived" 
              value={metrics.tasks.archived}
              icon={<Archive className="h-4 w-4" />}
              color="muted"
            />
            <MetricCard 
              label="Completed" 
              value={metrics.tasks.completed}
              icon={<CheckCircle className="h-4 w-4" />}
              color="green"
              subValue="Done + Archived"
            />
          </div>
        )}
      </div>

      {/* Blocked Reason Breakdown (only show if there are blocked tasks) */}
      {metrics && metrics.tasks.byStatus['blocked'] > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Blocked Tasks Breakdown</h3>
          <div className="grid grid-cols-5 gap-3">
            <MetricCard 
              label="Waiting on Feedback" 
              value={metrics.tasks.byBlockedReason['waiting-on-feedback'] || 0}
              icon={<MessageSquare className="h-4 w-4" />}
              color="yellow"
            />
            <MetricCard 
              label="Technical Snag" 
              value={metrics.tasks.byBlockedReason['technical-snag'] || 0}
              icon={<Wrench className="h-4 w-4" />}
              color="red"
            />
            <MetricCard 
              label="Prerequisite" 
              value={metrics.tasks.byBlockedReason['prerequisite'] || 0}
              icon={<Link2 className="h-4 w-4" />}
              color="blue"
            />
            <MetricCard 
              label="Other" 
              value={metrics.tasks.byBlockedReason['other'] || 0}
              icon={<HelpCircle className="h-4 w-4" />}
              color="muted"
            />
            <MetricCard 
              label="Unspecified" 
              value={metrics.tasks.byBlockedReason['unspecified'] || 0}
              icon={<Ban className="h-4 w-4" />}
              color="muted"
            />
          </div>
        </div>
      )}

      {/* Agent Operations Row */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Agent Operations ({period})</h3>
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

      {/* Budget Tracking Card */}
      <BudgetCard project={project} />

      {/* Agent Comparison */}
      <AgentComparison project={project} />

      {/* Agent Status Timeline */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Agent Activity</h3>
        <div className="rounded-lg border bg-card p-4">
          <StatusTimeline />
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
