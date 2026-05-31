import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NotificationService } from '../../services/notification-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

describe('SQLite notification repositories', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-notifications-'));
  });

  afterEach(async () => {
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('persists notification inbox records and thread subscriptions without JSON files', async () => {
    const dataDir = path.join(testRoot, 'data');
    const service = new NotificationService({
      dataDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const created = await service.processComment({
      taskId: 'TASK-1',
      fromAgent: 'alice',
      content: '@bob @all please review',
      allAgents: ['alice', 'bob', 'case'],
    });
    await service.notifyAssignment('TASK-2', ['bob', 'alice'], 'alice');
    await service.createNotification({
      type: 'system_alert',
      title: 'System Alert',
      message: 'System alert',
      taskId: 'TASK-3',
      taskTitle: 'Review production deploy',
      project: 'veritas-kanban',
      targetUrl: '/tasks/TASK-3',
      dedupeKey: 'system_alert:TASK-3',
      source: { service: 'sqlite-notification-test', retry: 0, userVisible: true },
    });
    await service.markDelivered(created[0].id);

    const restarted = new NotificationService({
      dataDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const bobNotifications = await restarted.getNotifications({ agent: 'bob' });
    expect(bobNotifications).toHaveLength(2);
    expect(bobNotifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: 'TASK-1',
          targetAgent: 'bob',
          type: 'mention',
          delivered: true,
          deliveredAt: expect.any(String),
        }),
        expect.objectContaining({
          taskId: 'TASK-2',
          targetAgent: 'bob',
          type: 'assignment',
          delivered: false,
        }),
      ])
    );
    expect(await restarted.getNotifications({ agent: 'case', undelivered: true })).toEqual([
      expect.objectContaining({ taskId: 'TASK-1', targetAgent: 'case' }),
    ]);
    expect(await restarted.getAllNotifications({ undelivered: true })).toHaveLength(3);
    expect(await restarted.getAllNotifications()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: 'TASK-3',
          targetAgent: 'system',
          type: 'system_alert',
          title: 'System Alert',
          taskTitle: 'Review production deploy',
          project: 'veritas-kanban',
          targetUrl: '/tasks/TASK-3',
          dedupeKey: 'system_alert:TASK-3',
          source: { service: 'sqlite-notification-test', retry: 0, userVisible: true },
        }),
      ])
    );

    const subscriptions = await restarted.getSubscriptions('TASK-1');
    expect(subscriptions.map((subscription) => subscription.agent).sort()).toEqual([
      'alice',
      'bob',
      'case',
    ]);

    const stats = await restarted.getStats();
    expect(stats.totalNotifications).toBe(4);
    expect(stats.byAgent.bob).toMatchObject({ total: 2, undelivered: 1 });
    expect(stats.byType).toMatchObject({ assignment: 1, mention: 2, system_alert: 1 });

    await expect(fs.access(path.join(dataDir, 'notifications.json'))).rejects.toThrow();
    await expect(fs.access(path.join(dataDir, 'thread-subscriptions.json'))).rejects.toThrow();
  });
});
