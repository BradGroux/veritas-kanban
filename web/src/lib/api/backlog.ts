/**
 * Backlog API endpoints: CRUD, promote, demote operations.
 */
import type { Task, CreateTaskInput } from '@veritas-kanban/shared';
import { API_BASE, handleResponse } from './helpers';

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
    const response = await fetch(url);
    return handleResponse<Task[]>(response);
  },

  getCount: async (): Promise<number> => {
    const response = await fetch(`${API_BASE}/backlog/count`);
    const data = await handleResponse<{ count: number }>(response);
    return data.count;
  },

  get: async (id: string): Promise<Task> => {
    const response = await fetch(`${API_BASE}/backlog/${id}`);
    return handleResponse<Task>(response);
  },

  create: async (input: CreateTaskInput): Promise<Task> => {
    const response = await fetch(`${API_BASE}/backlog`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<Task>(response);
  },

  update: async (id: string, updates: Partial<Task>): Promise<Task> => {
    const response = await fetch(`${API_BASE}/backlog/${id}`, {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return handleResponse<Task>(response);
  },

  delete: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/backlog/${id}`, {
      credentials: 'include',
      method: 'DELETE',
    });
    return handleResponse<void>(response);
  },

  promote: async (id: string): Promise<Task> => {
    const response = await fetch(`${API_BASE}/backlog/${id}/promote`, {
      credentials: 'include',
      method: 'POST',
    });
    return handleResponse<Task>(response);
  },

  bulkPromote: async (ids: string[]): Promise<{ promoted: string[]; failed: string[] }> => {
    const response = await fetch(`${API_BASE}/backlog/bulk-promote`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    return handleResponse<{ promoted: string[]; failed: string[] }>(response);
  },

  demote: async (id: string): Promise<Task> => {
    const response = await fetch(`${API_BASE}/tasks/${id}/demote`, {
      credentials: 'include',
      method: 'POST',
    });
    return handleResponse<Task>(response);
  },
};
