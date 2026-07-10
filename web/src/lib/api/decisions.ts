import type {
  CreateDecisionInput,
  CreateDecisionReviewSessionInput,
  DecisionListFilters,
  DecisionRecord,
  DecisionReviewListFilters,
  DecisionReviewSession,
  DecisionWithChain,
  FinalizeDecisionReviewSessionInput,
  RecordDecisionReviewCritiqueInput,
  RecordDecisionReviewTurnInput,
  UpdateDecisionAssumptionInput,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

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
    return apiFetch<DecisionRecord[]>(`${API_BASE}/decisions${toQuery(filters)}`);
  },

  get: async (id: string): Promise<DecisionWithChain> => {
    return apiFetch<DecisionWithChain>(`${API_BASE}/decisions/${encodeURIComponent(id)}`);
  },

  create: async (input: CreateDecisionInput): Promise<DecisionRecord> => {
    return apiFetch<DecisionRecord>(`${API_BASE}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  updateAssumption: async (
    id: string,
    index: number,
    input: UpdateDecisionAssumptionInput
  ): Promise<DecisionRecord> => {
    return apiFetch<DecisionRecord>(
      `${API_BASE}/decisions/${encodeURIComponent(id)}/assumptions/${index}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },

  reviews: {
    list: async (filters: DecisionReviewListFilters = {}): Promise<DecisionReviewSession[]> => {
      const params = new URLSearchParams();
      if (filters.taskId) params.set('taskId', filters.taskId);
      if (filters.status) params.set('status', filters.status);
      if (filters.limit !== undefined) params.set('limit', String(filters.limit));
      const query = params.toString();
      return apiFetch<DecisionReviewSession[]>(
        `${API_BASE}/decisions/reviews${query ? `?${query}` : ''}`
      );
    },

    get: async (id: string): Promise<DecisionReviewSession> => {
      return apiFetch<DecisionReviewSession>(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}`
      );
    },

    create: async (input: CreateDecisionReviewSessionInput): Promise<DecisionReviewSession> => {
      return apiFetch<DecisionReviewSession>(`${API_BASE}/decisions/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    },

    recordResponse: async (
      id: string,
      input: RecordDecisionReviewTurnInput
    ): Promise<DecisionReviewSession> => {
      return apiFetch<DecisionReviewSession>(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/responses`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
    },

    recordCritique: async (
      id: string,
      input: RecordDecisionReviewCritiqueInput
    ): Promise<DecisionReviewSession> => {
      return apiFetch<DecisionReviewSession>(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/critiques`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
    },

    finalize: async (
      id: string,
      input: FinalizeDecisionReviewSessionInput
    ): Promise<DecisionReviewSession> => {
      return apiFetch<DecisionReviewSession>(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
    },

    cancel: async (id: string): Promise<DecisionReviewSession> => {
      return apiFetch<DecisionReviewSession>(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/cancel`,
        {
          method: 'POST',
        }
      );
    },

    export: async (id: string): Promise<string> => {
      // This endpoint returns plain text (markdown export), not a JSON envelope.
      // Uses raw fetch intentionally; apiFetch does not support text() responses.
      const response = await fetch(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/export`,
        {
          credentials: 'include',
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (body && typeof body === 'object' && 'message' in body) {
          throw new Error(String((body as { message: unknown }).message));
        }
        throw new Error(`HTTP ${response.status}`);
      }
      return response.text();
    },
  },
};
