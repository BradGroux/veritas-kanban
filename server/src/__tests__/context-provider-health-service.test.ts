import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { ContextProviderHealthService } from '../services/context-provider-health-service.js';

describe('ContextProviderHealthService', () => {
  it('maps OpenClaw config posture without exposing secrets', async () => {
    const getConfig = vi.fn().mockResolvedValue({
      agents: [
        {
          type: 'openclaw',
          name: 'OpenClaw',
          command: 'openclaw',
          args: ['run', '--approval-never'],
          enabled: true,
          provider: 'openclaw',
        },
      ],
    } as Partial<AppConfig>);
    const getFeatureSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_FEATURE_SETTINGS,
      squadWebhook: {
        ...DEFAULT_FEATURE_SETTINGS.squadWebhook,
        enabled: true,
        mode: 'openclaw',
        openclawGatewayUrl: 'http://127.0.0.1:18789',
        openclawGatewayToken: 'super-secret-token',
      },
    });
    const getHealth = vi.fn().mockResolvedValue({
      checkedAt: '2026-06-05T00:00:00.000Z',
      cli: { installed: true, authenticated: true },
      sdk: { available: true },
      agents: { codexCli: true, codexSdk: true, codexCloud: false, enabled: ['codex'] },
      ready: { cli: true, sdk: true, cloud: false, overall: true },
      recommendations: [],
    });

    const service = new ContextProviderHealthService({
      configService: { getConfig, getFeatureSettings },
      codexHealthService: { getHealth },
    });

    const result = await service.getHealth();
    const openClaw = result.providers.find((provider) => provider.id === 'openclaw');

    expect(openClaw).toMatchObject({
      state: 'unknown',
      risk: 'risky',
      boundary: 'local',
      writeCapability: true,
    });
    expect(openClaw?.postureFlags).toContain('Risky exec/elevated argument detected');
    expect(JSON.stringify(openClaw)).not.toContain('super-secret-token');
    expect(result.summary.risky).toBe(1);
  });
});
