/**
 * Notification Service
 *
 * Handles @mention parsing, notification storage, delivery tracking,
 * and thread subscriptions for multi-agent communication.
 */

import { createLogger } from '../lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { withFileLock } from './file-lock.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');

const log = createLogger('notifications');

// ─── Types ───────────────────────────────────────────────────────

export interface Notification {
  id: string;
  /** Task where the mention occurred */
  taskId: string;
  /** Agent or user being notified */
  targetAgent: string;
  /** Who created the mention */
  fromAgent: string;
  /** The comment/content containing the mention */
  content: string;
  /** Type of notification */
  type: 'mention' | 'assignment' | 'status_change' | 'reply';
  /** Has the notification been delivered/read? */
  delivered: boolean;
  /** ISO timestamp when delivered */
  deliveredAt?: string;
  /** ISO timestamp of creation */
  createdAt: string;
}

export interface ThreadSubscription {
  taskId: string;
  agent: string;
  /** How the agent got subscribed */
  reason: 'mentioned' | 'commented' | 'assigned' | 'manual';
  subscribedAt: string;
}

export interface NotificationStats {
  totalNotifications: number;
  undelivered: number;
  byAgent: Record<string, { total: number; undelivered: number }>;
  byType: Record<string, number>;
}

// ─── Mention Parser ──────────────────────────────────────────────

/** Extract @mentions from text. Supports @agent-name and @all */
export function parseMentions(text: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }

  return [...new Set(mentions)];
}

// ─── Service ─────────────────────────────────────────────────────

export class NotificationService {
  private notifications: Notification[] = [];
  private subscriptions: ThreadSubscription[] = [];
  private loaded = false;

  private get notificationsPath(): string {
    return path.join(DATA_DIR, 'notifications.json');
  }

  private get subscriptionsPath(): string {
    return path.join(DATA_DIR, 'thread-subscriptions.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const nData = await fs.readFile(this.notificationsPath, 'utf-8');
      this.notifications = JSON.parse(nData);
    } catch {
      this.notifications = [];
    }
    try {
      const sData = await fs.readFile(this.subscriptionsPath, 'utf-8');
      this.subscriptions = JSON.parse(sData);
    } catch {
      this.subscriptions = [];
    }
    this.loaded = true;
  }

  private async saveNotifications(): Promise<void> {
    await withFileLock(this.notificationsPath, async () => {
      await fs.writeFile(this.notificationsPath, JSON.stringify(this.notifications, null, 2));
    });
  }

  private async saveSubscriptions(): Promise<void> {
    await withFileLock(this.subscriptionsPath, async () => {
      await fs.writeFile(this.subscriptionsPath, JSON.stringify(this.subscriptions, null, 2));
    });
  }

  /**
   * Process a comment for @mentions and create notifications.
   * Also subscribes the commenter to the thread.
   */
  async processComment(params: {
    taskId: string;
    fromAgent: string;
    content: string;
    allAgents?: string[];
  }): Promise<Notification[]> {
    await this.ensureLoaded();

    const mentions = parseMentions(params.content);
    const created: Notification[] = [];

    // Expand @all to all known agents
    let targets = mentions.filter((m) => m !== 'all');
    if (mentions.includes('all') && params.allAgents) {
      targets = [...new Set([...targets, ...params.allAgents])];
    }

    // Remove self-mentions
    targets = targets.filter((t) => t !== params.fromAgent.toLowerCase());

    // Also notify thread subscribers (if not already in mentions)
    const subscribers = this.subscriptions
      .filter((s) => s.taskId === params.taskId)
      .map((s) => s.agent.toLowerCase());

    const allTargets = [...new Set([...targets, ...subscribers])].filter(
      (t) => t !== params.fromAgent.toLowerCase()
    );

    for (const target of allTargets) {
      const notification: Notification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        taskId: params.taskId,
        targetAgent: target,
        fromAgent: params.fromAgent,
        content: params.content.slice(0, 500),
        type: targets.includes(target) ? 'mention' : 'reply',
        delivered: false,
        createdAt: new Date().toISOString(),
      };
      this.notifications.push(notification);
      created.push(notification);
    }

    // Subscribe the commenter
    await this.subscribe(params.taskId, params.fromAgent, 'commented');

    // Subscribe mentioned agents
    for (const target of targets) {
      await this.subscribe(params.taskId, target, 'mentioned');
    }

    await this.saveNotifications();

    log.info(
      {
        taskId: params.taskId,
        from: params.fromAgent,
        mentions: targets.length,
        subscribers: allTargets.length - targets.length,
      },
      'Processed comment mentions'
    );

