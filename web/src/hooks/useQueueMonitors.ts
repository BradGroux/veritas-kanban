import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { QueueMonitorUpdateInput } from '@veritas-kanban/shared';

export const QUEUE_MONITORS_KEY = ['queue-monitors'] as const;

export function useQueueMonitors() {
  return useQuery({
    queryKey: QUEUE_MONITORS_KEY,
    queryFn: api.queueMonitors.list,
  });
}

export function useQueueMonitorRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (monitorId: string) => api.queueMonitors.run(monitorId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUEUE_MONITORS_KEY }),
  });
}

export function useQueueMonitorPause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (monitorId: string) => api.queueMonitors.pause(monitorId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUEUE_MONITORS_KEY }),
  });
}

export function useQueueMonitorResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (monitorId: string) => api.queueMonitors.resume(monitorId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUEUE_MONITORS_KEY }),
  });
}

export function useQueueMonitorExplain() {
  return useMutation({
    mutationFn: (monitorId: string) => api.queueMonitors.explain(monitorId),
  });
}

export function useQueueMonitorUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ monitorId, input }: { monitorId: string; input: QueueMonitorUpdateInput }) =>
      api.queueMonitors.update(monitorId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUEUE_MONITORS_KEY }),
  });
}
