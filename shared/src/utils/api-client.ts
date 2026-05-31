/**
 * Shared API client for CLI and MCP
 */

import type { Task } from '../types/task.types.js';
import { createApiPermissionGuard, type ClientAuthContext } from './api-permissions.js';
export {
  ClientPermissionError,
  createApiPermissionGuard,
  getApiPermissionRequirement,
  hasClientPermission,
  type ApiPermissionRequirement,
  type ClientAuthActorType,
  type ClientAuthContext,
  type ClientAuthMethod,
  type ClientAuthPermission,
  type ClientAuthRole,
} from './api-permissions.js';

const DEFAULT_BASE = 'http://localhost:3001';

/** Standard API response envelope */
interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

interface ApiErrorEnvelope {
  success: false;
  error: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  meta?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  return isRecord(value) && value.success === false && isRecord(value.error);
}

function isSuccessEnvelope<T>(value: unknown): value is ApiSuccessEnvelope<T> {
  return isRecord(value) && value.success === true && 'data' in value;
}

function getEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  const normalized: Record<string, string> = {};

  if (!headers) {
    return normalized;
  }

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key.toLowerCase()] = value;
    });
    return normalized;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    normalized[key.toLowerCase()] = value;
  }

  return normalized;
}

export function buildApiHeaders(headers?: HeadersInit, apiKey = getEnv('VK_API_KEY')) {
  const normalized = normalizeHeaders(headers);
  const hasAuthHeader = 'authorization' in normalized || 'x-api-key' in normalized;

  return {
    'content-type': 'application/json',
    ...normalized,
    ...(apiKey && !hasAuthHeader ? { 'x-api-key': apiKey } : {}),
  };
}

/**
 * Create an API client instance
 * @param baseUrl - Base URL for the API (default: http://localhost:3001)
 * @returns API client function
 */
export function createApiClient(baseUrl = DEFAULT_BASE, apiKey = getEnv('VK_API_KEY')) {
  return async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: buildApiHeaders(options?.headers, apiKey),
    });

    if (!res.ok) {
      const error = (await res.json().catch(() => ({ error: res.statusText }))) as unknown;

      if (isErrorEnvelope(error)) {
        throw new Error(error.error.message || `API error: ${res.status}`);
      }

      const legacyError = isRecord(error) && typeof error.error === 'string' ? error.error : null;
      const legacyMessage =
        isRecord(error) && typeof error.message === 'string' ? error.message : null;

      throw new Error(legacyError || legacyMessage || `API error: ${res.status}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const body = await res.json();

    // Unwrap standard API envelope { success, data, meta }
    if (isSuccessEnvelope<T>(body)) {
      return body.data;
    }

    return body as T;
  };
}

export function createGuardedApiClient(baseUrl = DEFAULT_BASE, apiKey = getEnv('VK_API_KEY')) {
  const rawApi = createApiClient(baseUrl, apiKey);
  const assertPermission = createApiPermissionGuard(() =>
    rawApi<ClientAuthContext>('/api/auth/context')
  );

  return async function api<T>(path: string, options?: RequestInit): Promise<T> {
    await assertPermission(path, options);
    return rawApi<T>(path, options);
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
