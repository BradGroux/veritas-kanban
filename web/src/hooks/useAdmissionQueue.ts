import { useQuery } from '@tanstack/react-query';
import type { AdmissionQueueInspectionQuery } from '@veritas-kanban/shared';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
import { api } from '@/lib/api';

export const ADMISSION_QUEUE_QUERY_KEY = ['admission-queue'] as const;

const DEFAULT_QUEUE_QUERY: AdmissionQueueInspectionQuery = {
  states: ['queued', 'requeued', 'leased'],
  page: 1,
  limit: 100,
};

export function useAdmissionQueue(query: AdmissionQueueInspectionQuery = DEFAULT_QUEUE_QUERY) {
  const { isConnected } = useWebSocketStatus();

  return useQuery({
    queryKey: [...ADMISSION_QUEUE_QUERY_KEY, query],
    queryFn: () => api.admission.queue(query),
    placeholderData: (previousData) => previousData,
    refetchInterval: isConnected ? 120_000 : 30_000,
    staleTime: isConnected ? 60_000 : 10_000,
  });
}
