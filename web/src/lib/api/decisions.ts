import type {
  CreateDecisionInput,
  DecisionListFilters,
  DecisionRecord,
  DecisionWithChain,
  UpdateDecisionAssumptionInput,
} from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

function toQuery(filters: DecisionListFilters = {}): string {
  const params = new URLSearchParams();

  if (filters.agent) params.set('agent', filters.agent);
  if (filters.startTime) params.set('startTime', filters.startTime);
  if (filters.endTime) params.set('endTime', filters.endTime);
  if (filters.minConfidence !== undefined)
    params.set('minConfidence', String(filters.minConfidence));
  if (filters.maxConfidence !== undefined)
    params.set('maxConfidence', String(filters.maxConfidence));
  if (filters.minRisk !== undefined) params.set('minRisk', String(filters.minRisk));
  if (filters.maxRisk !== undefined) params.set('maxRisk', String(filters.maxRisk));

  const query = params.toString();
  return query ? `?${query}` : '';
}

export const decisionsApi = {
  list: async (filters: DecisionListFilters = {}): Promise<DecisionRecord[]> => {
    const response = await fetch(`${API_BASE}/decisions${toQuery(filters)}`, {
      credentials: 'include',
    });
    return handleResponse<DecisionRecord[]>(response);
  },

  get: async (id: string): Promise<DecisionWithChain> => {
    const response = await fetch(`${API_BASE}/decisions/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    return handleResponse<DecisionWithChain>(response);
  },

  create: async (input: CreateDecisionInput): Promise<DecisionRecord> => {
    const response = await fetch(`${API_BASE}/decisions`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<DecisionRecord>(response);
  },

  updateAssumption: async (
    id: string,
    index: number,
    input: UpdateDecisionAssumptionInput
  ): Promise<DecisionRecord> => {
    const response = await fetch(
      `${API_BASE}/decisions/${encodeURIComponent(id)}/assumptions/${index}`,
      {
        credentials: 'include',
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
    return handleResponse<DecisionRecord>(response);
  },
};
