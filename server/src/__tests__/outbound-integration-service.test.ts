import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OutboundIntegrationService } from '../services/outbound-integration-service.js';

const mockLookup = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

function stubGlobalFetch() {
  const fn = vi.fn();
  vi.stubGlobal('fetch', fn);
  return fn;
}

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

describe('OutboundIntegrationService', () => {
  const audit = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    audit.mockClear();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  });

  it('records sanitized endpoints and delivery attempts without exposing secrets', async () => {
    const { server, port } = await listenLocalServer((_req, res) => {
      res.writeHead(202, { 'content-type': 'text/plain' });
      res.end('accepted');
    });
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const service = new OutboundIntegrationService({ persist: false, audit });
    const sanitizedUrl = `http://hook.test:${port}/endpoint`;

    try {
      const result = await service.deliver(
        {
          id: 'squad.webhook',
          type: 'squad-webhook',
          displayName: 'Squad webhook',
          url: `${sanitizedUrl}?token=secret-token`,
          auth: {
            type: 'bearer',
            secretRef: 'featureSettings.squadWebhook.secret',
            hasSecret: true,
          },
          owner: { source: 'feature-settings', resourceId: 'squadWebhook.url' },
          validationOptions: { allowHttp: true, allowPrivateIp: true },
        },
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer raw-token-value',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ok: true }),
          responseBodyLimit: 100,
        }
      );

      expect(result).toMatchObject({ ok: true, status: 'success', responseStatus: 202 });

      const endpoints = await service.listEndpoints();
      expect(endpoints[0]).toMatchObject({
        id: 'squad.webhook',
        url: sanitizedUrl,
        auth: {
          type: 'bearer',
          secretRef: 'featureSettings.squadWebhook.secret',
          hasSecret: true,
        },
      });

      const deliveries = await service.listDeliveries();
      expect(deliveries[0]).toMatchObject({
        endpointId: 'squad.webhook',
        sanitizedUrl,
        status: 'success',
        responseStatus: 202,
        responseClass: '2xx',
      });

      const auditPayload = JSON.stringify(audit.mock.calls);
      expect(auditPayload).not.toContain('raw-token-value');
      expect(auditPayload).not.toContain('secret-token');
    } finally {
      await closeServer(server);
    }
  });

  it('blocks private IP destinations before fetch', async () => {
    const fetchSpy = stubGlobalFetch();
    const service = new OutboundIntegrationService({ persist: false, audit });

    const result = await service.deliver(
      {
        id: 'blocked.private',
        type: 'broadcast-webhook',
        displayName: 'Blocked private endpoint',
        url: 'https://10.0.0.5/hook',
        owner: { source: 'runtime', resourceId: 'test' },
      },
      { method: 'POST' }
    );

    expect(result.status).toBe('blocked');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await service.listDeliveries())[0]).toMatchObject({
      endpointId: 'blocked.private',
      status: 'blocked',
    });
  });

  it('blocks DNS rebinding destinations before fetch', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.10', family: 4 }]);
    const fetchSpy = stubGlobalFetch();
    const service = new OutboundIntegrationService({ persist: false, audit });

    const result = await service.deliver(
      {
        id: 'blocked.dns',
        type: 'policy-webhook',
        displayName: 'Blocked DNS endpoint',
        url: 'https://hook.test/endpoint',
        owner: { source: 'policy', resourceId: 'policy_1' },
      },
      { method: 'POST' }
    );

    expect(result.status).toBe('blocked');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips disabled endpoints and records history', async () => {
    const fetchSpy = stubGlobalFetch();
    const service = new OutboundIntegrationService({ persist: false, audit });

    const result = await service.deliver(
      {
        id: 'disabled.endpoint',
        type: 'failure-alert-webhook',
        displayName: 'Disabled endpoint',
        url: 'https://hook.test/endpoint',
        enabled: false,
        owner: { source: 'feature-settings', resourceId: 'notifications.webhookUrl' },
      },
      { method: 'POST' }
    );

    expect(result.status).toBe('skipped');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await service.listDeliveries())[0]).toMatchObject({
      endpointId: 'disabled.endpoint',
      status: 'skipped',
      error: 'Endpoint disabled',
    });
  });
});
