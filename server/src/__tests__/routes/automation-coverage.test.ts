/**
 * Automation Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockTaskService, mockAutomationService } = vi.hoisted(() => ({
  mockTaskService: {
    getTask: vi.fn(),
    updateTask: vi.fn(),
    listTasks: vi.fn(),
  },
  mockAutomationService: {
    validateCanStart: vi.fn(),
    validateCanComplete: vi.fn(),
    getStartPayload: vi.fn(),
    getCompletePayload: vi.fn(),
    buildStartResult: vi.fn(),
    buildCompleteResult: vi.fn(),
    getPendingTasks: vi.fn(),
    getRunningTasks: vi.fn(),
  },
}));

vi.mock('../../services/task-service.js', () => ({
  TaskService: function () {
    return mockTaskService;
  },
}));

vi.mock('../../services/automation-service.js', () => ({
  getAutomationService: () => mockAutomationService,
}));

import { automationRoutes } from '../../routes/automation.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Automation Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/automation', automationRoutes);
    app.use(errorHandler);
  });

  describe('POST /:taskId/start', () => {
    it('should start automation', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1', status: 'todo' });
      mockAutomationService.validateCanStart.mockReturnValue({ valid: true });
      mockAutomationService.getStartPayload.mockReturnValue({
        attempt: { id: 'a1' },
        status: 'in-progress',
      });
      mockTaskService.updateTask.mockResolvedValue({ id: 't1', status: 'in-progress' });
      mockAutomationService.buildStartResult.mockReturnValue({ taskId: 't1', attemptId: 'a1' });

      const res = await request(app).post('/api/automation/t1/start').send({});
      expect(res.status).toBe(200);
      expect(res.body.taskId).toBe('t1');
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).post('/api/automation/missing/start').send({});
      expect(res.status).toBe(404);
    });

    it('should reject invalid task state', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1' });
      mockAutomationService.validateCanStart.mockReturnValue({
        valid: false,
        error: 'Task already running',
      });
      const res = await request(app).post('/api/automation/t1/start').send({});
      expect(res.status).toBe(400);
    });

    it('should accept sessionKey', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1' });
      mockAutomationService.validateCanStart.mockReturnValue({ valid: true });
      mockAutomationService.getStartPayload.mockReturnValue({ attempt: { id: 'a1' } });
      mockTaskService.updateTask.mockResolvedValue({ id: 't1' });
      mockAutomationService.buildStartResult.mockReturnValue({ taskId: 't1' });

      const res = await request(app)
        .post('/api/automation/t1/start')
        .send({ sessionKey: 'session-123' });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /:taskId/complete', () => {
    it('should complete automation', async () => {
      mockTaskService.getTask.mockResolvedValue({
        id: 't1',
        attempt: { id: 'a1' },
        automation: {},
      });
      mockAutomationService.validateCanComplete.mockReturnValue({ valid: true });
      mockAutomationService.getCompletePayload.mockReturnValue({ status: 'done' });
      mockTaskService.updateTask.mockResolvedValue({ id: 't1', status: 'done' });
      mockAutomationService.buildCompleteResult.mockReturnValue({ success: true });

      const res = await request(app)
        .post('/api/automation/t1/complete')
        .send({ status: 'complete' });
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).post('/api/automation/missing/complete').send({});
      expect(res.status).toBe(404);
    });

    it('should reject invalid task state', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1' });
      mockAutomationService.validateCanComplete.mockReturnValue({
        valid: false,
        error: 'Not running',
      });
      const res = await request(app).post('/api/automation/t1/complete').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /pending', () => {
    it('should list pending tasks', async () => {
      mockTaskService.listTasks.mockResolvedValue([]);
      mockAutomationService.getPendingTasks.mockReturnValue([]);
      const res = await request(app).get('/api/automation/pending');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /running', () => {
    it('should list running tasks', async () => {
      mockTaskService.listTasks.mockResolvedValue([]);
      mockAutomationService.getRunningTasks.mockReturnValue([]);
      const res = await request(app).get('/api/automation/running');
      expect(res.status).toBe(200);
    });
  });
});
