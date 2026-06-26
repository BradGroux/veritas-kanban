import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const { mockCeremonyService } = vi.hoisted(() => ({
  mockCeremonyService: {
    list: vi.fn(),
    create: vi.fn(),
    complete: vi.fn(),
  },
}));

vi.mock('../../services/ceremony-service.js', () => ({
  getCeremonyService: () => mockCeremonyService,
}));

import { ceremonyRoutes } from '../../routes/ceremonies.js';

interface TestAuthRequest extends Request {
  auth?: { role: string; userId?: string; permissions: string[] };
}

interface TestError extends Error {
  statusCode?: number;
  code?: string;
}

const requirement = {
  id: 'ceremony_1',
  kind: 'design_review',
  status: 'pending',
  enforcementMode: 'block',
  title: 'Design review required before completion',
  reason: 'Task is high-risk, multi-agent, or review-mode work.',
  target: { taskId: 'task_20260626_ceremony' },
  trigger: 'task.completion',
  participants: [{ role: 'coordinator' }],
  requiredArtifacts: ['decision-packet', 'risk-list', 'action-items'],
  artifacts: [],
  actionItems: [],
  createdAt: '2026-06-26T12:00:00.000Z',
  updatedAt: '2026-06-26T12:00:00.000Z',
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: TestAuthRequest, _res: Response, next: NextFunction) => {
    req.auth = { role: 'agent', userId: 'brad', permissions: ['workflow:write'] };
    next();
  });
  app.use('/api/ceremonies', ceremonyRoutes);
  app.use((err: TestError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ code: err.code || 'ERROR', message: err.message });
  });
  return app;
}

describe('ceremony routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCeremonyService.list.mockResolvedValue([requirement]);
    mockCeremonyService.create.mockResolvedValue(requirement);
    mockCeremonyService.complete.mockResolvedValue({ ...requirement, status: 'completed' });
  });

  it('lists ceremony requirements with validated filters', async () => {
    const res = await request(createApp()).get('/api/ceremonies?status=pending&limit=5');

    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('ceremony_1');
    expect(mockCeremonyService.list).toHaveBeenCalledWith({ status: 'pending', limit: 5 });
  });

  it('creates ceremony requirements', async () => {
    const res = await request(createApp())
      .post('/api/ceremonies')
      .send({
        kind: 'design_review',
        enforcementMode: 'block',
        reason: 'Task coordinates multiple agents.',
        target: { taskId: 'task_20260626_ceremony' },
        trigger: 'manual',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('ceremony_1');
    expect(mockCeremonyService.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'design_review', enforcementMode: 'block' })
    );
  });

  it('completes ceremony requirements using the authenticated actor by default', async () => {
    const res = await request(createApp())
      .post('/api/ceremonies/ceremony_1/complete')
      .send({
        artifacts: [
          {
            kind: 'decision-packet',
            title: 'Decision packet',
            body: 'Reviewed the risk list and rollback plan.',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(mockCeremonyService.complete).toHaveBeenCalledWith(
      'ceremony_1',
      expect.objectContaining({ completedBy: 'brad' })
    );
  });

  it('rejects invalid ceremony targets', async () => {
    const res = await request(createApp()).post('/api/ceremonies').send({
      kind: 'design_review',
      reason: 'Missing target.',
      target: {},
      trigger: 'manual',
    });

    expect(res.status).toBe(400);
    expect(mockCeremonyService.create).not.toHaveBeenCalled();
  });
});
