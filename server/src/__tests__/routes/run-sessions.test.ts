import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../middleware/error-handler.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

const mockRunSessionShareService = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  listEvents: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
  sendMessage: vi.fn(),
  respondToApproval: vi.fn(),
  fork: vi.fn(),
}));

vi.mock('../../services/run-session-share-service.js', () => ({
  getRunSessionShareService: () => mockRunSessionShareService,
}));

import { runSessionRoutes } from '../../routes/run-sessions.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      userId: 'user-721',
      tokenName: 'Brad',
      role: 'admin',
      workspaceId: 'workspace-a',
      authMethod: 'api-token',
      clientMode: req.header('x-client-mode') || undefined,
    };
    next();
  });
  app.use('/api/run-sessions', runSessionRoutes);
  app.use(errorHandler);
  return app;
}

describe('Run Session Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('lists shares with task filters and request workspace actor context', async () => {
    mockRunSessionShareService.list.mockResolvedValue([
      { id: 'run_share_1', taskId: 'task-721', permission: 'view', status: 'active' },
    ]);

    const response = await request(app).get('/api/run-sessions?taskId=task-721&status=active');

    expect(response.status).toBe(200);
    expect(mockRunSessionShareService.list).toHaveBeenCalledWith(
      { taskId: 'task-721', status: 'active' },
      expect.objectContaining({ id: 'user-721', workspaceId: 'workspace-a' })
    );
  });

  it('creates, updates, revokes, messages, approvals, and forks shares', async () => {
    mockRunSessionShareService.create.mockResolvedValue({ id: 'run_share_1' });
    mockRunSessionShareService.update.mockResolvedValue({ id: 'run_share_1', permission: 'edit' });
    mockRunSessionShareService.revoke.mockResolvedValue({ id: 'run_share_1', status: 'revoked' });
    mockRunSessionShareService.sendMessage.mockResolvedValue({ id: 'run_event_msg' });
    mockRunSessionShareService.respondToApproval.mockResolvedValue({ id: 'run_event_approval' });
    mockRunSessionShareService.fork.mockResolvedValue({
      fork: { id: 'run_fork_1' },
      task: { id: 'task-fork' },
    });

    const create = await request(app)
      .post('/api/run-sessions')
      .send({
        taskId: 'task-721',
        permission: 'view',
        mobileSafeApprovalClasses: ['human-review'],
      });
    const update = await request(app).patch('/api/run-sessions/run_share_1').send({
      permission: 'edit',
    });
    const revoke = await request(app).post('/api/run-sessions/run_share_1/revoke').send({
      reason: 'Reviewer rotated out',
    });
    const message = await request(app).post('/api/run-sessions/run_share_1/messages').send({
      message: 'Please continue the focused run.',
    });
    const approval = await request(app)
      .post('/api/run-sessions/run_share_1/approvals')
      .set('x-client-mode', 'mobile-pwa')
      .send({
        actionClass: 'human-review',
        response: 'approved',
      });
    const fork = await request(app).post('/api/run-sessions/run_share_1/fork').send({
      title: 'Fork run session',
      priority: 'high',
    });

    expect(create.status).toBe(201);
    expect(update.status).toBe(200);
    expect(revoke.status).toBe(200);
    expect(message.status).toBe(201);
    expect(approval.status).toBe(201);
    expect(fork.status).toBe(201);
    expect(mockRunSessionShareService.create).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-721', permission: 'view' }),
      expect.objectContaining({ workspaceId: 'workspace-a' })
    );
    expect(mockRunSessionShareService.update).toHaveBeenCalledWith(
      'run_share_1',
      { permission: 'edit' },
      expect.objectContaining({ workspaceId: 'workspace-a' })
    );
    expect(mockRunSessionShareService.revoke).toHaveBeenCalledWith(
      'run_share_1',
      expect.objectContaining({ workspaceId: 'workspace-a' }),
      'Reviewer rotated out'
    );
    expect(mockRunSessionShareService.sendMessage).toHaveBeenCalledWith(
      'run_share_1',
      { message: 'Please continue the focused run.' },
      expect.objectContaining({ workspaceId: 'workspace-a' })
    );
    expect(mockRunSessionShareService.respondToApproval).toHaveBeenCalledWith(
      'run_share_1',
      { actionClass: 'human-review', response: 'approved' },
      expect.objectContaining({ clientMode: 'mobile-pwa' })
    );
    expect(mockRunSessionShareService.fork).toHaveBeenCalledWith(
      'run_share_1',
      { title: 'Fork run session', priority: 'high' },
      expect.objectContaining({ workspaceId: 'workspace-a' })
    );
  });

  it('rejects invalid permissions and blank co-drive messages before the service layer', async () => {
    const create = await request(app).post('/api/run-sessions').send({
      taskId: 'task-721',
      permission: 'admin',
    });
    const message = await request(app).post('/api/run-sessions/run_share_1/messages').send({
      message: '',
    });

    expect(create.status).toBe(400);
    expect(message.status).toBe(400);
    expect(mockRunSessionShareService.create).not.toHaveBeenCalled();
    expect(mockRunSessionShareService.sendMessage).not.toHaveBeenCalled();
  });
});
