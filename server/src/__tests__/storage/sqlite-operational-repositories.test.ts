import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type {
  RunCompletedEvent,
  TaskTelemetryEvent,
  TokenTelemetryEvent,
} from '@veritas-kanban/shared';
import { ActivityService } from '../../services/activity-service.js';
import { StatusHistoryService } from '../../services/status-history-service.js';
import { TelemetryService } from '../../services/telemetry-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

describe('SQLite operational repositories', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-operational-'));
  });

  afterEach(async () => {
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('stores activities in SQLite and preserves ActivityService filtering helpers', async () => {
    const activityFile = path.join(testRoot, '.veritas-kanban', 'activity.json');
    const service = new ActivityService({
      activityFile,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const started = await service.logActivity(
      'agent_started',
      'task_1',
      'First task',
      { attemptId: 'attempt_1' },
      'codex'
    );
    const updated = await service.logActivity('task_updated', 'task_2', 'Second task');

    expect((await service.getActivities(10)).map((activity) => activity.id).sort()).toEqual(
      [started.id, updated.id].sort()
    );
    expect(await service.countActivities({ agent: 'codex' })).toBe(1);
    expect((await service.getActivities(10, { type: 'task_updated' }))[0].id).toBe(updated.id);
    expect((await service.getActivities(10, { taskId: 'task_1' }))[0]).toMatchObject({
      id: started.id,
      details: { attemptId: 'attempt_1' },
      agent: 'codex',
    });
    expect(await service.getDistinctAgents()).toEqual(['codex']);
    expect(await service.getDistinctTypes()).toEqual(['agent_started', 'task_updated']);

    await service.clearActivities();

    expect(await service.getActivities()).toEqual([]);
    await expect(fs.access(activityFile)).rejects.toThrow();
  });

  it('stores status history in SQLite and computes summaries without status-history JSON', async () => {
    const historyFile = path.join(testRoot, '.veritas-kanban', 'status-history.json');
    const service = new StatusHistoryService({
      historyFile,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const started = await service.logStatusChange('idle', 'working', 'task_1', 'First task', 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const stopped = await service.logStatusChange('working', 'idle', 'task_1', 'First task');

    const history = await service.getHistory(10);
    expect(history.map((entry) => entry.id)).toEqual([stopped.id, started.id]);
    expect(stopped.durationMs).toBeGreaterThanOrEqual(0);

    const range = await service.getHistoryByDateRange(
      new Date(Date.now() - 1000).toISOString(),
      new Date(Date.now() + 1000).toISOString()
    );
    expect(range).toHaveLength(2);

    const today = new Date().toISOString().split('T')[0];
    const daily = await service.getDailySummary(today);
    expect(daily.date).toBe(today);
    expect(daily.transitions).toBe(2);
    expect(daily.periods.length).toBeGreaterThanOrEqual(1);
    expect(await service.getWeeklySummary()).toHaveLength(7);

    await service.clearHistory();

    expect(await service.getHistory()).toEqual([]);
    await expect(fs.access(historyFile)).rejects.toThrow();
  });

  it('stores telemetry in SQLite with query, export, config, and duration parity', async () => {
    const telemetryDir = path.join(testRoot, '.veritas-kanban', 'telemetry');
    const service = new TelemetryService({
      telemetryDir,
      config: { enabled: true, retention: 7 },
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const completed = await service.emit<RunCompletedEvent>({
      type: 'run.completed',
      taskId: 'task_1',
      project: 'veritas',
      agent: 'codex',
      durationMs: 604800001,
      exitCode: 0,
      success: true,
      attemptId: 'attempt_1',
    });
    const tokens = await service.emit<TokenTelemetryEvent>({
      type: 'run.tokens',
      taskId: 'task_1',
      project: 'veritas',
      agent: 'codex',
      inputTokens: 100,
      outputTokens: 25,
      cacheTokens: 10,
      totalTokens: 135,
      model: 'gpt.5',
      attemptId: 'attempt_1',
    });

    expect(completed.durationMs).toBe(604800000);
    expect(await service.countEvents(['run.completed', 'run.tokens'])).toBe(2);
    expect((await service.getEvents({ type: 'run.completed' })).map((event) => event.id)).toEqual([
      completed.id,
    ]);
    expect(
      (await service.getEvents({ project: 'veritas' })).map((event) => event.id).sort()
    ).toEqual([completed.id, tokens.id].sort());
    expect((await service.getTaskEvents('task_1')).map((event) => event.id).sort()).toEqual(
      [completed.id, tokens.id].sort()
    );

    const bulk = await service.getBulkTaskEvents(['task_1'], 1);
    expect(bulk.get('task_1')).toHaveLength(1);
    expect(await service.exportAsJson({ taskId: 'task_1' })).toContain('run.completed');
    expect(await service.exportAsCsv({ taskId: 'task_1' })).toContain('run.tokens');

    service.configure({ enabled: false });
    const disabled = await service.emit<TaskTelemetryEvent>({
      type: 'task.created',
      taskId: 'task_2',
    });
    expect(disabled.id).toMatch(/^disabled_/);
    expect(await service.countEvents(['run.completed', 'run.tokens', 'task.created'])).toBe(2);

    await service.clear();

    expect(await service.getEvents()).toEqual([]);
    await expect(fs.access(telemetryDir)).rejects.toThrow();
  });
});
