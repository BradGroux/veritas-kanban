import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
}));

const { mockSafeFetch } = vi.hoisted(() => ({
  mockSafeFetch: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

vi.mock('../../utils/url-validation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/url-validation.js')>();
  return {
    ...actual,
    safeFetch: mockSafeFetch,
  };
});

const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
}));

vi.mock('../../services/config-service.js', () => ({
  ConfigService: function () {
    return {
      getConfig: mockGetConfig,
    };
  },
}));

import { integrationsRoutes } from '../../routes/integrations.js';
import { getOutboundIntegrationService } from '../../services/outbound-integration-service.js';

describe('integrations routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
    } as unknown as Response);
    app = express();
    app.use('/api/integrations', integrationsRoutes);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks localhost/private targets (SSRF guard)', async () => {
    mockGetConfig.mockResolvedValue({
      coolify: {
        services: {
          n8n: { url: 'http://127.0.0.1:5678', token: '' },
        },
      },
    });

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.data.n8n.status).toBe('down');
    expect(res.body.data.n8n.error).toBe('blocked host');
  });

  it('blocks DNS resolutions that point to private addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.4', family: 4 }]);
    mockGetConfig.mockResolvedValue({
      coolify: {
        services: {
          n8n: { url: 'https://example.com', token: '' },
        },
      },
    });

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.data.n8n.status).toBe('down');
    expect(res.body.data.n8n.error).toBe('blocked host');
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('marks service up when reachable', async () => {
    mockGetConfig.mockResolvedValue({
      coolify: {
        services: {
          n8n: { url: 'https://example.com', token: '' },
        },
      },
    });

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.data.n8n.status).toBe('up');
    expect(mockLookup).toHaveBeenCalledWith('example.com', { all: true });
    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
      { allowHttp: true }
    );
  });

  it('exposes sanitized outbound endpoint and delivery history', async () => {
    const endpointId = `route-test.${Date.now()}`;
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 202,
      text: vi.fn().mockResolvedValue('accepted'),
    } as unknown as Response);

    const delivery = await getOutboundIntegrationService().deliver(
      {
        id: endpointId,
        type: 'squad-webhook',
        displayName: 'Route test webhook',
        url: 'https://example.com/outbound?token=query-secret',
        auth: {
          type: 'bearer',
          secretRef: 'featureSettings.squadWebhook.secret',
          hasSecret: true,
        },
        owner: { source: 'runtime', resourceId: 'route-test' },
      },
      {
        method: 'POST',
        headers: { Authorization: 'Bearer raw-token-value' },
        body: '{}',
      }
    );

    expect(delivery.ok).toBe(true);

    const endpointsRes = await request(app).get('/api/integrations/outbound/endpoints');
    expect(endpointsRes.status).toBe(200);
    const endpoint = endpointsRes.body.find((entry: { id: string }) => entry.id === endpointId);
    expect(endpoint).toMatchObject({
      id: endpointId,
      url: 'https://example.com/outbound',
      auth: {
        type: 'bearer',
        secretRef: 'featureSettings.squadWebhook.secret',
        hasSecret: true,
      },
    });

    const deliveriesRes = await request(app).get('/api/integrations/outbound/deliveries?limit=10');
    expect(deliveriesRes.status).toBe(200);
    const attempt = deliveriesRes.body.find(
      (entry: { endpointId: string }) => entry.endpointId === endpointId
    );
    expect(attempt).toMatchObject({
      endpointId,
      sanitizedUrl: 'https://example.com/outbound',
      status: 'success',
      responseStatus: 202,
    });

    const responsePayload = JSON.stringify({ endpoint, attempt });
    expect(responsePayload).not.toContain('query-secret');
    expect(responsePayload).not.toContain('raw-token-value');
  });
});
