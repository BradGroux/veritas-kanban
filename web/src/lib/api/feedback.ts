import type {
  CreateFeedbackInput,
  Feedback,
  FeedbackAnalytics,
  FeedbackAnalyticsFilters,
  FeedbackListFilters,
  UpdateFeedbackInput,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export type { FeedbackListFilters, FeedbackAnalyticsFilters };

const buildParams = (filters: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const feedbackApi = {
  list: async (filters?: FeedbackListFilters): Promise<Feedback[]> => {
    return apiFetch<Feedback[]>(
      `${API_BASE}/feedback${buildParams((filters ?? {}) as Record<string, unknown>)}`
    );
  },

  get: async (id: string): Promise<Feedback> => {
    return apiFetch<Feedback>(`${API_BASE}/feedback/${id}`);
  },

  create: async (input: CreateFeedbackInput): Promise<Feedback> => {
    return apiFetch<Feedback>(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: UpdateFeedbackInput): Promise<Feedback> => {
    return apiFetch<Feedback>(`${API_BASE}/feedback/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  delete: async (id: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/feedback/${id}`, {
      method: 'DELETE',
    });
  },

  getAnalytics: async (filters?: FeedbackAnalyticsFilters): Promise<FeedbackAnalytics> => {
    return apiFetch<FeedbackAnalytics>(
      `${API_BASE}/feedback/analytics${buildParams((filters ?? {}) as Record<string, unknown>)}`
    );
  },

  listUnresolved: async (limit?: number): Promise<Feedback[]> => {
    const query = limit ? `?limit=${limit}` : '';
    return apiFetch<Feedback[]>(`${API_BASE}/feedback/unresolved${query}`);
  },
};
