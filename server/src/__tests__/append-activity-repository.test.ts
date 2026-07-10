/**
 * Append Activity Repository Tests
 * Tests append-only JSONL storage, compaction, recovery, and concurrent access.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { AppendActivityRepository } from '../storage/append-activity-repository.js';
import type { Activity } from '../services/activity-service.js';

const tmpRoot = `/tmp/veritas-append-activity-test-${Math.random().toString(36).substring(7)}`;

describe('AppendActivityRepository', () => {
  let repo: AppendActivityRepository;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpRoot, 'test');
    await fs.mkdir(testDir, { recursive: true });
    repo = new AppendActivityRepository(testDir, {
      maxActivities: 100,
      maxFileSizeBytes: 50 * 1024, // 50 KB
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  describe('logActivity', () => {
    it('should log an activity and return it', async () => {
      const activity = await repo.logActivity(
        'task_created',
        'task_123',
        'New Feature',
        { priority: 'high' },
        'codex',
        'user:alice'
      );

      expect(activity.id).toMatch(/^activity_/);
      expect(activity.type).toBe('task_created');
      expect(activity.taskId).toBe('task_123');
      expect(activity.taskTitle).toBe('New Feature');
      expect(activity.agent).toBe('codex');
      expect(activity.actor).toBe('user:alice');
      expect(activity.timestamp).toBeTruthy();
    });

    it('should prepend new activities (newest-first)', async () => {
      const a1 = await repo.logActivity('task_created', 'task_1', 'First');
      const a2 = await repo.logActivity('task_updated', 'task_2', 'Second');
      const a3 = await repo.logActivity('status_changed', 'task_3', 'Third');

      const all = await repo.getAllActivities();
      expect(all.length).toBe(3);
      expect(all[0].id).toBe(a3.id); // Newest first
      expect(all[1].id).toBe(a2.id);
      expect(all[2].id).toBe(a1.id);
    });

    it('should enforce MAX_ACTIVITIES retention limit', async () => {
      const limit = 100;
      for (let i = 0; i < limit + 20; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }

      const all = await repo.getAllActivities();
      expect(all.length).toBeLessThanOrEqual(limit);
    });

    it('should handle concurrent appends safely', async () => {
      const writes: Promise<Activity>[] = [];
      for (let i = 0; i < 50; i++) {
        writes.push(repo.logActivity('task_created', `task_${i}`, `Task ${i}`));
      }

      const results = await Promise.all(writes);
      expect(results.length).toBe(50);
      expect(new Set(results.map((a) => a.id)).size).toBe(50); // All unique
    });

    it('should back up and recover from corrupted file', async () => {
      // Log an activity first
      const a1 = await repo.logActivity('task_created', 'task_1', 'First');

      // Corrupt the JSONL file
      const jsonlPath = path.join(testDir, 'activity.jsonl');
      const validContent = `${JSON.stringify(a1)}\n`;
      await fs.writeFile(jsonlPath, validContent + 'INVALID JSON\n');

      // Attempt recovery by logging another activity
      await repo.logActivity('task_updated', 'task_2', 'Second');

      // Should still have the first activity (recovery)
      const all = await repo.getAllActivities();
      expect(all.length).toBeGreaterThan(0);
      expect(all.some((a) => a.id === a1.id)).toBe(true);

      // Backup should exist
      const backupFiles = await fs.readdir(testDir);
      const hasBackup = backupFiles.some((f) => f.includes('corrupt'));
      expect(hasBackup).toBe(true);
    });
  });

  describe('getActivities', () => {
    beforeEach(async () => {
      for (let i = 0; i < 25; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`, {}, 'agent_a');
        await repo.logActivity('task_updated', `task_${i}`, `Task ${i}`, {}, 'agent_b');
      }
    });

    it('should retrieve paginated activities with limit and offset', async () => {
      const page1 = await repo.getActivities(10, 0);
      expect(page1.length).toBe(10);

      const page2 = await repo.getActivities(10, 10);
      expect(page2.length).toBe(10);

      // Pages should have different activities
      const ids1 = new Set(page1.map((a) => a.id));
      const ids2 = new Set(page2.map((a) => a.id));
      expect([...ids1].some((id) => ids2.has(id))).toBe(false);
    });

    it('should filter activities by agent', async () => {
      const filtered = await repo.getActivities(100, 0, { agent: 'agent_a' });
      expect(filtered.every((a) => a.agent === 'agent_a')).toBe(true);
      expect(filtered.length).toBe(25);
    });

    it('should filter activities by type', async () => {
      const filtered = await repo.getActivities(100, 0, { type: 'task_created' });
      expect(filtered.every((a) => a.type === 'task_created')).toBe(true);
      expect(filtered.length).toBe(25);
    });

    it('should filter activities by taskId', async () => {
      const filtered = await repo.getActivities(100, 0, { taskId: 'task_5' });
      expect(filtered.every((a) => a.taskId === 'task_5')).toBe(true);
      expect(filtered.length).toBe(2); // One created, one updated
    });

    it('should filter activities by timestamp range', async () => {
      const now = new Date();
      const since = new Date(now.getTime() - 60000).toISOString();
      const until = new Date(now.getTime() + 60000).toISOString();

      const filtered = await repo.getActivities(100, 0, { since, until });
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  describe('getActivitiesPage', () => {
    beforeEach(async () => {
      for (let i = 0; i < 15; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`, {}, 'agent_a');
      }
    });

    it('should return items and total in one pass', async () => {
      const page = await repo.getActivitiesPage(5, 0);
      expect(page.items.length).toBe(5);
      expect(page.total).toBe(15);
    });

    it('should honor pagination params', async () => {
      const page = await repo.getActivitiesPage(5, 10);
      expect(page.items.length).toBe(5);
      expect(page.total).toBe(15);
    });
  });

  describe('countActivities', () => {
    it('should return 0 for empty repo', async () => {
      const count = await repo.countActivities();
      expect(count).toBe(0);
    });

    it('should count all activities without filters', async () => {
      for (let i = 0; i < 10; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }

      const count = await repo.countActivities();
      expect(count).toBe(10);
    });

    it('should count filtered activities', async () => {
      for (let i = 0; i < 10; i++) {
        await repo.logActivity(
          'task_created',
          `task_${i}`,
          `Task ${i}`,
          {},
          i % 2 === 0 ? 'agent_a' : 'agent_b'
        );
      }

      const count = await repo.countActivities({ agent: 'agent_a' });
      expect(count).toBe(5);
    });
  });

  describe('compaction', () => {
    it('should compact file when exceeding size threshold', async () => {
      // Log enough activities to approach size threshold
      const largeDetails = { data: 'x'.repeat(1000) };
      for (let i = 0; i < 60; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`, largeDetails);
      }

      const jsonlPath = path.join(testDir, 'activity.jsonl');
      const before = (await fs.stat(jsonlPath)).size;

      // Compaction may have already triggered; manually call if needed
      await repo.compact();

      const after = (await fs.stat(jsonlPath)).size;
      // After compaction and retention limit, file should not grow infinitely
      expect(after).toBeLessThanOrEqual(before);
    });

    it('should backup compacted files', async () => {
      for (let i = 0; i < 60; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }

      await repo.compact();

      const files = await fs.readdir(testDir);
      const hasCompactedBackup = files.some((f) => f.includes('compacted'));
      expect(hasCompactedBackup).toBe(true);
    });
  });

  describe('clearActivities', () => {
    it('should clear all activities', async () => {
      for (let i = 0; i < 10; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }

      let all = await repo.getAllActivities();
      expect(all.length).toBe(10);

      await repo.clearActivities();

      all = await repo.getAllActivities();
      expect(all.length).toBe(0);
    });
  });

  describe('migrateFromJson', () => {
    it('should migrate from legacy JSON array format', async () => {
      const legacyFile = path.join(testDir, 'activity.json');

      const activities: Activity[] = [
        {
          id: 'activity_1',
          type: 'task_created',
          taskId: 'task_1',
          taskTitle: 'Old Activity',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'activity_2',
          type: 'task_updated',
          taskId: 'task_2',
          taskTitle: 'Another Old Activity',
          timestamp: new Date().toISOString(),
        },
      ];

      await fs.writeFile(legacyFile, JSON.stringify(activities, null, 2));

      await repo.migrateFromJson(legacyFile);

      // Check JSONL was created
      const jsonlPath = path.join(testDir, 'activity.jsonl');
      expect(await fs.stat(jsonlPath)).toBeTruthy();

      // Check legacy file was backed up and removed
      const files = await fs.readdir(testDir);
      const hasBackup = files.some((f) => f.includes('migrated'));
      expect(hasBackup).toBe(true);

      // Verify content
      const migrated = await repo.getAllActivities();
      expect(migrated.length).toBe(2);
    });
  });

  describe('recover', () => {
    it('should recover from truncated JSONL', async () => {
      // Create valid entries
      await repo.logActivity('task_created', 'task_1', 'First');
      await repo.logActivity('task_updated', 'task_2', 'Second');

      // Truncate the file
      const jsonlPath = path.join(testDir, 'activity.jsonl');
      const content = await fs.readFile(jsonlPath, 'utf-8');
      const truncated = content.substring(0, Math.floor(content.length / 2));
      await fs.writeFile(jsonlPath, truncated);

      // Call recover
      const recovered = await repo.recover();
      expect(recovered).toBeGreaterThan(0);

      // Should have valid entries
      const all = await repo.getAllActivities();
      expect(all.length).toBeGreaterThan(0);

      // Backup should exist
      const files = await fs.readdir(testDir);
      const hasBackup = files.some((f) => f.includes('corrupted'));
      expect(hasBackup).toBe(true);
    });
  });

  describe('SQLite parity', () => {
    it('should maintain pagination consistency across multiple calls', async () => {
      for (let i = 0; i < 30; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }

      // Fetch all pages
      const pages: Activity[] = [];
      const pageSize = 10;
      for (let offset = 0; offset < 30; offset += pageSize) {
        const page = await repo.getActivities(pageSize, offset);
        pages.push(...page);
      }

      // Should have all activities
      expect(pages.length).toBe(30);

      // Should be newest-first
      for (let i = 0; i < pages.length - 1; i++) {
        const current = new Date(pages[i].timestamp).getTime();
        const next = new Date(pages[i + 1].timestamp).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });
  });

  describe('write amplification', () => {
    it('should not rewrite full history on append', async () => {
      // Log initial activities
      for (let i = 0; i < 10; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }

      const jsonlPath = path.join(testDir, 'activity.jsonl');
      const sizeBefore = (await fs.stat(jsonlPath)).size;

      // Single append
      await repo.logActivity('task_created', 'task_new', 'New Task');
      const sizeAfter = (await fs.stat(jsonlPath)).size;

      // Size increase should be roughly the size of one activity (< 500 bytes)
      const increase = sizeAfter - sizeBefore;
      expect(increase).toBeLessThan(500);
    });
  });
});
