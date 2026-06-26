/**
 * NotificationService Tests
 * Tests @mention parsing, notification creation, delivery tracking, and thread subscriptions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseMentions } from '../services/notification-service.js';

// Mock fs and file-lock before importing the service
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/file-lock.js', () => ({
  withFileLock: vi.fn(async (_path: string, fn: () => Promise<void>) => await fn()),
}));

const { getNotificationService } = await import('../services/notification-service.js');
import type { NotificationService } from '../services/notification-service.js';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = getNotificationService();
    // Reset internal state
    (service as any).notifications = [];
    (service as any).subscriptions = [];
    (service as any).loaded = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('parseMentions()', () => {
    it('should extract single @mention', () => {
      const mentions = parseMentions('Hey @alice, can you review this?');
      expect(mentions).toEqual(['alice']);
    });

    it('should extract multiple @mentions', () => {
      const mentions = parseMentions('@alice @bob please check this');
      expect(mentions).toEqual(['alice', 'bob']);
    });

    it('should handle @all', () => {
      const mentions = parseMentions('@all this is important');
      expect(mentions).toEqual(['all']);
    });

    it('should deduplicate mentions', () => {
      const mentions = parseMentions('@alice @bob @alice check this');
      expect(mentions).toEqual(['alice', 'bob']);
    });

    it('should handle hyphenated and underscored names', () => {
      const mentions = parseMentions('@claude-main @gpt_4 hello');
      expect(mentions).toEqual(['claude-main', 'gpt_4']);
    });

    it('should return empty array when no mentions', () => {
      const mentions = parseMentions('No mentions here');
      expect(mentions).toEqual([]);
    });

    it('should lowercase mentions', () => {
      const mentions = parseMentions('@Alice @BOB');
      expect(mentions).toEqual(['alice', 'bob']);
    });
  });

  describe('processComment()', () => {
    it('should create notifications for mentioned agents', async () => {
      const created = await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: 'Hey @bob, can you review this?',
      });

      expect(created).toHaveLength(1);
      expect(created[0].targetAgent).toBe('bob');
      expect(created[0].fromAgent).toBe('alice');
      expect(created[0].type).toBe('mention');
      expect(created[0].delivered).toBe(false);
    });

    it('should not create self-mention notifications', async () => {
      const created = await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: 'I am @alice working on this',
      });

      expect(created).toHaveLength(0);
    });

    it('should expand @all to all known agents', async () => {
      const created = await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: '@all please review',
        allAgents: ['alice', 'bob', 'charlie'],
      });

      expect(created).toHaveLength(2); // bob and charlie (alice excluded)
      const targets = created.map((n) => n.targetAgent).sort();
      expect(targets).toEqual(['bob', 'charlie']);
    });

    it('should subscribe commenter to thread', async () => {
      await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: 'Working on this',
      });

      const subs = await service.getSubscriptions('TASK-1');
      expect(subs).toHaveLength(1);
      expect(subs[0].agent).toBe('alice');
      expect(subs[0].reason).toBe('commented');
    });

    it('should subscribe mentioned agents to thread', async () => {
      await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: 'Hey @bob, check this',
      });

      const subs = await service.getSubscriptions('TASK-1');
      expect(subs).toHaveLength(2);
      const agents = subs.map((s) => s.agent).sort();
      expect(agents).toEqual(['alice', 'bob']);
    });

    it('should notify thread subscribers even without mention', async () => {
      // Bob subscribes to thread
      await service.subscribe('TASK-1', 'bob', 'manual');

      // Alice comments without mentioning Bob
      const created = await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: 'Making progress',
      });

      // Bob should still get notified as a subscriber
      expect(created).toHaveLength(1);
      expect(created[0].targetAgent).toBe('bob');
      expect(created[0].type).toBe('reply'); // Not 'mention' since not explicitly mentioned
    });
  });

  describe('notifyAssignment()', () => {
    it('should create assignment notifications', async () => {
      await service.notifyAssignment('TASK-1', ['bob', 'charlie'], 'alice');

      const bobNotifs = await service.getNotifications({ agent: 'bob' });
      expect(bobNotifs).toHaveLength(1);
      expect(bobNotifs[0].type).toBe('assignment');
      expect(bobNotifs[0].fromAgent).toBe('alice');
    });

    it('should not notify the assigner', async () => {
      await service.notifyAssignment('TASK-1', ['alice', 'bob'], 'alice');

      const aliceNotifs = await service.getNotifications({ agent: 'alice' });
      expect(aliceNotifs).toHaveLength(0);

      const bobNotifs = await service.getNotifications({ agent: 'bob' });
      expect(bobNotifs).toHaveLength(1);
    });

    it('should auto-subscribe assigned agents', async () => {
      await service.notifyAssignment('TASK-1', ['bob'], 'alice');

      const subs = await service.getSubscriptions('TASK-1');
      expect(subs).toHaveLength(1);
      expect(subs[0].agent).toBe('bob');
      expect(subs[0].reason).toBe('assigned');
    });
  });

  describe('getNotifications()', () => {
    beforeEach(async () => {
      await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: '@bob check this',
      });
      await service.processComment({
        taskId: 'TASK-2',
        fromAgent: 'charlie',
        content: '@bob another task',
      });
    });

    it('should get all notifications for an agent', async () => {
      const notifs = await service.getNotifications({ agent: 'bob' });
      expect(notifs).toHaveLength(2);
    });

    it('should filter by undelivered', async () => {
      const allNotifs = await service.getNotifications({ agent: 'bob' });
      await service.markDelivered(allNotifs[0].id);

      const undelivered = await service.getNotifications({ agent: 'bob', undelivered: true });
      expect(undelivered).toHaveLength(1);
    });

    it('should filter by taskId', async () => {
      const notifs = await service.getNotifications({ agent: 'bob', taskId: 'TASK-1' });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].taskId).toBe('TASK-1');
    });

    it('should respect limit', async () => {
      const notifs = await service.getNotifications({ agent: 'bob', limit: 1 });
      expect(notifs).toHaveLength(1);
    });

    it('should sort by newest first', async () => {
      const notifs = await service.getNotifications({ agent: 'bob' });
      const timestamps = notifs.map((n) => new Date(n.createdAt).getTime());
      expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
    });
  });

  describe('markDelivered()', () => {
    it('should mark a notification as delivered', async () => {
      const created = await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: '@bob hello',
      });

      const success = await service.markDelivered(created[0].id);
      expect(success).toBe(true);

      const notifs = await service.getNotifications({ agent: 'bob' });
      expect(notifs[0].delivered).toBe(true);
      expect(notifs[0].deliveredAt).toBeDefined();
    });

    it('should return false for unknown notification', async () => {
      const success = await service.markDelivered('nonexistent');
      expect(success).toBe(false);
    });
  });

  describe('markAllDelivered()', () => {
    it('should mark all notifications for an agent as delivered', async () => {
      await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: '@bob first',
      });
      await service.processComment({
        taskId: 'TASK-2',
        fromAgent: 'alice',
        content: '@bob second',
      });

      const count = await service.markAllDelivered('bob');
      expect(count).toBe(2);

      const undelivered = await service.getNotifications({ agent: 'bob', undelivered: true });
      expect(undelivered).toHaveLength(0);
    });

    it('should return 0 if no undelivered notifications', async () => {
      const count = await service.markAllDelivered('bob');
      expect(count).toBe(0);
    });
  });

  describe('createNotification()', () => {
    it('should create a direct notification (backward compat)', async () => {
      const notif = await service.createNotification({
        type: 'error',
        title: 'Build Failed',
        message: 'The build failed on task ABC-123',
        taskId: 'ABC-123',
      });

      expect(notif.id).toBeDefined();
      expect(notif.targetAgent).toBe('system');
      expect(notif.fromAgent).toBe('system');
      expect(notif.content).toBe('The build failed on task ABC-123');
      expect(notif.type).toBe('error');
      expect(notif.title).toBe('Build Failed');
      expect(notif.delivered).toBe(false);
    });

    it('should create targeted direct notifications', async () => {
      const notif = await service.createNotification({
        type: 'squad_mention',
        title: 'Squad Chat mention',
        message: 'Please review this',
        taskId: 'squad-chat',
        targetAgent: 'CASE',
        fromAgent: 'VERITAS',
      });

      expect(notif.targetAgent).toBe('case');
      expect(notif.fromAgent).toBe('VERITAS');
      expect(notif.type).toBe('squad_mention');
    });
  });

  describe('getStats()', () => {
    beforeEach(async () => {
      await service.processComment({
        taskId: 'TASK-1',
        fromAgent: 'alice',
        content: '@bob @charlie check this',
      });
      await service.processComment({
        taskId: 'TASK-2',
        fromAgent: 'bob',
        content: '@alice done',
      });
    });

    it('should return notification statistics', async () => {
      const stats = await service.getStats();

      expect(stats.totalNotifications).toBe(3); // bob, charlie, alice
      expect(stats.undelivered).toBe(3);
      expect(stats.byAgent).toHaveProperty('bob');
      expect(stats.byAgent).toHaveProperty('charlie');
      expect(stats.byAgent).toHaveProperty('alice');
      expect(stats.byType).toHaveProperty('mention');
    });

    it('should track delivered vs undelivered', async () => {
      const bobNotifs = await service.getNotifications({ agent: 'bob' });
      await service.markDelivered(bobNotifs[0].id);

      const stats = await service.getStats();
      expect(stats.byAgent.bob.total).toBe(1);
      expect(stats.byAgent.bob.undelivered).toBe(0);
    });
  });

  describe('subscribe()', () => {
    it('should subscribe an agent to a thread', async () => {
      await service.subscribe('TASK-1', 'alice', 'manual');

      const subs = await service.getSubscriptions('TASK-1');
      expect(subs).toHaveLength(1);
      expect(subs[0].agent).toBe('alice');
      expect(subs[0].reason).toBe('manual');
    });

    it('should not create duplicate subscriptions', async () => {
      await service.subscribe('TASK-1', 'alice', 'manual');
      await service.subscribe('TASK-1', 'alice', 'commented');

      const subs = await service.getSubscriptions('TASK-1');
      expect(subs).toHaveLength(1);
    });

    it('should lowercase agent names', async () => {
      await service.subscribe('TASK-1', 'Alice', 'manual');

      const subs = await service.getSubscriptions('TASK-1');
      expect(subs[0].agent).toBe('alice');
    });
  });

  describe('getSubscriptions()', () => {
    it('should return subscriptions for a task', async () => {
      await service.subscribe('TASK-1', 'alice', 'manual');
      await service.subscribe('TASK-1', 'bob', 'mentioned');
      await service.subscribe('TASK-2', 'charlie', 'assigned');

      const subs = await service.getSubscriptions('TASK-1');
      expect(subs).toHaveLength(2);
      const agents = subs.map((s) => s.agent).sort();
      expect(agents).toEqual(['alice', 'bob']);
    });

    it('should return empty array for task with no subscriptions', async () => {
      const subs = await service.getSubscriptions('TASK-999');
      expect(subs).toEqual([]);
    });
  });
});
