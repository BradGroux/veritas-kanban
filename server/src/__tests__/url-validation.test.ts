import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

const mockLookup = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

import { safeFetch, validateWebhookUrl } from '../utils/url-validation.js';

async function listenLocalServer(
  handler: Parameters<typeof createServer>[0],
  host = '127.0.0.1'
): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, host, resolve);
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

  it('allows loopback addresses when localhost destinations are explicitly allowed', async () => {
    const { server, port } = await listenLocalServer((_req, res) => {
      res.writeHead(202, { 'content-type': 'text/plain' });
      res.end('accepted');
    });

    try {
      const response = await safeFetch(
        `http://127.0.0.1:${port}/hook`,
        { method: 'POST', body: 'payload' },
        { allowHttp: true, allowLocalhost: true }
      );

      expect(response?.status).toBe(202);
      await expect(response?.text()).resolves.toBe('accepted');
    } finally {
      await closeServer(server);
    }
  });

  it('connects to an explicitly allowed bracketed IPv6 loopback address', async () => {
    const { server, port } = await listenLocalServer((req, res) => {
      expect(req.headers.host).toBe(`[::1]:${port}`);
      res.writeHead(202, { 'content-type': 'text/plain' });
      res.end('accepted-ipv6');
    }, '::1');

    try {
      const response = await safeFetch(
        `http://[::1]:${port}/hook`,
        { method: 'POST', body: 'payload' },
        { allowHttp: true, allowLocalhost: true }
      );

      expect(response?.status).toBe(202);
      await expect(response?.text()).resolves.toBe('accepted-ipv6');
      expect(mockLookup).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it.each(['10.0.0.1', '172.16.0.1', '192.168.0.1'])(
    'does not treat allowLocalhost as private-network approval for %s',
    async (address) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const url = `http://${address}/hook`;
      const validationOptions = { allowHttp: true, allowLocalhost: true, logFailures: false };

      expect(validateWebhookUrl(url, validationOptions).valid).toBe(false);
      await expect(safeFetch(url, undefined, validationOptions)).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it('does not treat allowLocalhost as DNS approval for resolved private addresses', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mockLookup.mockResolvedValue([{ address: '192.168.1.20', family: 4 }]);

    await expect(
      safeFetch('http://hooks.example.test/hook', undefined, {
        allowHttp: true,
        allowLocalhost: true,
        logFailures: false,
      })
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['10.0.0.1', '172.16.0.1', '192.168.0.1', '[fd00::1]'])(
    'allows only private network classes through the narrow private-network option for %s',
    (address) => {
      expect(
        validateWebhookUrl(`https://${address}/hook`, {
          allowPrivateNetwork: true,
          logFailures: false,
        }).valid
      ).toBe(true);
    }
  );

  it.each([
    '169.254.170.2',
    '100.64.0.1',
    '[fe80::1]',
    '[fe90::1]',
    '[fea0::1]',
    '[febf::1]',
    '[::ffff:a9fe:a9fe]',
  ])(
    'keeps link-local and CGNAT destinations blocked under private-network approval for %s',
    (address) => {
      expect(
        validateWebhookUrl(`https://${address}/hook`, {
          allowPrivateNetwork: true,
          logFailures: false,
        }).valid
      ).toBe(false);
    }
  );

  it.each([
    ['[::ffff:7f00:1]', { allowLocalhost: true }],
    ['[::ffff:a00:1]', { allowPrivateNetwork: true }],
  ])('requires the matching opt-in for IPv4-mapped IPv6 destination %s', (address, allowance) => {
    const url = `http://${address}/hook`;
    expect(validateWebhookUrl(url, { allowHttp: true, logFailures: false }).valid).toBe(false);
    expect(
      validateWebhookUrl(url, { allowHttp: true, logFailures: false, ...allowance }).valid
    ).toBe(true);
  });

  it('blocks deprecated IPv4-compatible IPv6 local addresses', () => {
    expect(
      validateWebhookUrl('http://[::7f00:1]/hook', {
        allowHttp: true,
        logFailures: false,
      }).valid
    ).toBe(false);
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
