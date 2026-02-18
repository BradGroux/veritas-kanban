import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

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
    fetchSpy.mockRestore();
  });
});
