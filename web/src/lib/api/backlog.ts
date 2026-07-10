/**
 * Backlog API endpoints: CRUD, promote, demote operations.
 */
import type { Task, CreateTaskInput } from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export interface BacklogListResponse {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

export interface BacklogFilterOptions {
  project?: string;
  type?: string;
  search?: string;
  limit?: number;
  page?: number;
}

export const backlogApi = {
  list: async (options: BacklogFilterOptions = {}): Promise<Task[]> => {
    const params = new URLSearchParams();
    if (options.project) params.append('project', options.project);
    if (options.type) params.append('type', options.type);
    if (options.search) params.append('search', options.search);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.page) params.append('page', options.page.toString());

    const url = `${API_BASE}/backlog${params.toString() ? `?${params.toString()}` : ''}`;
    return apiFetch<Task[]>(url);
  },

  getCount: async (): Promise<number> => {
    const data = await apiFetch<{ count: number }>(`${API_BASE}/backlog/count`);
    return data.count;
  },

  get: async (id: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/backlog/${id}`);
  },

  create: async (input: CreateTaskInput): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/backlog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, updates: Partial<Task>): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/backlog/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  },

  delete: async (id: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/backlog/${id}`, {
      method: 'DELETE',
    });
  },

  promote: async (id: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/backlog/${id}/promote`, {
      method: 'POST',
    });
  },

  bulkPromote: async (ids: string[]): Promise<{ promoted: string[]; failed: string[] }> => {
    return apiFetch<{ promoted: string[]; failed: string[] }>(`${API_BASE}/backlog/bulk-promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  },

  demote: async (id: string): Promise<Task> => {
    return apiFetch<Task>(`${API_BASE}/tasks/${id}/demote`, {
      method: 'POST',
    });
  },

  bulkDemote: async (
    ids: string[]
  ): Promise<{ demoted: string[]; count: number; failed: string[] }> => {
    return apiFetch(`${API_BASE}/backlog/bulk-demote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  },
};
