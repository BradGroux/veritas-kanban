import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';

export type WorkflowPeriod = '24h' | '7d' | '30d';

export type WorkflowRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  taskId?: string;
  status: WorkflowRunStatus;
  currentStep?: string;
  context?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  lastCheckpoint?: string;
  error?: string;
  steps: Array<{
    stepId: string;
    status: string;
    agent?: string;
    startedAt?: string;
    completedAt?: string;
    duration?: number;
    retries?: number;
    output?: string;
    error?: string;
  }>;
}

export interface WorkflowStats {
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

const API_BASE = '/api';

async function fetchWorkflowStats(period: WorkflowPeriod): Promise<WorkflowStats> {
  return apiFetch<WorkflowStats>(`${API_BASE}/workflows/runs/stats?period=${period}`);
}

async function fetchActiveRuns(): Promise<WorkflowRun[]> {
  return apiFetch<WorkflowRun[]>(`${API_BASE}/workflows/runs/active`);
}

async function fetchRecentRuns(): Promise<WorkflowRun[]> {
  return apiFetch<WorkflowRun[]>(`${API_BASE}/workflows/runs`);
}

/**
 * Fetch workflow statistics for dashboard
 * Follows same polling pattern as useMetrics (120s connected, 30s disconnected)
 */
export function useWorkflowStats(period: WorkflowPeriod = '7d') {
  const { isConnected } = useWebSocketStatus();

  return useQuery({
    queryKey: ['workflow-stats', period],
    queryFn: () => fetchWorkflowStats(period),
    // WebSocket updates trigger invalidation via workflow:status events
    // Safety net polling based on connection status
    refetchInterval: isConnected ? 120_000 : 30_000,
    staleTime: isConnected ? 60_000 : 10_000,
  });
}

/**
 * Fetch currently running workflow runs
 * More frequent polling for live updates
 */
export function useActiveRuns() {
  const { isConnected } = useWebSocketStatus();

  return useQuery({
    queryKey: ['workflow-active-runs'],
    queryFn: fetchActiveRuns,
    refetchInterval: isConnected ? 30_000 : 10_000,
    staleTime: isConnected ? 10_000 : 5_000,
  });
}

/**
 * Fetch recent workflow runs (last 50)
 */
export function useRecentRuns() {
  const { isConnected } = useWebSocketStatus();

  return useQuery({
    queryKey: ['workflow-recent-runs'],
    queryFn: fetchRecentRuns,
    refetchInterval: isConnected ? 60_000 : 20_000,
    staleTime: isConnected ? 30_000 : 10_000,
  });
}
