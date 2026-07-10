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

async function loadRouteModule() {
  vi.resetModules();
  return import('../../routes/agent-status.js');
}

async function makeApp(withInjectedConfig: boolean) {
  const { agentStatusRoutes, initAgentStatus, setAgentStatusConfigService } =
    await loadRouteModule();
  const app = express();
  app.use(express.json());

  const wss = { clients: new Set() } as unknown as WebSocketServer;
  initAgentStatus(wss);

  if (withInjectedConfig) {
    const { ConfigService } = await import('../../services/config-service.js');
    const sharedConfig = new ConfigService();
    // Simulate the async startup path: setAgentStatusConfigService is called
    // after the IIFE completes, not at initAgentStatus time.
    setAgentStatusConfigService(sharedConfig);
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
    disposeCallCount = 0;

    const app = await makeApp(true);
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
    expect(disposeCallCount).toBe(0);
  });

  it('disposes a fallback ConfigService when no singleton is injected', async () => {
    constructorCallCount = 0;
    disposeCallCount = 0;

    // Fresh module import keeps configServiceRef null and exercises fallback branch.
    const app = await makeApp(false);

    await request(app)
      .post('/api/agent/delegation-violation')
      .send({ agent: 'VERITAS', action: 'direct-code-edit' })
      .expect(200);

    expect(constructorCallCount).toBe(1);
    expect(disposeCallCount).toBe(1);
  });

  it('returns 200 with enforced:false when enforcement is disabled', async () => {
    const app = await makeApp(true);
    const res = await request(app)
      .post('/api/agent/delegation-violation')
      .send({ agent: 'VERITAS', action: 'direct-code-edit', taskId: 'task-123' })
      .expect(200);

    expect(res.body.enforced).toBe(false);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 for invalid request body', async () => {
    const app = await makeApp(true);
    await request(app)
      .post('/api/agent/delegation-violation')
      .send({ notAValidField: true })
      .expect(400);
  });
});
