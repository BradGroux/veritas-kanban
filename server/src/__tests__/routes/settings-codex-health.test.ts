import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/error-handler.js';

const { mockCodexHealthService, mockContextProviderHealthService } = vi.hoisted(() => ({
  mockCodexHealthService: {
    getHealth: vi.fn(),
  },
  mockContextProviderHealthService: {
    getHealth: vi.fn(),
  },
}));

vi.mock('../../services/codex-health-service.js', () => ({
  CodexHealthService: function () {
    return mockCodexHealthService;
  },
}));

vi.mock('../../services/context-provider-health-service.js', () => ({
  ContextProviderHealthService: function () {
    return mockContextProviderHealthService;
  },
}));

vi.mock('../../services/config-service.js', () => ({
  ConfigService: function () {
    return {
      getFeatureSettings: vi.fn(),
      updateFeatureSettings: vi.fn(),
    };
  },
}));

import { settingsRoutes } from '../../routes/settings.js';

describe('Settings Codex health route', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRoutes);
    app.use(errorHandler);
  });

  it('returns Codex install/auth/profile health', async () => {
    mockCodexHealthService.getHealth.mockResolvedValue({
      checkedAt: '2026-05-06T00:00:00.000Z',
      cli: { installed: true, authenticated: true, version: 'codex-cli 0.128.0' },
      sdk: { available: true },
      agents: { codexCli: true, codexSdk: true, codexCloud: true, enabled: ['codex'] },
      ready: { cli: true, sdk: true, cloud: true, overall: true },
      recommendations: [],
    });

    const response = await request(app).get('/api/settings/codex/health');

    expect(response.status).toBe(200);
    expect(response.body.ready.overall).toBe(true);
    expect(mockCodexHealthService.getHealth).toHaveBeenCalled();
  });

  it('returns context provider health', async () => {
    mockContextProviderHealthService.getHealth.mockResolvedValue({
      checkedAt: '2026-06-05T00:00:00.000Z',
      summary: {
        total: 2,
        connected: 1,
        degraded: 0,
        stale: 0,
        disconnected: 0,
        unknown: 1,
        risky: 1,
        writeCapable: 2,
      },
      providers: [
        {
          id: 'openclaw',
          name: 'OpenClaw',
          provider: 'openclaw',
          state: 'unknown',
          risk: 'risky',
          boundary: 'local',
          readCapability: true,
          writeCapability: true,
          privacyScope: 'Local gateway posture only.',
          lastCheckedAt: '2026-06-05T00:00:00.000Z',
          detail: 'OpenClaw profile detected.',
          tools: ['gateway'],
          postureFlags: ['Risky exec/elevated argument detected'],
          recommendations: ['Review OpenClaw exec/elevated arguments.'],
        },
      ],
    });

    const response = await request(app).get('/api/settings/provider-health');

    expect(response.status).toBe(200);
    expect(response.body.providers[0]).toMatchObject({
      id: 'openclaw',
      risk: 'risky',
    });
    expect(mockContextProviderHealthService.getHealth).toHaveBeenCalled();
  });
});
