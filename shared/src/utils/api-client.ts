/**
 * Shared API client for CLI and MCP
 */

import type { Task } from '../types/task.types.js';

const DEFAULT_BASE = 'http://localhost:3001';

/** Standard API response envelope */
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Create an API client instance
 * @param baseUrl - Base URL for the API (default: http://localhost:3001)
 * @returns API client function
 */
export function createApiClient(baseUrl = DEFAULT_BASE) {
  return async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const apiKey = typeof process !== 'undefined' ? process.env?.VK_API_KEY : undefined;
    const authHeaders: Record<string, string> = {};
    if (apiKey) {
      authHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const error = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error?: string;
      };
      throw new Error(error.error || `API error: ${res.status}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const body = await res.json();

    // Unwrap standard API envelope { success, data, meta }
    if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
      return (body as ApiEnvelope<T>).data;
    }

    return body as T;
  };
}

/**
 * Default API client using environment variable or localhost
 * Uses typeof check to avoid ReferenceError in browser environments
 */
export const API_BASE = (typeof process !== 'undefined' && process.env?.VK_API_URL) || DEFAULT_BASE;
export const api = createApiClient(API_BASE);

/**
 * Find task by ID (supports partial matching on ID suffix)
 * @param id - Full or partial task ID
 * @param apiClient - Optional custom API client (defaults to shared api client)
 * @returns Task if found, null otherwise
 */
export async function findTask(id: string, apiClient = api): Promise<Task | null> {
  const tasks = await apiClient<Task[]>('/api/tasks');
  return tasks.find((t) => t.id === id || t.id.endsWith(id)) || null;
}