    return created;
  }

  /**
   * Create a notification for task assignment.
   */
  async notifyAssignment(taskId: string, agents: string[], assignedBy: string): Promise<void> {
    await this.ensureLoaded();

    for (const agent of agents) {
      if (agent.toLowerCase() === assignedBy.toLowerCase()) continue;

      const notification: Notification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        taskId,
        targetAgent: agent.toLowerCase(),
        fromAgent: assignedBy,
        content: `You were assigned to this task by ${assignedBy}`,
        type: 'assignment',
        delivered: false,
        createdAt: new Date().toISOString(),
      };
      this.notifications.push(notification);

      // Auto-subscribe assigned agents
      await this.subscribe(taskId, agent, 'assigned');
    }

    await this.saveNotifications();
  }

  /**
   * Get notifications for an agent.
   */
  async getNotifications(filters: {
    agent: string;
    undelivered?: boolean;
    taskId?: string;
    limit?: number;
  }): Promise<Notification[]> {
    await this.ensureLoaded();

    let results = this.notifications.filter((n) => n.targetAgent === filters.agent.toLowerCase());

    if (filters.undelivered) {
      results = results.filter((n) => !n.delivered);
    }
    if (filters.taskId) {
      results = results.filter((n) => n.taskId === filters.taskId);
    }

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * Get notifications across all agents.
   *
   * Used by the CLI notification commands, which predate the agent-scoped
   * route shape.
   */
  async getAllNotifications(filters: {
    undelivered?: boolean;
    limit?: number;
  } = {}): Promise<Notification[]> {
    await this.ensureLoaded();

    let results = [...this.notifications];

    if (filters.undelivered) {
      results = results.filter((n) => !n.delivered);
    }

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * Mark a notification as delivered.
   */
  async markDelivered(notificationId: string): Promise<boolean> {
    await this.ensureLoaded();

    const notification = this.notifications.find((n) => n.id === notificationId);
    if (!notification) return false;

    notification.delivered = true;
    notification.deliveredAt = new Date().toISOString();
    await this.saveNotifications();
    return true;
  }

  /**
   * Mark multiple notifications as delivered.
   */
  async markManyDelivered(notificationIds: string[]): Promise<number> {
    await this.ensureLoaded();

    const ids = new Set(notificationIds);
    const now = new Date().toISOString();
    let count = 0;
    for (const notification of this.notifications) {
      if (ids.has(notification.id) && !notification.delivered) {
        notification.delivered = true;
        notification.deliveredAt = now;
        count++;
      }
    }

    if (count > 0) await this.saveNotifications();
    return count;
  }

  /**
   * Mark all notifications for an agent as delivered.
   */
  async markAllDelivered(agent: string): Promise<number> {
    await this.ensureLoaded();

    let count = 0;
    const now = new Date().toISOString();
    for (const n of this.notifications) {
      if (n.targetAgent === agent.toLowerCase() && !n.delivered) {
        n.delivered = true;
        n.deliveredAt = now;
        count++;
      }
    }

    if (count > 0) await this.saveNotifications();
    return count;
  }

  /**
   * Create a notification directly (backward compat with failure-alert-service).
   */
  async createNotification(params: {
    type?: string;
    title?: string;
    message: string;
    taskId?: string;
    taskTitle?: string;
    project?: string;
  }): Promise<Notification> {
    await this.ensureLoaded();

    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      taskId: params.taskId || 'system',
      targetAgent: 'system',
      fromAgent: 'system',
      content: params.message,
      type: 'mention',
      delivered: false,
      createdAt: new Date().toISOString(),
    };

    this.notifications.push(notification);
    await this.saveNotifications();
    return notification;
  }

  /**
   * Clear all notifications.
   */
  async clearNotifications(): Promise<number> {
    await this.ensureLoaded();

    const count = this.notifications.length;
    this.notifications = [];
    if (count > 0) await this.saveNotifications();
    return count;
  }

  /**
   * Get notification statistics.
   */
  async getStats(): Promise<NotificationStats> {
    await this.ensureLoaded();

    const byAgent: Record<string, { total: number; undelivered: number }> = {};
    const byType: Record<string, number> = {};

    for (const n of this.notifications) {
      if (!byAgent[n.targetAgent]) {
        byAgent[n.targetAgent] = { total: 0, undelivered: 0 };
      }
      byAgent[n.targetAgent].total++;
      if (!n.delivered) byAgent[n.targetAgent].undelivered++;

      byType[n.type] = (byType[n.type] || 0) + 1;
    }

    return {
      totalNotifications: this.notifications.length,
      undelivered: this.notifications.filter((n) => !n.delivered).length,
      byAgent,
      byType,
    };
  }

  /**
   * Subscribe an agent to a task thread.
   */
  async subscribe(
    taskId: string,
    agent: string,
    reason: ThreadSubscription['reason']
  ): Promise<void> {
    await this.ensureLoaded();

    const exists = this.subscriptions.some(
      (s) => s.taskId === taskId && s.agent === agent.toLowerCase()
    );
    if (exists) return;

    this.subscriptions.push({
      taskId,
      agent: agent.toLowerCase(),
      reason,
      subscribedAt: new Date().toISOString(),
    });
    await this.saveSubscriptions();
  }

  /**
   * Get subscriptions for a task.
   */
  async getSubscriptions(taskId: string): Promise<ThreadSubscription[]> {
    await this.ensureLoaded();
    return this.subscriptions.filter((s) => s.taskId === taskId);
  }
}

// Singleton
let instance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!instance) {
    instance = new NotificationService();
  }
  return instance;
}
