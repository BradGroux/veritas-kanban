import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest, AuthPermission } from '../../middleware/auth.js';
import type { Task } from '@veritas-kanban/shared';

const calls = vi.hoisted(() => ({
  preview: vi.fn(),
  start: vi.fn(),
  resume: vi.fn(),
  followUp: vi.fn(),
  fork: vi.fn(),
  interrupt: vi.fn(),
  compact: vi.fn(),
  archive: vi.fn(),
  close: vi.fn(),
  steer: vi.fn(),
}));
// Keep the actual router, validators and capability controls. Only executable
// provider operations are replaced; these fixtures must never dispatch a run.
vi.mock('../../services/clawdbot-agent-service.js', () => ({
  AgentReadinessError: class AgentReadinessError extends Error {},
  clawdbotAgentService: {
    previewAgentLaunch: calls.preview,
    startAgent: calls.start,
    resumeConversation: calls.resume,
    followUpConversation: calls.followUp,
    forkConversation: calls.fork,
    interruptConversation: calls.interrupt,
    compactConversation: calls.compact,
    archiveConversation: calls.archive,
    closeConversation: calls.close,
    sendMessage: calls.steer,
  },
}));
vi.mock('../../services/gateway-chat-client.js', () => ({
  loadGatewayToken: async () => '',
  sendGatewayChat: async () => {
    throw new Error('Gateway chat is outside this fixture');
  },
}));
let root: string;
let app: express.Express;
let tasks: typeof import('../../services/task-service.js');
let workflows: typeof import('../../services/workflow-service.js');
let task: Task;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-v1-permission-'));
  vi.stubEnv('VERITAS_DATA_DIR', root);
  vi.stubEnv('DATA_DIR', root);
  vi.stubEnv('VERITAS_STORAGE', 'file');
  vi.stubEnv('VERITAS_DISABLE_WATCHERS', '1');
  vi.stubEnv('RATE_LIMIT_WRITE_MAX', '5000');
  vi.stubEnv('RATE_LIMIT_MAX', '5000');
  const [{ v1Router }, auth, { errorHandler }] = await Promise.all([
    import('../../routes/v1/index.js'),
    import('../../middleware/auth.js'),
    import('../../middleware/error-handler.js'),
  ]);
  tasks = await import('../../services/task-service.js');
  workflows = await import('../../services/workflow-service.js');
  app = express();
  app.use(express.json());
  app.use((req: AuthenticatedRequest, _res, next) => {
    if (req.headers['x-fixture-scopes'] !== undefined)
      req.auth = {
        role: 'agent',
        isLocalhost: false,
        workspaceId: 'fixture-workspace',
        userId: 'fixture-user',
        actorType: 'user',
        authMethod: 'api-key',
        permissions: String(req.headers['x-fixture-scopes'])
          .split(',')
          .filter(Boolean) as AuthPermission[],
        clientMode: req.headers['x-fixture-remote'] ? 'desktop-remote' : 'cli',
      };
    next();
  });
  // Match the production write-role boundary and both real router mounts.
  app.use('/api', auth.authorizeWrite);
  app.use('/api/v1', v1Router);
  app.use('/api', v1Router);
  app.use(errorHandler);
});
beforeEach(async () => {
  vi.clearAllMocks();
  task = await tasks
    .getTaskService()
    .createTask({ title: 'Permission composition fixture', type: 'code' });
  for (const operation of Object.values(calls))
    operation.mockResolvedValue({ taskId: task.id, fixture: true });
});
afterAll(async () => {
  tasks?.disposeTaskService();
  workflows?.disposeWorkflowService();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
function scoped(test: request.Test, permission: string) {
  return test.set('X-Fixture-Scopes', permission);
}
function unwrap<T>(body: unknown): T {
  return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
}

describe.each(['/api', '/api/v1', '/API/V1'])('assembled permission routing at %s', (base) => {
  const literal = (value: string) => (base === '/API/V1' ? value.toUpperCase() : value);
  const taskPath = () => `${base}/${literal('tasks')}/${task.id}`;
  const agentPath = () => `${base}/${literal('agents')}/${task.id}`;

  it('allows a comment-only token through earlier unmatched task routers', async () => {
    const response = await scoped(
      request(app).post(`${taskPath()}/${literal('comments')}`),
      'comment:write'
    ).send({ author: 'Fixture', text: 'Scoped comment' });
    expect(response.status).toBe(201);
    expect(unwrap<Task>(response.body).id).toBe(task.id);
    expect((await tasks.getTaskService().getTask(task.id))?.comments?.[0].text).toBe(
      'Scoped comment'
    );
  });

  it('allows task work products under their own read/write scopes', async () => {
    const body = {
      kind: 'text',
      title: 'Scoped work product',
      render: { schemaVersion: 1, kind: 'text', text: 'Fixture result' },
    };
    const created = await scoped(
      request(app).post(`${taskPath()}/${literal('work-products')}`),
      'work_product:write'
    ).send(body);
    expect(created.status).toBe(201);
    const listed = await scoped(
      request(app).get(`${taskPath()}/${literal('work-products')}`),
      'work_product:read'
    );
    expect(listed.status).toBe(200);
    expect(unwrap(listed.body)).toEqual([
      expect.objectContaining({
        taskId: task.id,
        title: body.title,
        workspaceId: 'fixture-workspace',
      }),
    ]);
  });

  it('allows read-like launch previews with agent read permission only', async () => {
    const response = await scoped(
      request(app).post(`${agentPath()}/${literal('launch-preview')}`),
      'agent:read'
    ).send({});
    expect(response.status).toBe(200);
    expect(calls.preview).toHaveBeenCalledWith(task.id, undefined, expect.any(Object));
    expect(calls.start).not.toHaveBeenCalled();
  });

  it.each([
    'fresh',
    'resume',
    'follow-up',
    'fork',
    'interrupt',
    'compact',
    'archive',
    'close',
    'steer',
  ])('allows the canonical scope for conversation %s', async (action) => {
    const body =
      action === 'fresh'
        ? { message: 'Fixture turn' }
        : ['resume', 'follow-up', 'fork'].includes(action)
          ? { sourceAttemptId: 'attempt-fixture', message: 'Fixture turn' }
          : action === 'steer'
            ? { attemptId: 'attempt-fixture', message: 'Fixture steer' }
            : { attemptId: 'attempt-fixture' };
    const response = await scoped(
      request(app).post(`${agentPath()}/${literal('conversation')}/${literal(action)}`),
      action === 'steer' ? 'task:write' : 'agent:write'
    ).send(body);
    expect(response.status).toBe(
      ['fresh', 'resume', 'follow-up', 'fork'].includes(action) ? 201 : 200
    );
    expect(unwrap<{ taskId: string }>(response.body).taskId).toBe(task.id);
  });

  it.each([
    ['post', 'tasks', 'comments', 'work_product:write'],
    ['get', 'tasks', 'work-products', 'task:read'],
    ['post', 'agents', 'launch-preview', 'task:write'],
    ['post', 'agents', 'conversation/fresh', 'comment:write'],
  ] as const)(
    'denies unrelated scopes on %s %s/%s',
    async (method, namespace, suffix, permission) => {
      const response = await scoped(
        request(app)[method](`${base}/${literal(namespace)}/${task.id}/${literal(suffix)}`),
        permission
      ).send({ author: 'Fixture', text: 'Denied', message: 'Denied' });
      expect(response.status).toBe(403);
      expect(Object.values(calls).every((operation) => operation.mock.calls.length === 0)).toBe(
        true
      );
      expect((await tasks.getTaskService().getTask(task.id))?.comments).toBeUndefined();
    }
  );

  it('keeps routing/trust administration and unknown agent mutations denied', async () => {
    for (const [method, suffix] of [
      ['put', 'routing'],
      ['post', `${task.id}/workspace-trust/decisions`],
      ['post', `${task.id}/unknown-operation`],
    ] as const) {
      const response = await scoped(
        request(app)[method](`${base}/${literal('agents')}/${literal(suffix)}`),
        'agent:write,task:write'
      ).send({});
      expect(response.status).toBe(403);
    }
  });

  it('preserves the separate local-capability boundary', async () => {
    const response = await scoped(
      request(app).post(`${agentPath()}/${literal('launch-preview')}`),
      'agent:read'
    )
      .set('X-Fixture-Remote', '1')
      .send({});
    expect(response.status).toBe(403);
    expect(calls.preview).not.toHaveBeenCalled();
  });

  it('requires authentication before task and agent endpoints', async () => {
    expect(
      (
        await request(app)
          .post(`${taskPath()}/comments`)
          .send({ author: 'Fixture', text: 'Denied' })
      ).status
    ).toBe(401);
    expect((await request(app).post(`${agentPath()}/launch-preview`).send({})).status).toBe(401);
  });
});
