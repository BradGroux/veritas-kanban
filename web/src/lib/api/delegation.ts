import type { DelegationSettings, TaskPriority } from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export interface DelegationResponse {
  delegation: DelegationSettings | null;
}

export interface SetDelegationInput {
  delegateAgent: string;
  expires: string;
  scope: { type: 'all' | 'project' | 'priority' };
  excludePriorities?: TaskPriority[];
  createdBy: string;
}

export const delegationApi = {
  get: (): Promise<DelegationResponse> => apiFetch(`${API_BASE}/delegation`),

  set: (input: SetDelegationInput): Promise<DelegationResponse> =>
    apiFetch(`${API_BASE}/delegation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  revoke: (): Promise<DelegationResponse> =>
    apiFetch(`${API_BASE}/delegation`, { method: 'DELETE' }),
};
