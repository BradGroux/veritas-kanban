import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
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
