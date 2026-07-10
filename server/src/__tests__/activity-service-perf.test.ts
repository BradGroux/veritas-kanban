/**
 * Tests for activity service performance improvements (#782)
 *
 * Verifies that:
 * - A paginated file-backed request uses a single parse/filter pass.
 * - Writes are atomic (no partial JSON visible to readers).
 * - A corrupt activity file is backed up before a reset — not silently overwritten.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const tmpRoot = vi.hoisted(() => {
  const tmpdir = process.env.TMPDIR || process.env.TEMP || '/tmp';
  return tmpdir + '/veritas-activity-perf-test-' + Math.random().toString(36).substring(7);
});

vi.mock('fs', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    existsSync: (p: string) => {
      if (p.includes('.veritas-kanban')) {
        const redirected = p.replace(/.*\.veritas-kanban/, path.join(tmpRoot, '.veritas-kanban'));
        return (original.existsSync as (p: string) => boolean)(redirected);
      }
      return (original.existsSync as (p: string) => boolean)(p);
    },
  };
});

import { ActivityService } from '../services/activity-service.js';

describe('ActivityService – performance & integrity (#782)', () => {
  let service: ActivityService;
  let activityDir: string;
  let activityFile: string;

  beforeEach(async () => {
    activityDir = path.join(tmpRoot, '.veritas-kanban');
    await fs.mkdir(activityDir, { recursive: true });
    service = new ActivityService();
    activityFile = path.join(activityDir, 'activity.json');
    (service as unknown as { activityFile: string }).activityFile = activityFile;
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  describe('single-scan pagination (#782)', () => {
    it('reads and parses the activity file once for a paginated result', async () => {
      await service.logActivity('task_created', 'task_1', 'Alpha');
      await service.logActivity('task_updated', 'task_2', 'Beta', {}, 'codex');

      const loadAllSpy = vi.spyOn(
        service as unknown as { loadAll(): Promise<unknown[]> },
        'loadAll'
      );

      const { items, total } = await service.getActivitiesPage(10);

      expect(items).toHaveLength(2);
      expect(total).toBe(2);
      expect(loadAllSpy).toHaveBeenCalledTimes(1);

      loadAllSpy.mockRestore();
    });

    it('countActivities applies filters', async () => {
      await service.logActivity('task_created', 'task_1', 'Alpha', {}, 'codex');
      await service.logActivity('task_updated', 'task_2', 'Beta', {}, 'tars');
      await service.logActivity('task_created', 'task_3', 'Gamma', {}, 'codex');

      const codexCount = await service.countActivities({ agent: 'codex' });
      const tarsCount = await service.countActivities({ agent: 'tars' });
      const totalCount = await service.countActivities();

      expect(codexCount).toBe(2);
      expect(tarsCount).toBe(1);
      expect(totalCount).toBe(3);
    });

    it('returns filtered page items and total from one result', async () => {
      for (let i = 0; i < 10; i++) {
        await service.logActivity(
          'task_created',
          `task_${i}`,
          `Task ${i}`,
          {},
          i % 2 === 0 ? 'codex' : 'tars'
        );
      }

      const filters = { agent: 'codex' };
      const { items, total } = await service.getActivitiesPage(3, filters, 0);

      expect(items).toHaveLength(3);
      expect(total).toBe(5); // 5 even indices: 0,2,4,6,8
    });
  });

  describe('atomic writes (#782)', () => {
    it('persisted activity file is valid JSON after concurrent writes', async () => {
      await Promise.all([
        service.logActivity('task_created', 'task_a', 'A'),
        service.logActivity('task_updated', 'task_b', 'B'),
        service.logActivity('task_created', 'task_c', 'C'),
      ]);

      const raw = await fs.readFile(activityFile, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
      const parsed = JSON.parse(raw) as unknown[];
      expect(parsed.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('corrupt file handling (#782)', () => {
    it('backs up a corrupt activity file before resetting to empty', async () => {
      // Write corrupt JSON
      await fs.writeFile(activityFile, '{not-valid-json', 'utf-8');

      // logActivity should succeed and reset gracefully
      await expect(
        service.logActivity('task_created', 'task_1', 'After Corruption')
      ).resolves.toBeDefined();

      // A .corrupt.* backup file should exist
      const files = await fs.readdir(activityDir);
      const backupFiles = files.filter((f) => f.includes('.corrupt.'));
      expect(backupFiles.length).toBeGreaterThan(0);

      // The activity file should now contain valid JSON with our new entry
      const raw = await fs.readFile(activityFile, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
      const activities = JSON.parse(raw) as { taskTitle: string }[];
      expect(activities[0].taskTitle).toBe('After Corruption');
    });
  });
});
