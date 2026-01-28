/**
 * Task Comments Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockTaskService, mockActivityService } = vi.hoisted(() => ({
  mockTaskService: {
    getTask: vi.fn(),
    updateTask: vi.fn(),
  },
  mockActivityService: {
    logActivity: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/task-service.js', () => ({
  TaskService: function () {
    return mockTaskService;
  },
}));

vi.mock('../../services/activity-service.js', () => ({
  activityService: mockActivityService,
}));

import { taskCommentRoutes } from '../../routes/task-comments.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Task Comment Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/tasks', taskCommentRoutes);
    app.use(errorHandler);
  });

  describe('POST /:id/comments', () => {
    it('should add a comment', async () => {
      const task = { id: 't1', title: 'Task', comments: [] };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.updateTask.mockResolvedValue({
        ...task,
        comments: [{ id: 'c1', author: 'Test', text: 'Hello' }],
      });

      const res = await request(app)
        .post('/api/tasks/t1/comments')
        .send({ author: 'Test', text: 'Hello' });
      expect(res.status).toBe(201);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/tasks/missing/comments')
        .send({ author: 'Test', text: 'Hello' });
      expect(res.status).toBe(404);
    });

    it('should reject missing author', async () => {
      const res = await request(app).post('/api/tasks/t1/comments').send({ text: 'Hello' });
      expect(res.status).toBe(400);
    });

    it('should reject empty text', async () => {
      const res = await request(app)
        .post('/api/tasks/t1/comments')
        .send({ author: 'Test', text: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /:id/comments/:commentId', () => {
    it('should edit a comment', async () => {
      const task = {
        id: 't1',
        comments: [{ id: 'c1', author: 'Test', text: 'Old', timestamp: '2025-01-01' }],
      };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.updateTask.mockResolvedValue(task);

      const res = await request(app).patch('/api/tasks/t1/comments/c1').send({ text: 'Updated' });
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app)
        .patch('/api/tasks/missing/comments/c1')
        .send({ text: 'Updated' });
      expect(res.status).toBe(404);
    });

    it('should return 404 for missing comment', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1', comments: [] });
      const res = await request(app)
        .patch('/api/tasks/t1/comments/missing')
        .send({ text: 'Updated' });
      expect(res.status).toBe(404);
    });

    it('should reject empty text', async () => {
      const res = await request(app).patch('/api/tasks/t1/comments/c1').send({ text: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:id/comments/:commentId', () => {
    it('should delete a comment', async () => {
      const task = {
        id: 't1',
        title: 'Task',
        comments: [{ id: 'c1', author: 'Test', text: 'Hello' }],
      };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.updateTask.mockResolvedValue({ ...task, comments: [] });

      const res = await request(app).delete('/api/tasks/t1/comments/c1');
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).delete('/api/tasks/missing/comments/c1');
      expect(res.status).toBe(404);
    });

    it('should return 404 for missing comment', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1', title: 'Task', comments: [] });
      const res = await request(app).delete('/api/tasks/t1/comments/missing');
      expect(res.status).toBe(404);
    });
  });
});
