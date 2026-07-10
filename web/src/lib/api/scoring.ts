import type {
  CreateScoringProfileInput,
  EvaluationRequest,
  EvaluationResult,
  ScoringProfile,
  UpdateScoringProfileInput,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export const scoringApi = {
  listProfiles: async (): Promise<ScoringProfile[]> => {
    return apiFetch<ScoringProfile[]>(`${API_BASE}/scoring/profiles`);
  },

  getProfile: async (id: string): Promise<ScoringProfile> => {
    return apiFetch<ScoringProfile>(`${API_BASE}/scoring/profiles/${id}`);
  },

  createProfile: async (input: CreateScoringProfileInput): Promise<ScoringProfile> => {
    return apiFetch<ScoringProfile>(`${API_BASE}/scoring/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  updateProfile: async (id: string, input: UpdateScoringProfileInput): Promise<ScoringProfile> => {
    return apiFetch<ScoringProfile>(`${API_BASE}/scoring/profiles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  deleteProfile: async (id: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/scoring/profiles/${id}`, {
      method: 'DELETE',
    });
  },

  evaluate: async (input: EvaluationRequest): Promise<EvaluationResult> => {
    return apiFetch<EvaluationResult>(`${API_BASE}/scoring/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  getHistory: async (filters?: {
    profileId?: string;
    agent?: string;
    taskId?: string;
    limit?: number;
  }): Promise<EvaluationResult[]> => {
    const params = new URLSearchParams();
    if (filters?.profileId) params.set('profileId', filters.profileId);
    if (filters?.agent) params.set('agent', filters.agent);
    if (filters?.taskId) params.set('taskId', filters.taskId);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const query = params.toString();
    return apiFetch<EvaluationResult[]>(`${API_BASE}/scoring/history${query ? `?${query}` : ''}`);
  },
};
