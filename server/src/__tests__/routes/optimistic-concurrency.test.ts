import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Task } from '@veritas-kanban/shared';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

let app: express.Express;
let testRoot: string;
let disposeTaskService: (() => void) | undefined;
let disposeWorkflowService: (() => void) | undefined;

function unwrap<T>(body: unknown): T {
  if (
    body &&
    typeof body === 'object' &&
    (body as { success?: unknown }).success === true &&
    'data' in body
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}

interface ApiErrorBody {
  code: string;
  message: string;
  details?: {
    resourceType?: string;
    resourceId?: string;
    expectedRevision?: number;
    currentRevision?: number;
    current?: Record<string, unknown>;
  };
}

function unwrapError(body: unknown): ApiErrorBody {
  if (
    body &&
    typeof body === 'object' &&
    (body as { success?: unknown }).success === false &&
    'error' in body
  ) {
    return (body as { error: ApiErrorBody }).error;
  }
  return body as ApiErrorBody;
}

function workflow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'route-concurrency',
    name: 'Route Concurrency',
    version: 1,
    description: 'Initial workflow',
    agents: [
      {
        id: 'agent-1',
        name: 'Agent 1',
        role: 'developer',
        description: 'Handles implementation work',
      },
    ],
    steps: [
      {
        id: 'step-1',
        name: 'Implement',
        type: 'agent',
        agent: 'agent-1',
        input: 'Do the work',
      },
    ],
    ...overrides,
  };
}

