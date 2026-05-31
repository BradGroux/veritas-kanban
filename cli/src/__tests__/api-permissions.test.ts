import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientPermissionError, createGuardedApiClient } from '../utils/api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CLI API permission preflight', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('blocks mutating commands before calling the target endpoint when the token is read-only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        role: 'read-only',
        isLocalhost: false,
        permissions: ['task:read'],
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createGuardedApiClient('http://vk.test', 'reader-key');

    await expect(
      api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'blocked' }),
      })
    ).rejects.toBeInstanceOf(ClientPermissionError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://vk.test/api/auth/context');
  });

  it('allows read commands when the token has the mapped read permission', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          role: 'read-only',
          isLocalhost: false,
          permissions: ['task:read'],
        })
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 'task_1', title: 'allowed' }]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createGuardedApiClient('http://vk.test', 'reader-key');
    const tasks = await api<{ id: string; title: string }[]>('/api/tasks');

    expect(tasks).toEqual([{ id: 'task_1', title: 'allowed' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('http://vk.test/api/tasks');
  });
});
