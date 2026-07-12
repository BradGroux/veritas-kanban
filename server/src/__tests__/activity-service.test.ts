/**
 * Activity Service Tests
 * Tests activity logging and retrieval.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Set to use SQLite for tests (avoids mocking fs/promises)
process.env.VERITAS_STORAGE = 'sqlite';

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
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Clear activities between tests
    await service.clearActivities();
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  describe('logActivity', () => {
    it('should log an activity and return it', async () => {
      const activity = await service.logActivity(
        'task_created',
        'task_20260128_abc123',
        'New Feature',
        { type: 'code', priority: 'high' },
        'codex',
        'agent:codex'
      );

      expect(activity.id).toMatch(/^activity_/);
      expect(activity.type).toBe('task_created');
      expect(activity.taskId).toBe('task_20260128_abc123');
      expect(activity.taskTitle).toBe('New Feature');
      expect(activity.agent).toBe('codex');
      expect(activity.actor).toBe('agent:codex');
      expect(activity.details).toEqual({ type: 'code', priority: 'high' });
      expect(activity.timestamp).toBeDefined();
    });

    it('should persist activity', async () => {
      const activity = await service.logActivity('task_created', 'task_1', 'Test');
      const activities = await service.getActivities();
      expect(activities).toHaveLength(1);
      expect(activities[0].id).toBe(activity.id);
    });

    it('should prepend new activities (most recent first)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-12T12:00:00.123Z'));

      await service.logActivity('task_created', 'task_1', 'First');
      await service.logActivity('task_updated', 'task_2', 'Second');

      const activities = await service.getActivities();
      expect(activities[0].taskTitle).toBe('Second');
      expect(activities[1].taskTitle).toBe('First');
    });
  });

  describe('getActivities', () => {
    it('should return empty array when no activities exist', async () => {
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
