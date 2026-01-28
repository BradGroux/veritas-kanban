/**
 * Generic managed list API helper for CRUD endpoints with consistent patterns.
 */
import { API_BASE, handleResponse } from './helpers';

export const managedList = {
  /**
   * Create API helpers for a managed list endpoint
   */
  createHelpers: <T>(endpoint: string) => ({
    list: async (includeHidden = false): Promise<T[]> => {
      const url = includeHidden
        ? `${API_BASE}${endpoint}?includeHidden=true`
        : `${API_BASE}${endpoint}`;
      const response = await fetch(url);
      return handleResponse<T[]>(response);
    },

    get: async (id: string): Promise<T> => {
      const response = await fetch(`${API_BASE}${endpoint}/${id}`);
      return handleResponse<T>(response);
    },

    create: async (input: any): Promise<T> => {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return handleResponse<T>(response);
    },

    update: async (id: string, patch: any): Promise<T> => {
      const response = await fetch(`${API_BASE}${endpoint}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return handleResponse<T>(response);
    },

    remove: async (id: string, force = false): Promise<void> => {
      const url = force
        ? `${API_BASE}${endpoint}/${id}?force=true`
        : `${API_BASE}${endpoint}/${id}`;
      const response = await fetch(url, { method: 'DELETE' });
      return handleResponse<void>(response);
    },

    canDelete: async (
      id: string
    ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
      const response = await fetch(`${API_BASE}${endpoint}/${id}/can-delete`);
      return handleResponse(response);
    },

    reorder: async (orderedIds: string[]): Promise<T[]> => {
      const response = await fetch(`${API_BASE}${endpoint}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      return handleResponse<T[]>(response);
    },
  }),
};
