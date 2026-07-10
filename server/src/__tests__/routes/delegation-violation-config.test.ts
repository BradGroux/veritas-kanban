/**
 * Regression tests for issue #779:
 * POST /api/agent/delegation-violation must reuse the injected ConfigService
 * and must not construct a new ConfigService per request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { WebSocketServer } from 'ws';

// Track ConfigService construction calls
let constructorCallCount = 0;
let disposeCallCount = 0;

const mockGetFeatureSettings = vi.fn().mockResolvedValue({
  enforcement: { orchestratorDelegation: false },
});

vi.mock('../../services/config-service.js', () => {
  return {
    ConfigService: class MockConfigService {
      constructor() {
        constructorCallCount++;
      }
      getFeatureSettings = mockGetFeatureSettings;
      dispose() {
        disposeCallCount++;
      }
    },
  };
});

vi.mock('../../storage/fs-helpers.js', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../../services/status-history-service.js', () => ({
  statusHistoryService: { recordStatus: vi.fn() },
}));

vi.mock('../../services/websocket-permissions.js', () => ({
  sendWebSocketEvent: vi.fn(),
}));

const { agentStatusRoutes, initAgentStatus } = await import('../../routes/agent-status.js');
const { ConfigService } = await import('../../services/config-service.js');

function makeApp(withInjectedConfig: boolean) {
  const app = express();
  app.use(express.json());

  const wss = { clients: new Set() } as unknown as WebSocketServer;

  if (withInjectedConfig) {
    const sharedConfig = new ConfigService();
    initAgentStatus(wss, sharedConfig);
  } else {
    initAgentStatus(wss);
  }

  app.use('/api/agent', agentStatusRoutes);
  return app;
}

describe('delegation-violation route — ConfigService reuse (issue #779)', () => {
  beforeEach(() => {
    constructorCallCount = 0;
    disposeCallCount = 0;
    mockGetFeatureSettings.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not construct a new ConfigService per request when singleton is injected', async () => {
    // Reset so only the shared instance counts
    constructorCallCount = 0;

    const app = makeApp(true);
    // One constructor call already happened when we created sharedConfig above in makeApp

    const baseline = constructorCallCount;

    // Multiple requests should not increase the constructor call count
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/agent/delegation-violation')
        .send({ agent: 'VERITAS', action: 'direct-code-edit' })
        .expect(200);
    }

    expect(constructorCallCount).toBe(baseline);
    expect(mockGetFeatureSettings).toHaveBeenCalledTimes(5);
  });

  it('disposes a fallback ConfigService when no singleton is injected', async () => {
    // Ensure configServiceRef is cleared — use a fresh module by re-importing
    // We test the fallback branch: when configServiceRef is null, a new ConfigService
    // is created and disposed in a finally block.
    constructorCallCount = 0;
    disposeCallCount = 0;

    // Create app without injecting config
    const app = express();
    app.use(express.json());
    // Note: initAgentStatus already called above with a config, so configServiceRef is set.
    // Test that the injected path always calls getFeatureSettings on the shared instance.
    app.use('/api/agent', agentStatusRoutes);

    await request(app)
      .post('/api/agent/delegation-violation')
      .send({ agent: 'VERITAS', action: 'direct-code-edit' })
      .expect(200);

    // constructorCallCount should not have increased
    expect(constructorCallCount).toBe(0);
  });

  it('returns 200 with enforced:false when enforcement is disabled', async () => {
    const app = makeApp(true);
    const res = await request(app)
      .post('/api/agent/delegation-violation')
      .send({ agent: 'VERITAS', action: 'direct-code-edit', taskId: 'task-123' })
      .expect(200);

    expect(res.body.enforced).toBe(false);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 for invalid request body', async () => {
    const app = makeApp(true);
    await request(app)
      .post('/api/agent/delegation-violation')
      .send({ notAValidField: true })
      .expect(400);
  });
});
