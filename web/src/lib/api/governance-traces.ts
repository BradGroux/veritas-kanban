import type { GovernanceTraceListFilters, GovernanceTraceRecord } from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

function toQuery(filters: GovernanceTraceListFilters = {}): string {
  const params = new URLSearchParams();

  if (filters.kind) params.set('kind', filters.kind);
  if (filters.outcome) params.set('outcome', filters.outcome);
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.taskId) params.set('taskId', filters.taskId);
  if (filters.actionType) params.set('actionType', filters.actionType);
  if (filters.startTime) params.set('startTime', filters.startTime);
  if (filters.endTime) params.set('endTime', filters.endTime);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));

  const query = params.toString();
  return query ? `?${query}` : '';
}

export const governanceTracesApi = {
  list: async (filters: GovernanceTraceListFilters = {}): Promise<GovernanceTraceRecord[]> => {
    return apiFetch<GovernanceTraceRecord[]>(`${API_BASE}/governance/traces${toQuery(filters)}`);
  },

  get: async (id: string): Promise<GovernanceTraceRecord> => {
    return apiFetch<GovernanceTraceRecord>(
      `${API_BASE}/governance/traces/${encodeURIComponent(id)}`
    );
  },
};
