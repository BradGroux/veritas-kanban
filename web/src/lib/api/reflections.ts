import type {
  AcceptReflectionCandidateInput,
  CreateReflectionCandidateInput,
  DeleteReflectionCandidateInput,
  MergeReflectionCandidateInput,
  ReflectionCandidate,
  ReflectionCandidateCategory,
  ReflectionCandidateStatus,
  ReflectionListResponse,
  ReflectionSourceKind,
  RejectReflectionCandidateInput,
} from '@veritas-kanban/shared';
import { apiFetch } from './helpers';

export interface ReflectionListFilters {
  status?: ReflectionCandidateStatus;
  category?: ReflectionCandidateCategory;
  sourceKind?: ReflectionSourceKind;
  taskId?: string;
  limit?: number;
}

function toQuery(filters: ReflectionListFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.sourceKind) params.set('sourceKind', filters.sourceKind);
  if (filters.taskId) params.set('taskId', filters.taskId);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));

  const query = params.toString();
  return query ? `?${query}` : '';
}

export const reflectionsApi = {
  list: async (filters: ReflectionListFilters = {}): Promise<ReflectionListResponse> =>
    apiFetch<ReflectionListResponse>(`/api/reflections${toQuery(filters)}`),

  create: async (input: CreateReflectionCandidateInput): Promise<ReflectionCandidate> =>
    apiFetch<ReflectionCandidate>('/api/reflections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  accept: async (id: string, input: AcceptReflectionCandidateInput): Promise<ReflectionCandidate> =>
    apiFetch<ReflectionCandidate>(`/api/reflections/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  reject: async (id: string, input: RejectReflectionCandidateInput): Promise<ReflectionCandidate> =>
    apiFetch<ReflectionCandidate>(`/api/reflections/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  delete: async (id: string, input: DeleteReflectionCandidateInput): Promise<ReflectionCandidate> =>
    apiFetch<ReflectionCandidate>(`/api/reflections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  merge: async (id: string, input: MergeReflectionCandidateInput): Promise<ReflectionCandidate> =>
    apiFetch<ReflectionCandidate>(`/api/reflections/${encodeURIComponent(id)}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
};