describe('route-level optimistic concurrency', () => {
  beforeEach(async () => {
    vi.resetModules();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-concurrency-'));
    process.env.VERITAS_DATA_DIR = testRoot;
    process.env.DATA_DIR = testRoot;
    process.env.VERITAS_DISABLE_WATCHERS = '1';
    process.env.VERITAS_TASK_SYNC_FLAP_GUARD_MS = '0';

    const [
      { taskRoutes },
      { taskCommentRoutes },
      { workflowRoutes },
      taskService,
      workflowService,
      { errorHandler },
    ] = await Promise.all([
      import('../../routes/tasks.js'),
      import('../../routes/task-comments.js'),
      import('../../routes/workflows.js'),
      import('../../services/task-service.js'),
      import('../../services/workflow-service.js'),
      import('../../middleware/error-handler.js'),
    ]);
    disposeTaskService = taskService.disposeTaskService;
    disposeWorkflowService = workflowService.disposeWorkflowService;

    app = express();
    app.use(express.json());
    app.use((req: AuthenticatedRequest, _res, next) => {
      req.auth = {
        role: 'admin',
        keyName: 'route-test-admin',
        isLocalhost: false,
        userId: 'route-test-user',
        workspaceId: 'local',
        actorType: 'user',
        authMethod: 'session',
        permissions: ['*'],
      };
      next();
    });
    app.use('/api/tasks', taskRoutes);
    app.use('/api/tasks', taskCommentRoutes);
    app.use('/api/workflows', workflowRoutes);
    app.use(errorHandler);
  });

  afterEach(async () => {
    disposeTaskService?.();
    disposeWorkflowService?.();
    delete process.env.VERITAS_DATA_DIR;
    delete process.env.DATA_DIR;
    delete process.env.VERITAS_DISABLE_WATCHERS;
    delete process.env.VERITAS_TASK_SYNC_FLAP_GUARD_MS;
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects stale task updates with current task metadata', async () => {
    const createRes = await request(app).post('/api/tasks').send({
      title: 'Concurrent task',
      type: 'feature',
      priority: 'high',
    });
    expect(createRes.status).toBe(201);
    const created = unwrap<Task>(createRes.body);

    const loaded = await request(app).get(`/api/tasks/${created.id}`);
    const firstEtag = loaded.headers.etag as string;
    expect(firstEtag).toBe(`"task:${created.id}:1"`);

    const firstUpdate = await request(app)
      .patch(`/api/tasks/${created.id}`)
      .set('If-Match', firstEtag)
      .send({ title: 'First client update' });
    expect(firstUpdate.status).toBe(200);
    const firstTask = unwrap<Task>(firstUpdate.body);
    expect(firstTask.revision).toBe(2);
    expect(firstTask.updatedBy).toBe('user:route-test-user');
    expect(firstUpdate.headers['x-resource-revision']).toBe('2');

    const staleUpdate = await request(app)
      .patch(`/api/tasks/${created.id}`)
      .set('If-Match', firstEtag)
      .send({ title: 'Second client stale update' });
    expect(staleUpdate.status).toBe(409);
    const error = unwrapError(staleUpdate.body);
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toMatchObject({
      resourceType: 'task',
      resourceId: created.id,
      expectedRevision: 1,
      currentRevision: 2,
    });
    expect(error.details?.current?.title).toBe('First client update');
  });

  it('rejects stale comment edits against the parent task revision', async () => {
    const createRes = await request(app)
      .post('/api/tasks')
      .send({ title: 'Comment race', type: 'feature', priority: 'medium' });
    const task = unwrap<Task>(createRes.body);

    const addRes = await request(app)
      .post(`/api/tasks/${task.id}/comments`)
      .set('If-Match', createRes.headers.etag as string)
      .send({ author: 'Tester', text: 'Original comment' });
    expect(addRes.status).toBe(201);
    const withComment = unwrap<Task>(addRes.body);
    const commentId = withComment.comments?.[0]?.id;
    expect(commentId).toBeTruthy();

    const loaded = await request(app).get(`/api/tasks/${task.id}`);
    const editEtag = loaded.headers.etag as string;

    const firstEdit = await request(app)
      .patch(`/api/tasks/${task.id}/comments/${commentId}`)
      .set('If-Match', editEtag)
      .send({ text: 'First edit wins' });
    expect(firstEdit.status).toBe(200);
    expect(unwrap<Task>(firstEdit.body).comments?.[0]).toMatchObject({
      text: 'First edit wins',
      updatedBy: 'user:route-test-user',
      revision: 2,
    });

    const staleEdit = await request(app)
      .patch(`/api/tasks/${task.id}/comments/${commentId}`)
      .set('If-Match', editEtag)
      .send({ text: 'Second edit is stale' });
    expect(staleEdit.status).toBe(409);
    const error = unwrapError(staleEdit.body);
    expect(error.details).toMatchObject({
      resourceType: 'task',
      resourceId: task.id,
      expectedRevision: 2,
      currentRevision: 3,
    });
    const currentComments = error.details?.current?.comments as Array<{ text: string }> | undefined;
    expect(currentComments?.[0]?.text).toBe('First edit wins');
  });

  it('rejects stale workflow updates using workflow versions as revisions', async () => {
    const initialWorkflow = workflow();
    const createRes = await request(app).post('/api/workflows').send(initialWorkflow);
    expect(createRes.status).toBe(201);

    const loaded = await request(app).get('/api/workflows/route-concurrency');
    const workflowEtag = loaded.headers.etag as string;
    expect(workflowEtag).toBe('"workflow:route-concurrency:1"');

    const firstUpdate = await request(app)
      .put('/api/workflows/route-concurrency')
      .set('If-Match', workflowEtag)
      .send({ ...initialWorkflow, description: 'First workflow update' });
    expect(firstUpdate.status).toBe(200);
    expect(firstUpdate.body.version).toBe(2);
    expect(firstUpdate.headers['x-resource-revision']).toBe('2');

    const staleUpdate = await request(app)
      .put('/api/workflows/route-concurrency')
      .set('If-Match', workflowEtag)
      .send({ ...initialWorkflow, description: 'Second stale workflow update' });
    expect(staleUpdate.status).toBe(409);
    const error = unwrapError(staleUpdate.body);
    expect(error.details).toMatchObject({
      resourceType: 'workflow',
      resourceId: 'route-concurrency',
      expectedRevision: 1,
      currentRevision: 2,
    });
    expect(error.details?.current?.description).toBe('First workflow update');
  });
});
