import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const { mockReflectionService, mockConsolidationService } = vi.hoisted(() => ({
  mockReflectionService: {
    list: vi.fn(),
    create: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    delete: vi.fn(),
    mergeDuplicate: vi.fn(),
  },
  mockConsolidationService: {
    propose: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('../../services/reflection-service.js', () => ({
  getReflectionService: () => mockReflectionService,
}));

vi.mock('../../services/reflection-consolidation-service.js', () => ({
  getReflectionConsolidationService: () => mockConsolidationService,
}));

import { reflectionRoutes } from '../../routes/reflections.js';

interface TestAuthRequest extends Request {
  auth?: { role: string; userId?: string; permissions: string[] };
}

interface TestError extends Error {
  statusCode?: number;
  code?: string;
}

const candidate = {
  id: 'reflection_1',
  status: 'pending',
  category: 'team',
  promotionTarget: 'task-lesson',
  confidence: 0.8,
  source: { kind: 'user-correction', taskId: 'task_20260626_reflect', messageId: 'msg_1' },
  summary: 'Use the live schema first.',
  previousApproach: 'Guessed a field name.',
  correction: 'Inspect source before editing.',
  nextAttempt: 'Read schema and tests before changing code.',
  evidence: [{ kind: 'note', title: 'Correction', content: 'User correction.' }],
  tags: ['workflow'],
  duplicateKey: 'team|task-lesson|schema',
  duplicateCount: 1,
  appliedTargets: [],
  redaction: { redacted: false, notes: [] },
  createdAt: '2026-06-26T12:00:00.000Z',
  updatedAt: '2026-06-26T12:00:00.000Z',
};

const proposal = {
  schemaVersion: 'reflection-consolidation-proposal/v1',
  id: 'reflection_proposal_1',
  domain: { kind: 'workspace-memory', id: 'primary', workspaceId: 'workspace_1' },
  state: 'proposed',
  revision: 1,
  sourceDigest: `sha256:${'a'.repeat(64)}`,
  policy: {
    staleAfterDays: 180,
    unusedAfterDays: 90,
    minimumConfidence: 0.5,
    maxCandidates: 500,
  },
  clusters: [],
  diff: [],
  candidateIds: ['reflection_1'],
  createdAt: '2026-07-25T12:00:00.000Z',
  updatedAt: '2026-07-25T12:00:00.000Z',
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: TestAuthRequest, _res: Response, next: NextFunction) => {
    req.auth = { role: 'agent', userId: 'brad', permissions: ['workflow:write'] };
    next();
  });
  app.use('/api/reflections', reflectionRoutes);
  app.use((err: TestError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ code: err.code || 'ERROR', message: err.message });
  });
  return app;
}

describe('reflection routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReflectionService.list.mockResolvedValue({
      candidates: [candidate],
      duplicateGroups: [],
      total: 1,
    });
    mockReflectionService.create.mockResolvedValue(candidate);
    mockReflectionService.accept.mockResolvedValue({ ...candidate, status: 'accepted' });
    mockReflectionService.reject.mockResolvedValue({ ...candidate, status: 'rejected' });
    mockReflectionService.delete.mockResolvedValue({ ...candidate, status: 'deleted' });
    mockReflectionService.mergeDuplicate.mockResolvedValue({
      ...candidate,
      status: 'deleted',
      mergedInto: 'reflection_0',
    });
    mockConsolidationService.propose.mockResolvedValue(proposal);
    mockConsolidationService.get.mockResolvedValue(proposal);
    mockConsolidationService.list.mockResolvedValue([proposal]);
  });

  it('creates and inspects bounded consolidation proposals', async () => {
    const app = createApp();
    const created = await request(app)
      .post('/api/reflections/consolidation/proposals')
      .send({
        domain: { kind: 'workspace-memory', id: 'primary', workspaceId: 'workspace_1' },
        candidateIds: ['reflection_1'],
      });
    const listed = await request(app).get(
      '/api/reflections/consolidation/proposals?kind=workspace-memory&id=primary&workspaceId=workspace_1'
    );
    const fetched = await request(app).get(
      '/api/reflections/consolidation/proposals/reflection_proposal_1'
    );

    expect(created.status).toBe(201);
    expect(listed.body.proposals).toHaveLength(1);
    expect(fetched.body.id).toBe('reflection_proposal_1');
    expect(mockConsolidationService.propose).toHaveBeenCalledWith(
      expect.objectContaining({ candidateIds: ['reflection_1'] })
    );
  });

  it('lists reflection candidates with validated filters', async () => {
    const res = await request(createApp()).get('/api/reflections?status=pending&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.candidates[0].id).toBe('reflection_1');
    expect(mockReflectionService.list).toHaveBeenCalledWith({ status: 'pending', limit: 5 });
  });

  it('creates candidates using the authenticated actor by default', async () => {
    const res = await request(createApp())
      .post('/api/reflections')
      .send({
        category: 'team',
        source: { kind: 'user-correction', taskId: 'task_20260626_reflect', messageId: 'msg_1' },
        summary: 'Use the live schema first.',
        previousApproach: 'Guessed a field name.',
        correction: 'Inspect source before editing.',
        nextAttempt: 'Read schema and tests before changing code.',
      });

    expect(res.status).toBe(201);
    expect(mockReflectionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'brad' })
    );
  });

  it('accepts, rejects, deletes, and merges candidates with actor defaults', async () => {
    const app = createApp();
    const accept = await request(app).post('/api/reflections/reflection_1/accept').send({});
    const reject = await request(app).post('/api/reflections/reflection_1/reject').send({
      reason: 'Too narrow.',
    });
    const remove = await request(app).delete('/api/reflections/reflection_1').send({});
    const merge = await request(app).post('/api/reflections/reflection_1/merge').send({});

    expect(accept.status).toBe(200);
    expect(reject.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(merge.status).toBe(200);
    expect(mockReflectionService.accept).toHaveBeenCalledWith('reflection_1', {
      reviewedBy: 'brad',
    });
    expect(mockReflectionService.reject).toHaveBeenCalledWith(
      'reflection_1',
      expect.objectContaining({ reviewedBy: 'brad', reason: 'Too narrow.' })
    );
    expect(mockReflectionService.delete).toHaveBeenCalledWith('reflection_1', {
      deletedBy: 'brad',
    });
    expect(mockReflectionService.mergeDuplicate).toHaveBeenCalledWith('reflection_1', {
      mergedBy: 'brad',
    });
  });

  it('rejects candidates without a source identifier', async () => {
    const res = await request(createApp())
      .post('/api/reflections')
      .send({
        category: 'team',
        source: { kind: 'user-correction' },
        summary: 'Use the live schema first.',
        previousApproach: 'Guessed a field name.',
        correction: 'Inspect source before editing.',
        nextAttempt: 'Read schema and tests before changing code.',
      });

    expect(res.status).toBe(400);
    expect(mockReflectionService.create).not.toHaveBeenCalled();
  });
});
