/**
 * WorkflowDashboard - Comprehensive workflow monitoring dashboard
 *
 * Features:
 * - Summary cards (total workflows, active runs, completed/failed runs, success rate, avg duration)
 * - Active runs table (live updates via WebSocket)
 * - Recent runs history (sortable/filterable)
 * - Per-workflow health metrics
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Badge,
  Button,
  Group,
  Select,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { ArrowLeft, Activity, Clock, Zap, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { WorkflowRunView } from './WorkflowRunView';
import { useWebSocket, type WebSocketMessage } from '@/hooks/useWebSocket';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
import { useQueryClient } from '@tanstack/react-query';
import {
  useWorkflowStats,
  useActiveRuns,
  useRecentRuns,
  type WorkflowPeriod,
  type WorkflowRun,
} from '@/hooks/useWorkflowStats';
import { WorkflowSummaryCards } from './dashboard/WorkflowSummaryCards';
import { ActiveRunsList } from './dashboard/ActiveRunsList';
import { RecentRunsList } from './dashboard/RecentRunsList';
import { WorkflowHealthMetrics } from './dashboard/WorkflowHealthMetrics';

interface WorkflowDashboardProps {
  onBack: () => void;
}

interface WorkflowStatusMessage extends WebSocketMessage {
  type: 'workflow:status';
  payload: WorkflowRun;
}

function isWorkflowStatusMessage(msg: WebSocketMessage): msg is WorkflowStatusMessage {
  return msg.type === 'workflow:status' && typeof msg.payload === 'object' && msg.payload !== null;
}

export function WorkflowDashboard({ onBack }: WorkflowDashboardProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [period, setPeriod] = useState<WorkflowPeriod>('7d');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { toast } = useToast();
  const { isConnected } = useWebSocketStatus();
  const queryClient = useQueryClient();

  // Fetch data with React Query
  const { data: stats, isLoading: isStatsLoading, error: statsError } = useWorkflowStats(period);

  const {
    data: activeRuns = [],
    isLoading: isActiveRunsLoading,
    error: activeRunsError,
  } = useActiveRuns();

  const {
    data: recentRuns = [],
    isLoading: isRecentRunsLoading,
    error: recentRunsError,
  } = useRecentRuns();

  // Show toast on errors (in useEffect to avoid infinite render loop)
  useEffect(() => {
    if (statsError) {
      toast({
        title: '❌ Failed to load workflow stats',
        description: statsError instanceof Error ? statsError.message : 'Unknown error',
      });
    }
  }, [statsError, toast]);

  useEffect(() => {
    if (activeRunsError) {
      toast({
        title: '❌ Failed to load active runs',
        description: activeRunsError instanceof Error ? activeRunsError.message : 'Unknown error',
      });
    }
  }, [activeRunsError, toast]);

  useEffect(() => {
    if (recentRunsError) {
      toast({
        title: '❌ Failed to load recent runs',
        description: recentRunsError instanceof Error ? recentRunsError.message : 'Unknown error',
      });
    }
  }, [recentRunsError, toast]);

  // WebSocket subscription for live updates
  const handleWebSocketMessage = useCallback(
    (message: WebSocketMessage) => {
      if (isWorkflowStatusMessage(message)) {
        const updatedRun = message.payload;

        // Invalidate queries to trigger refetch
        queryClient.invalidateQueries({ queryKey: ['workflow-active-runs'] });
        queryClient.invalidateQueries({ queryKey: ['workflow-recent-runs'] });

        // Refetch stats on completion/failure
        if (updatedRun.status === 'completed' || updatedRun.status === 'failed') {
          queryClient.invalidateQueries({ queryKey: ['workflow-stats'] });
        }
      }
    },
    [queryClient]
  );

  useWebSocket({
    autoConnect: true,
    onOpen: { type: 'workflow:subscribe' },
    onMessage: handleWebSocketMessage,
  });

  if (selectedRunId) {
    return <WorkflowRunView runId={selectedRunId} onBack={() => setSelectedRunId(null)} />;
  }

  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Group gap="md" align="center">
          <Button
            variant="subtle"
            size="sm"
            leftSection={<ArrowLeft className="h-4 w-4" />}
            onClick={onBack}
          >
            Back to Workflows
          </Button>
          <Title order={1} className="text-2xl">
            Workflow Dashboard
          </Title>
        </Group>

        <Select
          aria-label="Workflow dashboard period"
          className="w-[180px]"
          value={period}
          onChange={(value) => setPeriod((value ?? '7d') as WorkflowPeriod)}
          data={[
            { value: '24h', label: 'Last 24 hours' },
            { value: '7d', label: 'Last 7 days' },
            { value: '30d', label: 'Last 30 days' },
          ]}
        />
      </Group>

      {/* Summary Cards */}
      {isStatsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} h={128} />
          ))}
        </div>
      ) : stats ? (
        <WorkflowSummaryCards stats={stats} period={period} />
      ) : null}

      {/* Active Runs */}
      <Stack gap="md">
        <Group gap="xs">
          <ThemeIcon variant="transparent" color="gray" size="sm">
            <Activity className="h-5 w-5" />
          </ThemeIcon>
          <Title order={2} className="text-lg">
            Active Runs
          </Title>
          <Badge variant="light">{activeRuns.length}</Badge>
          {!isConnected && (
            <Badge
              color="yellow"
              variant="outline"
              leftSection={<AlertCircle className="h-3 w-3" />}
            >
              WebSocket disconnected
            </Badge>
          )}
        </Group>

        {isActiveRunsLoading ? (
          <Stack gap="sm">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} h={96} />
            ))}
          </Stack>
        ) : activeRuns.length === 0 ? (
          <Text ta="center" c="dimmed" py="xl">
            No active runs
          </Text>
        ) : (
          <ActiveRunsList runs={activeRuns} onSelectRun={setSelectedRunId} />
        )}
      </Stack>

      {/* Recent Runs */}
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <ThemeIcon variant="transparent" color="gray" size="sm">
              <Clock className="h-5 w-5" />
            </ThemeIcon>
            <Title order={2} className="text-lg">
              Recent Runs
            </Title>
            <Badge variant="light">{recentRuns.length}</Badge>
          </Group>

          <Select
            aria-label="Recent workflow run status filter"
            className="w-[180px]"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value ?? 'all')}
            data={[
              { value: 'all', label: 'All Statuses' },
              { value: 'completed', label: 'Completed' },
              { value: 'failed', label: 'Failed' },
              { value: 'blocked', label: 'Blocked' },
              { value: 'pending', label: 'Pending' },
            ]}
          />
        </Group>

        {isRecentRunsLoading ? (
          <Stack gap="sm">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} h={80} />
            ))}
          </Stack>
        ) : (
          <RecentRunsList
            runs={recentRuns}
            statusFilter={statusFilter}
            onSelectRun={setSelectedRunId}
          />
        )}
      </Stack>

      {/* Workflow Health */}
      {stats && stats.perWorkflow.length > 0 && (
        <Stack gap="md">
          <Group gap="xs">
            <ThemeIcon variant="transparent" color="gray" size="sm">
              <Zap className="h-5 w-5" />
            </ThemeIcon>
            <Title order={2} className="text-lg">
              Workflow Health
            </Title>
          </Group>

          <WorkflowHealthMetrics workflowStats={stats.perWorkflow} />
        </Stack>
      )}
    </Stack>
  );
}
