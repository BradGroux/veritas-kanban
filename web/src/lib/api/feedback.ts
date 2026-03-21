import type {
  CreateFeedbackInput,
  Feedback,
  FeedbackAnalytics,
  FeedbackAnalyticsFilters,
  FeedbackListFilters,
  UpdateFeedbackInput,
} from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

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
    const response = await fetch(`${API_BASE}/feedback${buildParams(filters ?? {})}`);
    return handleResponse<Feedback[]>(response);
  },

  get: async (id: string): Promise<Feedback> => {
    const response = await fetch(`${API_BASE}/feedback/${id}`);
    return handleResponse<Feedback>(response);
  },

  create: async (input: CreateFeedbackInput): Promise<Feedback> => {
    const response = await fetch(`${API_BASE}/feedback`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<Feedback>(response);
  },

  update: async (id: string, input: UpdateFeedbackInput): Promise<Feedback> => {
    const response = await fetch(`${API_BASE}/feedback/${id}`, {
      credentials: 'include',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<Feedback>(response);
  },

  delete: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/feedback/${id}`, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  getAnalytics: async (filters?: FeedbackAnalyticsFilters): Promise<FeedbackAnalytics> => {
    const response = await fetch(`${API_BASE}/feedback/analytics${buildParams(filters ?? {})}`);
    return handleResponse<FeedbackAnalytics>(response);
  },

  listUnresolved: async (limit?: number): Promise<Feedback[]> => {
    const query = limit ? `?limit=${limit}` : '';
    const response = await fetch(`${API_BASE}/feedback/unresolved${query}`);
    return handleResponse<Feedback[]>(response);
  },
};
