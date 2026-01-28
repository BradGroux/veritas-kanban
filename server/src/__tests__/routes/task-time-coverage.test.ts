/**
 * Task Time Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockTaskService } = vi.hoisted(() => ({
  mockTaskService: {
    getTimeSummary: vi.fn(),
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    addTimeEntry: vi.fn(),
    deleteTimeEntry: vi.fn(),
  },
}));

vi.mock('../../services/task-service.js', () => ({
  TaskService: vi.fn().mockImplementation(() => mockTaskService),
}));

import { taskTimeRoutes } from '../../routes/task-time.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Task Time Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/tasks', taskTimeRoutes);
    app.use(errorHandler);
  });

  it('GET /time/summary should return summary', async () => {
    mockTaskService.getTimeSummary.mockResolvedValue({ total: 3600 });
    const res = await request(app).get('/api/tasks/time/summary');
    expect(res.status).toBe(200);
  });

  it('POST /:id/time/start should start timer', async () => {
    mockTaskService.startTimer.mockResolvedValue({ id: 't1' });
    const res = await request(app).post('/api/tasks/t1/time/start');
    expect(res.status).toBe(200);
  });

  it('POST /:id/time/stop should stop timer', async () => {
    mockTaskService.stopTimer.mockResolvedValue({ id: 't1' });
    const res = await request(app).post('/api/tasks/t1/time/stop');
    expect(res.status).toBe(200);
  });

  it('POST /:id/time/entry should add entry', async () => {
    mockTaskService.addTimeEntry.mockResolvedValue({ id: 't1' });
    const res = await request(app).post('/api/tasks/t1/time/entry').send({ duration: 3600, description: 'Work' });
    expect(res.status).toBe(200);
  });

  it('POST /:id/time/entry should reject invalid duration', async () => {
    const res = await request(app).post('/api/tasks/t1/time/entry').send({ duration: -1 });
    expect(res.status).toBe(400);
  });

  it('POST /:id/time/entry should reject missing duration', async () => {
    const res = await request(app).post('/api/tasks/t1/time/entry').send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /:id/time/entry/:entryId should delete entry', async () => {
    mockTaskService.deleteTimeEntry.mockResolvedValue({ id: 't1' });
    const res = await request(app).delete('/api/tasks/t1/time/entry/e1');
    expect(res.status).toBe(200);
  });
});
