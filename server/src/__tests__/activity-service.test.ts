/**
 * Activity Service Tests
 * Tests activity logging and retrieval.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Hoist tmpRoot so it's available when vi.mock factory runs (before const declarations)
const tmpRoot = vi.hoisted(() => {
  const tmpdir = process.env.TMPDIR || process.env.TEMP || '/tmp';
  return tmpdir + '/veritas-activity-test-' + Math.random().toString(36).substring(7);
});

vi.mock('fs', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    existsSync: (p: string) => {
      // Redirect .veritas-kanban checks to tmp
      if (p.includes('.veritas-kanban')) {
        const redirected = p.replace(/.*\.veritas-kanban/, path.join(tmpRoot, '.veritas-kanban'));
        return original.existsSync(redirected);
      }
      return original.existsSync(p);
    },
  };
});

import { ActivityService, type ActivityType } from '../services/activity-service.js';

describe('ActivityService', () => {
  let service: ActivityService;
  let activityDir: string;

  beforeEach(async () => {
    activityDir = path.join(tmpRoot, '.veritas-kanban');
    await fs.mkdir(activityDir, { recursive: true });
    service = new ActivityService();
    // Override the activity file path
    (service as any).activityFile = path.join(activityDir, 'activity.json');
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  describe('logActivity', () => {
    it('should log an activity and return it', async () => {
      const activity = await service.logActivity(
        'task_created',
        'task_20260128_abc123',
        'New Feature',
        { type: 'code', priority: 'high' }
      );

      expect(activity.id).toMatch(/^activity_/);
      expect(activity.type).toBe('task_created');
      expect(activity.taskId).toBe('task_20260128_abc123');
      expect(activity.taskTitle).toBe('New Feature');
      expect(activity.details).toEqual({ type: 'code', priority: 'high' });
      expect(activity.timestamp).toBeDefined();
    });

    it('should persist activity to file', async () => {
      await service.logActivity('task_created', 'task_1', 'Test');
      const data = JSON.parse(await fs.readFile((service as any).activityFile, 'utf-8'));
      expect(data).toHaveLength(1);
    });

    it('should prepend new activities (most recent first)', async () => {
      await service.logActivity('task_created', 'task_1', 'First');
      await service.logActivity('task_updated', 'task_2', 'Second');

      const activities = await service.getActivities();
      expect(activities[0].taskTitle).toBe('Second');
      expect(activities[1].taskTitle).toBe('First');
    });
  });

  describe('getActivities', () => {
    it('should return empty array when no file exists', async () => {
      // Use a fresh service with non-existent file
      (service as any).activityFile = path.join(activityDir, 'nonexistent.json');
      const activities = await service.getActivities();
      expect(activities).toEqual([]);
    });

    it('should return limited results', async () => {
      for (let i = 0; i < 5; i++) {
        await service.logActivity('task_created', `task_${i}`, `Task ${i}`);
      }
      const activities = await service.getActivities(3);
      expect(activities).toHaveLength(3);
    });
  });

  describe('clearActivities', () => {
    it('should clear all activities', async () => {
      await service.logActivity('task_created', 'task_1', 'Test');
      await service.clearActivities();
      const activities = await service.getActivities();
      expect(activities).toEqual([]);
    });
  });
});
