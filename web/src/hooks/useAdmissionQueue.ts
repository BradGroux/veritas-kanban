import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdmissionCancellationInput,
  AdmissionQueueInspectionQuery,
} from '@veritas-kanban/shared';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
import { api } from '@/lib/api';

export const ADMISSION_QUEUE_QUERY_KEY = ['admission-queue'] as const;
export const ADMISSION_RESERVATIONS_QUERY_KEY = ['admission-reservations'] as const;

interface QueueControlInput extends AdmissionCancellationInput {
  id: string;
}

interface TreeControlInput extends AdmissionCancellationInput {
  rootObjectiveId: string;
}

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

export function useAdmissionReservations() {
  const { isConnected } = useWebSocketStatus();
  return useQuery({
    queryKey: ADMISSION_RESERVATIONS_QUERY_KEY,
    queryFn: api.admission.reservations,
    refetchInterval: isConnected ? 120_000 : 30_000,
    staleTime: isConnected ? 60_000 : 10_000,
  });
}

function useAdmissionControlInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ADMISSION_QUEUE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ADMISSION_RESERVATIONS_QUERY_KEY }),
    ]);
}

export function useAdmissionQueueCancel() {
  const invalidate = useAdmissionControlInvalidation();
  return useMutation({
    mutationFn: ({ id, ...input }: QueueControlInput) => api.admission.cancelQueueEntry(id, input),
    onSuccess: invalidate,
  });
}

export function useAdmissionTreeCancel() {
  const invalidate = useAdmissionControlInvalidation();
  return useMutation({
    mutationFn: ({ rootObjectiveId, ...input }: TreeControlInput) =>
      api.admission.cancelTree(rootObjectiveId, input),
    onSuccess: invalidate,
  });
}

export function useAdmissionTreeResume() {
  const invalidate = useAdmissionControlInvalidation();
  return useMutation({
    mutationFn: ({ rootObjectiveId, ...input }: TreeControlInput) =>
      api.admission.resumeTree(rootObjectiveId, input),
    onSuccess: invalidate,
  });
}
