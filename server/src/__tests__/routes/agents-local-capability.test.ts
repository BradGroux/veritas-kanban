import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext, AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';

const { mockStartAgent, mockStopAgent } = vi.hoisted(() => ({
  mockStartAgent: vi.fn(),
  mockStopAgent: vi.fn(),
}));

vi.mock('../../services/clawdbot-agent-service.js', () => ({
  AgentReadinessError: class AgentReadinessError extends Error {
    readiness: unknown;
  },
  clawdbotAgentService: {
    startAgent: mockStartAgent,
    stopAgent: mockStopAgent,
    completeAgent: vi.fn(),
    getAgentStatus: vi.fn(),
    listPendingRequests: vi.fn(),
    listAttempts: vi.fn(),
    getAttemptLog: vi.fn(),
  },
}));

import { agentRoutes } from '../../routes/agents.js';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    role: 'agent',
    isLocalhost: false,
    authMethod: 'device-session',
    permissions: ['agent:write'],
    clientMode: 'desktop-remote',
    capabilities: ['desktop:remote', 'agent:run:scoped'],
    ...overrides,
  };
}

function createApp(authContext: AuthContext | undefined) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = authContext;
    next();
  });
  app.use('/api/agents', agentRoutes);
  app.use(errorHandler);
  return app;
}

describe('agent local capability enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartAgent.mockResolvedValue({ taskId: 'task_1', agent: 'codex', status: 'running' });
    mockStopAgent.mockResolvedValue(undefined);
  });

  it('rejects remote sessions without a local-agent capability before starting agents', async () => {
    const response = await request(createApp(auth()))
      .post('/api/agents/task_1/start')
      .send({ agent: 'codex' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Local agent controls are disabled for this session',
    });
    expect(mockStartAgent).not.toHaveBeenCalled();
  });

  it('allows local desktop sessions to start agents', async () => {
    const response = await request(
      createApp(auth({ clientMode: 'desktop-local', capabilities: ['desktop:local'] }))
    )
      .post('/api/agents/task_1/start')
      .send({ agent: 'codex' });

    expect(response.status).toBe(201);
    expect(mockStartAgent).toHaveBeenCalledWith('task_1', 'codex', { overrideReason: undefined });
  });

  it('allows explicitly authorized remote sessions to stop agents', async () => {
    const response = await request(
      createApp(auth({ capabilities: ['desktop:remote', 'agent:run:local'] }))
    )
      .post('/api/agents/task_1/stop')
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stopped: true });
    expect(mockStopAgent).toHaveBeenCalledWith('task_1');
  });
});
