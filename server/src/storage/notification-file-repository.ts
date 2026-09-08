import type { NotificationRepository, NotificationQuery } from './interfaces.js';
import type {
  Notification,
  NotificationStats,
  ThreadSubscription,
} from '../services/notification-service.js';
import { readFile } from 'node:fs/promises';
import { atomicWriteFile } from './fs-helpers.js';
import path from 'node:path';
import { withFileLock } from '../services/file-lock.js';

export interface NotificationFileRepositoryOptions {
  dataDir: string;
  notificationsFile?: string;
  subscriptionsFile?: string;
}

export class NotificationFileRepository implements NotificationRepository {
  private readonly notificationsFile: string;
  private readonly subscriptionsFile: string;

  constructor(options: NotificationFileRepositoryOptions) {
    this.notificationsFile =
      options.notificationsFile ?? path.join(options.dataDir, 'notifications.json');
    this.subscriptionsFile =
      options.subscriptionsFile ?? path.join(options.dataDir, 'thread-subscriptions.json');
  }

  loadNotifications<T>(): Promise<T[]> {
    return this.loadArray<T>(this.notificationsFile);
  }

  loadSubscriptions<T>(): Promise<T[]> {
    return this.loadArray<T>(this.subscriptionsFile);
  }

  saveNotifications<T>(notifications: T[]): Promise<void> {
    return this.saveArray(this.notificationsFile, notifications);
  }

  saveSubscriptions<T>(subscriptions: T[]): Promise<void> {
    return this.saveArray(this.subscriptionsFile, subscriptions);
  }

  async appendNotifications(notifications: Notification[]): Promise<void> {
    if (!notifications.length) return;
    await this.mutateArray<Notification, void>(this.notificationsFile, (values) => {
      const ids = new Set(values.map((value) => value.id));
      for (const notification of notifications) {
        if (ids.has(notification.id))
          throw new Error(`Duplicate notification id: ${notification.id}`);
        ids.add(notification.id);
        values.push(notification);
      }
    });
  }

  async listNotifications(query: NotificationQuery = {}): Promise<Notification[]> {
    const values = await this.loadNotifications<Notification>();
    const results = values
      .filter(
        (value) =>
          (query.agent === undefined || value.targetAgent === query.agent.toLowerCase()) &&
          (!query.undelivered || !value.delivered) &&
          (!query.taskId || value.taskId === query.taskId)
      )
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0
          : a.createdAt > b.createdAt
            ? -1
            : 1
      );
    const offset = query.offset ?? 0;
    return results.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
  }

  async markDelivered(id: string, at: string): Promise<boolean> {
    return (await this.deliver((value) => value.id === id, at)) > 0;
  }

  markManyDelivered(ids: string[], at: string): Promise<number> {
    const selected = new Set(ids);
    return this.deliver((value) => !value.delivered && selected.has(value.id), at);
  }

  markAllDelivered(agent: string, at: string): Promise<number> {
    return this.deliver(
      (value) => !value.delivered && value.targetAgent === agent.toLowerCase(),
      at
    );
  }

  private deliver(matches: (value: Notification) => boolean, at: string): Promise<number> {
    return this.mutateArray<Notification, number>(this.notificationsFile, (values) => {
      let count = 0;
      for (const value of values) {
        if (!matches(value)) continue;
        value.delivered = true;
        value.deliveredAt = at;
        count++;
      }
      return count;
    });
  }

  clearNotifications(): Promise<number> {
    return this.mutateArray<Notification, number>(this.notificationsFile, (values) => {
      const count = values.length;
      values.length = 0;
      return count;
    });
  }

  async getStats(): Promise<NotificationStats> {
    const values = await this.loadNotifications<Notification>();
    const byAgent: NotificationStats['byAgent'] = Object.create(null);
    const byType: NotificationStats['byType'] = Object.create(null);
    let undelivered = 0;
    for (const value of values) {
      const agent = (byAgent[value.targetAgent] ??= { total: 0, undelivered: 0 });
      agent.total++;
      if (!value.delivered) {
        agent.undelivered++;
        undelivered++;
      }
      byType[value.type] = (byType[value.type] ?? 0) + 1;
    }
    return { totalNotifications: values.length, undelivered, byAgent, byType };
  }

  subscribe(subscription: ThreadSubscription): Promise<void> {
    return this.mutateArray<ThreadSubscription, void>(this.subscriptionsFile, (values) => {
      if (
        !values.some(
          (value) => value.taskId === subscription.taskId && value.agent === subscription.agent
        )
      )
        values.push(subscription);
    });
  }

  async getSubscriptions(taskId: string): Promise<ThreadSubscription[]> {
    return (await this.loadSubscriptions<ThreadSubscription>())
      .filter((value) => value.taskId === taskId)
      .sort((a, b) =>
        a.subscribedAt === b.subscribedAt
          ? a.agent.localeCompare(b.agent)
          : a.subscribedAt.localeCompare(b.subscribedAt)
      );
  }

  private mutateArray<T, R>(filePath: string, mutate: (values: T[]) => R): Promise<R> {
    return withFileLock(filePath, async () => {
      const values = await this.loadArray<T>(filePath);
      const before = JSON.stringify(values);
      const result = mutate(values);
      if (JSON.stringify(values) !== before) {
        await atomicWriteFile(filePath, JSON.stringify(values, null, 2));
      }
      return result;
    });
  }

  private async loadArray<T>(filePath: string): Promise<T[]> {
    try {
      const values: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      if (!Array.isArray(values)) throw new Error('Expected a JSON array');
      return values as T[];
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error(
        `Cannot load ${path.basename(filePath)}. Preserve the file and restore valid JSON or correct its read permissions before retrying.`,
        { cause }
      );
    }
  }

  private saveArray<T>(filePath: string, values: T[]): Promise<void> {
    return withFileLock(filePath, async () => {
      // A cached service must not overwrite state that became unreadable since
      // its last load. Validate the existing bytes while holding the same lock.
      await this.loadArray(filePath);
      await atomicWriteFile(filePath, JSON.stringify(values, null, 2));
    });
  }
}
