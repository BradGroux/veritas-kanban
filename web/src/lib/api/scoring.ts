import type {
  CreateScoringProfileInput,
  EvaluationRequest,
  EvaluationResult,
  ScoringProfile,
  UpdateScoringProfileInput,
} from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

export const scoringApi = {
  listProfiles: async (): Promise<ScoringProfile[]> => {
    const response = await fetch(`${API_BASE}/scoring/profiles`);
    return handleResponse<ScoringProfile[]>(response);
  },

  getProfile: async (id: string): Promise<ScoringProfile> => {
    const response = await fetch(`${API_BASE}/scoring/profiles/${id}`);
    return handleResponse<ScoringProfile>(response);
  },

  createProfile: async (input: CreateScoringProfileInput): Promise<ScoringProfile> => {
    const response = await fetch(`${API_BASE}/scoring/profiles`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<ScoringProfile>(response);
  },

  updateProfile: async (id: string, input: UpdateScoringProfileInput): Promise<ScoringProfile> => {
    const response = await fetch(`${API_BASE}/scoring/profiles/${id}`, {
      credentials: 'include',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<ScoringProfile>(response);
  },

  deleteProfile: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/scoring/profiles/${id}`, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  evaluate: async (input: EvaluationRequest): Promise<EvaluationResult> => {
    const response = await fetch(`${API_BASE}/scoring/evaluate`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<EvaluationResult>(response);
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
    const response = await fetch(`${API_BASE}/scoring/history${query ? `?${query}` : ''}`);
    return handleResponse<EvaluationResult[]>(response);
  },
};
