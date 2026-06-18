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

  reviews: {
    list: async (filters: DecisionReviewListFilters = {}): Promise<DecisionReviewSession[]> => {
      const params = new URLSearchParams();
      if (filters.taskId) params.set('taskId', filters.taskId);
      if (filters.status) params.set('status', filters.status);
      if (filters.limit !== undefined) params.set('limit', String(filters.limit));
      const query = params.toString();
      const response = await fetch(`${API_BASE}/decisions/reviews${query ? `?${query}` : ''}`, {
        credentials: 'include',
      });
      return handleResponse<DecisionReviewSession[]>(response);
    },

    get: async (id: string): Promise<DecisionReviewSession> => {
      const response = await fetch(`${API_BASE}/decisions/reviews/${encodeURIComponent(id)}`, {
        credentials: 'include',
      });
      return handleResponse<DecisionReviewSession>(response);
    },

    create: async (input: CreateDecisionReviewSessionInput): Promise<DecisionReviewSession> => {
      const response = await fetch(`${API_BASE}/decisions/reviews`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<DecisionReviewSession>(response);
    },

    recordResponse: async (
      id: string,
      input: RecordDecisionReviewTurnInput
    ): Promise<DecisionReviewSession> => {
      const response = await fetch(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/responses`,
        {
          credentials: 'include',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
      return handleResponse<DecisionReviewSession>(response);
    },

    recordCritique: async (
      id: string,
      input: RecordDecisionReviewCritiqueInput
    ): Promise<DecisionReviewSession> => {
      const response = await fetch(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/critiques`,
        {
          credentials: 'include',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
      return handleResponse<DecisionReviewSession>(response);
    },

    finalize: async (
      id: string,
      input: FinalizeDecisionReviewSessionInput
    ): Promise<DecisionReviewSession> => {
      const response = await fetch(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/finalize`,
        {
          credentials: 'include',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }
      );
      return handleResponse<DecisionReviewSession>(response);
    },

    cancel: async (id: string): Promise<DecisionReviewSession> => {
      const response = await fetch(
        `${API_BASE}/decisions/reviews/${encodeURIComponent(id)}/cancel`,
        {
          credentials: 'include',
          method: 'POST',
        }
      );
      return handleResponse<DecisionReviewSession>(response);
    },

    export: async (id: string): Promise<string> => {
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
