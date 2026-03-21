import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/error-handler.js';

const mockDecisionService = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  getChain: vi.fn(),
  updateAssumption: vi.fn(),
}));

vi.mock('../../services/decision-service.js', () => ({
  getDecisionService: () => mockDecisionService,
}));

import { decisionRoutes } from '../../routes/decisions.js';

describe('Decision Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/decisions', decisionRoutes);
    app.use(errorHandler);
  });

  it('POST /api/decisions creates a decision', async () => {
    mockDecisionService.create.mockResolvedValue({
      id: 'decision_1',
      inputContext: 'task blocked on flaky test',
      outputAction: 'defer merge and gather logs',
      assumptions: [],
      confidenceLevel: 72,
      riskScore: 64,
      agentId: 'codex',
      taskId: 'task_123',
      timestamp: '2025-02-01T00:00:00.000Z',
    });

    const response = await request(app)
      .post('/api/decisions')
      .send({
        inputContext: 'task blocked on flaky test',
        outputAction: 'defer merge and gather logs',
        assumptions: ['test failure is nondeterministic'],
        confidenceLevel: 72,
        riskScore: 64,
        agentId: 'codex',
        taskId: 'task_123',
      });

    expect(response.status).toBe(201);
    expect(mockDecisionService.create).toHaveBeenCalled();
  });

  it('GET /api/decisions applies filters', async () => {
    mockDecisionService.list.mockResolvedValue([]);

    const response = await request(app).get(
      '/api/decisions?agent=codex&minConfidence=50&maxRisk=80'
    );

    expect(response.status).toBe(200);
    expect(mockDecisionService.list).toHaveBeenCalledWith({
      agent: 'codex',
      minConfidence: 50,
      maxRisk: 80,
    });
  });

  it('GET /api/decisions/:id returns the decision with its chain', async () => {
    mockDecisionService.getById.mockResolvedValue({
      id: 'decision_1',
      inputContext: 'ctx',
      outputAction: 'action',
      assumptions: [],
      confidenceLevel: 60,
      riskScore: 40,
      agentId: 'codex',
      taskId: 'task_123',
      timestamp: '2025-02-01T00:00:00.000Z',
    });
    mockDecisionService.getChain.mockResolvedValue([{ id: 'decision_root' }, { id: 'decision_1' }]);

    const response = await request(app).get('/api/decisions/decision_1');

    expect(response.status).toBe(200);
    expect(response.body.chain).toHaveLength(2);
  });

  it('PATCH /api/decisions/:id/assumptions/:idx updates assumption status', async () => {
    mockDecisionService.updateAssumption.mockResolvedValue({
      id: 'decision_1',
      assumptions: [{ text: 'logs are complete', status: 'validated' }],
    });

    const response = await request(app)
      .patch('/api/decisions/decision_1/assumptions/0')
      .send({ status: 'validated', note: 'Confirmed in CI rerun' });

    expect(response.status).toBe(200);
    expect(mockDecisionService.updateAssumption).toHaveBeenCalledWith('decision_1', 0, {
      status: 'validated',
      note: 'Confirmed in CI rerun',
    });
  });

  it('rejects invalid confidence input', async () => {
    const response = await request(app).post('/api/decisions').send({
      inputContext: 'ctx',
      outputAction: 'action',
      confidenceLevel: 120,
      riskScore: 40,
      agentId: 'codex',
      taskId: 'task_123',
    });

    expect(response.status).toBe(400);
  });
});
