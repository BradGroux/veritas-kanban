import type { Notification, ThreadSubscription } from '../../services/notification-service.js';
import type { SqliteDatabase } from './database.js';

interface NotificationRow {
  notification_json: string;
}

interface ThreadSubscriptionRow {
  subscription_json: string;
}

export class SqliteNotificationRepository {
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

      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
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
