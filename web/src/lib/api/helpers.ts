/**
 * Shared API helpers and base URL.
 */
import { API_BASE } from '../config';

export { API_BASE };

/**
 * Standard API envelope shapes returned by the server.
 */
interface ApiSuccessEnvelope<T = unknown> {
  success: true;
  data: T;
  meta: { timestamp: string; requestId?: string };
}

interface ApiErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: unknown };
  meta: { timestamp: string; requestId?: string };
}

type ApiEnvelope<T = unknown> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

/**
 * Type guard: returns true when the payload looks like a response envelope.
 */
function isEnvelope(data: unknown): data is ApiEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    'success' in data &&
    typeof (data as Record<string, unknown>).success === 'boolean' &&
    'meta' in data
  );
}

export async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);

  // Unwrap the standard envelope
  if (isEnvelope(body)) {
    if (!body.success) {
      // Error envelope — throw with the server-provided message
      const errMsg = body.error?.message || `HTTP ${response.status}`;
      const err = new Error(errMsg) as Error & { code?: string; details?: unknown };
      err.code = body.error?.code;
      err.details = body.error?.details;
      throw err;
    }
    // Success envelope — return unwrapped data
    return body.data as T;
  }

  // Non-envelope response (e.g., legacy or non-API endpoint)
  if (!response.ok) {
    const errBody = body as Record<string, unknown> | null;
    throw new Error(
      (errBody && typeof errBody.error === 'string' ? errBody.error : null) ||
        `HTTP ${response.status}`
    );
  }

  return body as T;
}

/**
 * Convenience wrapper: fetch + handleResponse in one call.
 * Use this in hooks instead of raw `fetch` + `response.json()`.
 */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  // When deployed under a sub-path, prefix absolute paths with BASE_URL
  // so /api/v1/tasks becomes e.g. /kanban/api/v1/tasks.
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const fullUrl = base && url.startsWith('/') ? base + url : url;
  const response = await fetch(fullUrl, {
    credentials: 'include',
    ...init,
  });
  return handleResponse<T>(response);
}
