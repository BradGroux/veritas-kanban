import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AuthPermission, AuthenticatedRequest } from '../../middleware/auth.js';
import { diffAccess } from '../../routes/v1/permissions.js';
import { errorHandler } from '../../middleware/error-handler.js';

const { mockDiffService, mockCodexReviewService } = vi.hoisted(() => ({
  mockDiffService: {
    getDiffSummary: vi.fn(),
    getFileDiff: vi.fn(),
    getFullDiff: vi.fn(),
  },
  mockCodexReviewService: {
    reviewTask: vi.fn(),
  },
}));

vi.mock('../../services/diff-service.js', () => ({
  DiffService: function () {
    return mockDiffService;
  },
}));

vi.mock('../../services/codex-review-service.js', () => ({
  CodexReviewService: function () {
    return mockCodexReviewService;
  },
}));

import { diffRoutes } from '../../routes/diff.js';

describe('Codex review route', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/diff', diffRoutes);
    app.use(errorHandler);
  });

  it('runs a Codex review for a task diff', async () => {
    mockCodexReviewService.reviewTask.mockResolvedValue({
      taskId: 'task_123',
      attemptId: 'attempt_review',
      decision: 'changes-requested',
      summary: 'Found one issue.',
      findings: [{ file: 'src/app.ts', line: 12, severity: 'high', title: 'Bug', message: 'Fix' }],
      comments: [],
      threadId: 'thread_review',
    });

    const response = await request(app).post('/api/diff/task_123/codex-review').send({
      model: 'gpt-5.5',
      instructions: 'Focus on regressions.',
    });

    expect(response.status).toBe(201);
    expect(response.body.decision).toBe('changes-requested');
    expect(mockCodexReviewService.reviewTask).toHaveBeenCalledWith({
      taskId: 'task_123',
      model: 'gpt-5.5',
      instructions: 'Focus on regressions.',
    });
  });

  it('rejects invalid request bodies', async () => {
    const response = await request(app).post('/api/diff/task_123/codex-review').send({
      save: 'yes',
    });

    expect(response.status).toBe(400);
    expect(mockCodexReviewService.reviewTask).not.toHaveBeenCalled();
  });
});

describe('mounted review permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  function appFor(permissions: AuthPermission[]) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).auth = { role: 'agent', isLocalhost: false, permissions };
      next();
    });
    app.use(['/api/diff', '/api/v1/diff'], diffAccess, diffRoutes);
    app.use(errorHandler);
    return app;
  }

  for (const prefix of ['/api/diff', '/api/v1/diff']) {
    for (const suffix of ['codex-review', 'CODEX-REVIEW', 'CoDeX-ReViEw/']) {
      it(`enforces execution authority at ${prefix}/:taskId/${suffix}`, async () => {
        const taskId = 'task_MixedCase';
        const path = `${prefix}/${taskId}/${suffix}`;
        const denied = await request(appFor(['task:write']))
          .post(path)
          .send({});
        expect(denied.status).toBe(403);
        expect(mockCodexReviewService.reviewTask).not.toHaveBeenCalled();
        mockCodexReviewService.reviewTask.mockResolvedValue({ taskId, decision: 'approved' });
        const allowed = await request(appFor(['workflow:execute']))
          .post(path)
          .send({});
        expect(allowed.status).toBe(201);
        expect(mockCodexReviewService.reviewTask).toHaveBeenCalledExactlyOnceWith({ taskId });
      });
    }
  }
});
