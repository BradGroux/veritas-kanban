/**
 * Generic managed list API helper for CRUD endpoints with consistent patterns.
 */
import { API_BASE, apiFetch } from './helpers';

export const managedList = {
  /**
   * Create API helpers for a managed list endpoint
   */
  createHelpers: <T>(endpoint: string) => ({
    list: async (includeHidden = false): Promise<T[]> => {
      const url = includeHidden
        ? `${API_BASE}${endpoint}?includeHidden=true`
        : `${API_BASE}${endpoint}`;
      return apiFetch<T[]>(url);
    },

    get: async (id: string): Promise<T> => {
      return apiFetch<T>(`${API_BASE}${endpoint}/${id}`);
    },

    create: async (input: any): Promise<T> => {
      return apiFetch<T>(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    },

    update: async (id: string, patch: any): Promise<T> => {
      return apiFetch<T>(`${API_BASE}${endpoint}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    },

    remove: async (id: string, force = false): Promise<void> => {
      const url = force
        ? `${API_BASE}${endpoint}/${id}?force=true`
        : `${API_BASE}${endpoint}/${id}`;
      return apiFetch<void>(url, { credentials: 'include', method: 'DELETE' });
    },

    canDelete: async (
      id: string
    ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> => {
      return apiFetch(`${API_BASE}${endpoint}/${id}/can-delete`);
    },

    reorder: async (orderedIds: string[]): Promise<T[]> => {
      return apiFetch<T[]>(`${API_BASE}${endpoint}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
    },
  }),
};
