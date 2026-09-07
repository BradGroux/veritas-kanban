import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_FEATURE_SETTINGS, type TaskAttempt } from '@veritas-kanban/shared';
import { TaskService } from '../services/task-service.js';
import { TelemetryService } from '../services/telemetry-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../storage/sqlite/test-helpers.js';

for (const storageType of ['file', 'sqlite'] as const) {
  describe(`generic attempt edits (${storageType})`, () => {
    let root: string;
    let database: TestSqliteDatabase | undefined;
    let service: TaskService;
    const legacy: TaskAttempt = { id: 'attempt_legacy', agent: 'codex', status: 'running' };

    function openService() {
      return new TaskService({
        storageType,
        sqliteDatabase: database?.database,
        tasksDir: path.join(root, 'active'),
        archiveDir: path.join(root, 'archive'),
        telemetryService: new TelemetryService({
          telemetryDir: path.join(root, 'telemetry'),
          config: { enabled: false },
        }),
        configService: { getFeatureSettings: async () => DEFAULT_FEATURE_SETTINGS },
      });
    }

    beforeEach(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-attempt-edit-'));
      database = storageType === 'sqlite' ? createTestSqliteDatabase() : undefined;
      service = openService();
    });

    afterEach(async () => {
      service.dispose();
      database?.cleanup();
      await fs.rm(root, { recursive: true, force: true });
    });

    it('denies same-ID status changes and replacements without changing durable evidence', async () => {
      const task = await service.createTask({ title: 'Managed attempt' });
      const managed: TaskAttempt = {
        ...legacy,
        runSupervisorId: 'supervisor_test',
        admissionReservationId: 'reservation_test',
      };
      await service.updateTask(task.id, { attempt: managed, attempts: [managed] });
      const before = await service.getTask(task.id);
      for (const id of [managed.id, 'attempt_replacement']) {
        for (const status of ['running', 'complete', 'failed'] as const) {
          await expect(
            service.updateTask(
              task.id,
              {
                title: 'Must not be written',
                attempt: { ...legacy, id, status },
              },
              { protectManagedAttempt: true }
            )
          ).rejects.toThrow('run lifecycle APIs');
        }
      }
      service.dispose();
      service = openService();
      expect(await service.getTask(task.id)).toEqual(before);
      const renamed = await service.updateTask(task.id, { title: 'Ordinary edit' });
      expect(renamed?.attempt).toEqual(managed);
      expect(renamed?.attempts).toEqual([managed]);
    });

    it('checks the current stored attempt after a launch replaces the route snapshot', async () => {
      const task = await service.createTask({ title: 'Concurrent launch' });
      await service.updateTask(task.id, { attempt: legacy });
      const routeSnapshot = await service.getTask(task.id);
      await service.updateTask(task.id, {
        attempt: { ...legacy, runSupervisorId: 'supervisor_new' },
      });
      await expect(
        service.updateTask(
          task.id,
          {
            attempt: { ...routeSnapshot!.attempt!, status: 'complete' },
          },
          { protectManagedAttempt: true }
        )
      ).rejects.toThrow('run lifecycle APIs');
      expect((await service.getTask(task.id))?.attempt?.status).toBe('running');
    });

    it('preserves legacy edits and dedicated lifecycle updates', async () => {
      const task = await service.createTask({ title: 'Legacy attempt' });
      await service.updateTask(task.id, { attempt: legacy }, { protectManagedAttempt: true });
      const completed = await service.updateTask(
        task.id,
        {
          attempt: { ...legacy, status: 'complete' },
        },
        { protectManagedAttempt: true }
      );
      expect(completed?.attempt?.status).toBe('complete');
      const managed = { ...legacy, runSupervisorId: 'supervisor_lifecycle' };
      await service.updateTask(task.id, { attempt: managed });
      await service.patchTaskAttempt(task.id, managed.id, { status: 'complete' });
      expect((await service.getTask(task.id))?.attempt).toEqual({ ...managed, status: 'complete' });
    });
  });
}
