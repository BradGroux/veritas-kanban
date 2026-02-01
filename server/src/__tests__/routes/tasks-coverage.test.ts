/**
 * Tasks Route Coverage Tests
 * Tests the actual tasks.ts route module for coverage
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Use vi.hoisted to declare mocks that vi.mock factories can reference
const { mockTaskService, mockWorktreeService, mockBlockingService, mockActivityService } =
  vi.hoisted(() => ({
    mockTaskService: {
      listTasks: vi.fn(),
      getTask: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      reorderTasks: vi.fn(),
    },
    mockWorktreeService: {
      createWorktree: vi.fn(),
      getWorktreeStatus: vi.fn(),
      deleteWorktree: vi.fn(),
      rebaseWorktree: vi.fn(),
      mergeWorktree: vi.fn(),
      openInVSCode: vi.fn(),
    },
    mockBlockingService: {
      getBlockingStatus: vi.fn(),
      canMoveToInProgress: vi.fn(),
    },
    mockActivityService: {
      logActivity: vi.fn().mockResolvedValue(undefined),
    },
  }));

vi.mock('../../services/task-service.js', () => ({
  getTaskService: () => mockTaskService,
  TaskService: function () {
    return mockTaskService;
  },
}));

vi.mock('../../services/worktree-service.js', () => ({
  WorktreeService: function () {
    return mockWorktreeService;
  },
}));

vi.mock('../../services/blocking-service.js', () => ({
  getBlockingService: () => mockBlockingService,
}));

vi.mock('../../services/activity-service.js', () => ({
  activityService: mockActivityService,
}));

vi.mock('../../services/broadcast-service.js', () => ({
  broadcastTaskChange: vi.fn(),
}));

vi.mock('../../services/attachment-service.js', () => ({
  getAttachmentService: () => ({
    getExtractedText: vi.fn().mockResolvedValue(null),
    getAttachmentPath: vi.fn().mockReturnValue('/fake/path'),
  }),
}));

// Must mock cache-control since it's used by the route
vi.mock('../../middleware/cache-control.js', async () => {
  const actual = await vi.importActual('../../middleware/cache-control.js');
  return actual;
});

// Import after mocking
import { taskRoutes } from '../../routes/tasks.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Tasks Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/tasks', taskRoutes);
    app.use(errorHandler);
  });

  describe('GET /api/tasks', () => {
    it('should list all tasks', async () => {
      const tasks = [
        { id: 't1', title: 'Task 1', created: '2025-01-01', updated: '2025-01-02' },
        { id: 't2', title: 'Task 2', created: '2025-01-01', updated: '2025-01-03' },
      ];
      mockTaskService.listTasks.mockResolvedValue(tasks);

      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('should return empty array when no tasks', async () => {
      mockTaskService.listTasks.mockResolvedValue([]);
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/tasks/reorder', () => {
    it('should reorder tasks', async () => {
      mockTaskService.reorderTasks.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      const res = await request(app)
        .post('/api/tasks/reorder')
        .send({ orderedIds: ['t1', 't2'] });
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(2);
    });

    it('should reject empty orderedIds', async () => {
      const res = await request(app).post('/api/tasks/reorder').send({ orderedIds: [] });
      expect(res.status).toBe(400);
    });

    it('should reject missing orderedIds', async () => {
      const res = await request(app).post('/api/tasks/reorder').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('should get a single task', async () => {
      const task = { id: 't1', title: 'Task 1', created: '2025-01-01' };
      mockTaskService.getTask.mockResolvedValue(task);

      const res = await request(app).get('/api/tasks/t1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('t1');
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).get('/api/tasks/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/tasks/:id/blocking-status', () => {
    it('should get blocking status', async () => {
      const task = { id: 't1', title: 'Test', blockedBy: ['t2'] };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.listTasks.mockResolvedValue([task]);
      mockBlockingService.getBlockingStatus.mockReturnValue({ isBlocked: false, blockers: [] });

      const res = await request(app).get('/api/tasks/t1/blocking-status');
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).get('/api/tasks/nonexistent/blocking-status');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/tasks', () => {
    it('should create a task', async () => {
      const newTask = {
        id: 't1',
        title: 'New Task',
        type: 'code',
        priority: 'medium',
        created: '2025-01-01',
      };
      mockTaskService.createTask.mockResolvedValue(newTask);

      const res = await request(app).post('/api/tasks').send({ title: 'New Task' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe('t1');
    });

    it('should reject missing title', async () => {
      const res = await request(app).post('/api/tasks').send({});
      expect(res.status).toBe(400);
    });

    it('should reject empty title', async () => {
      const res = await request(app).post('/api/tasks').send({ title: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('should update a task', async () => {
      const oldTask = { id: 't1', title: 'Old', status: 'todo', created: '2025-01-01' };
      const updatedTask = { ...oldTask, title: 'Updated' };
      mockTaskService.getTask.mockResolvedValue(oldTask);
      mockTaskService.updateTask.mockResolvedValue(updatedTask);

      const res = await request(app).patch('/api/tasks/t1').send({ title: 'Updated' });
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing task on getTask', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).patch('/api/tasks/nonexistent').send({ title: 'Updated' });
      expect(res.status).toBe(404);
    });

    it('should return 404 when updateTask returns null', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1', status: 'todo' });
      mockTaskService.updateTask.mockResolvedValue(null);
      const res = await request(app).patch('/api/tasks/t1').send({ title: 'Updated' });
      expect(res.status).toBe(404);
    });

    it('should log activity for status change', async () => {
      const oldTask = { id: 't1', title: 'Task', status: 'todo' };
      const updatedTask = { ...oldTask, status: 'done' };
      mockTaskService.getTask.mockResolvedValue(oldTask);
      mockTaskService.updateTask.mockResolvedValue(updatedTask);

      await request(app).patch('/api/tasks/t1').send({ status: 'done' });
      expect(mockActivityService.logActivity).toHaveBeenCalledWith(
        'status_changed',
        't1',
        'Task',
        expect.objectContaining({ from: 'todo', status: 'done' }),
        updatedTask.agent
      );
    });

    it('should check blocking when moving to in-progress', async () => {
      const oldTask = { id: 't1', status: 'todo', title: 'Task', blockedBy: ['t2'] };
      mockTaskService.getTask.mockResolvedValue(oldTask);
      mockTaskService.listTasks.mockResolvedValue([oldTask]);
      mockBlockingService.canMoveToInProgress.mockReturnValue({ allowed: true, blockers: [] });
      mockTaskService.updateTask.mockResolvedValue({ ...oldTask, status: 'in-progress' });

      const res = await request(app).patch('/api/tasks/t1').send({ status: 'in-progress' });
      expect(res.status).toBe(200);
    });

    it('should reject blocked task moving to in-progress', async () => {
      const oldTask = { id: 't1', status: 'todo', title: 'Task', blockedBy: ['t2'] };
      mockTaskService.getTask.mockResolvedValue(oldTask);
      mockTaskService.listTasks.mockResolvedValue([oldTask]);
      mockBlockingService.canMoveToInProgress.mockReturnValue({
        allowed: false,
        blockers: [{ id: 't2', title: 'Blocker' }],
      });

      const res = await request(app).patch('/api/tasks/t1').send({ status: 'in-progress' });
      expect(res.status).toBe(400);
    });

    it('should auto-clear blockedReason when moving out of blocked', async () => {
      const oldTask = {
        id: 't1',
        status: 'blocked',
        title: 'Task',
        blockedReason: { category: 'technical-snag', note: 'x' },
      };
      const updatedTask = { ...oldTask, status: 'in-progress', blockedReason: null };
      mockTaskService.getTask.mockResolvedValue(oldTask);
      mockTaskService.updateTask.mockResolvedValue(updatedTask);

      const res = await request(app).patch('/api/tasks/t1').send({ status: 'in-progress' });
      expect(res.status).toBe(200);
      expect(mockTaskService.updateTask).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ blockedReason: null })
      );
    });

    it('should reject invalid validation input', async () => {
      const res = await request(app).patch('/api/tasks/t1').send({ priority: 'invalid-priority' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('should delete a task', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1', title: 'Task' });
      mockTaskService.deleteTask.mockResolvedValue(true);

      const res = await request(app).delete('/api/tasks/t1');
      expect(res.status).toBe(204);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      mockTaskService.deleteTask.mockResolvedValue(false);

      const res = await request(app).delete('/api/tasks/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('Worktree routes', () => {
    it('POST should create worktree', async () => {
      mockWorktreeService.createWorktree.mockResolvedValue({ path: '/tmp/wt', branch: 'task/t1' });
      const res = await request(app).post('/api/tasks/t1/worktree');
      expect(res.status).toBe(201);
    });

    it('GET should get worktree status', async () => {
      mockWorktreeService.getWorktreeStatus.mockResolvedValue({ exists: true });
      const res = await request(app).get('/api/tasks/t1/worktree');
      expect(res.status).toBe(200);
    });

    it('DELETE should delete worktree', async () => {
      mockWorktreeService.deleteWorktree.mockResolvedValue(undefined);
      const res = await request(app).delete('/api/tasks/t1/worktree');
      expect(res.status).toBe(204);
    });

    it('DELETE with force=true should force delete', async () => {
      mockWorktreeService.deleteWorktree.mockResolvedValue(undefined);
      const res = await request(app).delete('/api/tasks/t1/worktree?force=true');
      expect(res.status).toBe(204);
      expect(mockWorktreeService.deleteWorktree).toHaveBeenCalledWith('t1', true);
    });

    it('POST /rebase should rebase', async () => {
      mockWorktreeService.rebaseWorktree.mockResolvedValue({ status: 'ok' });
      const res = await request(app).post('/api/tasks/t1/worktree/rebase');
      expect(res.status).toBe(200);
    });

    it('POST /merge should merge', async () => {
      mockWorktreeService.mergeWorktree.mockResolvedValue(undefined);
      const res = await request(app).post('/api/tasks/t1/worktree/merge');
      expect(res.status).toBe(200);
      expect(res.body.merged).toBe(true);
    });

    it('GET /open should get vscode command', async () => {
      mockWorktreeService.openInVSCode.mockResolvedValue('code /tmp/wt');
      const res = await request(app).get('/api/tasks/t1/worktree/open');
      expect(res.status).toBe(200);
      expect(res.body.command).toBe('code /tmp/wt');
    });
  });

  describe('POST /api/tasks/:id/apply-template', () => {
    it('should apply template to task', async () => {
      mockTaskService.getTask.mockResolvedValue({ id: 't1', title: 'Task' });
      const res = await request(app)
        .post('/api/tasks/t1/apply-template')
        .send({ templateId: 'tmpl1', templateName: 'Bug Fix' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject missing templateId', async () => {
      const res = await request(app).post('/api/tasks/t1/apply-template').send({});
      expect(res.status).toBe(400);
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/tasks/t1/apply-template')
        .send({ templateId: 'tmpl1' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/tasks/:id/context', () => {
    it('should get task context', async () => {
      mockTaskService.getTask.mockResolvedValue({
        id: 't1',
        title: 'Task',
        description: 'Desc',
        type: 'code',
        status: 'todo',
        priority: 'medium',
        attachments: [],
        created: '2025-01-01',
      });
      const res = await request(app).get('/api/tasks/t1/context');
      expect(res.status).toBe(200);
      expect(res.body.taskId).toBe('t1');
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      const res = await request(app).get('/api/tasks/nonexistent/context');
      expect(res.status).toBe(404);
    });

    it('should include attachment context', async () => {
      mockTaskService.getTask.mockResolvedValue({
        id: 't1',
        title: 'Task',
        type: 'code',
        status: 'todo',
        priority: 'medium',
        attachments: [
          { id: 'a1', originalName: 'doc.pdf', mimeType: 'application/pdf', filename: 'a1.pdf' },
          { id: 'a2', originalName: 'img.png', mimeType: 'image/png', filename: 'a2.png' },
        ],
        created: '2025-01-01',
      });

      const res = await request(app).get('/api/tasks/t1/context');
      expect(res.status).toBe(200);
      expect(res.body.attachments.count).toBe(2);
    });
  });
});
