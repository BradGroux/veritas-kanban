import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopBridgeHandlers } from '../bridge.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));
const transport = globalThis.fetch;
afterEach(() => vi.unstubAllGlobals());
const handlers = () => createDesktopBridgeHandlers({} as never, {} as never, true, '6.1.7');

async function fixture(
  run: (origin: string, hits: string[]) => Promise<void>,
  location?: string,
  statusCode = 302
) {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    if (request.url?.startsWith('/redirect')) {
      response.writeHead(statusCode, { Location: location ?? '/trap' });
      response.end();
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          request.url?.includes('exchange')
            ? { secret: 'synthetic-session' }
            : { authenticated: true }
        )
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('remote connection transport policy', () => {
  it.each([301, 302, 303, 307, 308])(
    'does not follow a %s redirect for status, credentials, or pairing',
    async (code) => {
      for (const auth of [
        {},
        { serverToken: 'synthetic-token' },
        { pairingPayload: 'synthetic-code' },
      ]) {
        await fixture(
          async (origin, hits) => {
            // Map only the selected synthetic HTTPS origin to the local fixture.
            // Node fetch itself handles the response and redirect policy.
            vi.stubGlobal('fetch', (_url: URL, init: RequestInit) =>
              transport(`${origin}/redirect`, init)
            );
            const result = await handlers().validateConnectionConfig({
              mode: 'remote',
              serverUrl: 'https://remote.example',
              ...auth,
            });
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(hits).toEqual([`${'pairingPayload' in auth ? 'POST' : 'GET'} /redirect`]);
          },
          undefined,
          code
        );
      }
    }
  );
  it.each([
    'http://example.test/next',
    'http://127.0.0.1/next',
    'http://10.0.0.1/next',
    'http://169.254.169.254/next',
  ])('rejects redirect target %s without issuing a second request', async (location) => {
    for (const auth of [{}, { pairingPayload: 'synthetic-code' }]) {
      await fixture(
        async (origin, hits) => {
          vi.stubGlobal('fetch', (_url: URL, init: RequestInit) => {
            // Fail before transport if the guard regresses: never contact a real target.
            expect(init.redirect).toBe('error');
            return transport(`${origin}/redirect`, init);
          });
          const result = await handlers().validateConnectionConfig({
            mode: 'remote',
            serverUrl: 'https://remote.example',
            ...auth,
          });
          expect(result.valid).toBe(false);
          expect(hits).toHaveLength(1);
        },
        location,
        307
      );
    }
  });
  it('preserves direct status, bearer authentication, and pairing followed by auth', async () => {
    await fixture(async (origin, hits) => {
      const requests: RequestInit[] = [];
      vi.stubGlobal('fetch', (url: URL, init: RequestInit) => {
        requests.push(init);
        return transport(new URL(url.pathname, origin), init);
      });
      for (const auth of [
        {},
        { serverToken: 'synthetic-token' },
        { pairingPayload: 'synthetic-code' },
      ]) {
        await expect(
          handlers().validateConnectionConfig({
            mode: 'remote',
            serverUrl: 'https://remote.example',
            ...auth,
          })
        ).resolves.toMatchObject({ valid: true, errors: [] });
      }
      expect(hits).toEqual([
        'GET /api/auth/status',
        'GET /api/auth/context',
        'POST /api/auth/device-pairing/exchange',
        'GET /api/auth/context',
      ]);
      expect(requests[1].headers).toEqual({ Authorization: 'Bearer synthetic-token' });
      expect(requests[2].body).toBe(JSON.stringify({ code: 'synthetic-code' }));
      expect(requests[3].headers).toEqual({ Authorization: 'Bearer synthetic-session' });
    });
  });
});
