import type {
  AdmissionCancellationInput,
  AdmissionExecutionTreeCancellationResult,
  AdmissionQueueGetResponse,
  AdmissionQueueInspectionQuery,
  AdmissionQueueListResponse,
  AdmissionQueuedCancellationResult,
  AdmissionReservation,
  ExecutionTreeControl,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

function queueQuery(query: AdmissionQueueInspectionQuery): string {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspaceId', query.workspaceId);
  if (query.rootObjectiveId) params.set('rootObjectiveId', query.rootObjectiveId);
  if (query.nodeId) params.set('nodeId', query.nodeId);
  for (const source of query.sources ?? []) params.append('source', source);
  for (const state of query.states ?? []) params.append('state', state);
  if (query.priority !== undefined) params.set('priority', String(query.priority));
  for (const scope of query.limitingScopes ?? []) params.append('limitingScope', scope);
  if (query.minAgeMs !== undefined) params.set('minAgeMs', String(query.minAgeMs));
  if (query.maxAgeMs !== undefined) params.set('maxAgeMs', String(query.maxAgeMs));
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.toString();
  return `${API_BASE}/admission/queue${suffix ? `?${suffix}` : ''}`;
}

export const admissionApi = {
  queue: (query: AdmissionQueueInspectionQuery = {}): Promise<AdmissionQueueListResponse> =>
    apiFetch<AdmissionQueueListResponse>(queueQuery(query)),

  queueEntry: (id: string): Promise<AdmissionQueueGetResponse> =>
    apiFetch<AdmissionQueueGetResponse>(`${API_BASE}/admission/queue/${encodeURIComponent(id)}`),

  reservations: (): Promise<{ generatedAt: string; reservations: AdmissionReservation[] }> =>
    apiFetch(`${API_BASE}/admission?limit=1000`),

  cancelQueueEntry: (
    id: string,
    input: AdmissionCancellationInput
  ): Promise<AdmissionQueuedCancellationResult> =>
    apiFetch(`${API_BASE}/admission/queue/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  cancelTree: (
    rootObjectiveId: string,
    input: AdmissionCancellationInput
  ): Promise<AdmissionExecutionTreeCancellationResult> =>
    apiFetch(`${API_BASE}/admission/tree/${encodeURIComponent(rootObjectiveId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  resumeTree: (
    rootObjectiveId: string,
    input: AdmissionCancellationInput
  ): Promise<ExecutionTreeControl> =>
    apiFetch(`${API_BASE}/admission/tree/${encodeURIComponent(rootObjectiveId)}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
};
