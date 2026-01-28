import { useTokenMetrics, formatTokens, type MetricsPeriod } from '@/hooks/useMetrics';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Coins, Bot, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TokensDrillDownProps {
  period: MetricsPeriod;
  project?: string;
}

export function TokensDrillDown({ period, project }: TokensDrillDownProps) {
  const { data: metrics, isLoading } = useTokenMetrics(period, project);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-8">
        <Coins className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No token data available</p>
      </div>
    );
  }

  const periodLabel = period === '24h' ? 'last 24 hours' : 'last 7 days';

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-medium text-muted-foreground mb-3">
          Token Usage Summary ({periodLabel})
        </h4>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-2xl font-bold text-primary">
              {formatTokens(metrics.totalTokens)}
            </div>
            <div className="text-xs text-muted-foreground">Total Tokens</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-500">
              {formatTokens(metrics.inputTokens)}
            </div>
            <div className="text-xs text-muted-foreground">Input</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-500">
              {formatTokens(metrics.outputTokens)}
            </div>
            <div className="text-xs text-muted-foreground">Output</div>
          </div>
        </div>
        
        <div className="mt-4 pt-3 border-t">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Per Run Statistics:</span>
          </div>
          <div className="flex gap-4 mt-1">
            <div>
              <span className="text-muted-foreground text-xs">Avg: </span>
              <span className="font-medium">{formatTokens(metrics.perSuccessfulRun.avg)}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">p50: </span>
              <span className="font-medium">{formatTokens(metrics.perSuccessfulRun.p50)}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">p95: </span>
              <span className="font-medium">{formatTokens(metrics.perSuccessfulRun.p95)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Per-Agent Breakdown */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <Bot className="h-4 w-4" />
          Breakdown by Agent
        </h4>
        
        {metrics.byAgent.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            No agent data available
          </div>
        ) : (
          <div className="space-y-2">
            {metrics.byAgent.map((agent, index) => {
              const percentage = metrics.totalTokens > 0 
                ? (agent.totalTokens / metrics.totalTokens) * 100 
                : 0;
              
              return (
                <AgentTokenRow 
                  key={agent.agent} 
                  agent={agent}
                  percentage={percentage}
                  isTop={index === 0}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface AgentTokenRowProps {
  agent: {
    agent: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    runs: number;
  };
  percentage: number;
  isTop: boolean;
}

function AgentTokenRow({ agent, percentage, isTop }: AgentTokenRowProps) {
  return (
    <div className={cn(
      'rounded-lg border p-3',
      isTop && 'border-primary/30 bg-primary/5'
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{agent.agent}</span>
          {isTop && (
            <Badge variant="secondary" className="text-xs flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Top Consumer
            </Badge>
          )}
        </div>
        <Badge variant="outline" className="text-xs">
          {agent.runs} runs
        </Badge>
      </div>
      
      {/* Progress Bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
        <div 
          className="h-full bg-primary transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      <div className="flex justify-between text-sm">
        <div className="flex gap-4">
          <span>
            <span className="text-muted-foreground">Total: </span>
            <span className="font-medium">{formatTokens(agent.totalTokens)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">In: </span>
            <span className="text-blue-500">{formatTokens(agent.inputTokens)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Out: </span>
            <span className="text-green-500">{formatTokens(agent.outputTokens)}</span>
          </span>
        </div>
        <span className="text-muted-foreground">
          {percentage.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
