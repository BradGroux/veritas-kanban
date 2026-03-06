import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

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

describe('integrations routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    app = express();
    app.use('/api/integrations', integrationsRoutes);
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

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.data.n8n.status).toBe('down');
    expect(res.body.data.n8n.error).toBe('blocked host');
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('marks service up when reachable', async () => {
    mockGetConfig.mockResolvedValue({
      coolify: {
        services: {
          n8n: { url: 'https://example.com', token: '' },
        },
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.data.n8n.status).toBe('up');
    expect(mockLookup).toHaveBeenCalledWith('example.com', { all: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' })
    );
    fetchSpy.mockRestore();
  });
});
