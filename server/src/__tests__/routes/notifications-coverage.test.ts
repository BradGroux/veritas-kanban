/**
 * Notifications Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockTaskService, mockNotificationService } = vi.hoisted(() => ({
  mockTaskService: {
    getTask: vi.fn(),
    listTasks: vi.fn(),
  },
  mockNotificationService: {
    createNotification: vi.fn(),
    getNotifications: vi.fn(),
    getPendingForTeams: vi.fn(),
    markAsSent: vi.fn(),
    checkTasksForNotifications: vi.fn(),
    clearNotifications: vi.fn(),
  },
}));

vi.mock('../../services/task-service.js', () => ({
  TaskService: function () {
    return mockTaskService;
  },
}));

vi.mock('../../services/notification-service.js', () => ({
  getNotificationService: () => mockNotificationService,
}));

import { notificationRoutes } from '../../routes/notifications.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Notification Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/notifications', notificationRoutes);
    app.use(errorHandler);
  });

  describe('POST /api/notifications', () => {
    it('should create a notification', async () => {
      mockNotificationService.createNotification.mockResolvedValue({ id: 'n1', type: 'info' });
      const res = await request(app)
        .post('/api/notifications')
        .send({ type: 'info', title: 'Test', message: 'Hello' });
      expect(res.status).toBe(201);
    });

    it('should enrich with task info', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1', title: 'Task', project: 'proj' });
      mockNotificationService.createNotification.mockResolvedValue({ id: 'n1' });
      const res = await request(app)
        .post('/api/notifications')
        .send({ type: 'task_done', title: 'Done', message: 'Task done', taskId: 't1' });
      expect(res.status).toBe(201);
    });

    it('should reject invalid type', async () => {
      const res = await request(app)
        .post('/api/notifications')
        .send({ type: 'invalid', title: 'Test', message: 'Hello' });
      expect(res.status).toBe(400);
    });

    it('should reject missing fields', async () => {
      const res = await request(app).post('/api/notifications').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/notifications', () => {
    it('should list notifications', async () => {
      mockNotificationService.getNotifications.mockResolvedValue([{ id: 'n1' }]);
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(200);
    });

    it('should filter unsent', async () => {
      mockNotificationService.getNotifications.mockResolvedValue([]);
      const res = await request(app).get('/api/notifications?unsent=true');
      expect(res.status).toBe(200);
      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith({ unsent: true });
    });
  });

  describe('GET /api/notifications/pending', () => {
    it('should get pending for Teams', async () => {
      mockNotificationService.getPendingForTeams.mockResolvedValue({ count: 0, notifications: [] });
      const res = await request(app).get('/api/notifications/pending');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/notifications/mark-sent', () => {
    it('should mark notifications as sent', async () => {
      mockNotificationService.markAsSent.mockResolvedValue(2);
      const res = await request(app)
        .post('/api/notifications/mark-sent')
        .send({ ids: ['n1', 'n2'] });
      expect(res.status).toBe(200);
      expect(res.body.marked).toBe(2);
    });

    it('should reject invalid body', async () => {
      const res = await request(app).post('/api/notifications/mark-sent').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/notifications/check', () => {
    it('should check tasks for notifications', async () => {
      mockTaskService.listTasks.mockResolvedValue([{ id: 't1' }]);
      mockNotificationService.checkTasksForNotifications.mockResolvedValue([]);
      const res = await request(app).post('/api/notifications/check');
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/notifications', () => {
    it('should clear all notifications', async () => {
      mockNotificationService.clearNotifications.mockResolvedValue(undefined);
      const res = await request(app).delete('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.cleared).toBe(true);
    });
  });
});
