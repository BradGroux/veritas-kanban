/**
 * Append Activity Repository Tests
 * Tests essential append-only JSONL storage functionality.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { AppendActivityRepository } from '../storage/append-activity-repository.js';

const tmpRoot = `/tmp/veritas-append-activity-test-${Math.random().toString(36).substring(7)}`;

describe('AppendActivityRepository', () => {
  let repo: AppendActivityRepository;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpRoot, 'test');
    await fs.mkdir(testDir, { recursive: true });
    repo = new AppendActivityRepository(testDir, {
      maxActivities: 100,
      maxFileSizeBytes: 50 * 1024,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  describe('logActivity and getActivities', () => {
    it('should log and retrieve activity', async () => {
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

      const all = await repo.getAllActivities();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(activity.id);
    });

    it('should prepend new activities (newest-first)', async () => {
      const a1 = await repo.logActivity('task_created', 'task_1', 'First');
      const a2 = await repo.logActivity('task_updated', 'task_2', 'Second');

      const all = await repo.getAllActivities();
      expect(all[0].id).toBe(a2.id);
      expect(all[1].id).toBe(a1.id);
    });

    it('should enforce MAX_ACTIVITIES retention limit', async () => {
      for (let i = 0; i < 120; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }

      const all = await repo.getAllActivities();
      expect(all.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getActivitiesPage', () => {
    beforeEach(async () => {
      for (let i = 0; i < 15; i++) {
        await repo.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }
    });

    it('should return items and total in single call', async () => {
      const page = await repo.getActivitiesPage(5, 0);
      expect(page.items).toHaveLength(5);
      expect(page.total).toBe(15);
    });

    it('should paginate correctly', async () => {
      const page1 = await repo.getActivitiesPage(5, 0);
      const page2 = await repo.getActivitiesPage(5, 5);
      expect(page1.items).toHaveLength(5);
      expect(page2.items).toHaveLength(5);
    });

    it('should filter by agent', async () => {
      await repo.clearActivities();
      await repo.logActivity('task_created', 'task_1', 'Task 1', {}, 'agent_a');
      await repo.logActivity('task_created', 'task_2', 'Task 2', {}, 'agent_b');

      const page = await repo.getActivitiesPage(10, 0, { agent: 'agent_a' });
      expect(page.total).toBe(1);
      expect(page.items[0].agent).toBe('agent_a');
    });
  });

  describe('clearActivities', () => {
    it('should clear all activities', async () => {
      await repo.logActivity('task_created', 'task_1', 'Test');
      await repo.clearActivities();
      const all = await repo.getAllActivities();
      expect(all).toHaveLength(0);
    });
  });
});
