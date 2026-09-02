import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { sortTasksByBoardPosition } from '@veritas-kanban/shared';
import { TaskService } from '../services/task-service.js';
import { TelemetryService } from '../services/telemetry-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../storage/sqlite/test-helpers.js';

interface Fixture {
  service: TaskService;
  telemetry: TelemetryService;
  root: string;
  sqlite?: TestSqliteDatabase;
}

const fixtures: Fixture[] = [];

async function createFixture(storageType: 'file' | 'sqlite'): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `veritas-task-move-${storageType}-`));
  const sqlite = storageType === 'sqlite' ? createTestSqliteDatabase() : undefined;
  const telemetry =
    storageType === 'sqlite'
      ? new TelemetryService({
          storageType: 'sqlite',
          sqliteConnectionOptions: { databasePath: sqlite?.databasePath },
          config: { enabled: true },
        })
      : new TelemetryService({
          telemetryDir: path.join(root, 'telemetry'),
          config: { enabled: true },
        });
  const fixture: Fixture = {
    root,
    sqlite,
    telemetry,
    service: new TaskService({
      storageType,
      sqliteDatabase: sqlite?.database,
      tasksDir: path.join(root, 'tasks', 'active'),
      archiveDir: path.join(root, 'tasks', 'archive'),
      telemetryService: telemetry,
    }),
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    fixtures.splice(0).map(async ({ service, telemetry, sqlite, root }) => {
      service.dispose();
      telemetry.dispose();
      sqlite?.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    })
  );
});

