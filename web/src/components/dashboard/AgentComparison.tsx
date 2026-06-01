import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { apiFetch } from '@/lib/api/helpers';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
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
  const { isConnected } = useWebSocketStatus();

  const { data, isLoading, error } = useQuery<AgentComparisonResult>({
    queryKey: ['agent-comparison', period, project],
    queryFn: async () => {
      const params = new URLSearchParams({ period, minRuns: '1' });
      if (project) params.set('project', project);
      return apiFetch<AgentComparisonResult>(`/api/metrics/agents/comparison?${params}`);
    },
    // Agent comparison data updates less frequently
    // - Connected: 120s safety-net polling
    // - Disconnected: 60s fallback polling
    refetchInterval: isConnected ? 120_000 : 60_000,
    staleTime: isConnected ? 60_000 : 30_000,
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
    <Paper withBorder radius="md">
      {/* Header */}
      <Group justify="space-between" p="md">
        <Group gap="xs">
          <Text size="sm" fw={500}>
            Agent Comparison
          </Text>
          {data && (
            <Text size="xs" c="dimmed">
              ({data.qualifyingAgents} of {data.totalAgents} agents with 3+ runs)
            </Text>
          )}
        </Group>
      </Group>

      {/* Content */}
      <Stack gap="md" p="md" pt={0}>
        {isLoading && (
          <Stack gap="sm">
            <Skeleton h={64} radius="md" />
            <Skeleton h={128} radius="md" />
          </Stack>
        )}

        {error && (
          <Text size="sm" c="red" ta="center" py="md">
            Failed to load agent comparison data
          </Text>
        )}

        {data && data.qualifyingAgents === 0 && (
          <Stack gap={4} ta="center" py="xl">
            <Text size="sm" c="dimmed">
              No agents have enough runs for comparison
            </Text>
            <Text size="xs" c="dimmed">
              Minimum 3 runs required per agent
            </Text>
          </Stack>
        )}

        {data && data.qualifyingAgents > 0 && (
          <>
            {/* Recommendations */}
            {data.recommendations.length > 0 && (
              <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
                {data.recommendations.map((rec) => (
                  <Tooltip
                    key={rec.category}
                    multiline
                    w={220}
                    position="bottom"
                    label={
                      <Stack gap={4}>
                        <Text size="xs">{rec.reason}</Text>
                        <Text size="xs" c="dimmed">
                          {categoryTooltips[rec.category]}
                        </Text>
                      </Stack>
                    }
                  >
                    <Paper withBorder radius="md" p="sm" className="cursor-help bg-muted/30">
                      <Group gap="xs" mb={4} wrap="nowrap">
                        {categoryIcons[rec.category]}
                        <Text size="xs" fw={500} c="dimmed">
                          {categoryLabels[rec.category]}
                        </Text>
                      </Group>
                      <Text size="sm" fw={600}>
                        {rec.agent}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {rec.value}
                      </Text>
                    </Paper>
                  </Tooltip>
                ))}
              </SimpleGrid>
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
                        <Tooltip label="Percentage of runs that completed successfully">
                          <ActionIcon variant="subtle" size="xs" aria-label="Success rate help">
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </ActionIcon>
                        </Tooltip>
                      </div>
                    </th>
                    <th className="pb-2 px-2 font-medium text-right">
                      <div className="flex items-center justify-end gap-1">
                        <SortHeader field="avgDurationMs" label="Avg Time" />
                        <Tooltip label="Average run duration (lower is better)">
                          <ActionIcon variant="subtle" size="xs" aria-label="Average time help">
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </ActionIcon>
                        </Tooltip>
                      </div>
                    </th>
                    <th className="pb-2 px-2 font-medium text-right">
                      <div className="flex items-center justify-end gap-1">
                        <SortHeader field="avgTokensPerRun" label="Avg Tokens" />
                        <Tooltip label="Average tokens per run (lower is more efficient)">
                          <ActionIcon variant="subtle" size="xs" aria-label="Average tokens help">
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </ActionIcon>
                        </Tooltip>
                      </div>
                    </th>
                    <th className="pb-2 pl-2 font-medium text-right">
                      <div className="flex items-center justify-end gap-1">
                        <SortHeader field="avgCostPerRun" label="Avg Cost" />
                        <Tooltip label="Estimated cost per run (lower is cheaper)">
                          <ActionIcon variant="subtle" size="xs" aria-label="Average cost help">
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </ActionIcon>
                        </Tooltip>
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
      </Stack>
    </Paper>
  );
}
