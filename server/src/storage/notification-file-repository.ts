import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from '../services/file-lock.js';

export interface NotificationFileRepositoryOptions {
  dataDir: string;
  notificationsFile?: string;
  subscriptionsFile?: string;
}

export class NotificationFileRepository {
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

  private async loadArray<T>(filePath: string): Promise<T[]> {
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as T[];
    } catch {
      return [];
    }
  }

  private saveArray<T>(filePath: string, values: T[]): Promise<void> {
    return withFileLock(filePath, () => writeFile(filePath, JSON.stringify(values, null, 2)));
  }
}
