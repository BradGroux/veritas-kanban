/**
 * Notifications Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockNotificationService } = vi.hoisted(() => ({
  mockNotificationService: {
    createNotification: vi.fn(),
    getAllNotifications: vi.fn(),
    getNotifications: vi.fn(),
    getStats: vi.fn(),
    getSubscriptions: vi.fn(),
    processComment: vi.fn(),
    markDelivered: vi.fn(),
    markManyDelivered: vi.fn(),
    markAllDelivered: vi.fn(),
    clearNotifications: vi.fn(),
  },
}));

vi.mock('../../services/notification-service.js', () => ({
  getNotificationService: () => mockNotificationService,
}));

import { notificationRoutes } from '../../routes/notifications.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Notification Routes', () => {
  let app: express.Express;

  function buildApp(role: 'admin' | 'agent' = 'admin'): express.Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req: any, _res: any, next: any) => {
      req.auth = { role, keyName: `test-${role}`, isLocalhost: true };
      next();
    });
    testApp.use('/api/notifications', notificationRoutes);
    testApp.use(errorHandler);
    return testApp;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  describe('GET /api/notifications', () => {
    it('should list all notifications when no agent is provided', async () => {
      mockNotificationService.getAllNotifications.mockResolvedValue([
        { id: 'n1', targetAgent: 'system', delivered: false },
      ]);

      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(mockNotificationService.getAllNotifications).toHaveBeenCalledWith({
        undelivered: false,
      });
    });

    it('should list undelivered notifications for CLI unsent compatibility', async () => {
      mockNotificationService.getAllNotifications.mockResolvedValue([
        { id: 'n1', targetAgent: 'system', delivered: false },
      ]);

      const res = await request(app).get('/api/notifications?unsent=true');

      expect(res.status).toBe(200);
      expect(mockNotificationService.getAllNotifications).toHaveBeenCalledWith({
        undelivered: true,
      });
    });

    it('should get notifications for an agent', async () => {
      mockNotificationService.getNotifications.mockResolvedValue([
        { id: 'n1', targetAgent: 'alice', delivered: false },
      ]);

      const res = await request(app).get('/api/notifications?agent=alice');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith({
        agent: 'alice',
        undelivered: false,
        taskId: '',
        limit: undefined,
      });
    });

    it('should create CLI notifications', async () => {
      mockNotificationService.createNotification.mockResolvedValue({
        id: 'n1',
        type: 'mention',
        title: 'Notification',
      });

      const res = await request(app).post('/api/notifications').send({
        type: 'info',
        title: 'Notification',
        message: 'Hello from CLI',
        taskId: 'TASK-1',
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('n1');
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith({
        type: 'info',
        title: 'Notification',
        message: 'Hello from CLI',
        taskId: 'TASK-1',
      });
    });

    it('should reject CLI notification creation without a message', async () => {
      const res = await request(app).post('/api/notifications').send({ title: 'Missing body' });
      expect(res.status).toBe(500);
    });

    it('should filter by undelivered', async () => {
      mockNotificationService.getNotifications.mockResolvedValue([]);
      const res = await request(app).get('/api/notifications?agent=bob&undelivered=true');

      expect(res.status).toBe(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith({
        agent: 'bob',
        undelivered: true,
        taskId: '',
        limit: undefined,
      });
    });

    it('should filter by taskId', async () => {
      mockNotificationService.getNotifications.mockResolvedValue([]);
      const res = await request(app).get('/api/notifications?agent=alice&taskId=TASK-1');

      expect(res.status).toBe(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith({
        agent: 'alice',
        undelivered: false,
        taskId: 'TASK-1',
        limit: undefined,
      });
    });

    it('should respect limit', async () => {
      mockNotificationService.getNotifications.mockResolvedValue([]);
      const res = await request(app).get('/api/notifications?agent=alice&limit=5');

      expect(res.status).toBe(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith({
        agent: 'alice',
        undelivered: false,
        taskId: '',
        limit: 5,
      });
    });
  });

  describe('GET /api/notifications/stats', () => {
    it('should return notification statistics', async () => {
      mockNotificationService.getStats.mockResolvedValue({
        totalNotifications: 10,
        undelivered: 3,
        byAgent: { alice: { total: 5, undelivered: 2 } },
        byType: { mention: 8, assignment: 2 },
      });

      const res = await request(app).get('/api/notifications/stats');

      expect(res.status).toBe(200);
      expect(res.body.totalNotifications).toBe(10);
      expect(res.body.undelivered).toBe(3);
    });
  });

  describe('CLI compatibility endpoints', () => {
    it('should return pending notifications formatted for Teams', async () => {
      mockNotificationService.getAllNotifications.mockResolvedValue([
        {
          id: 'n1',
          type: 'mention',
          content: 'Review TASK-1',
          createdAt: '2026-05-13T12:00:00.000Z',
        },
      ]);

      const res = await request(app).get('/api/notifications/pending');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.messages[0]).toEqual({
        id: 'n1',
        type: 'mention',
        text: 'Review TASK-1',
        timestamp: '2026-05-13T12:00:00.000Z',
      });
      expect(mockNotificationService.getAllNotifications).toHaveBeenCalledWith({
        undelivered: true,
      });
    });

    it('should mark pending notifications sent through the CLI alias', async () => {
      mockNotificationService.markManyDelivered.mockResolvedValue(2);

      const res = await request(app)
        .post('/api/notifications/mark-sent')
        .send({
          ids: ['n1', 'n2'],
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, count: 2 });
      expect(mockNotificationService.markManyDelivered).toHaveBeenCalledWith(['n1', 'n2']);
    });

    it('should reject mark-sent without ids', async () => {
      const res = await request(app).post('/api/notifications/mark-sent').send({});
      expect(res.status).toBe(500);
    });

    it('should return a safe no-op notify check result', async () => {
      const res = await request(app).post('/api/notifications/check');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ checked: 0, created: 0 });
    });

    it('should clear notifications for the CLI clear command', async () => {
      mockNotificationService.clearNotifications.mockResolvedValue(4);

      const res = await request(app).delete('/api/notifications');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, count: 4 });
      expect(mockNotificationService.clearNotifications).toHaveBeenCalled();
    });
  });

  describe('global notification authorization', () => {
    beforeEach(() => {
      app = buildApp('agent');
    });

    it('should allow agent-scoped notification reads for agent keys', async () => {
      mockNotificationService.getNotifications.mockResolvedValue([
        { id: 'n1', targetAgent: 'alice', delivered: false },
      ]);

      const res = await request(app).get('/api/notifications?agent=alice');

      expect(res.status).toBe(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith({
        agent: 'alice',
        undelivered: false,
        taskId: '',
        limit: undefined,
      });
    });

    it('should reject global notification reads for agent keys', async () => {
      const res = await request(app).get('/api/notifications');

      expect(res.status).toBe(403);
      expect(mockNotificationService.getAllNotifications).not.toHaveBeenCalled();
    });

    it('should reject global notification creation for agent keys', async () => {
      const res = await request(app).post('/api/notifications').send({
        message: 'Hello from CLI',
      });

      expect(res.status).toBe(403);
      expect(mockNotificationService.createNotification).not.toHaveBeenCalled();
    });

    it('should reject pending notification export for agent keys', async () => {
      const res = await request(app).get('/api/notifications/pending');

      expect(res.status).toBe(403);
      expect(mockNotificationService.getAllNotifications).not.toHaveBeenCalled();
    });

    it('should reject global mark-sent for agent keys', async () => {
      const res = await request(app)
        .post('/api/notifications/mark-sent')
        .send({
          ids: ['n1'],
        });

      expect(res.status).toBe(403);
      expect(mockNotificationService.markManyDelivered).not.toHaveBeenCalled();
    });

    it('should reject global notification clearing for agent keys', async () => {
      const res = await request(app).delete('/api/notifications');

      expect(res.status).toBe(403);
      expect(mockNotificationService.clearNotifications).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/notifications/subscriptions/:taskId', () => {
    it('should return thread subscriptions', async () => {
      mockNotificationService.getSubscriptions.mockResolvedValue([
        { taskId: 'TASK-1', agent: 'alice', reason: 'mentioned', subscribedAt: '2024-01-01' },
        { taskId: 'TASK-1', agent: 'bob', reason: 'commented', subscribedAt: '2024-01-02' },
      ]);

      const res = await request(app).get('/api/notifications/subscriptions/TASK-1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].agent).toBe('alice');
    });

    it('should return empty array for task with no subscriptions', async () => {
      mockNotificationService.getSubscriptions.mockResolvedValue([]);

      const res = await request(app).get('/api/notifications/subscriptions/TASK-999');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/notifications/process', () => {
    it('should process comment and create notifications', async () => {
      mockNotificationService.processComment.mockResolvedValue([
        { id: 'n1', targetAgent: 'bob', type: 'mention' },
      ]);

      const res = await request(app).post('/api/notifications/process').send({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: 'Hey @bob, check this out',
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(1);
      expect(mockNotificationService.processComment).toHaveBeenCalledWith({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: 'Hey @bob, check this out',
      });
    });

    it('should process @all mentions', async () => {
      mockNotificationService.processComment.mockResolvedValue([
        { id: 'n1', targetAgent: 'bob' },
        { id: 'n2', targetAgent: 'charlie' },
      ]);

      const res = await request(app)
        .post('/api/notifications/process')
        .send({
          taskId: 'TASK-1',
          fromAgent: 'alice',
          content: '@all please review',
          allAgents: ['alice', 'bob', 'charlie'],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveLength(2);
    });

    it('should reject missing required fields', async () => {
      const res = await request(app).post('/api/notifications/process').send({ taskId: 'TASK-1' });

      // Missing fromAgent and content triggers validation error (caught by error handler)
      expect(res.status).toBe(500); // ZodError returns 500 via error handler
    });
  });

  describe('POST /api/notifications/:id/delivered', () => {
    it('should mark notification as delivered', async () => {
      mockNotificationService.markDelivered.mockResolvedValue(true);

      const res = await request(app).post('/api/notifications/notif_123/delivered');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockNotificationService.markDelivered).toHaveBeenCalledWith('notif_123');
    });

    it('should return 404 for unknown notification', async () => {
      mockNotificationService.markDelivered.mockResolvedValue(false);

      const res = await request(app).post('/api/notifications/nonexistent/delivered');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/notifications/delivered-all', () => {
    it('should mark all notifications delivered for an agent', async () => {
      mockNotificationService.markAllDelivered.mockResolvedValue(3);

      const res = await request(app)
        .post('/api/notifications/delivered-all')
        .send({ agent: 'alice' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(3);
      expect(mockNotificationService.markAllDelivered).toHaveBeenCalledWith('alice');
    });

    it('should return 0 count when no undelivered notifications', async () => {
      mockNotificationService.markAllDelivered.mockResolvedValue(0);

      const res = await request(app)
        .post('/api/notifications/delivered-all')
        .send({ agent: 'bob' });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });

    it('should reject missing agent field', async () => {
      const res = await request(app).post('/api/notifications/delivered-all').send({});

      // Missing agent field triggers Zod validation error (caught by error handler)
      expect(res.status).toBe(500); // ZodError returns 500 via error handler
    });
  });
});
