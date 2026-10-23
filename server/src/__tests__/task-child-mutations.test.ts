import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import type { TaskService } from '../services/task-service.js';
import type { TestSqliteDatabase } from '../storage/sqlite/test-helpers.js';

const context = vi.hoisted(() => ({
  service: undefined as TaskService | undefined,
  activity: vi.fn().mockResolvedValue(undefined),
  broadcast: vi.fn(),
  sync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/task-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/task-service.js')>()),
  getTaskService: () => ({
    mutateTaskChildren: (...args: Parameters<TaskService['mutateTaskChildren']>) =>
      context.service!.mutateTaskChildren(...args),
    getTask: (id: string) => context.service!.getTask(id),
  }),
}));
vi.mock('../services/activity-service.js', () => ({
  activityService: { logActivity: context.activity },
}));
vi.mock('../services/broadcast-service.js', () => ({ broadcastTaskChange: context.broadcast }));
vi.mock('../services/github-sync-service.js', () => ({
  getGitHubSyncService: () => ({ syncCommentToGitHub: context.sync }),
}));
vi.mock('../services/work-product-service.js', () => ({
  getWorkProductService: () => ({ generateCompletionPacket: vi.fn().mockResolvedValue(undefined) }),
}));

let root: string;
let app: express.Express;
let taskModule: typeof import('../services/task-service.js');
let shared: typeof import('@veritas-kanban/shared');
let sqlite: typeof import('../storage/sqlite/test-helpers.js');
let telemetry: typeof import('../services/telemetry-service.js');
let database: TestSqliteDatabase | undefined;
let fixtureRoot: string;
let service: TaskService;
let settings: typeof shared.DEFAULT_FEATURE_SETTINGS;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-child-routes-'));
  vi.stubEnv('VERITAS_DATA_DIR', root);
  vi.stubEnv('DATA_DIR', root);
  vi.stubEnv('VERITAS_DISABLE_WATCHERS', '1');
  vi.stubEnv('VERITAS_STORAGE', 'file');
  taskModule = await import('../services/task-service.js');
  shared = await import('@veritas-kanban/shared');
  sqlite = await import('../storage/sqlite/test-helpers.js');
  telemetry = await import('../services/telemetry-service.js');
  const [
    { taskCommentRoutes },
    { taskSubtaskRoutes },
    { taskObservationRoutes },
    { errorHandler },
  ] = await Promise.all([
    import('../routes/task-comments.js'),
    import('../routes/task-subtasks.js'),
    import('../routes/task-observations.js'),
    import('../middleware/error-handler.js'),
  ]);
  app = express();
  app.use(express.json());
  app.use('/api/tasks', taskCommentRoutes, taskSubtaskRoutes, taskObservationRoutes);
  app.use(errorHandler);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  service?.dispose();
  database?.cleanup();
  database = undefined;
  context.service = undefined;
});
afterAll(async () => {
  taskModule?.disposeTaskService();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

const collections = ['comments', 'subtasks', 'observations'] as const;
type Collection = (typeof collections)[number];
function child(collection: Collection, id: string) {
  const timestamp = '2026-10-23T00:00:00.000Z';
  switch (collection) {
    case 'comments':
      return { id, author: 'Fixture', text: id, timestamp, revision: 1 };
    case 'subtasks':
      return {
        id,
        title: id,
        completed: false,
        created: timestamp,
        acceptanceCriteria: ['first', 'second'],
        criteriaChecked: [false, false],
      };
    case 'observations':
      return { id, type: 'context' as const, content: id, score: 5, timestamp };
  }
}
function addBody(collection: Collection, label: string) {
  switch (collection) {
    case 'comments':
      return { author: 'Fixture', text: label };
    case 'subtasks':
      return { title: label };
    case 'observations':
      return { type: 'context', content: label };
  }
}
function payload(response: request.Response): Task {
  return response.body.data ?? response.body;
}
function expectedEffects(collection: Collection, operations: string[], id: string) {
  const activity = collection === 'comments' || collection === 'observations';
  expect(context.activity).toHaveBeenCalledTimes(activity ? operations.length : 0);
  if (activity) {
    expect(context.activity.mock.calls.map(([kind]) => kind).sort()).toEqual(
      operations
        .map((operation) => `${collection === 'comments' ? 'comment' : 'observation'}_${operation}`)
        .sort()
    );
    for (const call of context.activity.mock.calls)
      expect(call.slice(1, 3)).toEqual([id, 'Child mutation fixture']);
  }
  expect(context.broadcast).toHaveBeenCalledTimes(
    collection === 'comments' ? operations.length : 0
  );
  expect(context.sync).not.toHaveBeenCalled();
}

// Hold both HTTP requests at the mutation boundary before either can acquire a storage lock.
function overlap() {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = service.mutateTaskChildren.bind(service);
  vi.spyOn(service, 'mutateTaskChildren').mockImplementation(async (...args) => {
    arrived += 1;
    if (arrived === 2) release();
    await gate;
    return original(...args);
  });
}
async function seed(collection: Collection) {
  const task = await service.createTask({ title: 'Child mutation fixture' });
  return (await service.updateTask(task.id, {
    [collection]: [child(collection, 'first'), child(collection, 'second')],
  }))!;
}
function precondition(test: request.Test, task: Task, conditional: boolean) {
  return conditional ? test.set('If-Match', `"task:${task.id}:${task.revision}"`) : test;
}
function assertResults(results: request.Response[], conditional: boolean, successes: number[]) {
  if (conditional) {
    expect(results.filter((result) => successes.includes(result.status))).toHaveLength(1);
    const conflict = results.find((result) => result.status === 409)!;
    expect(conflict).toBeDefined();
    const error = conflict.body.error ?? conflict.body;
    expect(error.details).toMatchObject({ expectedRevision: 2, currentRevision: 3 });
  } else expect(results.every((result) => successes.includes(result.status))).toBe(true);
  for (const result of results.filter((result) => successes.includes(result.status))) {
    expect(result.headers['x-resource-revision']).toBe(String(payload(result).revision));
  }
}

describe.each(['file', 'sqlite'] as const)('%s child mutation storage', (backend) => {
  beforeEach(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(root, `${backend}-`));
    if (backend === 'sqlite') database = sqlite.createTestSqliteDatabase();
    settings = structuredClone(shared.DEFAULT_FEATURE_SETTINGS);
    service = new taskModule.TaskService({
      storageType: backend,
      sqliteDatabase: database?.database,
      tasksDir: path.join(fixtureRoot, 'active'),
      archiveDir: path.join(fixtureRoot, 'archive'),
      telemetryService: new telemetry.TelemetryService({
        telemetryDir: path.join(fixtureRoot, 'telemetry'),
        config: { enabled: false },
      }),
      configService: { getFeatureSettings: async () => settings },
    });
    context.service = service;
  });

  describe.each([false, true])('conditional revision: %s', (conditional) => {
    it.each(collections)('preserves accepted %s add/add operations', async (collection) => {
      const task = await seed(collection);
      overlap();
      const results = await Promise.all(
        ['added-a', 'added-b'].map((label) =>
          precondition(
            request(app).post(`/api/tasks/${task.id}/${collection}`),
            task,
            conditional
          ).send(addBody(collection, label))
        )
      );
      assertResults(results, conditional, [201]);
      const accepted = results.filter((result) => result.status === 201);
      const final = (await service.getTask(task.id))!;
      const expected = new Set(['first', 'second']);
      for (const result of accepted)
        for (const entry of payload(result)[collection]!) expected.add(entry.id);
      expect(final[collection]!.map((entry) => entry.id).sort()).toEqual([...expected].sort());
      expect(final.revision).toBe(2 + accepted.length);
      expectedEffects(
        collection,
        accepted.map(() => 'added'),
        task.id
      );
    });

    it.each(collections)('preserves accepted %s add/delete operations', async (collection) => {
      const task = await seed(collection);
      overlap();
      const results = await Promise.all([
        precondition(
          request(app).post(`/api/tasks/${task.id}/${collection}`),
          task,
          conditional
        ).send(addBody(collection, 'added')),
        precondition(
          request(app).delete(`/api/tasks/${task.id}/${collection}/first`),
          task,
          conditional
        ),
      ]);
      assertResults(results, conditional, [200, 201]);
      const final = (await service.getTask(task.id))!;
      const expected = new Set(['first', 'second']);
      if (results[0].status === 201)
        expected.add(payload(results[0])[collection]!.find((entry) => !expected.has(entry.id))!.id);
      if (results[1].status === 200) expected.delete('first');
      expect(final[collection]!.map((entry) => entry.id).sort()).toEqual([...expected].sort());
      const operations = results.flatMap((result, index) =>
        result.status < 300 ? [index === 0 ? 'added' : 'deleted'] : []
      );
      expect(final.revision).toBe(2 + operations.length);
      expectedEffects(collection, operations, task.id);
    });

    it.each(['comments', 'subtasks'] as const)(
      'preserves edits to separate %s',
      async (collection) => {
        const task = await seed(collection);
        const field = collection === 'comments' ? 'text' : 'title';
        overlap();
        const results = await Promise.all(
          ['first', 'second'].map((id) =>
            precondition(
              request(app).patch(`/api/tasks/${task.id}/${collection}/${id}`),
              task,
              conditional
            ).send({ [field]: `edited-${id}` })
          )
        );
        assertResults(results, conditional, [200]);
        const final = (await service.getTask(task.id))!;
        for (const [index, entry] of final[collection]!.entries()) {
          expect(entry[field as keyof typeof entry]).toBe(
            results[index].status === 200 ? `edited-${entry.id}` : entry.id
          );
        }
        if (collection === 'comments') {
          for (const [index, entry] of final.comments!.entries()) {
            expect(entry.timestamp).toBe('2026-10-23T00:00:00.000Z');
            expect(entry.revision).toBe(results[index].status === 200 ? 2 : 1);
          }
        }
        expect(context.activity).not.toHaveBeenCalled();
        expect(context.broadcast).toHaveBeenCalledTimes(
          collection === 'comments' ? (conditional ? 1 : 2) : 0
        );
      }
    );

    it('preserves concurrent criterion toggles on one child', async () => {
      const task = await seed('subtasks');
      overlap();
      const results = await Promise.all(
        [0, 1].map((index) =>
          precondition(
            request(app).patch(`/api/tasks/${task.id}/subtasks/first/criteria/${index}`),
            task,
            conditional
          )
        )
      );
      assertResults(results, conditional, [200]);
      expect((await service.getTask(task.id))!.subtasks![0].criteriaChecked).toEqual(
        results.map((result) => result.status === 200)
      );
    });
  });

  it('auto-completes from current children after concurrent subtask completions', async () => {
    let task = await seed('subtasks');
    task = (await service.updateTask(task.id, { autoCompleteOnSubtasks: true }))!;
    overlap();
    const results = await Promise.all(
      ['first', 'second'].map((id) =>
        request(app).patch(`/api/tasks/${task.id}/subtasks/${id}`).send({ completed: true })
      )
    );
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(await service.getTask(task.id)).toMatchObject({
      status: 'done',
      revision: 5,
      subtasks: [{ completed: true }, { completed: true }],
    });
  });
  it('keeps child completion uncommitted when the parent quality gate rejects it', async () => {
    let task = await seed('subtasks');
    task = (await service.updateTask(task.id, {
      autoCompleteOnSubtasks: true,
      subtasks: task.subtasks!.map((subtask, index) => ({ ...subtask, completed: index === 0 })),
    }))!;
    settings.tasks.requireDeliverableForDone = true;
    const response = await request(app)
      .patch(`/api/tasks/${task.id}/subtasks/second`)
      .send({ completed: true });
    expect(response.status).toBe(400);
    expect(await service.getTask(task.id)).toEqual(task);
    expect(context.activity).not.toHaveBeenCalled();
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it('syncs only the committed linked comment and reports its new revision', async () => {
    const created = await service.createTask({ title: 'Child mutation fixture' });
    const task = (await service.updateTask(created.id, {
      github: { repo: 'fixture/disposable', issueNumber: 1 },
    }))!;
    const response = await request(app)
      .post(`/api/tasks/${task.id}/comments`)
      .set('X-Resource-Revision', String(task.revision))
      .send({ author: 'Fixture', text: '<script>discard</script>Kept comment' });
    expect(response.status).toBe(201);
    const committed = payload(response);
    expect(committed.comments![0].text).not.toContain('<script>');
    expect(context.sync).toHaveBeenCalledWith(
      committed,
      `**Fixture:** ${committed.comments![0].text}`
    );
    const stale = await request(app)
      .post(`/api/tasks/${task.id}/comments`)
      .set('X-Resource-Revision', String(task.revision))
      .send({ author: 'Fixture', text: 'Rejected comment' });
    expect(stale.status).toBe(409);
    expect(context.sync).toHaveBeenCalledTimes(1);
    expect(context.activity).toHaveBeenCalledTimes(1);
    expect(context.broadcast).toHaveBeenCalledTimes(1);
    expect(await service.getTask(task.id)).toEqual(committed);
  });

  it('preserves sequential child validation and missing-task responses', async () => {
    const task = await seed('subtasks');
    for (const [suffix, expectedStatus] of [
      ['missing/criteria/0', 404],
      ['first/criteria/8', 400],
      ['first/criteria/-1', 400],
    ]) {
      expect((await request(app).patch(`/api/tasks/${task.id}/subtasks/${suffix}`)).status).toBe(
        expectedStatus
      );
    }
    expect(await service.getTask(task.id)).toEqual(task);
    for (const collection of collections) {
      expect(
        (
          await request(app)
            .post(`/api/tasks/missing/${collection}`)
            .send(addBody(collection, 'Added'))
        ).status
      ).toBe(404);
      expect((await request(app).delete(`/api/tasks/missing/${collection}/first`)).status).toBe(
        404
      );
    }
    expect(context.activity).not.toHaveBeenCalled();
    expect(context.broadcast).not.toHaveBeenCalled();
  });
});
