/**
 * Task Subtasks Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockTaskService } = vi.hoisted(() => ({
  mockTaskService: {
    getTask: vi.fn(),
    updateTask: vi.fn(),
  },
}));

vi.mock('../../services/task-service.js', () => ({
  TaskService: function () {
    return mockTaskService;
  },
}));

import { taskSubtaskRoutes } from '../../routes/task-subtasks.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Task Subtask Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/tasks', taskSubtaskRoutes);
    app.use(errorHandler);
  });

  describe('POST /:id/subtasks', () => {
    it('should add a subtask', async () => {
      const task = { id: 't1', title: 'Task', subtasks: [] };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.updateTask.mockResolvedValue({
        ...task,
        subtasks: [{ id: 's1', title: 'Sub', completed: false }],
      });

      const res = await request(app).post('/api/tasks/t1/subtasks').send({ title: 'Sub' });
      expect(res.status).toBe(201);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).post('/api/tasks/missing/subtasks').send({ title: 'Sub' });
      expect(res.status).toBe(404);
    });

    it('should reject empty title', async () => {
      const res = await request(app).post('/api/tasks/t1/subtasks').send({ title: '' });
      expect(res.status).toBe(400);
    });

    it('should reject missing title', async () => {
      const res = await request(app).post('/api/tasks/t1/subtasks').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /:id/subtasks/:subtaskId', () => {
    it('should update a subtask', async () => {
      const task = {
        id: 't1',
        subtasks: [{ id: 's1', title: 'Sub', completed: false, created: '2025-01-01' }],
      };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.updateTask.mockResolvedValue(task);

      const res = await request(app).patch('/api/tasks/t1/subtasks/s1').send({ completed: true });
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app)
        .patch('/api/tasks/missing/subtasks/s1')
        .send({ completed: true });
      expect(res.status).toBe(404);
    });

    it('should return 404 for missing subtask', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1', subtasks: [] });
      const res = await request(app)
        .patch('/api/tasks/t1/subtasks/missing')
        .send({ completed: true });
      expect(res.status).toBe(404);
    });

    it('should auto-complete task when all subtasks done', async () => {
      const task = {
        id: 't1',
        autoCompleteOnSubtasks: true,
        subtasks: [
          { id: 's1', title: 'Sub1', completed: true, created: '2025-01-01' },
          { id: 's2', title: 'Sub2', completed: false, created: '2025-01-01' },
        ],
      };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.updateTask.mockResolvedValue({ ...task, status: 'done' });

      const res = await request(app).patch('/api/tasks/t1/subtasks/s2').send({ completed: true });
      expect(res.status).toBe(200);
      expect(mockTaskService.updateTask).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ status: 'done' })
      );
    });

    it('should reject invalid update body', async () => {
      const res = await request(app).patch('/api/tasks/t1/subtasks/s1').send({ title: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:id/subtasks/:subtaskId', () => {
    it('should delete a subtask', async () => {
      const task = { id: 't1', subtasks: [{ id: 's1', title: 'Sub', completed: false }] };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.updateTask.mockResolvedValue({ ...task, subtasks: [] });

      const res = await request(app).delete('/api/tasks/t1/subtasks/s1');
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).delete('/api/tasks/missing/subtasks/s1');
      expect(res.status).toBe(404);
    });
  });
});
