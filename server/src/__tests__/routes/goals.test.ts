import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';

const goals = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  transition: vi.fn(),
  linkRun: vi.fn(),
}));

vi.mock('../../services/durable-goal-service.js', () => ({
  getDurableGoalService: () => goals,
}));

import { goalRoutes } from '../../routes/goals.js';

const GOAL_ID = 'goal_0123456789abcdef';

function createApp(workspaceId = 'workspace-a'): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role: 'admin',
      isLocalhost: false,
      userId: 'user-brad',
      workspaceId,
    };
    next();
  });
  app.use('/api/goals', goalRoutes);
  app.use(errorHandler);
  return app;
}

describe('durable goal routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists bounded goals inside the authenticated workspace', async () => {
    goals.list.mockResolvedValue([{ id: GOAL_ID, state: 'blocked' }]);

    const response = await request(createApp()).get(
      '/api/goals?state=active&state=blocked&rootTaskId=task-865&limit=25'
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      generatedAt: expect.any(String),
      goals: [{ id: GOAL_ID, state: 'blocked' }],
    });
    expect(goals.list).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      states: ['active', 'blocked'],
      rootTaskId: 'task-865',
      limit: 25,
    });
  });

  it('creates a goal in the authenticated workspace instead of trusting caller identity', async () => {
    goals.create.mockResolvedValue({ id: GOAL_ID, workspaceId: 'workspace-a', state: 'active' });

    const response = await request(createApp())
      .post('/api/goals')
      .send({
        objective: 'Deliver durable goal controls.',
        acceptanceCriteria: ['REST is verified.'],
        root: { kind: 'task', taskId: 'task-865' },
        continuation: { mode: 'manual' },
        completionRequirements: [
          {
            id: 'route-tests',
            description: 'Route tests pass.',
            required: true,
            verificationKind: 'test',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(goals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-a',
        objective: 'Deliver durable goal controls.',
      })
    );
  });

  it('does not expose a goal from another workspace', async () => {
    goals.get.mockResolvedValue({ id: GOAL_ID, workspaceId: 'workspace-b' });

    const response = await request(createApp('workspace-a')).get(`/api/goals/${GOAL_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('derives transition actor and verification timestamps from the server', async () => {
    goals.get.mockResolvedValue({ id: GOAL_ID, workspaceId: 'workspace-a' });
    goals.transition.mockResolvedValue({ id: GOAL_ID, state: 'complete', revision: 2 });

    const response = await request(createApp())
      .post(`/api/goals/${GOAL_ID}/transition`)
      .send({
        expectedRevision: 1,
        state: 'complete',
        reason: 'Focused verification passed.',
        completionEvidence: [
          {
            requirementId: 'route-tests',
            evidenceId: 'ci-1082',
            summary: 'Route tests passed.',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(goals.transition).toHaveBeenCalledWith(GOAL_ID, {
      expectedRevision: 1,
      to: 'complete',
      actorId: 'user-brad',
      reason: 'Focused verification passed.',
      blocker: undefined,
      completionEvidence: [
        {
          requirementId: 'route-tests',
          evidenceId: 'ci-1082',
          summary: 'Route tests passed.',
          verifier: 'user-brad',
          verifiedAt: expect.any(String),
        },
      ],
    });
  });

  it('links a run with exact revision and rejects caller-supplied actor identity', async () => {
    goals.get.mockResolvedValue({ id: GOAL_ID, workspaceId: 'workspace-a' });
    goals.linkRun.mockResolvedValue({ id: GOAL_ID, revision: 3 });

    const linked = await request(createApp()).post(`/api/goals/${GOAL_ID}/runs`).send({
      expectedRevision: 2,
      taskId: 'task-865',
      attemptId: 'attempt-2',
      conversationId: 'conversation-2',
    });
    const spoofed = await request(createApp()).post(`/api/goals/${GOAL_ID}/transition`).send({
      expectedRevision: 3,
      state: 'paused',
      reason: 'Caller attempted identity spoofing.',
      actorId: 'spoofed-admin',
    });

    expect(linked.status).toBe(200);
    expect(goals.linkRun).toHaveBeenCalledWith(GOAL_ID, {
      expectedRevision: 2,
      run: {
        taskId: 'task-865',
        attemptId: 'attempt-2',
        workflowRunId: undefined,
        conversationId: 'conversation-2',
        parentAttemptId: undefined,
      },
    });
    expect(spoofed.status).toBe(400);
    expect(goals.transition).not.toHaveBeenCalled();
  });
});
