import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { authorizeWrite } from '../../middleware/auth.js';
import { agentRoutingAccess, costPredictionAccess } from '../../routes/v1/permissions.js';
import { errorHandler } from '../../middleware/error-handler.js';

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  predict: vi.fn(),
  record: vi.fn(),
  getTask: vi.fn(),
}));
vi.mock('../../services/agent-routing-service.js', () => ({
  getAgentRoutingService: () => ({ resolveAgentWithTrace: mocks.route }),
}));
vi.mock('../../services/cost-prediction-service.js', () => ({
  getCostPredictionService: () => ({ predict: mocks.predict }),
}));
vi.mock('../../services/governance-trace-service.js', () => ({
  getGovernanceTraceService: () => ({ record: mocks.record }),
}));
vi.mock('../../services/task-service.js', () => ({
  getTaskService: () => ({ getTask: mocks.getTask }),
}));
import { agentRoutingRoutes } from '../../routes/agent-routing.js';
import { costPredictionRoutes } from '../../routes/cost-prediction.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role: 'agent',
      isLocalhost: false,
      permissions: ['agent:read', 'task:write'],
    };
    next();
  });
  app.use(authorizeWrite);
  app.use(['/api/agents', '/api/v1/agents'], agentRoutingAccess, agentRoutingRoutes);
  app.use(
    ['/api/cost-prediction', '/api/v1/cost-prediction'],
    costPredictionAccess,
    costPredictionRoutes
  );
  app.use(errorHandler);
  return app;
}

describe('bounded metadata previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.mockResolvedValue({ result: { agent: 'fixture' }, trace: {} });
    mocks.predict.mockResolvedValue({ estimatedCost: 1 });
    mocks.record.mockResolvedValue({ id: 'trace_fixture' });
  });

  for (const prefix of ['/api', '/api/v1']) {
    for (const endpoint of ['/agents/route', '/cost-prediction/predict']) {
      it(`rejects invalid counts before evaluation at ${prefix}${endpoint}`, async () => {
        const app = createApp();
        // 501 proves the bound without risking a large allocation on a regressed build.
        for (const subtaskCount of [-1, 0.5, 501, '5', null]) {
          const response = await request(app)
            .post(prefix + endpoint)
            .send({ subtaskCount });
          expect(response.status).toBe(400);
          expect(mocks.route).not.toHaveBeenCalled();
          expect(mocks.predict).not.toHaveBeenCalled();
        }
      });

      it(`passes valid counts without materializing subtasks at ${prefix}${endpoint}`, async () => {
        const app = createApp();
        for (const subtaskCount of [0, 1, 500]) {
          await request(app)
            .post(prefix + endpoint)
            .send({ subtaskCount })
            .expect(200);
          const call =
            endpoint === '/agents/route' ? mocks.route.mock.lastCall : mocks.predict.mock.lastCall;
          expect(call?.[0].subtaskCount).toBe(subtaskCount);
          expect(call?.[0]).not.toHaveProperty('subtasks');
        }
      });
    }
  }
});
