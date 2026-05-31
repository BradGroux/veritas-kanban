import { describe, expect, it } from 'vitest';
import path from 'path';
import { TaskService } from '../../services/task-service.js';
import { TelemetryService } from '../../services/telemetry-service.js';
import { computeAllMetrics, computeTrends } from '../../services/metrics/dashboard-metrics.js';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';

describe('SQLite dashboard metrics', () => {
  it('loads dashboard metrics and trends from telemetry_events without telemetry files', async () => {
    const fixture = createTestSqliteDatabase();
    const originalStorage = process.env.VERITAS_STORAGE;
    const originalSqlitePath = process.env.VERITAS_SQLITE_PATH;

    process.env.VERITAS_STORAGE = 'sqlite';
    process.env.VERITAS_SQLITE_PATH = fixture.databasePath;

    const telemetry = new TelemetryService({
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });
    const taskService = new TaskService({
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
      telemetryService: telemetry,
    });
    const missingTelemetryDir = path.join(fixture.rootDir, 'missing-telemetry-files');

    try {
      const task = await taskService.createTask({
        title: 'SQLite metric task',
        project: 'alpha',
      });

      await telemetry.emit({
        type: 'run.completed',
        taskId: task.id,
        project: 'alpha',
        agent: 'codex',
        success: true,
        durationMs: 1200,
        timestamp: '2026-05-30T12:00:00.000Z',
      });
      await telemetry.emit({
        type: 'run.tokens',
        taskId: task.id,
        project: 'alpha',
        agent: 'codex',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.25,
        timestamp: '2026-05-30T12:00:01.000Z',
      });

      const metrics = await computeAllMetrics(
        taskService,
        missingTelemetryDir,
        'custom',
        'alpha',
        '2026-05-30T00:00:00.000Z',
        '2026-05-31T00:00:00.000Z'
      );

      expect(metrics.tasks.total).toBe(1);
      expect(metrics.runs.runs).toBe(1);
      expect(metrics.runs.successes).toBe(1);
      expect(metrics.tokens.totalTokens).toBe(150);
      expect(metrics.duration.avgMs).toBe(1200);

      const trends = await computeTrends(
        missingTelemetryDir,
        'custom',
        'alpha',
        '2026-05-30T00:00:00.000Z',
        '2026-05-31T00:00:00.000Z'
      );
      const day = trends.daily.find((point) => point.date === '2026-05-30');

      expect(day).toMatchObject({
        runs: 1,
        successes: 1,
        totalTokens: 150,
        inputTokens: 100,
        outputTokens: 50,
        avgDurationMs: 1200,
      });
    } finally {
      taskService.dispose();
      telemetry.dispose();
      fixture.cleanup();

      if (originalStorage === undefined) {
        delete process.env.VERITAS_STORAGE;
      } else {
        process.env.VERITAS_STORAGE = originalStorage;
      }

      if (originalSqlitePath === undefined) {
        delete process.env.VERITAS_SQLITE_PATH;
      } else {
        process.env.VERITAS_SQLITE_PATH = originalSqlitePath;
      }
    }
  });
});
