import { useQuery } from '@tanstack/react-query';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
import { apiFetch } from '@/lib/api/helpers';

// ─── Types ────────────────────────────────────────────────────

export type OverallStatus = 'stable' | 'reviewing' | 'drifting' | 'elevated' | 'alert';

export interface SystemSignal {
  status: 'ok' | 'warn' | 'fail';
  storage: boolean;
  disk: boolean;
  memory: boolean;
}

export interface AgentSignal {
  status: 'ok' | 'warn' | 'critical';
  total: number;
  online: number;
  offline: number;
}

export interface OperationsSignal {
  status: 'ok' | 'warn' | 'critical';
  recentRuns: number;
  successRate: number;
  failedRuns: number;
}

export interface SystemHealth {
  timestamp: string;
  status: OverallStatus;
  signals: {
    system: SystemSignal;
    agents: AgentSignal;
    operations: OperationsSignal;
  };
}

/**
 * Fetches aggregated system health for the status bar.
 * Polls every 30s when WebSocket is connected, 60s otherwise.
 */
export function useSystemHealth() {
  const { isConnected } = useWebSocketStatus();

  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => apiFetch<SystemHealth>('/api/v1/system/health'),
    refetchInterval: isConnected ? 30_000 : 60_000,
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
  });
}
