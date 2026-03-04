import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { errorHandler } from '../../middleware/error-handler.js';

let app: express.Express;
let testRoot: string;

let taskRoutes: typeof import('../../routes/tasks.js').taskRoutes;
let agentRegistryRoutes: typeof import('../../routes/agent-registry.js').agentRegistryRoutes;
let disposeTaskService: typeof import('../../services/task-service.js').disposeTaskService;
let disposeAgentRegistryService: typeof import('../../services/agent-registry-service.js').disposeAgentRegistryService;

function unwrap<T>(body: any): T {
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    return body.data as T;
  }
  return body as T;
}

describe('Task ↔ Agent registry sync (route-level integration)', () => {
  beforeAll(async () => {
    const uniqueSuffix = Math.random().toString(36).slice(2, 8);
    testRoot = path.join(os.tmpdir(), `veritas-task-agent-sync-${uniqueSuffix}`);
    await fs.mkdir(testRoot, { recursive: true });

    // Isolate all storage for this test file.
    process.env.VERITAS_DATA_DIR = testRoot;
    process.env.DATA_DIR = testRoot;
    process.env.VERITAS_TASK_SYNC_FLAP_GUARD_MS = '0';

    ({ taskRoutes } = await import('../../routes/tasks.js'));
    ({ agentRegistryRoutes } = await import('../../routes/agent-registry.js'));
    ({ disposeTaskService } = await import('../../services/task-service.js'));
    ({ disposeAgentRegistryService } = await import('../../services/agent-registry-service.js'));

    app = express();
    app.use(express.json());
    app.use('/api/tasks', taskRoutes);
    app.use('/api/agents/register', agentRegistryRoutes);
    app.use(errorHandler);
  });

  afterAll(async () => {
    disposeTaskService();
    disposeAgentRegistryService();
    delete process.env.VERITAS_TASK_SYNC_FLAP_GUARD_MS;
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('syncs agent busy/idle state from task route transitions with registry readback', async () => {
    const agentId = 'route-sync-agent-1';

    // 1) Register agent.
    const reg = await request(app)
      .post('/api/agents/register')
      .send({
        id: agentId,
        name: 'Route Sync Agent',
        capabilities: [{ name: 'code' }],
      });

    expect(reg.status).toBe(201);

    // 2) Create task assigned to this agent.
    const created = await request(app).post('/api/tasks').send({
      title: 'Route sync smoke task',
      type: 'feature',
      priority: 'high',
      agent: agentId,
    });

    expect(created.status).toBe(201);
    const createdTask = unwrap<{ id: string; status: string }>(created.body);
    expect(createdTask.id).toMatch(/^task_/);
    expect(createdTask.status).toBe('todo');

    // 3) Move task to in-progress => registry should reflect busy + currentTaskId.
    const toInProgress = await request(app)
      .patch(`/api/tasks/${createdTask.id}`)
      .send({ status: 'in-progress' });

    expect(toInProgress.status).toBe(200);

    const agentBusy = await request(app).get(`/api/agents/register/${agentId}`);
    expect(agentBusy.status).toBe(200);
    expect(agentBusy.body.status).toBe('busy');
    expect(agentBusy.body.currentTaskId).toBe(createdTask.id);

    // 4) Move task to done => registry should return to idle + clear task.
    // Test forces flap guard to 0ms (VERITAS_TASK_SYNC_FLAP_GUARD_MS) for deterministic timing.
    const toDone = await request(app)
      .patch(`/api/tasks/${createdTask.id}`)
      .send({ status: 'done' });
    expect(toDone.status).toBe(200);

    const agentIdle = await request(app).get(`/api/agents/register/${agentId}`);
    expect(agentIdle.status).toBe(200);
    expect(agentIdle.body.status).toBe('idle');
    expect(agentIdle.body.currentTaskId).toBeUndefined();
  }, 20_000);
});
