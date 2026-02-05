/**
 * Notification Service
 *
 * Handles notification persistence, formatting, and generation.
 * Extracted from notifications.ts route to separate business logic from HTTP concerns.
 */

import fs from 'fs/promises';
import path from 'path';
import type { Task } from '@veritas-kanban/shared';
import { withFileLock } from './file-lock.js';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  taskId?: string;
  taskTitle?: string;
  project?: string;
  timestamp: string;
  sent: boolean;
}

export type NotificationType =
  | 'agent_complete'
  | 'agent_failed'
  | 'needs_review'
  | 'task_done'
  | 'high_priority'
  | 'error'
  | 'milestone'
  | 'info';

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  taskId?: string;
  taskTitle?: string;
  project?: string;
}

export interface FormattedMessage {
  id: string;
  type: NotificationType;
  text: string;
  timestamp: string;
}

// Type icons for message formatting
const TYPE_ICONS: Record<NotificationType, string> = {
  agent_complete: '✅',
  agent_failed: '❌',
  needs_review: '👀',
  task_done: '🎉',
  high_priority: '🔴',
  error: '⚠️',
  milestone: '🏆',
  info: 'ℹ️',
};

// Default paths
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const DEFAULT_NOTIFICATIONS_FILE = path.join(PROJECT_ROOT, '.veritas-kanban', 'notifications.json');

export class NotificationService {
  private notificationsFile: string;
  private maxNotifications: number;

  constructor(options: { notificationsFile?: string; maxNotifications?: number } = {}) {
    this.notificationsFile = options.notificationsFile || DEFAULT_NOTIFICATIONS_FILE;
    this.maxNotifications = options.maxNotifications || 100;
  }

  // ============ Persistence ============

  async loadNotifications(): Promise<Notification[]> {
    try {
      const data = await fs.readFile(this.notificationsFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      // Intentionally silent: file may not exist yet — return empty list
      return [];
    }
  }

  async saveNotifications(notifications: Notification[]): Promise<void> {
    await fs.mkdir(path.dirname(this.notificationsFile), { recursive: true });
    await fs.writeFile(this.notificationsFile, JSON.stringify(notifications, null, 2));
  }

  async clearNotifications(): Promise<void> {
    await this.saveNotifications([]);
  }

  // ============ CRUD Operations ============

  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    const notification: Notification = {
      ...input,
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      sent: false,
    };

    await withFileLock(this.notificationsFile, async () => {
      const notifications = await this.loadNotifications();

      notifications.push(notification);

      // Keep only last N notifications
      if (notifications.length > this.maxNotifications) {
        notifications.splice(0, notifications.length - this.maxNotifications);
      }

      await this.saveNotifications(notifications);
    });

    return notification;
  }

  async getNotifications(filter?: { unsent?: boolean }): Promise<Notification[]> {
    let notifications = await this.loadNotifications();

    if (filter?.unsent) {
      notifications = notifications.filter((n) => !n.sent);
    }

    // Most recent first
    return notifications.reverse();
  }

  async markAsSent(ids: string[]): Promise<number> {
    const notifications = await this.loadNotifications();

    let marked = 0;
    notifications.forEach((n) => {
      if (ids.includes(n.id)) {
        n.sent = true;
        marked++;
      }
    });

    await this.saveNotifications(notifications);
    return marked;
  }

  // ============ Formatting Logic ============

  /**
   * Format a notification for Teams delivery
   */
  formatForTeams(notification: Notification): FormattedMessage {
    const icon = TYPE_ICONS[notification.type];
    let text = `${icon} **${notification.title}**\n${notification.message}`;

    if (notification.taskTitle) {
      text += `\n\n📋 Task: ${notification.taskTitle}`;
      if (notification.project) text += ` (#${notification.project})`;
      text += `\n🔗 \`vk show ${notification.taskId?.slice(-8)}\``;
    }

    return {
      id: notification.id,
      type: notification.type,
      text,
      timestamp: notification.timestamp,
    };
  }

  /**
   * Get unsent notifications formatted for Teams
   */
  async getPendingForTeams(): Promise<{ count: number; messages: FormattedMessage[] }> {
    const notifications = await this.loadNotifications();
    const unsent = notifications.filter((n) => !n.sent);

    if (unsent.length === 0) {
      return { count: 0, messages: [] };
    }

    const messages = unsent.map((n) => this.formatForTeams(n));
    return { count: unsent.length, messages };
  }

  // ============ Notification Generation ============

  /**
   * Check tasks and generate notifications for conditions that need attention.
   * Returns newly created notifications.
   */
  async checkTasksForNotifications(tasks: Task[]): Promise<Notification[]> {
    const created: Notification[] = [];
    const existing = await this.loadNotifications();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    // Check for blocked tasks where agent completed work (needs human review)
    const inReview = tasks.filter(
      (t) =>
        t.status === 'blocked' && t.attempt?.status === 'complete' && t.attempt?.agent !== 'veritas'
    );

    for (const task of inReview) {
      const alreadyNotified = existing.some(
        (n) =>
          n.taskId === task.id &&
          n.type === 'needs_review' &&
          new Date(n.timestamp).getTime() > oneDayAgo
      );

      if (!alreadyNotified) {
        const notification = await this.createNotification({
          type: 'needs_review',
          title: 'Code Ready for Review',
          message: `Agent completed work on "${task.title}". Please review the changes.`,
          taskId: task.id,
          taskTitle: task.title,
          project: task.project,
        });
        created.push(notification);
      }
    }

    // Check for failed agent attempts
    const failed = tasks.filter((t) => t.attempt?.status === 'failed' && t.status !== 'done');

    for (const task of failed) {
      const alreadyNotified = existing.some(
        (n) =>
          n.taskId === task.id &&
          n.type === 'agent_failed' &&
          new Date(n.timestamp).getTime() > oneDayAgo
      );

      if (!alreadyNotified) {
        const notification = await this.createNotification({
          type: 'agent_failed',
          title: 'Agent Failed',
          message: `${task.attempt?.agent} failed on "${task.title}". May need manual intervention.`,
          taskId: task.id,
          taskTitle: task.title,
          project: task.project,
        });
        created.push(notification);
      }
    }

    return created;
  }
}

// Singleton instance
let instance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!instance) {
    instance = new NotificationService();
  }
  return instance;
}
