import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { errorHandler } from '../../middleware/error-handler.js';
import type { AuthPermission, AuthenticatedRequest } from '../../middleware/auth.js';

const { mockCodexHealthService, mockConfigService, mockContextProviderHealthService } = vi.hoisted(
  () => ({
    mockConfigService: {
      getFeatureSettings: vi.fn(),
      updateFeatureSettings: vi.fn(),
    },
    mockCodexHealthService: {
      getHealth: vi.fn(),
    },
    mockContextProviderHealthService: {
      getHealth: vi.fn(),
    },
  })
);

function permissionsFromHeader(value: string | undefined): AuthPermission[] {
  if (!value) return ['settings:read'];
  return value
    .split(',')
    .map((permission) => permission.trim())
    .filter((permission): permission is AuthPermission => Boolean(permission));
}

function featureSettingsWithCredentialedUrls() {
  return {
    ...DEFAULT_FEATURE_SETTINGS,
    notifications: {
      ...DEFAULT_FEATURE_SETTINGS.notifications,
      webhookUrl: 'https://hooks.example.test/failures?token=notification-secret',
    },
    hooks: {
      ...DEFAULT_FEATURE_SETTINGS.hooks,
      enabled: true,
      onCreated: {
        enabled: true,
        webhook: 'https://hooks.example.test/created?token=hook-secret',
      },
    },
    squadWebhook: {
      ...DEFAULT_FEATURE_SETTINGS.squadWebhook,
      enabled: true,
      mode: 'openclaw' as const,
      url: 'https://hooks.example.test/squad?token=squad-secret',
      secret: 'squad-webhook-secret-000000',
      openclawGatewayUrl: 'https://gateway.example.test/wake?token=gateway-secret',
      openclawGatewayToken: 'openclaw-gateway-token-000000',
    },
  };
}

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
    return mockConfigService;
  },
}));

import { settingsRoutes } from '../../routes/settings.js';

describe('Settings Codex health route', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req: AuthenticatedRequest, _res, next) => {
      const permissions = permissionsFromHeader(req.header('x-test-permissions') ?? undefined);
      req.auth = {
        role: permissions.includes('*') ? 'admin' : 'read-only',
        isLocalhost: false,
        permissions,
      };
      next();
    });
    app.use('/api/settings', settingsRoutes);
    app.use(errorHandler);
  });

  it('redacts credential-bearing feature setting URLs for settings readers', async () => {
    mockConfigService.getFeatureSettings.mockResolvedValue(featureSettingsWithCredentialedUrls());

    const response = await request(app).get('/api/settings/features');

    expect(response.status).toBe(200);
    expect(response.body.notifications.webhookUrl).toBeUndefined();
    expect(response.body.notifications.webhookUrlConfigured).toBe(true);
    expect(response.body.notifications.webhookUrlRedacted).toBe(true);
    expect(response.body.hooks.onCreated.webhook).toBeUndefined();
    expect(response.body.hooks.onCreated.webhookConfigured).toBe(true);
    expect(response.body.hooks.onCreated.webhookRedacted).toBe(true);
    expect(response.body.squadWebhook.url).toBeUndefined();
    expect(response.body.squadWebhook.urlConfigured).toBe(true);
    expect(response.body.squadWebhook.urlRedacted).toBe(true);
    expect(response.body.squadWebhook.openclawGatewayUrl).toBeUndefined();
    expect(response.body.squadWebhook.openclawGatewayUrlConfigured).toBe(true);
    expect(response.body.squadWebhook.openclawGatewayUrlRedacted).toBe(true);
    expect(response.body.squadWebhook.secret).toBeUndefined();
    expect(response.body.squadWebhook.secretConfigured).toBe(true);
    expect(response.body.squadWebhook.secretRedacted).toBe(true);
    expect(response.body.squadWebhook.openclawGatewayToken).toBeUndefined();
    expect(response.body.squadWebhook.openclawGatewayTokenConfigured).toBe(true);
    expect(response.body.squadWebhook.openclawGatewayTokenRedacted).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('notification-secret');
    expect(JSON.stringify(response.body)).not.toContain('hook-secret');
    expect(JSON.stringify(response.body)).not.toContain('squad-secret');
    expect(JSON.stringify(response.body)).not.toContain('gateway-secret');
    expect(JSON.stringify(response.body)).not.toContain('openclaw-gateway-token');
  });

  it('returns webhook URLs to settings writers while keeping scalar secrets redacted', async () => {
    mockConfigService.getFeatureSettings.mockResolvedValue(featureSettingsWithCredentialedUrls());

    const response = await request(app)
      .get('/api/settings/features')
      .set('x-test-permissions', 'settings:write');

    expect(response.status).toBe(200);
    expect(response.body.notifications.webhookUrl).toContain('notification-secret');
    expect(response.body.notifications.webhookUrlRedacted).toBe(false);
    expect(response.body.hooks.onCreated.webhook).toContain('hook-secret');
    expect(response.body.hooks.onCreated.webhookRedacted).toBe(false);
    expect(response.body.squadWebhook.url).toContain('squad-secret');
    expect(response.body.squadWebhook.urlRedacted).toBe(false);
    expect(response.body.squadWebhook.openclawGatewayUrl).toContain('gateway-secret');
    expect(response.body.squadWebhook.openclawGatewayUrlRedacted).toBe(false);
    expect(response.body.squadWebhook.secret).toBeUndefined();
    expect(response.body.squadWebhook.secretConfigured).toBe(true);
    expect(response.body.squadWebhook.secretRedacted).toBe(true);
    expect(response.body.squadWebhook.openclawGatewayToken).toBeUndefined();
    expect(response.body.squadWebhook.openclawGatewayTokenConfigured).toBe(true);
    expect(response.body.squadWebhook.openclawGatewayTokenRedacted).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('squad-webhook-secret');
    expect(JSON.stringify(response.body)).not.toContain('openclaw-gateway-token');
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
