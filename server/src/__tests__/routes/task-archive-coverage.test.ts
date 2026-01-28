/**
 * Task Archive Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockTaskService, mockActivityService } = vi.hoisted(() => ({
  mockTaskService: {
    getTask: vi.fn(),
    listTasks: vi.fn(),
    listArchivedTasks: vi.fn(),
    archiveTask: vi.fn(),
    restoreTask: vi.fn(),
    archiveSprint: vi.fn(),
    getArchiveSuggestions: vi.fn(),
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
vi.mock('../../services/activity-service.js', () => ({ activityService: mockActivityService }));
vi.mock('../../services/broadcast-service.js', () => ({ broadcastTaskChange: vi.fn() }));

import { taskArchiveRoutes } from '../../routes/task-archive.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Task Archive Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/tasks', taskArchiveRoutes);
    app.use(errorHandler);
  });

  it('GET /archived should list archived tasks', async () => {
    mockTaskService.listArchivedTasks.mockResolvedValue([{ id: 't1' }]);
    const res = await request(app).get('/api/tasks/archived');
    expect(res.status).toBe(200);
  });

  it('GET /archive/suggestions should get suggestions', async () => {
    mockTaskService.getArchiveSuggestions.mockResolvedValue([]);
    const res = await request(app).get('/api/tasks/archive/suggestions');
    expect(res.status).toBe(200);
  });

  it('POST /archive/sprint/:sprint should archive sprint', async () => {
    mockTaskService.archiveSprint.mockResolvedValue({ archived: 5 });
    const res = await request(app).post('/api/tasks/archive/sprint/S1');
    expect(res.status).toBe(200);
  });

  describe('POST /bulk-archive', () => {
    it('should bulk archive', async () => {
      mockTaskService.listTasks.mockResolvedValue([
        { id: 't1', sprint: 'S1', status: 'done', title: 'Done Task' },
      ]);
      mockTaskService.archiveTask.mockResolvedValue(true);
      const res = await request(app).post('/api/tasks/bulk-archive').send({ sprint: 'S1' });
      expect(res.status).toBe(200);
    });

    it('should reject missing sprint', async () => {
      const res = await request(app).post('/api/tasks/bulk-archive').send({});
      expect(res.status).toBe(400);
    });

    it('should reject when no completed tasks', async () => {
      mockTaskService.listTasks.mockResolvedValue([{ id: 't1', sprint: 'S1', status: 'todo' }]);
      const res = await request(app).post('/api/tasks/bulk-archive').send({ sprint: 'S1' });
      expect(res.status).toBe(400);
    });
  });

  it('POST /:id/archive should archive a task', async () => {
    mockTaskService.getTask.mockResolvedValue({ id: 't1', title: 'Task' });
    mockTaskService.archiveTask.mockResolvedValue(true);
    const res = await request(app).post('/api/tasks/t1/archive');
    expect(res.status).toBe(200);
  });

  it('POST /:id/archive should 404 for missing task', async () => {
    mockTaskService.getTask.mockResolvedValue(null);
    mockTaskService.archiveTask.mockResolvedValue(false);
    const res = await request(app).post('/api/tasks/missing/archive');
    expect(res.status).toBe(404);
  });

  it('POST /:id/restore should restore a task', async () => {
    mockTaskService.restoreTask.mockResolvedValue({ id: 't1', title: 'Task', status: 'done' });
    const res = await request(app).post('/api/tasks/t1/restore');
    expect(res.status).toBe(200);
  });

  it('POST /:id/restore should 404 for missing', async () => {
    mockTaskService.restoreTask.mockResolvedValue(null);
    const res = await request(app).post('/api/tasks/missing/restore');
    expect(res.status).toBe(404);
  });
});
