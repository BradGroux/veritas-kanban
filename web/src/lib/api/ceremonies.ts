import type {
  CeremonyKind,
  CeremonyRequirement,
  CeremonyStatus,
  CompleteCeremonyRequirementInput,
  CreateCeremonyRequirementInput,
} from '@veritas-kanban/shared';
import { apiFetch } from './helpers';

export interface CeremonyListFilters {
  status?: CeremonyStatus;
  kind?: CeremonyKind;
  taskId?: string;
  limit?: number;
}

function toQuery(filters: CeremonyListFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.taskId) params.set('taskId', filters.taskId);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));

  const query = params.toString();
  return query ? `?${query}` : '';
}

export const ceremoniesApi = {
  list: async (filters: CeremonyListFilters = {}): Promise<CeremonyRequirement[]> =>
    apiFetch<CeremonyRequirement[]>(`/api/ceremonies${toQuery(filters)}`),

  create: async (input: CreateCeremonyRequirementInput): Promise<CeremonyRequirement> =>
    apiFetch<CeremonyRequirement>('/api/ceremonies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  complete: async (
    id: string,
    input: CompleteCeremonyRequirementInput
  ): Promise<CeremonyRequirement> =>
    apiFetch<CeremonyRequirement>(`/api/ceremonies/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
};
