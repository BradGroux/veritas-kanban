import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';
import {
  Trophy,
  Zap,
  DollarSign,
  Target,
  Info,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
interface AgentComparisonData {
  agent: string;
  runs: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDurationMs: number;
  avgTokensPerRun: number;
  totalTokens: number;
  avgCostPerRun: number;
  totalCost: number;
}

interface AgentRecommendation {
  category: 'reliability' | 'speed' | 'cost' | 'efficiency';
  agent: string;
  value: string;
  reason: string;
}

interface AgentComparisonResult {
  period: string;
  minRuns: number;
  agents: AgentComparisonData[];
  recommendations: AgentRecommendation[];
  totalAgents: number;
  qualifyingAgents: number;
}

type SortField = 'runs' | 'successRate' | 'avgDurationMs' | 'avgTokensPerRun' | 'avgCostPerRun';
type SortDirection = 'asc' | 'desc';

const categoryIcons: Record<string, React.ReactNode> = {
  reliability: <Trophy className="h-4 w-4 text-yellow-500" />,
  speed: <Zap className="h-4 w-4 text-blue-500" />,
  cost: <DollarSign className="h-4 w-4 text-green-500" />,
  efficiency: <Target className="h-4 w-4 text-purple-500" />,
};

const categoryLabels: Record<string, string> = {
  reliability: 'Most Reliable',
  speed: 'Fastest',
  cost: 'Cheapest',
  efficiency: 'Most Efficient',
};

const categoryTooltips: Record<string, string> = {
  reliability: 'Highest success rate among qualifying agents',
  speed: 'Shortest average run duration',
  cost: 'Lowest estimated cost per run',
  efficiency: 'Fewest tokens consumed per successful run',
};

function formatDuration(ms: number): string {
  if (ms === 0) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return '—';
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

interface AgentComparisonProps {
  project?: string;
}

export function AgentComparison({ project }: AgentComparisonProps) {
  const period = '7d';
  const [sortField, setSortField] = useState<SortField>('runs');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const { data, isLoading, error } = useQuery<AgentComparisonResult>({
    queryKey: ['agent-comparison', period, project],
    queryFn: async () => {
      const params = new URLSearchParams({ period, minRuns: '3' });
      if (project) params.set('project', project);
      return apiFetch<AgentComparisonResult>(`/api/metrics/agents/comparison?${params}`);
    },
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // Default direction based on metric (lower is better for cost/duration, higher for others)
      setSortDirection(
        field === 'avgDurationMs' || field === 'avgCostPerRun' || field === 'avgTokensPerRun'
          ? 'asc'
          : 'desc'
      );
    }
  };

  const sortedAgents = data?.agents
    ? [...data.agents].sort((a, b) => {
        const multiplier = sortDirection === 'asc' ? 1 : -1;
        return (a[sortField] - b[sortField]) * multiplier;
      })
    : [];

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {sortField === field ? (
        sortDirection === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      )}
    </button>
  );

  // Determine highlight classes for best in category
  const getBestHighlight = (agent: string, field: SortField): string => {
    if (!data?.recommendations) return '';
    const categoryMap: Record<SortField, string> = {
      runs: '',
      successRate: 'reliability',
      avgDurationMs: 'speed',
      avgTokensPerRun: 'efficiency',
      avgCostPerRun: 'cost',
    };
    const category = categoryMap[field];
    if (!category) return '';
    const rec = data.recommendations.find((r) => r.category === category);
    if (rec?.agent === agent) {
      return 'font-bold text-primary';
    }
    return '';
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Agent Comparison</h3>
          {data && (
            <span className="text-xs text-muted-foreground">
              ({data.qualifyingAgents} of {data.totalAgents} agents with 3+ runs)
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 pt-0 space-y-4">
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive text-center py-4">
              Failed to load agent comparison data
            </div>
          )}

          {data && data.qualifyingAgents === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No agents have enough runs for comparison</p>
              <p className="text-xs mt-1">Minimum 3 runs required per agent</p>
            </div>
          )}

          {data && data.qualifyingAgents > 0 && (
            <>
              {/* Recommendations */}
              {data.recommendations.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <TooltipProvider>
                    {data.recommendations.map((rec) => (
                      <Tooltip key={rec.category}>
                        <TooltipTrigger asChild>
                          <div className="rounded-lg border bg-muted/30 p-3 cursor-help">
                            <div className="flex items-center gap-2 mb-1">
                              {categoryIcons[rec.category]}
                              <span className="text-xs font-medium text-muted-foreground">
                                {categoryLabels[rec.category]}
                              </span>
                            </div>
                            <div className="font-semibold text-sm">{rec.agent}</div>
                            <div className="text-xs text-muted-foreground">{rec.value}</div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[200px]">
                          <p className="text-xs">{rec.reason}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {categoryTooltips[rec.category]}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </TooltipProvider>
                </div>
              )}

              {/* Comparison Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-left">
                      <th className="pb-2 pr-4 font-medium">Agent</th>
                      <th className="pb-2 px-2 font-medium text-right">
                        <SortHeader field="runs" label="Runs" />
                      </th>
                      <th className="pb-2 px-2 font-medium text-right">
                        <div className="flex items-center justify-end gap-1">
                          <SortHeader field="successRate" label="Success" />
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Info className="h-3 w-3 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  Percentage of runs that completed successfully
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </th>
                      <th className="pb-2 px-2 font-medium text-right">
                        <div className="flex items-center justify-end gap-1">
                          <SortHeader field="avgDurationMs" label="Avg Time" />
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Info className="h-3 w-3 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Average run duration (lower is better)</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </th>
                      <th className="pb-2 px-2 font-medium text-right">
                        <div className="flex items-center justify-end gap-1">
                          <SortHeader field="avgTokensPerRun" label="Avg Tokens" />
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Info className="h-3 w-3 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  Average tokens per run (lower is more efficient)
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </th>
                      <th className="pb-2 pl-2 font-medium text-right">
                        <div className="flex items-center justify-end gap-1">
                          <SortHeader field="avgCostPerRun" label="Avg Cost" />
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Info className="h-3 w-3 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Estimated cost per run (lower is cheaper)</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAgents.map((agent) => (
                      <tr key={agent.agent} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium">{agent.agent}</td>
                        <td
                          className={cn(
                            'py-2 px-2 text-right',
                            getBestHighlight(agent.agent, 'runs')
                          )}
                        >
                          {agent.runs}
                        </td>
                        <td
                          className={cn(
                            'py-2 px-2 text-right',
                            getBestHighlight(agent.agent, 'successRate')
                          )}
                        >
                          <span
                            className={cn(
                              agent.successRate >= 90 && 'text-green-500',
                              agent.successRate < 70 && 'text-red-500'
                            )}
                          >
                            {agent.successRate}%
                          </span>
                        </td>
                        <td
                          className={cn(
                            'py-2 px-2 text-right',
                            getBestHighlight(agent.agent, 'avgDurationMs')
                          )}
                        >
                          {formatDuration(agent.avgDurationMs)}
                        </td>
                        <td
                          className={cn(
                            'py-2 px-2 text-right',
                            getBestHighlight(agent.agent, 'avgTokensPerRun')
                          )}
                        >
                          {formatTokens(agent.avgTokensPerRun)}
                        </td>
                        <td
                          className={cn(
                            'py-2 pl-2 text-right',
                            getBestHighlight(agent.agent, 'avgCostPerRun')
                          )}
                        >
                          ${agent.avgCostPerRun.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
    </div>
  );
}
