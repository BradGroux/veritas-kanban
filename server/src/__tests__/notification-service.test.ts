/**
 * NotificationService Tests
 * Tests notification CRUD, formatting, and task-checking logic.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { NotificationService, type CreateNotificationInput, type Notification } from '../services/notification-service.js';

describe('NotificationService', () => {
  let testDir: string;
  let notifFile: string;
  let service: NotificationService;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `veritas-test-notif-${suffix}`);
    notifFile = path.join(testDir, 'notifications.json');
    await fs.mkdir(testDir, { recursive: true });

    service = new NotificationService({ notificationsFile: notifFile, maxNotifications: 10 });
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('loadNotifications()', () => {
    it('should return empty array when file does not exist', async () => {
      const notifications = await service.loadNotifications();
      expect(notifications).toEqual([]);
    });

    it('should load existing notifications from file', async () => {
      const data: Notification[] = [
        {
          id: 'notif_1',
          type: 'info',
          title: 'Test',
          message: 'Hello',
          timestamp: '2024-01-01T00:00:00Z',
          sent: false,
        },
      ];
      await fs.writeFile(notifFile, JSON.stringify(data));

      const result = await service.loadNotifications();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('notif_1');
    });

    it('should return empty array on corrupted file', async () => {
      await fs.writeFile(notifFile, 'invalid json');
      const result = await service.loadNotifications();
      expect(result).toEqual([]);
    });
  });

  describe('saveNotifications()', () => {
    it('should save notifications to file', async () => {
      const data: Notification[] = [
        {
          id: 'notif_1',
          type: 'info',
          title: 'Saved',
          message: 'Test',
          timestamp: '2024-01-01T00:00:00Z',
          sent: false,
        },
      ];
      await service.saveNotifications(data);

      const content = await fs.readFile(notifFile, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].title).toBe('Saved');
    });

    it('should create directory if it does not exist', async () => {
      const deepFile = path.join(testDir, 'deep', 'notifications.json');
      const deepService = new NotificationService({ notificationsFile: deepFile });
      await deepService.saveNotifications([]);
      
      const content = await fs.readFile(deepFile, 'utf-8');
      expect(JSON.parse(content)).toEqual([]);
    });
  });

  describe('clearNotifications()', () => {
    it('should clear all notifications', async () => {
      await service.createNotification({ type: 'info', title: 'Test', message: 'Hi' });
      await service.clearNotifications();
      
      const result = await service.loadNotifications();
      expect(result).toEqual([]);
    });
  });

  describe('createNotification()', () => {
    it('should create a notification with generated id and timestamp', async () => {
      const input: CreateNotificationInput = {
        type: 'agent_complete',
        title: 'Agent Done',
        message: 'Work completed',
        taskId: 'task_123',
        taskTitle: 'My Task',
        project: 'my-project',
      };

      const notification = await service.createNotification(input);
      expect(notification.id).toMatch(/^notif_/);
      expect(notification.type).toBe('agent_complete');
      expect(notification.title).toBe('Agent Done');
      expect(notification.sent).toBe(false);
      expect(notification.timestamp).toBeDefined();
      expect(notification.taskId).toBe('task_123');
      expect(notification.project).toBe('my-project');
    });

    it('should enforce maxNotifications limit', async () => {
      for (let i = 0; i < 15; i++) {
        await service.createNotification({ type: 'info', title: `Notif ${i}`, message: `Msg ${i}` });
      }

      const all = await service.loadNotifications();
      expect(all.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getNotifications()', () => {
    it('should return notifications in reverse order (most recent first)', async () => {
      await service.createNotification({ type: 'info', title: 'First', message: 'A' });
      await service.createNotification({ type: 'info', title: 'Second', message: 'B' });

      const result = await service.getNotifications();
      expect(result[0].title).toBe('Second');
      expect(result[1].title).toBe('First');
    });

    it('should filter unsent notifications', async () => {
      const n1 = await service.createNotification({ type: 'info', title: 'Unsent', message: 'A' });
      const n2 = await service.createNotification({ type: 'info', title: 'Will be sent', message: 'B' });
      
      // Mark one as sent
      await service.markAsSent([n2.id]);

      const unsent = await service.getNotifications({ unsent: true });
      expect(unsent).toHaveLength(1);
      expect(unsent[0].title).toBe('Unsent');
    });
  });

  describe('markAsSent()', () => {
    it('should mark specified notifications as sent', async () => {
      const n1 = await service.createNotification({ type: 'info', title: 'A', message: 'A' });
      const n2 = await service.createNotification({ type: 'info', title: 'B', message: 'B' });

      const marked = await service.markAsSent([n1.id]);
      expect(marked).toBe(1);

      const all = await service.loadNotifications();
      const sentOne = all.find(n => n.id === n1.id);
      const unsentOne = all.find(n => n.id === n2.id);
      expect(sentOne!.sent).toBe(true);
      expect(unsentOne!.sent).toBe(false);
    });

    it('should return count of marked notifications', async () => {
      const n1 = await service.createNotification({ type: 'info', title: 'A', message: 'A' });
      const n2 = await service.createNotification({ type: 'info', title: 'B', message: 'B' });

      const marked = await service.markAsSent([n1.id, n2.id]);
      expect(marked).toBe(2);
    });
  });

  describe('formatForTeams()', () => {
    it('should format notification with icon and title', () => {
      const notification: Notification = {
        id: 'n1',
        type: 'agent_complete',
        title: 'Agent Done',
        message: 'Work completed',
        timestamp: '2024-01-01T00:00:00Z',
        sent: false,
      };

      const formatted = service.formatForTeams(notification);
      expect(formatted.text).toContain('✅');
      expect(formatted.text).toContain('**Agent Done**');
      expect(formatted.text).toContain('Work completed');
      expect(formatted.type).toBe('agent_complete');
    });

    it('should include task details when present', () => {
      const notification: Notification = {
        id: 'n1',
        type: 'needs_review',
        title: 'Review Required',
        message: 'Please review',
        taskId: 'task_12345678',
        taskTitle: 'My Task',
        project: 'veritas',
        timestamp: '2024-01-01T00:00:00Z',
        sent: false,
      };

      const formatted = service.formatForTeams(notification);
      expect(formatted.text).toContain('📋 Task: My Task');
      expect(formatted.text).toContain('#veritas');
      expect(formatted.text).toContain('vk show');
    });

    it('should handle all notification types', () => {
      const types = ['agent_complete', 'agent_failed', 'needs_review', 'task_done', 'high_priority', 'error', 'milestone', 'info'] as const;
      
      for (const type of types) {
        const notification: Notification = {
          id: 'n1',
          type,
          title: 'Test',
          message: 'Msg',
          timestamp: '2024-01-01T00:00:00Z',
          sent: false,
        };
        const formatted = service.formatForTeams(notification);
        expect(formatted.text.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getPendingForTeams()', () => {
    it('should return count and formatted messages for unsent notifications', async () => {
      await service.createNotification({ type: 'info', title: 'Pending', message: 'Msg' });

      const result = await service.getPendingForTeams();
      expect(result.count).toBe(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].text).toContain('Pending');
    });

    it('should return zero when no unsent notifications', async () => {
      const n = await service.createNotification({ type: 'info', title: 'Sent', message: 'Msg' });
      await service.markAsSent([n.id]);

      const result = await service.getPendingForTeams();
      expect(result.count).toBe(0);
      expect(result.messages).toHaveLength(0);
    });
  });

  describe('checkTasksForNotifications()', () => {
    it('should create notifications for tasks needing review', async () => {
      const tasks = [
        {
          id: 'task_1',
          title: 'Review This',
          status: 'blocked',
          project: 'test',
          attempt: { id: 'a1', agent: 'claude-code', status: 'complete' },
        },
      ] as any;

      const created = await service.checkTasksForNotifications(tasks);
      expect(created).toHaveLength(1);
      expect(created[0].type).toBe('needs_review');
      expect(created[0].taskId).toBe('task_1');
    });

    it('should create notifications for failed agent attempts', async () => {
      const tasks = [
        {
          id: 'task_2',
          title: 'Failed Task',
          status: 'blocked',
          attempt: { id: 'a1', agent: 'amp', status: 'failed' },
        },
      ] as any;

      const created = await service.checkTasksForNotifications(tasks);
      expect(created).toHaveLength(1);
      expect(created[0].type).toBe('agent_failed');
    });

    it('should not duplicate notifications within 24 hours', async () => {
      const tasks = [
        {
          id: 'task_3',
          title: 'Dedup Test',
          status: 'blocked',
          attempt: { id: 'a1', agent: 'amp', status: 'failed' },
        },
      ] as any;

      // First check creates notification
      await service.checkTasksForNotifications(tasks);
      // Second check should not duplicate
      const second = await service.checkTasksForNotifications(tasks);
      expect(second).toHaveLength(0);
    });

    it('should skip tasks that don\'t need notifications', async () => {
      const tasks = [
        { id: 'task_4', title: 'Normal', status: 'todo' },
        { id: 'task_5', title: 'In Progress', status: 'in-progress' },
        { id: 'task_6', title: 'Done', status: 'done', attempt: { status: 'complete' } },
      ] as any;

      const created = await service.checkTasksForNotifications(tasks);
      expect(created).toHaveLength(0);
    });

    it('should skip tasks where veritas is the agent (for review notifications)', async () => {
      const tasks = [
        {
          id: 'task_7',
          title: 'Veritas Task',
          status: 'blocked',
          attempt: { id: 'a1', agent: 'veritas', status: 'complete' },
        },
      ] as any;

      const created = await service.checkTasksForNotifications(tasks);
      // veritas agent complete shouldn't trigger 'needs_review'
      expect(created.filter(n => n.type === 'needs_review')).toHaveLength(0);
    });
  });
});
