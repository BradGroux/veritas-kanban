import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

const mockLookup = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

import { safeFetch, validateWebhookUrl } from '../utils/url-validation.js';

async function listenLocalServer(
  handler: Parameters<typeof createServer>[0]
): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port');
  }
  return { server, port: address.port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe('url validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLookup.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks localhost webhook URLs before fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(validateWebhookUrl('https://localhost/hook').valid).toBe(false);
    await expect(safeFetch('https://127.0.0.1/hook')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks hostnames that resolve to private addresses', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mockLookup.mockResolvedValue([{ address: '10.0.0.12', family: 4 }]);

    await expect(safeFetch('https://hooks.example.test/hook')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('pins outbound fetches to the validated DNS answer', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { server, port } = await listenLocalServer((req, res) => {
      expect(req.headers.host).toBe(`hooks.example.test:${port}`);
      res.writeHead(202, { 'content-type': 'text/plain' });
      res.end('accepted');
    });
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    try {
      const response = await safeFetch(
        `http://hooks.example.test:${port}/hook`,
        { method: 'POST', body: 'payload', redirect: 'follow' },
        { allowHttp: true, allowPrivateIp: true }
      );

      expect(response?.status).toBe(202);
      await expect(response?.text()).resolves.toBe('accepted');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('does not follow redirects for allowed outbound fetches', async () => {
    const { server, port } = await listenLocalServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1/admin' });
      res.end();
    });
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    try {
      const response = await safeFetch(`http://hooks.example.test:${port}/hook`, undefined, {
        allowHttp: true,
        allowPrivateIp: true,
      });

      expect(response?.status).toBe(302);
      expect(response?.headers.get('location')).toBe('http://127.0.0.1/admin');
    } finally {
      await closeServer(server);
    }
  });
});
