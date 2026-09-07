/**
 * Shared API client for CLI and MCP
 */

import { ApiError, safeApiDetails, safeApiText } from './api-errors.js';
export { ApiError, formatApiError } from './api-errors.js';
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

export interface ApiClientOptions {
  timeoutMs?: number;
}
export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}
export const DEFAULT_API_TIMEOUT_MS = 30_000;

function requestTimeout(value: number | undefined): number {
  const timeout = value ?? Number(getEnv('VK_API_TIMEOUT_MS') ?? DEFAULT_API_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    throw new Error('API timeout must be an integer from 1 to 2147483647 milliseconds');
  }
  return timeout;
}

async function withDeadline<T>(
  options: ApiRequestOptions,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const caller = options.signal;
  caller?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(caller?.reason);
  caller?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (caller?.aborted) throw caller.reason;
    if (timedOut)
      throw new ApiError(
        `Request exceeded ${timeoutMs} ms. Check server availability or set an explicit longer timeout. Mutations are not retried.`,
        { code: 'TIMEOUT' }
      );
    throw error;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}

/** A finite deadline covers both response headers and the response body. No automatic retries. */
export function createApiClient(
  baseUrl = DEFAULT_BASE,
  apiKey = getEnv('VK_API_KEY'),
  defaults: ApiClientOptions = {}
) {
  const defaultTimeout = requestTimeout(defaults.timeoutMs);
  return async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const { timeoutMs: override, ...request } = options;
    const headers = buildApiHeaders(options.headers, apiKey);
    const secrets = Object.entries(headers)
      .filter(([key]) => key === 'x-api-key' || key === 'authorization')
      .flatMap(([, value]) => [value, value.replace(/^Bearer\s+/i, '')]);
    return withDeadline(options, requestTimeout(override ?? defaultTimeout), async (signal) => {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`, { ...request, signal, headers });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ApiError(
          'Cannot reach the API server. Check VK_API_URL and server availability.',
          { code: 'NETWORK_ERROR' }
        );
      }
      if (res.status === 204) return undefined as T;
      let body: unknown;
      try {
        body = await res.json();
      } catch (error) {
        if (signal.aborted) throw error;
        if (res.ok)
          throw new ApiError('API returned an invalid JSON response.', {
            status: res.status,
            code: 'INVALID_RESPONSE',
          });
      }
      if (!res.ok || isErrorEnvelope(body)) {
        const envelope = isErrorEnvelope(body) ? body.error : null;
        const legacy = isRecord(body) ? body : {};
        const rawMessage =
          envelope?.message ?? (typeof legacy.error === 'string' ? legacy.error : legacy.message);
        const rawCode = envelope?.code ?? legacy.code;
        const retryAfter = res.headers.get('retry-after');
        const details = safeApiDetails(envelope?.details ?? legacy.details, secrets);
        throw new ApiError(
          safeApiText(
            typeof rawMessage === 'string' ? rawMessage : `API request failed (${res.status})`,
            secrets
          ),
          {
            status: res.status,
            code:
              typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode)
                ? rawCode
                : 'API_ERROR',
            details: retryAfter
              ? {
                  ...(isRecord(details) && !Array.isArray(details) ? details : {}),
                  retryAfter: safeApiText(retryAfter, secrets),
                }
              : details,
          }
        );
      }
      if (isSuccessEnvelope<T>(body)) return body.data;
      return body as T;
    });
  };
}

export function createGuardedApiClient(
  baseUrl = DEFAULT_BASE,
  apiKey = getEnv('VK_API_KEY'),
  defaults: ApiClientOptions = {}
) {
  const rawApi = createApiClient(baseUrl, apiKey, defaults);
  const defaultTimeout = requestTimeout(defaults.timeoutMs);
  const assertPermission = createApiPermissionGuard((options) =>
    rawApi<ClientAuthContext>('/api/auth/context', options)
  );
  return async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return withDeadline(
      options,
      requestTimeout(options.timeoutMs ?? defaultTimeout),
      async (signal) => {
        await assertPermission(path, { ...options, signal });
        signal.throwIfAborted();
        return rawApi<T>(path, { ...options, signal });
      }
    );
  };
}

/**
 * Default API client using environment variable or localhost
 * Uses typeof check to avoid ReferenceError in browser environments
 */
export const API_BASE = (typeof process !== 'undefined' && process.env?.VK_API_URL) || DEFAULT_BASE;
export const api = createApiClient(API_BASE);

/**
 * Find a task by exact ID or an unambiguous ID suffix. Blank and ambiguous
 * identifiers are rejected before a caller can mutate an unintended task.
 * @param id - Full or partial task ID
 * @param apiClient - Optional custom API client (defaults to shared api client)
 * @returns Task if found, null otherwise
 */
export async function findTask(id: string, apiClient = api): Promise<Task | null> {
  if (!id.trim()) throw new Error('Task identifier must not be empty or whitespace');
  const tasks = await apiClient<Task[]>('/api/tasks');
  const exact = tasks.find((task) => task.id === id);
  if (exact) return exact;
  const candidates = tasks.filter((task) => task.id.endsWith(id));
  if (candidates.length > 1) {
    const ids = candidates.map((task) => JSON.stringify(task.id)).sort();
    throw new Error(
      `Ambiguous task identifier ${JSON.stringify(id)}; use an exact ID: ${ids.join(', ')}`
    );
  }
  return candidates[0] ?? null;
}
