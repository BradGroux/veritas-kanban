import { readFile } from 'node:fs/promises';
import { atomicWriteFile } from './fs-helpers.js';
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
