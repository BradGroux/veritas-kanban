/**
 * Tasks Route Integration Tests
 * Tests CRUD operations for /api/tasks endpoints
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import express from 'express';
import { TaskService } from '../../services/task-service.js';
import { taskRoutes } from '../../routes/tasks.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Tasks Routes', () => {
  let app: express.Express;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;
  let taskService: TaskService;

  beforeEach(async () => {
    // Create fresh test directories
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-routes-${uniqueSuffix}`);
    tasksDir = path.join(testRoot, 'active');
    archiveDir = path.join(testRoot, 'archive');
    
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
    
    // Create TaskService with test directories
    taskService = new TaskService({ tasksDir, archiveDir });
    
    // Create app with mocked routes
    app = express();
    app.use(express.json());
    
    // Create a router that uses our test TaskService
    const router = express.Router();
    
    // GET /api/tasks - List all tasks
    router.get('/', async (_req, res) => {
      const tasks = await taskService.listTasks();
      res.json(tasks);
    });
    
    // POST /api/tasks - Create task
    router.post('/', async (req, res) => {
      try {
        const task = await taskService.createTask(req.body);
        res.status(201).json(task);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });
    
    // GET /api/tasks/:id - Get single task
    router.get('/:id', async (req, res) => {
      const task = await taskService.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json(task);
    });
    
    // PATCH /api/tasks/:id - Update task
    router.patch('/:id', async (req, res) => {
      const task = await taskService.updateTask(req.params.id, req.body);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json(task);
    });
    
    // DELETE /api/tasks/:id - Delete task
    router.delete('/:id', async (req, res) => {
      const success = await taskService.deleteTask(req.params.id);
      if (!success) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.status(204).send();
    });
    
    // POST /api/tasks/reorder - Reorder tasks
    router.post('/reorder', async (req, res) => {
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        return res.status(400).json({ error: 'orderedIds must be a non-empty array' });
      }
      const updated = await taskService.reorderTasks(orderedIds);
      res.json({ updated: updated.length });
    });
    
    app.use('/api/tasks', router);
    app.use(errorHandler);
  });

  afterEach(async () => {
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('GET /api/tasks', () => {
    it('should return empty array when no tasks exist', async () => {
      const res = await request(app).get('/api/tasks');
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return all tasks', async () => {
      await taskService.createTask({ title: 'Task 1' });
      await taskService.createTask({ title: 'Task 2' });
      
      const res = await request(app).get('/api/tasks');
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((t: any) => t.title)).toContain('Task 1');
      expect(res.body.map((t: any) => t.title)).toContain('Task 2');
    });
  });

  describe('POST /api/tasks', () => {
    it('should create a task with minimal fields', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'New Task' });
      
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('New Task');
      expect(res.body.id).toMatch(/^task_/);
      expect(res.body.status).toBe('todo');
      expect(res.body.priority).toBe('medium');
      expect(res.body.type).toBe('code');
    });

    it('should create a task with all fields', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({
          title: 'Full Task',
          description: 'Detailed description',
          type: 'research',
          priority: 'high',
          project: 'test-project',
          sprint: 'US-100',
        });
      
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Full Task');
      expect(res.body.description).toBe('Detailed description');
      expect(res.body.type).toBe('research');
      expect(res.body.priority).toBe('high');
      expect(res.body.project).toBe('test-project');
      expect(res.body.sprint).toBe('US-100');
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('should return a task by id', async () => {
      const task = await taskService.createTask({ title: 'Fetch Me' });
      
      const res = await request(app).get(`/api/tasks/${task.id}`);
      
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(task.id);
      expect(res.body.title).toBe('Fetch Me');
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app).get('/api/tasks/nonexistent_id');
      
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('should update task fields', async () => {
      const task = await taskService.createTask({ title: 'Original' });
      
      const res = await request(app)
        .patch(`/api/tasks/${task.id}`)
        .send({
          title: 'Updated',
          status: 'in-progress',
          priority: 'high',
        });
      
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated');
      expect(res.body.status).toBe('in-progress');
      expect(res.body.priority).toBe('high');
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .patch('/api/tasks/nonexistent_id')
        .send({ title: 'Will Fail' });
      
      expect(res.status).toBe(404);
    });

    it('should update only provided fields', async () => {
      const task = await taskService.createTask({
        title: 'Original Title',
        description: 'Original Desc',
        priority: 'low',
      });
      
      const res = await request(app)
        .patch(`/api/tasks/${task.id}`)
        .send({ priority: 'high' });
      
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Original Title');
      expect(res.body.description).toBe('Original Desc');
      expect(res.body.priority).toBe('high');
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('should delete a task', async () => {
      const task = await taskService.createTask({ title: 'Delete Me' });
      
      const res = await request(app).delete(`/api/tasks/${task.id}`);
      
      expect(res.status).toBe(204);
      
      // Verify task is gone
      const tasks = await taskService.listTasks();
      expect(tasks).toHaveLength(0);
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app).delete('/api/tasks/nonexistent_id');
      
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/tasks/reorder', () => {
    it('should reorder tasks', async () => {
      const task1 = await taskService.createTask({ title: 'Task 1' });
      const task2 = await taskService.createTask({ title: 'Task 2' });
      const task3 = await taskService.createTask({ title: 'Task 3' });
      
      const res = await request(app)
        .post('/api/tasks/reorder')
        .send({ orderedIds: [task3.id, task1.id, task2.id] });
      
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(3);
      
      // Verify positions
      const tasks = await taskService.listTasks();
      const taskMap = new Map(tasks.map(t => [t.id, t]));
      expect(taskMap.get(task3.id)?.position).toBe(0);
      expect(taskMap.get(task1.id)?.position).toBe(1);
      expect(taskMap.get(task2.id)?.position).toBe(2);
    });

    it('should reject empty orderedIds', async () => {
      const res = await request(app)
        .post('/api/tasks/reorder')
        .send({ orderedIds: [] });
      
      expect(res.status).toBe(400);
    });

    it('should reject missing orderedIds', async () => {
      const res = await request(app)
        .post('/api/tasks/reorder')
        .send({});
      
      expect(res.status).toBe(400);
    });
  });
});
