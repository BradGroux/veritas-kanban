/**
 * Tasks Route Coverage Tests
 * Tests the actual tasks.ts route module for coverage
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Use vi.hoisted to declare mocks that vi.mock factories can reference
const {
  mockTaskService,
  mockWorktreeService,
  mockBlockingService,
  mockActivityService,
  mockBacklogService,
  mockBroadcastTaskChange,
  mockSyncTaskStatusToGitHub,
} = vi.hoisted(() => ({
  mockTaskService: {
    listTasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    archiveTask: vi.fn(),
    reorderTasks: vi.fn(),
    moveTask: vi.fn(),
    reconcileBoardMoveTelemetry: vi.fn().mockResolvedValue(true),
    markBoardMoveAuditComplete: vi.fn().mockImplementation((id: string, operationId: string) =>
      Promise.resolve({
        id,
        lastBoardMove: {
          operationId,
          auditCompletedAt: '2026-08-01T10:00:01.000Z',
        },
      })
    ),
    getIdentityScanSources: vi.fn().mockReturnValue([]),
  },
  mockWorktreeService: {
    createWorktree: vi.fn(),
    getWorktreeStatus: vi.fn(),
    deleteWorktree: vi.fn(),
    rebaseWorktree: vi.fn(),
    mergeWorktree: vi.fn(),
    openInVSCode: vi.fn(),
    previewCleanup: vi.fn(),
    previewCleanupCandidates: vi.fn(),
    adoptLegacyWorktree: vi.fn(),
  },
  mockBlockingService: {
    getBlockingStatus: vi.fn(),
    canMoveToInProgress: vi.fn(),
  },
  mockActivityService: {
    logActivity: vi.fn().mockResolvedValue(undefined),
    logActivityOnce: vi.fn().mockResolvedValue({ activity: {}, created: true }),
  },
  mockBacklogService: {
    getTaskIdentityDiagnostics: vi
      .fn()
      .mockResolvedValue({ hasConflicts: false, conflictCount: 0, conflicts: [] }),
    getBacklogCount: vi.fn().mockResolvedValue(0),
    demoteToBacklog: vi.fn(),
  },
  mockBroadcastTaskChange: vi.fn(),
  mockSyncTaskStatusToGitHub: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../services/backlog-service.js', () => ({
  getBacklogService: () => mockBacklogService,
}));

vi.mock('../../services/broadcast-service.js', () => ({
  broadcastTaskChange: mockBroadcastTaskChange,
}));

vi.mock('../../services/github-sync-service.js', () => ({
  getGitHubSyncService: () => ({ syncTaskStatusToGitHub: mockSyncTaskStatusToGitHub }),
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
    app.use((req, _res, next) => {
      if (req.query.force === 'true' || req.path.endsWith('/worktree/adopt')) {
        (req as import('../../middleware/auth.js').AuthenticatedRequest).auth = {
          role: 'admin',
          isLocalhost: true,
          permissions: ['*'],
        };
      }
      next();
    });
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

    it('repairs the durable audit receipt when a board is loaded after restart', async () => {
      const task = {
        id: 't1',
        title: 'Moved task',
        status: 'blocked',
        position: 0,
        created: '2025-01-01',
        updated: '2025-01-02',
        updatedBy: 'user:test',
        lastBoardMove: {
          operationId: '00000000-0000-4000-8000-000000000013',
          sourceStatus: 'todo',
          sourcePosition: null,
          destinationStatus: 'blocked',
          destinationIndex: 0,
          completedAt: '2025-01-02',
        },
      };
      const secondTask = {
        ...task,
        id: 't2',
        title: 'Second moved task',
      };
      mockTaskService.listTasks.mockResolvedValue([task, secondTask]);

      const res = await request(app).get('/api/tasks');

      expect(res.status).toBe(200);
      await vi.waitFor(() => {
        expect(mockTaskService.reconcileBoardMoveTelemetry).toHaveBeenCalledWith(task);
        expect(mockTaskService.reconcileBoardMoveTelemetry).toHaveBeenCalledWith(secondTask);
        expect(mockActivityService.logActivityOnce).toHaveBeenCalledTimes(2);
      });
    });

    it('should expose duplicate identity diagnostics as a response header', async () => {
      mockTaskService.listTasks.mockResolvedValue([]);
      mockBacklogService.getTaskIdentityDiagnostics.mockResolvedValueOnce({
        hasConflicts: true,
        conflictCount: 1,
        conflicts: [
          {
            kind: 'task-id',
            id: 'task_20260603_dup',
            sources: [
              {
                location: 'active',
                path: 'active/task_20260603_dup-active.md',
                filename: 'task_20260603_dup-active.md',
                taskId: 'task_20260603_dup',
                businessIds: [],
              },
              {
                location: 'backlog',
                path: 'backlog/task_20260603_dup-backlog.md',
                filename: 'task_20260603_dup-backlog.md',
                taskId: 'task_20260603_dup',
                businessIds: [],
              },
            ],
          },
        ],
      });

      const res = await request(app).get('/api/tasks');

      expect(res.status).toBe(200);
      expect(res.headers['x-veritas-task-identity-conflicts']).toBe('1');
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

  describe('POST /api/tasks/:id/move', () => {
    it('does not overwrite a prior durable receipt while audit repair is unavailable', async () => {
      mockTaskService.getTask.mockResolvedValue({
        id: 't1',
        title: 'Task',
        status: 'blocked',
        position: 0,
        revision: 2,
        lastBoardMove: {
          operationId: '00000000-0000-4000-8000-000000000010',
          sourceStatus: 'todo',
          sourcePosition: null,
          destinationStatus: 'blocked',
          destinationIndex: 0,
          completedAt: '2026-08-01T10:00:00.000Z',
        },
      });
      mockActivityService.logActivityOnce.mockRejectedValueOnce(new Error('activity unavailable'));

      const res = await request(app)
        .post('/api/tasks/t1/move')
        .set('If-Match', '"task:t1:2"')
        .send({
          operationId: '00000000-0000-4000-8000-000000000011',
          sourceStatus: 'blocked',
          sourcePosition: 0,
          destinationStatus: 'done',
          destinationIndex: 0,
        });

      expect(res.status).toBe(500);
      expect(mockTaskService.moveTask).not.toHaveBeenCalled();
    });

    it('passes revision and operation identity to one move command', async () => {
      const task = {
        id: 't1',
        title: 'Task',
        status: 'todo',
        position: 0,
        revision: 4,
      };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.moveTask.mockResolvedValue({
        task: { ...task, status: 'blocked', position: 0.5, revision: 5 },
        operationId: '00000000-0000-4000-8000-000000000010',
        orderedTaskIds: ['b1', 't1', 'b2'],
        replayed: false,
      });

      const res = await request(app)
        .post('/api/tasks/t1/move')
        .set('If-Match', '"task:t1:4"')
        .send({
          operationId: '00000000-0000-4000-8000-000000000010',
          sourceStatus: 'todo',
          sourcePosition: 0,
          destinationStatus: 'blocked',
          destinationIndex: 1,
        });

      expect(res.status).toBe(200);
      expect(mockTaskService.moveTask).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          operationId: '00000000-0000-4000-8000-000000000010',
          expectedRevision: 4,
          updatedBy: 'system:unknown',
        })
      );
      expect(mockActivityService.logActivityOnce).toHaveBeenCalledOnce();
      expect(mockActivityService.logActivityOnce.mock.invocationCallOrder[0]).toBeLessThan(
        mockBroadcastTaskChange.mock.invocationCallOrder[0]
      );
      expect(res.body).toMatchObject({ replayed: false, task: { revision: 5 } });
    });

    it('allows an already committed operation to replay with its original revision', async () => {
      const task = {
        id: 't1',
        title: 'Task',
        status: 'blocked',
        position: 0.5,
        revision: 5,
        github: { owner: 'BradGroux', repo: 'veritas-kanban', issue: 1302 },
        lastBoardMove: {
          operationId: '00000000-0000-4000-8000-000000000010',
          sourceStatus: 'todo',
          sourcePosition: 0,
          destinationStatus: 'blocked',
          destinationIndex: 1,
          completedAt: '2026-08-01T10:00:00.000Z',
        },
      };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.moveTask.mockResolvedValue({
        task,
        operationId: '00000000-0000-4000-8000-000000000010',
        orderedTaskIds: ['b1', 't1', 'b2'],
        replayed: true,
      });
      mockActivityService.logActivityOnce.mockResolvedValueOnce({ activity: {}, created: false });

      const res = await request(app)
        .post('/api/tasks/t1/move')
        .set('If-Match', '"task:t1:4"')
        .send({
          operationId: '00000000-0000-4000-8000-000000000010',
          sourceStatus: 'todo',
          sourcePosition: 0,
          destinationStatus: 'blocked',
          destinationIndex: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.replayed).toBe(true);
      expect(mockActivityService.logActivityOnce).toHaveBeenCalledOnce();
      expect(mockActivityService.logActivityOnce).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000010',
        'status_changed',
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ from: 'todo', status: 'blocked' }),
        undefined,
        'system:unknown'
      );
      expect(mockBroadcastTaskChange).not.toHaveBeenCalled();
      expect(mockSyncTaskStatusToGitHub).toHaveBeenCalledWith(task);
    });

    it('returns the committed move when activity persistence is temporarily unavailable', async () => {
      const task = { id: 't1', title: 'Task', status: 'todo', revision: 1 };
      const moved = {
        ...task,
        status: 'blocked',
        position: 0,
        boardRank: 'v1:0/1',
        revision: 2,
        lastBoardMove: {
          operationId: '00000000-0000-4000-8000-000000000011',
          sourceStatus: 'todo',
          sourcePosition: null,
          destinationStatus: 'blocked',
          destinationIndex: 0,
          completedAt: '2026-08-01T10:00:00.000Z',
        },
      };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.moveTask.mockResolvedValue({
        task: moved,
        operationId: '00000000-0000-4000-8000-000000000011',
        orderedTaskIds: ['t1'],
        replayed: false,
      });
      mockActivityService.logActivityOnce.mockRejectedValueOnce(new Error('activity unavailable'));

      const res = await request(app)
        .post('/api/tasks/t1/move')
        .set('If-Match', '"task:t1:1"')
        .send({
          operationId: '00000000-0000-4000-8000-000000000011',
          sourceStatus: 'todo',
          sourcePosition: null,
          destinationStatus: 'blocked',
          destinationIndex: 0,
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ task: moved, replayed: false });
      await vi.waitFor(() => {
        expect(mockActivityService.logActivityOnce).toHaveBeenCalledTimes(2);
      });
      expect(mockBroadcastTaskChange).toHaveBeenCalledWith('moved', 't1', undefined, {
        operationId: '00000000-0000-4000-8000-000000000011',
      });
      expect(mockBroadcastTaskChange).toHaveBeenCalledWith('updated', 't1', undefined, {
        operationId: '00000000-0000-4000-8000-000000000011',
      });
      expect(
        mockBroadcastTaskChange.mock.calls.filter(([changeType]) => changeType === 'moved')
      ).toHaveLength(1);
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
    it('accepts critical priority on creation', async () => {
      mockTaskService.createTask.mockImplementation(async (input) => ({
        id: 'critical-task',
        ...input,
      }));
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Urgent repair', priority: 'critical' });
      expect(res.status).toBe(201);
      expect(res.body.priority).toBe('critical');
      expect(mockTaskService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'critical' })
      );
    });

    it('rejects unknown priority before creation', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Invalid priority', priority: 'urgent' });
      expect(res.status).toBe(400);
      expect(mockTaskService.createTask).not.toHaveBeenCalled();
    });

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
      expect(mockTaskService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'medium' })
      );
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
    it('accepts critical priority on update', async () => {
      const task = { id: 'critical-task', title: 'Urgent repair', status: 'todo' };
      mockTaskService.getTask.mockResolvedValue(task);
      mockTaskService.updateTask.mockImplementation(async (_id, input) => ({ ...task, ...input }));
      const res = await request(app)
        .patch('/api/tasks/critical-task')
        .send({ priority: 'critical' });
      expect(res.status).toBe(200);
      expect(res.body.priority).toBe('critical');
      expect(mockTaskService.updateTask).toHaveBeenCalledWith(
        'critical-task',
        expect.objectContaining({ priority: 'critical' })
      );
    });

    it('should update a task', async () => {
      const oldTask = { id: 't1', title: 'Old', status: 'todo', created: '2025-01-01' };
      const updatedTask = { ...oldTask, title: 'Updated' };
      mockTaskService.getTask.mockResolvedValue(oldTask);
      mockTaskService.updateTask.mockResolvedValue(updatedTask);

      const res = await request(app).patch('/api/tasks/t1').send({ title: 'Updated' });
      expect(res.status).toBe(200);
    });

    it('should accept current and custom attempt agent slugs', async () => {
      const oldTask = { id: 't1', title: 'Old', status: 'todo', created: '2025-01-01' };
      mockTaskService.getTask.mockResolvedValue(oldTask);
      mockTaskService.updateTask.mockImplementation(async (_id, input) => ({
        ...oldTask,
        ...input,
      }));

      for (const agent of ['codex', 'ollama-local', 'lm-studio-local', 'custom-router']) {
        const res = await request(app)
          .patch('/api/tasks/t1')
          .send({
            attempt: {
              id: `attempt_${agent.replaceAll('-', '_')}`,
              agent,
              status: 'running',
              provider: agent,
              model: agent === 'ollama-local' ? 'llama3.2' : undefined,
              threadId: 'thread_docs_refresh',
              cloudTarget: agent === 'custom-router' ? 'local-lab' : undefined,
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.attempt.agent).toBe(agent);
      }

      expect(mockTaskService.updateTask).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          attempt: expect.objectContaining({
            agent: 'ollama-local',
            provider: 'ollama-local',
            model: 'llama3.2',
            threadId: 'thread_docs_refresh',
          }),
        })
      );
    });

    it('should still reject invalid attempt status', async () => {
      mockTaskService.getTask.mockResolvedValue({
        id: 't1',
        title: 'Old',
        status: 'todo',
        created: '2025-01-01',
      });

      const res = await request(app)
        .patch('/api/tasks/t1')
        .send({
          attempt: {
            id: 'attempt_bad',
            agent: 'codex',
            status: 'stuck',
          },
        });

      expect(res.status).toBe(400);
      expect(mockTaskService.updateTask).not.toHaveBeenCalled();
    });

    it.each(['HEAD:refs/heads/canary', '+HEAD:refs/heads/main', '-force-like-option'])(
      'rejects invalid task branch %s at the route boundary',
      async (branch) => {
        const res = await request(app)
          .patch('/api/tasks/t1')
          .send({ git: { repo: 'veritas', branch, baseBranch: 'main' } });

        expect(res.status).toBe(400);
        expect(mockTaskService.updateTask).not.toHaveBeenCalled();
      }
    );

    it('rejects generic PATCH attempts that mutate authoritative run contracts', async () => {
      for (const field of ['taskEnvelope', 'completionResult']) {
        const res = await request(app)
          .patch('/api/tasks/t1')
          .send({
            attempt: {
              id: 'attempt_forged',
              agent: 'codex',
              status: 'running',
              [field]: {},
            },
          });

        expect(res.status).toBe(400);
      }
      expect(mockTaskService.updateTask).not.toHaveBeenCalled();
    });

    it('preserves authoritative run contracts when patching the same attempt', async () => {
      const taskEnvelope = { digest: 'immutable-envelope' };
      const completionResult = { status: 'success' };
      mockTaskService.getTask.mockResolvedValue({
        id: 't1',
        title: 'Old',
        status: 'in-progress',
        attempt: {
          id: 'attempt_1',
          agent: 'codex',
          status: 'running',
          taskEnvelope,
          completionResult,
        },
      });
      mockTaskService.updateTask.mockImplementation(async (_id, input) => input);

      const res = await request(app)
        .patch('/api/tasks/t1')
        .send({ attempt: { id: 'attempt_1', agent: 'codex', status: 'complete' } });

      expect(res.status).toBe(200);
      expect(mockTaskService.updateTask).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          attempt: expect.objectContaining({ taskEnvelope, completionResult }),
        })
      );
    });

    it('rejects replacing an attempt that owns authoritative run contracts', async () => {
      mockTaskService.getTask.mockResolvedValue({
        id: 't1',
        title: 'Old',
        status: 'in-progress',
        attempt: {
          id: 'attempt_1',
          agent: 'codex',
          status: 'running',
          taskEnvelope: { digest: 'immutable-envelope' },
        },
      });

      const res = await request(app)
        .patch('/api/tasks/t1')
        .send({ attempt: { id: 'attempt_2', agent: 'codex', status: 'running' } });

      expect(res.status).toBe(400);
      expect(mockTaskService.updateTask).not.toHaveBeenCalled();
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
        expect.objectContaining({ from: 'todo', status: 'done', actor: 'system:unknown' }),
        updatedTask.agent,
        'system:unknown'
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
      const oldTask = { id: 't1', status: 'blocked', title: 'Task', blockedBy: ['t2'] };
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
      mockTaskService.archiveTask.mockResolvedValue(true);

      const res = await request(app).delete('/api/tasks/t1');
      expect(res.status).toBe(204);
      expect(mockTaskService.archiveTask).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ deletedBy: 'system:unknown' })
      );
    });

    it('should return 404 for missing task', async () => {
      mockTaskService.getTask.mockResolvedValue(null);
      mockTaskService.archiveTask.mockResolvedValue(false);

      const res = await request(app).delete('/api/tasks/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('Worktree routes', () => {
    it('POST should create worktree', async () => {
      mockWorktreeService.createWorktree.mockResolvedValue({ path: '/tmp/wt', branch: 'task/t1' });
      const res = await request(app).post('/api/tasks/t1/worktree');
      expect(res.status).toBe(201);
      expect(mockWorktreeService.createWorktree).toHaveBeenCalledWith('t1', {});
    });

    it('POST requires a reasoned stale-base acknowledgement', async () => {
      const invalid = await request(app)
        .post('/api/tasks/t1/worktree')
        .send({ allowStaleBase: true });
      expect(invalid.status).toBe(400);

      mockWorktreeService.createWorktree.mockResolvedValue({ path: '/tmp/wt' });
      const valid = await request(app)
        .post('/api/tasks/t1/worktree')
        .send({
          allowStaleBase: true,
          staleBaseAcknowledgement: { reason: 'Confirmed offline maintenance.' },
        });

      expect(valid.status).toBe(201);
      expect(mockWorktreeService.createWorktree).toHaveBeenCalledWith('t1', {
        allowStaleBase: true,
        staleBaseAcknowledgement: {
          reason: 'Confirmed offline maintenance.',
          actor: 'system:unknown',
        },
      });
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
      expect(mockWorktreeService.deleteWorktree).toHaveBeenCalledWith('t1', {
        force: false,
        reason: undefined,
        actor: 'system:unknown',
      });
    });

    it('DELETE with force=true requires and records an explicit reason', async () => {
      mockWorktreeService.deleteWorktree.mockResolvedValue(undefined);
      const rejected = await request(app).delete('/api/tasks/t1/worktree?force=true');
      expect(rejected.status).toBe(400);

      const res = await request(app)
        .delete('/api/tasks/t1/worktree')
        .query({ force: 'true', reason: 'Operator inspected and accepted the risk.' });
      expect(res.status).toBe(204);
      expect(mockWorktreeService.deleteWorktree).toHaveBeenCalledWith('t1', {
        force: true,
        reason: 'Operator inspected and accepted the risk.',
        actor: 'service:unknown',
      });
    });

    it('requires admin permission for reasoned cleanup overrides', async () => {
      const agentApp = express();
      agentApp.use(express.json());
      agentApp.use((req, _res, next) => {
        (req as import('../../middleware/auth.js').AuthenticatedRequest).auth = {
          role: 'agent',
          isLocalhost: false,
          permissions: ['task:write'],
        };
        next();
      });
      agentApp.use('/api/tasks', taskRoutes);
      agentApp.use(errorHandler);

      const res = await request(agentApp)
        .delete('/api/tasks/t1/worktree')
        .query({ force: 'true', reason: 'Agent attempts to bypass safety.' });

      expect(res.status).toBe(403);
      expect(mockWorktreeService.deleteWorktree).not.toHaveBeenCalled();
    });

    it('adopts a validated legacy worktree through an admin-only endpoint', async () => {
      mockWorktreeService.adoptLegacyWorktree.mockResolvedValue({
        path: '/tmp/legacy-worktree',
      });

      const res = await request(app).post('/api/tasks/t1/worktree/adopt');

      expect(res.status).toBe(201);
      expect(mockWorktreeService.adoptLegacyWorktree).toHaveBeenCalledWith('t1');
    });

    it('GET cleanup previews should remain read-only', async () => {
      mockWorktreeService.previewCleanup.mockResolvedValue({ eligible: false });
      mockWorktreeService.previewCleanupCandidates.mockResolvedValue([{ taskId: 't1' }]);

      const taskPreview = await request(app).get('/api/tasks/t1/worktree/cleanup-preview');
      const stalePreview = await request(app).get('/api/tasks/worktrees/cleanup-preview');

      expect(taskPreview.status).toBe(200);
      expect(stalePreview.status).toBe(200);
      expect(mockWorktreeService.deleteWorktree).not.toHaveBeenCalled();
    });

    it('POST /rebase should rebase', async () => {
      mockWorktreeService.rebaseWorktree.mockResolvedValue({ status: 'ok' });
      const res = await request(app).post('/api/tasks/t1/worktree/rebase');
      expect(res.status).toBe(200);
    });

    it('POST /merge should merge', async () => {
      mockWorktreeService.mergeWorktree.mockResolvedValue({
        merged: true,
        targetCommit: 'a'.repeat(40),
      });
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
