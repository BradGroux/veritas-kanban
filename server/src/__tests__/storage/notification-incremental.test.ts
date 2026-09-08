import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Notification, ThreadSubscription } from '../../services/notification-service.js';
import type { NotificationRepository } from '../../storage/interfaces.js';
import { NotificationFileRepository } from '../../storage/notification-file-repository.js';
import { SqliteNotificationRepository } from '../../storage/sqlite/notification-repository.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

const row = (id: string, extra: Partial<Notification> = {}): Notification => ({
  id,
  taskId: 'task',
  targetAgent: 'alice',
  fromAgent: 'bob',
  type: 'mention',
  content: id,
  delivered: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  dedupeKey: 'retained-metadata',
  ...extra,
});
const deliveredAt = '2026-01-02T00:00:00.000Z';

describe.each(['file', 'sqlite'] as const)('incremental notifications (%s)', (kind) => {
  let fixture: TestSqliteDatabase;
  let repository: NotificationRepository;
  beforeEach(() => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    repository =
      kind === 'sqlite'
        ? new SqliteNotificationRepository(fixture.database)
        : new NotificationFileRepository({ dataDir: fixture.rootDir });
  });
  afterEach(() => fixture.cleanup());

  it('filters and pages in stable timestamp/id order and preserves metadata', async () => {
    await repository.appendNotifications([
      row('b'),
      row('a'),
      row('c', { createdAt: '2026-01-01T00:00:00.001Z' }),
      row('other', { targetAgent: 'case' }),
      row('delivered', { delivered: true }),
    ]);
    const page = await repository.listNotifications({
      agent: 'ALICE',
      undelivered: true,
      taskId: 'task',
      limit: 2,
      offset: 1,
    });
    expect(page.map((value) => value.id)).toEqual(['a', 'b']);
    expect(page.every((value) => value.dedupeKey === 'retained-metadata')).toBe(true);
    expect(await repository.listNotifications({ limit: 2, offset: 99 })).toEqual([]);
    expect(await repository.getStats()).toEqual({
      totalNotifications: 5,
      undelivered: 4,
      byAgent: { alice: { total: 4, undelivered: 3 }, case: { total: 1, undelivered: 1 } },
      byType: { mention: 5 },
    });
  });

  it('updates only intended deliveries and counts only newly delivered batch entries', async () => {
    const untouched = row('untouched', { targetAgent: 'case', source: { retained: true } });
    await repository.appendNotifications([row('a'), row('b'), untouched]);
    expect(await repository.markDelivered('missing', deliveredAt)).toBe(false);
    expect(await repository.markDelivered('a', deliveredAt)).toBe(true);
    expect(await repository.markManyDelivered(['a', 'b', 'b', 'missing'], deliveredAt)).toBe(1);
    expect(await repository.markAllDelivered('ALICE', deliveredAt)).toBe(0);
    expect((await repository.listNotifications({ agent: 'case' }))[0]).toEqual(untouched);
    expect(await repository.markAllDelivered('CASE', deliveredAt)).toBe(1);
    expect((await repository.getStats()).undelivered).toBe(0);
    expect(await repository.clearNotifications()).toBe(3);
    expect(await repository.clearNotifications()).toBe(0);
  });

  it('rolls back an append batch and keeps subscription dedupe stable', async () => {
    await repository.appendNotifications([row('retained')]);
    await expect(
      Promise.resolve().then(() => repository.appendNotifications([row('new'), row('retained')]))
    ).rejects.toThrow();
    expect(await repository.listNotifications()).toEqual([row('retained')]);
    const subscription: ThreadSubscription = {
      taskId: 'task',
      agent: 'alice',
      reason: 'manual',
      subscribedAt: deliveredAt,
    };
    await repository.subscribe(subscription);
    await repository.subscribe({
      ...subscription,
      reason: 'mentioned',
      subscribedAt: '2026-01-03T00:00:00.000Z',
    });
    expect(await repository.getSubscriptions('task')).toEqual([subscription]);
  });

  it('sees other repository instances without replacing their updates', async () => {
    const other =
      kind === 'sqlite'
        ? new SqliteNotificationRepository(fixture.database)
        : new NotificationFileRepository({ dataDir: fixture.rootDir });
    await repository.appendNotifications([row('a')]);
    await other.appendNotifications([row('b')]);
    await repository.markDelivered('a', deliveredAt);
    expect((await other.listNotifications()).map((value) => value.id)).toEqual(['a', 'b']);
  });

  if (kind === 'sqlite') {
    it('changes exactly one row and keeps unrelated stored bytes intact', async () => {
      await repository.appendNotifications([row('a'), row('b')]);
      const db = fixture.database.getConnection();
      db.prepare("UPDATE notifications SET notification_json = ? WHERE id = 'b'").run(
        '{ "untouched" : true }'
      );
      const before = Number(db.prepare('SELECT total_changes() AS n').get()?.n);
      expect(await repository.markDelivered('a', deliveredAt)).toBe(true);
      expect(Number(db.prepare('SELECT total_changes() AS n').get()?.n) - before).toBe(1);
      expect(
        db.prepare("SELECT notification_json FROM notifications WHERE id = 'b'").get()
          ?.notification_json
      ).toBe('{ "untouched" : true }');
      const updated = await repository.listNotifications({
        undelivered: false,
        taskId: 'task',
        limit: 1,
      });
      expect(updated[0]).toEqual(row('a', { delivered: true, deliveredAt }));
    });

    it('rolls back an entire delivery statement when one row fails', async () => {
      await repository.appendNotifications([row('a'), row('b')]);
      const db = fixture.database.getConnection();
      db.exec(
        "CREATE TRIGGER reject_delivery BEFORE UPDATE ON notifications WHEN NEW.id = 'b' BEGIN SELECT RAISE(ABORT, 'injected delivery failure'); END"
      );
      await expect(
        Promise.resolve().then(() => repository.markManyDelivered(['a', 'b'], deliveredAt))
      ).rejects.toThrow('injected delivery failure');
      expect(await repository.listNotifications()).toEqual([row('a'), row('b')]);
      db.exec('DROP TRIGGER reject_delivery');
      expect(await repository.markManyDelivered(['a', 'b'], deliveredAt)).toBe(2);
    });
  }
});
