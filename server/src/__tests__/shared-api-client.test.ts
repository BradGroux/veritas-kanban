import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  createGuardedApiClient,
  formatApiError,
} from '../../../shared/src/utils/api-client.js';

describe('shared API deadlines and errors', () => {
  let server: Server;
  let origin: string;
  let requests: string[];
  beforeEach(async () => {
    requests = [];
    server = createServer((req, res) => {
      requests.push(req.url ?? '');
      if (req.url === '/body-stall') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{');
        return;
      }
      if (req.url === '/stall' || req.url === '/api/auth/context') return;
      if (req.url === '/slow') {
        setTimeout(() => {
          res.end(JSON.stringify({ ok: true }));
        }, 80);
        return;
      }
      const status = Number(req.url?.slice(1));
      res.writeHead(status || 200, {
        'Content-Type': 'application/json',
        ...(status === 429 ? { 'Retry-After': '12' } : {}),
      });
      res.end(
        JSON.stringify(
          status
            ? {
                success: false,
                error: {
                  code:
                    status === 409 ? 'CONFLICT' : status === 401 ? 'UNAUTHORIZED' : 'RATE_LIMITED',
                  message: 'Request failed with fixture-api-key',
                  details: {
                    currentRevision: 3,
                    password: 'do-not-forward',
                    current: { description: 'private task body' },
                    message: 'Bearer fixture-api-key',
                  },
                },
              }
            : { success: true, data: { ok: true } }
        )
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it.each(['/stall', '/body-stall'])(
    'bounds a real nonresponding server at %s without retries',
    async (path) => {
      const api = createApiClient(origin, undefined, { timeoutMs: 100 });
      const started = performance.now();
      await expect(api(path, { method: 'POST' })).rejects.toMatchObject({ code: 'TIMEOUT' });
      expect(performance.now() - started).toBeLessThan(1500);
      expect(requests).toEqual([path]);
    }
  );

  it('honors a longer explicit deadline', async () => {
    const api = createApiClient(origin, undefined, { timeoutMs: 20 });
    expect(await api('/slow', { timeoutMs: 500 })).toEqual({ ok: true });
    expect(requests).toEqual(['/slow']);
  });

  it('cancels permission preflight and does not send the mutation', async () => {
    const api = createGuardedApiClient(origin, undefined, { timeoutMs: 1000 });
    const controller = new AbortController();
    const pending = api('/api/tasks', { method: 'POST', signal: controller.signal });
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(requests).toEqual(['/api/auth/context']));
    controller.abort();
    await failure;
    expect(requests).toEqual(['/api/auth/context']);
  });

  it('does not send a request for a signal already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createApiClient(origin)('/stall', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toEqual([]);
  });

  it.each([409, 401, 429])('retains safe structured HTTP %s metadata', async (status) => {
    const api = createApiClient(origin, 'fixture-api-key');
    const error = await api(`/${status}`).catch((value) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(status);
    expect(error.details.currentRevision).toBe(3);
    const output = formatApiError(error, true);
    expect(JSON.parse(output).error.status).toBe(status);
    expect(output).not.toContain('fixture-api-key');
    expect(output).not.toContain('do-not-forward');
    expect(output).not.toContain('private task body');
    if (status === 429) expect(error.details.retryAfter).toBe('12');
  });

  it('does not cache a failed preflight or retry it automatically', async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: ['task:read'] })))
      .mockResolvedValueOnce(new Response('[]'));
    vi.stubGlobal('fetch', transport);
    const api = createGuardedApiClient(origin);
    await expect(api('/api/tasks')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await api('/api/tasks')).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('clears request timers and cancellation listeners on success and HTTP errors', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}'))
        .mockResolvedValueOnce(new Response('{}', { status: 409 }))
    );
    const api = createApiClient(origin);
    await api('/success', { signal: controller.signal });
    expect(vi.getTimerCount()).toBe(0);
    await expect(api('/error', { signal: controller.signal })).rejects.toBeInstanceOf(ApiError);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
