import type { Notification, ThreadSubscription } from '../../services/notification-service.js';
import type { NotificationRepository, NotificationQuery } from '../interfaces.js';
import type { NotificationStats } from '../../services/notification-service.js';
import type { SqliteDatabase } from './database.js';

interface NotificationRow {
  notification_json: string;
}

interface ThreadSubscriptionRow {
  subscription_json: string;
}

export class SqliteNotificationRepository implements NotificationRepository {
  constructor(private readonly database: SqliteDatabase) {}

  loadNotifications(): Notification[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT notification_json
          FROM notifications
          WHERE workspace_id = 'local'
          ORDER BY datetime(created_at) ASC, id ASC
        `
      )
      .all() as unknown as NotificationRow[];

    return rows.map((row) => JSON.parse(row.notification_json) as Notification);
  }

  saveNotifications(notifications: Notification[]): void {
    const db = this.database.getConnection();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare("DELETE FROM notifications WHERE workspace_id = 'local'").run();

      this.insertNotifications(notifications);

      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  private insertNotifications(notifications: Notification[]): void {
    const db = this.database.getConnection();
    const insertNotification = db.prepare(
      `
          INSERT INTO notifications (
            id,
            workspace_id,
            task_id,
            target_agent,
            from_agent,
            type,
            delivered,
            delivered_at,
            content,
            title,
            task_title,
            project,
            target_url,
            dedupe_key,
            source_json,
            notification_json,
            created_at
          )
          VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
    );

    for (const notification of notifications) {
      insertNotification.run(
        notification.id,
        notification.taskId,
        notification.targetAgent,
        notification.fromAgent,
        notification.type,
        notification.delivered ? 1 : 0,
        notification.deliveredAt ?? null,
        notification.content,
        notification.title ?? null,
        notification.taskTitle ?? null,
        notification.project ?? null,
        notification.targetUrl ?? null,
        notification.dedupeKey ?? null,
        notification.source ? JSON.stringify(notification.source) : null,
        JSON.stringify(notification),
        notification.createdAt
      );
    }
  }

  appendNotifications(notifications: Notification[]): void {
    if (!notifications.length) return;
    const db = this.database.getConnection();
    db.exec('BEGIN IMMEDIATE;');
    try {
      this.insertNotifications(notifications);
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  listNotifications(query: NotificationQuery = {}): Notification[] {
    const clauses = ["workspace_id = 'local'"];
    const parameters: (string | number)[] = [];
    if (query.agent !== undefined) {
      clauses.push('target_agent = ?');
      parameters.push(query.agent.toLowerCase());
    }
    if (query.undelivered) clauses.push('delivered = 0');
    if (query.taskId) {
      clauses.push('task_id = ?');
      parameters.push(query.taskId);
    }
    parameters.push(query.limit ?? -1, query.offset ?? 0);
    const rows = this.database
      .getConnection()
      .prepare(
        `SELECT notification_json FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`
      )
      .all(...parameters) as unknown as NotificationRow[];
    return rows.map((row) => JSON.parse(row.notification_json) as Notification);
  }

  markDelivered(id: string, at: string): boolean {
    return this.updateDelivered('id = ?', [id], at) > 0;
  }

  private updateDelivered(where: string, parameters: string[], at: string): number {
    return Number(
      this.database
        .getConnection()
        .prepare(
          `UPDATE notifications SET delivered = 1, delivered_at = ?, notification_json = json_set(notification_json, '$.delivered', json('true'), '$.deliveredAt', ?) WHERE workspace_id = 'local' AND ${where}`
        )
        .run(at, at, ...parameters).changes
    );
  }

  markManyDelivered(ids: string[], at: string): number {
    if (!ids.length) return 0;
    // JSON table avoids SQLite's parameter limit for a large delivery batch.
    return this.updateDelivered(
      'delivered = 0 AND id IN (SELECT value FROM json_each(?))',
      [JSON.stringify([...new Set(ids)])],
      at
    );
  }

  markAllDelivered(agent: string, at: string): number {
    return this.updateDelivered('delivered = 0 AND target_agent = ?', [agent.toLowerCase()], at);
  }

  clearNotifications(): number {
    return Number(
      this.database
        .getConnection()
        .prepare("DELETE FROM notifications WHERE workspace_id = 'local'")
        .run().changes
    );
  }

  getStats(): NotificationStats {
    const rows = this.database
      .getConnection()
      .prepare(
        "SELECT target_agent AS agent, type, COUNT(*) AS total, SUM(delivered = 0) AS undelivered FROM notifications WHERE workspace_id = 'local' GROUP BY target_agent, type"
      )
      .all() as unknown as { agent: string; type: string; total: number; undelivered: number }[];
    const byAgent: NotificationStats['byAgent'] = Object.create(null);
    const byType: NotificationStats['byType'] = Object.create(null);
    let totalNotifications = 0;
    let undelivered = 0;
    for (const row of rows) {
      const total = Number(row.total);
      const pending = Number(row.undelivered);
      const agent = (byAgent[row.agent] ??= { total: 0, undelivered: 0 });
      agent.total += total;
      agent.undelivered += pending;
      byType[row.type] = (byType[row.type] ?? 0) + total;
      totalNotifications += total;
      undelivered += pending;
    }
    return { totalNotifications, undelivered, byAgent, byType };
  }

  subscribe(subscription: ThreadSubscription): void {
    this.database
      .getConnection()
      .prepare(
        `INSERT INTO thread_subscriptions (workspace_id, task_id, agent, reason, subscription_json, subscribed_at) VALUES ('local', ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, task_id, agent) DO NOTHING`
      )
      .run(
        subscription.taskId,
        subscription.agent,
        subscription.reason,
        JSON.stringify(subscription),
        subscription.subscribedAt
      );
  }

  getSubscriptions(taskId: string): ThreadSubscription[] {
    const rows = this.database
      .getConnection()
      .prepare(
        "SELECT subscription_json FROM thread_subscriptions WHERE workspace_id = 'local' AND task_id = ? ORDER BY subscribed_at ASC, agent ASC"
      )
      .all(taskId) as unknown as ThreadSubscriptionRow[];
    return rows.map((row) => JSON.parse(row.subscription_json) as ThreadSubscription);
  }

  loadSubscriptions(): ThreadSubscription[] {
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT subscription_json
          FROM thread_subscriptions
          WHERE workspace_id = 'local'
          ORDER BY datetime(subscribed_at) ASC, task_id ASC, agent ASC
        `
      )
      .all() as unknown as ThreadSubscriptionRow[];

    return rows.map((row) => JSON.parse(row.subscription_json) as ThreadSubscription);
  }

  saveSubscriptions(subscriptions: ThreadSubscription[]): void {
    const db = this.database.getConnection();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare("DELETE FROM thread_subscriptions WHERE workspace_id = 'local'").run();

      const insertSubscription = db.prepare(
        `
          INSERT INTO thread_subscriptions (
            task_id,
            agent,
            workspace_id,
            reason,
            subscription_json,
            subscribed_at
          )
          VALUES (?, ?, 'local', ?, ?, ?)
        `
      );

      for (const subscription of subscriptions) {
        insertSubscription.run(
          subscription.taskId,
          subscription.agent,
          subscription.reason,
          JSON.stringify(subscription),
          subscription.subscribedAt
        );
      }

      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
}
