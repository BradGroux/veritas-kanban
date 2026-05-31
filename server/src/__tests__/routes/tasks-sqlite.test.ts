import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { TaskService } from '../../services/task-service.js';
import { TelemetryService } from '../../services/telemetry-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';
import { errorHandler } from '../../middleware/error-handler.js';

describe('Tasks Routes with SQLite TaskService', () => {
  let app: express.Express;
  let fixture: TestSqliteDatabase;
  let taskService: TaskService;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-routes-sqlite-'));

    taskService = new TaskService({
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
      tasksDir: path.join(testRoot, 'tasks', 'active'),
      archiveDir: path.join(testRoot, 'tasks', 'archive'),
      telemetryService: new TelemetryService({
        telemetryDir: path.join(testRoot, 'telemetry'),
        config: { enabled: false },
      }),
    });

    const router = express.Router();
    router.get('/', async (_req, res) => {
      res.json(await taskService.listTasks());
    });
    router.post('/', async (req, res) => {
      res.status(201).json(await taskService.createTask(req.body));
    });
    router.patch('/:id', async (req, res) => {
      const task = await taskService.updateTask(req.params.id, req.body);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      res.json(task);
    });
    router.delete('/:id', async (req, res) => {
      const deleted = await taskService.deleteTask(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      res.status(204).send();
    });
    router.post('/reorder', async (req, res) => {
      res.json({ updated: (await taskService.reorderTasks(req.body.orderedIds)).length });
    });

    app = express();
    app.use(express.json());
    app.use('/api/tasks', router);
    app.use(errorHandler);
  });

  afterEach(async () => {
    taskService.dispose();
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('returns equivalent CRUD responses without task markdown files', async () => {
    const createRes = await request(app).post('/api/tasks').send({
      title: 'SQLite API task',
      description: 'Created through the API route shape',
      type: 'feature',
      priority: 'high',
      project: 'veritas',
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.title).toBe('SQLite API task');
    expect(createRes.body.status).toBe('todo');

    const patchRes = await request(app)
      .patch(`/api/tasks/${createRes.body.id}`)
      .send({ title: 'Updated SQLite API task', position: 2 });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.title).toBe('Updated SQLite API task');
    expect(patchRes.body.position).toBe(2);

    const listRes = await request(app).get('/api/tasks');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const deleteRes = await request(app).delete(`/api/tasks/${createRes.body.id}`);
    expect(deleteRes.status).toBe(204);

    const emptyListRes = await request(app).get('/api/tasks');
    expect(emptyListRes.body).toEqual([]);

    await expect(fs.readdir(path.join(testRoot, 'tasks', 'active'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('supports reorder responses with SQLite-backed position updates', async () => {
    const first = await taskService.createTask({ title: 'First' });
    const second = await taskService.createTask({ title: 'Second' });

    const reorderRes = await request(app)
      .post('/api/tasks/reorder')
      .send({ orderedIds: [second.id, first.id] });

    expect(reorderRes.status).toBe(200);
    expect(reorderRes.body.updated).toBe(2);
    expect((await taskService.getTask(second.id))?.position).toBe(0);
    expect((await taskService.getTask(first.id))?.position).toBe(1);
  });
});
