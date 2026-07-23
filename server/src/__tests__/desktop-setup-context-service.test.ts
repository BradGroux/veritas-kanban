import { afterEach, describe, expect, it } from 'vitest';

import { getDesktopSetupContext } from '../services/desktop-setup-context-service.js';
import {
  getStorage,
  initStorage,
  shutdownStorage,
  SqliteStorageProvider,
} from '../storage/index.js';
import { createTestSqliteDatabase } from '../storage/sqlite/test-helpers.js';
import { SqliteSetupContextRepository } from '../storage/sqlite/setup-context-repository.js';

describe('desktop setup context', () => {
  const fixtures: ReturnType<typeof createTestSqliteDatabase>[] = [];

  afterEach(async () => {
    await shutdownStorage();
    fixtures.splice(0).forEach((fixture) => fixture.cleanup());
    delete process.env.VERITAS_DESKTOP_RUNTIME;
    delete process.env.VERITAS_STORAGE;
  });

  function createFixture() {
    const fixture = createTestSqliteDatabase();
    fixture.database.open();
    fixtures.push(fixture);
    return fixture;
  }

  it('classifies a newly initialized SQLite database as empty', () => {
    const fixture = createFixture();

    expect(new SqliteSetupContextRepository(fixture.database).getSetupContext()).toEqual({
      storageMode: 'sqlite',
      hasExistingData: false,
      counts: {
        tasks: 0,
        squadMessages: 0,
        telemetryEvents: 0,
        workflowDefinitions: 0,
        workflowRuns: 0,
      },
    });
  });

  it('reports concise counts for a populated desktop database', () => {
    const fixture = createFixture();
    const database = fixture.database.getConnection();
    const now = '2026-07-23T13:18:26.000Z';

    database
      .prepare(
        `INSERT INTO tasks (
          id, workspace_id, storage_state, title, description, type, status, priority,
          task_json, created_at, updated_at
        ) VALUES (?, 'local', 'active', ?, '', 'task', 'todo', 'medium', ?, ?, ?)`
      )
      .run(
        'task_existing',
        'Existing task',
        JSON.stringify({ id: 'task_existing', title: 'Existing task' }),
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO squad_messages (
          id, workspace_id, agent, message, timestamp, message_json
        ) VALUES (?, 'local', ?, ?, ?, ?)`
      )
      .run(
        'message_existing',
        'VERITAS',
        'Existing message',
        now,
        JSON.stringify({ id: 'message_existing' })
      );
    database
      .prepare(
        `INSERT INTO telemetry_events (
          id, workspace_id, type, payload_json, created_at
        ) VALUES (?, 'local', ?, ?, ?)`
      )
      .run('event_existing', 'task.created', '{}', now);
    database
      .prepare(
        `INSERT INTO workflow_definitions (
          id, workspace_id, name, version, workflow_json, created_at, updated_at
        ) VALUES (?, 'local', ?, 1, ?, ?, ?)`
      )
      .run('workflow_existing', 'Existing workflow', '{}', now, now);
    database
      .prepare(
        `INSERT INTO workflow_runs (
          id, workspace_id, workflow_id, workflow_version, status, run_json, started_at
        ) VALUES (?, 'local', ?, 1, 'completed', ?, ?)`
      )
      .run('run_existing', 'workflow_existing', '{}', now);

    expect(new SqliteSetupContextRepository(fixture.database).getSetupContext()).toEqual({
      storageMode: 'sqlite',
      hasExistingData: true,
      counts: {
        tasks: 1,
        squadMessages: 1,
        telemetryEvents: 1,
        workflowDefinitions: 1,
        workflowRuns: 1,
      },
    });
  });

  it('exposes setup context only from the active desktop SQLite runtime', async () => {
    const fixture = createTestSqliteDatabase();
    fixtures.push(fixture);
    process.env.VERITAS_STORAGE = 'sqlite';
    await initStorage('sqlite', {
      database: { databasePath: fixture.databasePath },
    });
    const storage = getStorage();
    expect(storage).toBeInstanceOf(SqliteStorageProvider);
    await storage.tasks.create({
      id: 'task_runtime',
      title: 'Existing runtime task',
      description: '',
      type: 'task',
      status: 'todo',
      priority: 'medium',
      created: '2026-07-23T13:18:26.000Z',
      updated: '2026-07-23T13:18:26.000Z',
    });

    expect(getDesktopSetupContext()).toBeUndefined();

    process.env.VERITAS_DESKTOP_RUNTIME = '1';
    expect(getDesktopSetupContext()).toMatchObject({
      storageMode: 'sqlite',
      hasExistingData: true,
      counts: { tasks: 1 },
    });
  });
});
