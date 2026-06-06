/**
 * Tests for lib/api/helpers.ts — handleResponse envelope unwrapping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_BASE, apiFetch, handleResponse } from '@/lib/api/helpers';
import { normalizeApiBase } from '@/lib/config';

// ── Helpers ──────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function brokenJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  } as unknown as Response;
}

// ── Tests ────────────────────────────────────────────────────

describe('handleResponse', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns undefined for 204 No Content', async () => {
    const response = { ok: true, status: 204, json: vi.fn() } as unknown as Response;
    const result = await handleResponse<void>(response);
    expect(result).toBeUndefined();
    // json() should NOT be called for 204
    expect(response.json).not.toHaveBeenCalled();
  });

  it('unwraps a success envelope and returns data', async () => {
    const body = {
      success: true,
      data: { id: '1', title: 'Hello' },
      meta: { timestamp: '2025-01-01T00:00:00Z' },
    };
    const result = await handleResponse<{ id: string; title: string }>(jsonResponse(body));
    expect(result).toEqual({ id: '1', title: 'Hello' });
  });

  it('throws with server message for error envelope', async () => {
    const body = {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Task not found' },
      meta: { timestamp: '2025-01-01T00:00:00Z' },
    };
    await expect(handleResponse(jsonResponse(body, 404))).rejects.toThrow('Task not found');
  });

  it('includes code and details on error envelope errors', async () => {
    const body = {
      success: false,
      error: { code: 'VALIDATION', message: 'Bad input', details: { field: 'title' } },
      meta: { timestamp: '2025-01-01T00:00:00Z' },
    };
    try {
      await handleResponse(jsonResponse(body, 400));
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const e = err as Error & { code?: string; details?: unknown };
      expect(e.code).toBe('VALIDATION');
      expect(e.details).toEqual({ field: 'title' });
    }
  });

  it('falls through to non-envelope path for non-ok response', async () => {
    const body = { error: 'Internal Server Error' };
    await expect(handleResponse(jsonResponse(body, 500))).rejects.toThrow('Internal Server Error');
  });

  it('preserves code and details for non-envelope errors', async () => {
    const body = {
      code: 'CONFLICT',
      message: 'Task changed',
      details: { currentRevision: 4 },
    };

    try {
      await handleResponse(jsonResponse(body, 409));
      expect.fail('Should have thrown');
    } catch (err: unknown) {
      const e = err as Error & { code?: string; details?: unknown };
      expect(e.message).toBe('Task changed');
      expect(e.code).toBe('CONFLICT');
      expect(e.details).toEqual({ currentRevision: 4 });
    }
  });

  it('uses HTTP status for non-ok non-envelope response without error string', async () => {
    const body = { some: 'data' };
    await expect(handleResponse(jsonResponse(body, 502))).rejects.toThrow('HTTP 502');
  });

  it('returns raw body for non-envelope OK response', async () => {
    const body = [1, 2, 3];
    const result = await handleResponse<number[]>(jsonResponse(body));
    expect(result).toEqual([1, 2, 3]);
  });

  it('handles null body from broken json gracefully for non-ok', async () => {
    // When json() throws, body is null; should throw "HTTP {status}"
    await expect(handleResponse(brokenJsonResponse(500))).rejects.toThrow('HTTP 500');
  });

  it('returns null body as-is for ok response with broken json', async () => {
    const result = await handleResponse(brokenJsonResponse(200));
    expect(result).toBeNull();
  });

  it('apiFetch routes /api paths through the configured API base once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })));

    await apiFetch('/api/tasks');
    await apiFetch(`${API_BASE}/metrics`);

    expect(fetch).toHaveBeenNthCalledWith(1, `${API_BASE}/tasks`, expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, `${API_BASE}/metrics`, expect.any(Object));
  });

  it('normalizes a pure API origin to the /api base path', () => {
    expect(normalizeApiBase('http://127.0.0.1:3101')).toBe('http://127.0.0.1:3101/api');
    expect(normalizeApiBase('https://example.com/')).toBe('https://example.com/api');
    expect(normalizeApiBase('/kanban/api')).toBe('/kanban/api');
    expect(normalizeApiBase('https://example.com/custom-api')).toBe(
      'https://example.com/custom-api'
    );
  });
});
