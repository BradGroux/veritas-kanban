import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DriftAlert,
  DriftAnalysisResult,
  DriftBaseline,
  DriftMetricSnapshot,
} from '@veritas-kanban/shared';
import { apiFetch, API_BASE } from '@/lib/api/helpers';

interface DriftAlertFilters {
  agentId?: string;
  metric?: string;
  severity?: string;
  acknowledged?: boolean;
}

function buildQuery(filters: Record<string, string | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useDriftAlerts(filters: DriftAlertFilters = {}) {
  return useQuery({
    queryKey: ['drift-alerts', filters],
    queryFn: () =>
      apiFetch<DriftAlert[]>(
        `${API_BASE}/drift/alerts${buildQuery(filters as Record<string, string | boolean | undefined>)}`
      ),
    refetchInterval: 30_000,
  });
}

export function useDriftBaselines(filters: { agentId?: string; metric?: string } = {}) {
  return useQuery({
    queryKey: ['drift-baselines', filters],
    queryFn: () => apiFetch<DriftBaseline[]>(`${API_BASE}/drift/baselines${buildQuery(filters)}`),
    refetchInterval: 60_000,
  });
}

export function useAcknowledgeDriftAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<DriftAlert>(`${API_BASE}/drift/alerts/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drift-alerts'] });
    },
  });
}

export function useAnalyzeDrift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      apiFetch<DriftAnalysisResult>(`${API_BASE}/drift/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drift-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['drift-baselines'] });
    },
  });
}

export function useResetDriftBaselines() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, metric }: { agentId: string; metric?: string }) =>
      apiFetch<{ deleted: number }>(`${API_BASE}/drift/baselines/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, metric }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drift-baselines'] });
      queryClient.invalidateQueries({ queryKey: ['drift-alerts'] });
    },
  });
}

export type DriftSnapshot = DriftMetricSnapshot;
