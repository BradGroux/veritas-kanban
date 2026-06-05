import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/helpers';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';

export interface TaskCounts extends Record<string, number> {
  backlog: number;
  todo: number;
  'in-progress': number;
  blocked: number;
  done: number;
  archived: number;
}

/**
 * Hook to fetch total task counts by status (no time filtering)
 *
 * This is used by the sidebar to show accurate counts across ALL tasks,
 * not just recently updated ones. Updates are driven by WebSocket task:changed
 * events with debounced cache invalidation (250ms).
 *
 * Polling intervals:
 * - Connected: 120s safety-net polling (WS delivers real-time updates)
 * - Disconnected: 30s fallback polling
 */
export function useTaskCounts() {
  const { isConnected } = useWebSocketStatus();

  return useQuery<TaskCounts>({
    queryKey: ['task-counts'],
    queryFn: () => apiFetch<TaskCounts>('/api/tasks/counts'),
    refetchInterval: isConnected ? 120_000 : 30_000,
    staleTime: isConnected ? 60_000 : 10_000,
  });
}
