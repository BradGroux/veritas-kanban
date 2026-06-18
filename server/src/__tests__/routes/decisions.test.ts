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

const mockDecisionReviewService = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  recordInitialResponse: vi.fn(),
  recordCritique: vi.fn(),
  finalize: vi.fn(),
  cancel: vi.fn(),
  exportMarkdown: vi.fn(),
}));

vi.mock('../../services/decision-service.js', () => ({
  getDecisionService: () => mockDecisionService,
}));

vi.mock('../../services/decision-review-service.js', () => ({
  getDecisionReviewService: () => mockDecisionReviewService,
}));

import { decisionRoutes } from '../../routes/decisions.js';

describe('Decision Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecisionReviewService.exportMarkdown.mockReturnValue('# Decision Review');
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

  it('POST /api/decisions/reviews creates a decision review session', async () => {
    mockDecisionReviewService.create.mockResolvedValue({
      id: 'decision_review_1',
      taskId: 'task_123',
      status: 'collecting',
    });

    const response = await request(app)
      .post('/api/decisions/reviews')
      .send({
        taskId: 'task_123',
        title: 'Review launch approach',
        prompt: 'Which launch path should we choose?',
        context: 'Two options are available.',
        participants: [
          { id: 'architect', label: 'Architect' },
          { id: 'reviewer', label: 'Reviewer' },
        ],
      });

    expect(response.status).toBe(201);
    expect(mockDecisionReviewService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_123',
        participants: expect.arrayContaining([
          expect.objectContaining({ id: 'architect' }),
          expect.objectContaining({ id: 'reviewer' }),
        ]),
      })
    );
  });

  it('records responses, critiques, and finalizes review sessions before decision id routes', async () => {
    mockDecisionReviewService.recordInitialResponse.mockResolvedValue({ id: 'decision_review_1' });
    mockDecisionReviewService.recordCritique.mockResolvedValue({ id: 'decision_review_1' });
    mockDecisionReviewService.finalize.mockResolvedValue({
      id: 'decision_review_1',
      status: 'synthesized',
      finalPacket: { decisionId: 'decision_1', workProductId: 'wp_1' },
    });

    const response = await request(app)
      .post('/api/decisions/reviews/decision_review_1/responses')
      .send({ participantId: 'architect', response: 'Use staged rollout.' });
    const critique = await request(app)
      .post('/api/decisions/reviews/decision_review_1/critiques')
      .send({ participantId: 'reviewer', round: 1, response: 'Call out rollback risk.' });
    const finalize = await request(app)
      .post('/api/decisions/reviews/decision_review_1/finalize')
      .send({
        recommendation: 'Use staged rollout.',
        assumptions: ['Traffic is moderate'],
        risks: ['Rollback gap'],
        validationPlan: ['Run smoke tests'],
        followUpTasks: ['Write rollout issue'],
      });

    expect(response.status).toBe(200);
    expect(critique.status).toBe(200);
    expect(finalize.status).toBe(200);
    expect(mockDecisionReviewService.recordInitialResponse).toHaveBeenCalledWith(
      'decision_review_1',
      expect.objectContaining({ participantId: 'architect' })
    );
    expect(mockDecisionReviewService.recordCritique).toHaveBeenCalledWith(
      'decision_review_1',
      expect.objectContaining({ round: 1 })
    );
    expect(mockDecisionReviewService.finalize).toHaveBeenCalledWith(
      'decision_review_1',
      expect.objectContaining({ recommendation: 'Use staged rollout.' })
    );
  });

  it('GET /api/decisions/reviews/:id/export returns markdown', async () => {
    mockDecisionReviewService.get.mockResolvedValue({ id: 'decision_review_1' });

    const response = await request(app).get('/api/decisions/reviews/decision_review_1/export');

    expect(response.status).toBe(200);
    expect(response.header['content-type']).toContain('text/markdown');
    expect(response.text).toBe('# Decision Review');
  });
});
