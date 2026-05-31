import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientPermissionError, createGuardedApiClient } from '../utils/api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MCP API permission preflight', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('blocks write tools before calling the target endpoint when the token lacks write scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        role: 'agent',
        isLocalhost: false,
        permissions: ['task:read', 'agent:read'],
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createGuardedApiClient('http://vk.test', 'agent-key');

    await expect(
      api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ label: 'blocked' }),
      })
    ).rejects.toBeInstanceOf(ClientPermissionError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://vk.test/api/auth/context');
  });

  it('allows read tools when the token has the mapped read permission', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          role: 'agent',
          isLocalhost: false,
          permissions: ['report:read'],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ total: 0 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createGuardedApiClient('http://vk.test', 'agent-key');
    const summary = await api<{ total: number }>('/api/summary');

    expect(summary).toEqual({ total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('http://vk.test/api/summary');
  });
});
