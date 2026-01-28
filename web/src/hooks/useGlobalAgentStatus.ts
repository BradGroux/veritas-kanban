import { useQuery } from '@tanstack/react-query';
import { api, GlobalAgentStatus } from '@/lib/api';

/**
 * Hook to fetch global agent status (not per-task)
 * 
 * @deprecated Consider using `useAgentStatus` for real-time WebSocket updates.
 * This hook uses polling only and is kept for backwards compatibility.
 * 
 * Polls every 2 seconds when agent is working, every 10 seconds when idle.
 */
export function useGlobalAgentStatus() {
  return useQuery({
    queryKey: ['agent', 'global-status'],
    queryFn: () => api.agent.globalStatus(),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll more frequently when active
      if (status === 'working' || status === 'thinking') {
        return 2000;
      }
      // Poll less frequently when idle
      return 10000;
    },
    // Keep previous data during refetch for smoother UX
    placeholderData: (previousData) => previousData,
  });
}

export type { GlobalAgentStatus };