describe.each(['file', 'sqlite'] as const)('TaskService board move (%s)', (storageType) => {
  it('commits status and destination order in one task revision', async () => {
    const { service } = await createFixture(storageType);
    const moving = await service.createTask({ title: 'Moving task' });
    const first = await service.createTask({ title: 'First blocked task', status: 'blocked' });
    const second = await service.createTask({ title: 'Second blocked task', status: 'blocked' });
    const movingPositioned = await service.updateTask(moving.id, { position: 0 });
    const firstPositioned = await service.updateTask(first.id, { position: 0 });
    const secondPositioned = await service.updateTask(second.id, { position: 1 });

    const result = await service.moveTask(moving.id, {
      operationId: '00000000-0000-4000-8000-000000000001',
      expectedRevision: movingPositioned?.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: 0,
      destinationStatus: 'blocked',
      destinationIndex: 1,
      updatedBy: 'user:test',
    });

    expect(result).toMatchObject({
      replayed: false,
      operationId: '00000000-0000-4000-8000-000000000001',
      orderedTaskIds: [first.id, moving.id, second.id],
      task: {
        id: moving.id,
        status: 'blocked',
        position: 0.5,
        revision: (movingPositioned?.revision ?? 1) + 1,
      },
    });
    expect((await service.getTask(first.id))?.revision).toBe(firstPositioned?.revision);
    expect((await service.getTask(second.id))?.revision).toBe(secondPositioned?.revision);
  });

  it('replays one operation without another write and rejects a genuinely stale move', async () => {
    const { service } = await createFixture(storageType);
    const moving = await service.createTask({ title: 'Moving task' });
    await service.createTask({ title: 'Blocked task', status: 'blocked' });
    const request = {
      operationId: '00000000-0000-4000-8000-000000000002',
      expectedRevision: moving.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: null,
      destinationStatus: 'blocked',
      destinationIndex: 0,
      updatedBy: 'user:test',
    } as const;

    const first = await service.moveTask(moving.id, request);
    const replay = await service.moveTask(moving.id, request);

    expect(first?.replayed).toBe(false);
    expect(replay?.replayed).toBe(true);
    expect(replay?.task.revision).toBe(first?.task.revision);

    await expect(
      service.moveTask(moving.id, {
        ...request,
        operationId: '00000000-0000-4000-8000-000000000003',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await service.getTask(moving.id)).toMatchObject({
      status: 'blocked',
      revision: first?.task.revision,
    });
  });

  it('keeps a committed move successful and repairs telemetry on explicit replay', async () => {
    const { service, telemetry } = await createFixture(storageType);
    const moving = await service.createTask({ title: 'Moving task' });
    const request = {
      operationId: '00000000-0000-4000-8000-000000000007',
      expectedRevision: moving.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: null,
      destinationStatus: 'blocked',
      destinationIndex: 0,
      updatedBy: 'user:test',
    } as const;
    const emit = vi.spyOn(telemetry, 'emit').mockRejectedValue(new Error('disk unavailable'));

    await expect(service.moveTask(moving.id, request)).resolves.toMatchObject({ replayed: false });
    expect(await service.getTask(moving.id)).toMatchObject({ status: 'blocked', revision: 2 });
    await expect(
      service.moveTask(moving.id, {
        ...request,
        operationId: '00000000-0000-4000-8000-000000000014',
        expectedRevision: 2,
        sourceStatus: 'blocked',
        sourcePosition: 0,
        destinationStatus: 'todo',
      })
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    emit.mockRestore();
    const replay = await service.moveTask(moving.id, request);
    const statusEvents = (await telemetry.getTaskEvents(moving.id)).filter(
      (event) =>
        event.type === 'task.status_changed' &&
        'operationId' in event &&
        event.operationId === request.operationId
    );

    expect(replay?.replayed).toBe(true);
    expect(statusEvents).toHaveLength(1);
    const completed = await service.markBoardMoveAuditComplete(moving.id, request.operationId);
    expect(completed).toMatchObject({
      revision: 2,
      lastBoardMove: {
        operationId: request.operationId,
        auditCompletedAt: expect.any(String),
      },
    });
    expect(await service.getTask(moving.id)).toMatchObject({
      revision: 2,
      lastBoardMove: { auditCompletedAt: expect.any(String) },
    });
  });

  it('serializes rapid duplicate submissions of the same operation', async () => {
    const { service } = await createFixture(storageType);
    const moving = await service.createTask({ title: 'Moving task' });
    const request = {
      operationId: '00000000-0000-4000-8000-000000000004',
      expectedRevision: moving.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: null,
      destinationStatus: 'blocked',
      destinationIndex: 0,
      updatedBy: 'user:test',
    } as const;

    const results = await Promise.all([
      service.moveTask(moving.id, request),
      service.moveTask(moving.id, request),
    ]);

    expect(results.map((result) => result?.replayed).sort()).toEqual([false, true]);
    expect((await service.getTask(moving.id))?.revision).toBe((moving.revision ?? 1) + 1);
  });

  it('commits only one of two distinct rapid operations from the same source revision', async () => {
    const { service } = await createFixture(storageType);
    const moving = await service.createTask({ title: 'Moving task' });
    const request = {
      expectedRevision: moving.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: null,
      destinationStatus: 'blocked',
      destinationIndex: 0,
      updatedBy: 'user:test',
    } as const;

    const results = await Promise.allSettled([
      service.moveTask(moving.id, {
        ...request,
        operationId: '00000000-0000-4000-8000-000000000008',
      }),
      service.moveTask(moving.id, {
        ...request,
        operationId: '00000000-0000-4000-8000-000000000009',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'CONFLICT' },
    });
    expect(await service.getTask(moving.id)).toMatchObject({ status: 'blocked', revision: 2 });
  });

  it('persists the requested order between legacy unpositioned tasks', async () => {
    const { service } = await createFixture(storageType);
    const moving = await service.createTask({ title: 'Moving task' });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    const older = await service.createTask({ title: 'Older blocked task', status: 'blocked' });
    vi.setSystemTime(new Date('2026-08-01T10:00:01.000Z'));
    const newer = await service.createTask({ title: 'Newer blocked task', status: 'blocked' });
    vi.useRealTimers();

    const result = await service.moveTask(moving.id, {
      operationId: '00000000-0000-4000-8000-000000000005',
      expectedRevision: moving.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: null,
      destinationStatus: 'blocked',
      destinationIndex: 1,
      updatedBy: 'user:test',
    });

    expect(result?.orderedTaskIds).toEqual([newer.id, moving.id, older.id]);
    expect(
      (
        await service.moveTask(moving.id, {
          operationId: '00000000-0000-4000-8000-000000000005',
          expectedRevision: moving.revision ?? 1,
          sourceStatus: 'todo',
          sourcePosition: null,
          destinationStatus: 'blocked',
          destinationIndex: 1,
          updatedBy: 'user:test',
        })
      )?.orderedTaskIds
    ).toEqual([newer.id, moving.id, older.id]);
    const persistedNewer = await service.getTask(newer.id);
    const persistedOlder = await service.getTask(older.id);
    expect(persistedNewer?.position).toBeUndefined();
    expect(persistedNewer?.revision).toBe(newer.revision);
    expect(persistedOlder?.position).toBeUndefined();
    expect(persistedOlder?.revision).toBe(older.revision);
  });

  it('persists insertion between tasks with the same legacy position', async () => {
    const { service } = await createFixture(storageType);
    const moving = await service.createTask({ title: 'Moving task' });
    const left = await service.createTask({ title: 'Equal position A', status: 'blocked' });
    const right = await service.createTask({ title: 'Equal position B', status: 'blocked' });
    await service.updateTask(left.id, { position: 0 });
    await service.updateTask(right.id, { position: 0 });
    const equalNeighbors = sortTasksByBoardPosition(
      (await service.listTasks()).filter((task) => task.status === 'blocked')
    );

    const result = await service.moveTask(moving.id, {
      operationId: '00000000-0000-4000-8000-000000000012',
      expectedRevision: moving.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: null,
      destinationStatus: 'blocked',
      destinationIndex: 1,
      updatedBy: 'user:test',
    });

    const persisted = sortTasksByBoardPosition(
      (await service.listTasks()).filter((task) => task.status === 'blocked')
    );
    const expectedOrder = [equalNeighbors[0].id, moving.id, equalNeighbors[1].id];
    expect(result?.orderedTaskIds).toEqual(expectedOrder);
    expect(persisted.map((task) => task.id)).toEqual(expectedOrder);
  });

  it('serializes position writers before resolving destination neighbors', async () => {
    const { service } = await createFixture(storageType);
    const moving = await service.createTask({ title: 'Moving task' });
    const first = await service.createTask({ title: 'First blocked task', status: 'blocked' });
    const second = await service.createTask({ title: 'Second blocked task', status: 'blocked' });
    await service.updateTask(first.id, { position: 0 });
    await service.updateTask(second.id, { position: 1 });

    const positionWrite = service.updateTask(first.id, { position: 2 });
    const move = service.moveTask(moving.id, {
      operationId: '00000000-0000-4000-8000-000000000006',
      expectedRevision: moving.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: null,
      destinationStatus: 'blocked',
      destinationIndex: 1,
      updatedBy: 'user:test',
    });
    await positionWrite;
    const result = await move;

    expect(result?.orderedTaskIds).toEqual([second.id, moving.id, first.id]);
    expect(result?.task.position).toBe(1.5);
  });

  it('uses exact ranks through repeated insertions without rewriting neighbors', async () => {
    const { service } = await createFixture(storageType);
    const movingTasks = await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        service.createTask({ title: `Moving task ${index + 1}` })
      )
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    const older = await service.createTask({ title: 'Older blocked task', status: 'blocked' });
    vi.setSystemTime(new Date('2026-08-01T10:00:01.000Z'));
    const newer = await service.createTask({ title: 'Newer blocked task', status: 'blocked' });
    vi.useRealTimers();

    for (const [index, moving] of movingTasks.entries()) {
      await expect(
        service.moveTask(moving.id, {
          operationId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
          expectedRevision: moving.revision ?? 1,
          sourceStatus: 'todo',
          sourcePosition: null,
          destinationStatus: 'blocked',
          destinationIndex: 1,
          updatedBy: 'user:test',
        })
      ).resolves.toMatchObject({ replayed: false });
    }

    const ordered = sortTasksByBoardPosition(
      (await service.listTasks()).filter((task) => task.status === 'blocked')
    );
    expect(ordered.map((task) => task.id)).toEqual([
      newer.id,
      ...movingTasks.map((task) => task.id).reverse(),
      older.id,
    ]);
    expect(ordered.filter((task) => task.boardRank?.startsWith('v1:'))).toHaveLength(64);
    const persistedNewer = await service.getTask(newer.id);
    const persistedOlder = await service.getTask(older.id);
    expect(persistedNewer?.position).toBeUndefined();
    expect(persistedNewer?.revision).toBe(newer.revision);
    expect(persistedOlder?.position).toBeUndefined();
    expect(persistedOlder?.revision).toBe(older.revision);
  });

  it('reloads the persisted status and exact order from storage', async () => {
    const fixture = await createFixture(storageType);
    const first = await fixture.service.createTask({ title: 'First blocked', status: 'blocked' });
    const moving = await fixture.service.createTask({ title: 'Moving task' });
    await fixture.service.moveTask(moving.id, {
      operationId: '00000000-0000-4000-8000-000000000010',
      expectedRevision: moving.revision ?? 1,
      sourceStatus: 'todo',
      sourcePosition: null,
      destinationStatus: 'blocked',
      destinationIndex: 0,
      updatedBy: 'user:test',
    });

    fixture.service.dispose();
    fixture.service = new TaskService({
      storageType,
      sqliteDatabase: fixture.sqlite?.database,
      tasksDir: path.join(fixture.root, 'tasks', 'active'),
      archiveDir: path.join(fixture.root, 'tasks', 'archive'),
      telemetryService: fixture.telemetry,
    });

    const reloaded = sortTasksByBoardPosition(
      (await fixture.service.listTasks()).filter((task) => task.status === 'blocked')
    );
    expect(reloaded.map((task) => task.id)).toEqual([moving.id, first.id]);
    expect(reloaded[0]).toMatchObject({
      status: 'blocked',
      boardRank: expect.stringMatching(/^v1:/),
      revision: 2,
    });
  });
});
