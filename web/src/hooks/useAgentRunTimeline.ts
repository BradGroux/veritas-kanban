import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { apiFetch } from '@/lib/api/helpers';
import type { AnyTelemetryEvent } from '@veritas-kanban/shared';

export function useAgentRunTraces(taskId: string | undefined) {
  return useQuery({
    queryKey: ['traces', 'task', taskId],
    queryFn: () => (taskId ? api.traces.listForTask(taskId) : Promise.resolve([])),
    enabled: Boolean(taskId),
  });
}

export function useTaskTelemetryEvents(taskId: string | undefined) {
  return useQuery({
    queryKey: ['telemetry', 'task', taskId],
    queryFn: () =>
      taskId
        ? apiFetch<AnyTelemetryEvent[]>(`/api/telemetry/events/task/${encodeURIComponent(taskId)}`)
        : Promise.resolve([]),
    enabled: Boolean(taskId),
    staleTime: 30000,
  });
}
