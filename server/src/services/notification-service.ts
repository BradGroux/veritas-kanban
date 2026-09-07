/**
 * Notification Service
 *
 * Handles @mention parsing, notification storage, delivery tracking,
 * and thread subscriptions for multi-agent communication.
 */

import type { NotificationRepository, NotificationQuery } from '../storage/interfaces.js';
import { createLogger } from '../lib/logger.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteNotificationRepository } from '../storage/sqlite/notification-repository.js';
import { getRuntimeDir } from '../utils/paths.js';
import { NotificationFileRepository } from '../storage/notification-file-repository.js';

const DATA_DIR = getRuntimeDir();

const log = createLogger('notifications');

// ─── Types ───────────────────────────────────────────────────────

export type NotificationSourceMetadata = Record<string, string | number | boolean | null>;

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
  type: string;
  /** Optional display title for direct notifications */
  title?: string;
  /** Optional human-readable task title */
  taskTitle?: string;
  /** Optional project or workspace label */
  project?: string;
  /** Optional link target for UI/API consumers */
  targetUrl?: string;
  /** Optional caller-provided dedupe key */
  dedupeKey?: string;
  /** Audit-safe source metadata, not raw event payloads */
  source?: NotificationSourceMetadata;
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

export interface NotificationServiceOptions {
  dataDir?: string;
  notificationsFile?: string;
  subscriptionsFile?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
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
  private readonly repository: NotificationRepository;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;

  constructor(options: NotificationServiceOptions = {}) {
    const dataDir = options.dataDir ?? DATA_DIR;
    this.repository = new NotificationFileRepository({
      dataDir,
      notificationsFile: options.notificationsFile,
      subscriptionsFile: options.subscriptionsFile,
    });
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteNotificationRepository(this.sqliteDatabase);
    }
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
    const subscribers = (await this.repository.getSubscriptions(params.taskId)).map((s) =>
      s.agent.toLowerCase()
    );

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
      created.push(notification);
    }

    // Subscribe the commenter
    await this.subscribe(params.taskId, params.fromAgent, 'commented');

    // Subscribe mentioned agents
    for (const target of targets) {
      await this.subscribe(params.taskId, target, 'mentioned');
    }

    await this.repository.appendNotifications(created);

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
    const created: Notification[] = [];
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
      created.push(notification);

      // Auto-subscribe assigned agents
      await this.subscribe(taskId, agent, 'assigned');
    }

    await this.repository.appendNotifications(created);
  }

  /**
   * Get notifications for an agent.
   */
  async getNotifications(filters: NotificationQuery & { agent: string }): Promise<Notification[]> {
    return this.repository.listNotifications(filters);
  }

  async getAllNotifications(
    filters: Omit<NotificationQuery, 'agent' | 'taskId'> = {}
  ): Promise<Notification[]> {
    return this.repository.listNotifications(filters);
  }

  async markDelivered(notificationId: string): Promise<boolean> {
    return this.repository.markDelivered(notificationId, new Date().toISOString());
  }

  async markManyDelivered(notificationIds: string[]): Promise<number> {
    return this.repository.markManyDelivered(notificationIds, new Date().toISOString());
  }

  async markAllDelivered(agent: string): Promise<number> {
    return this.repository.markAllDelivered(agent.toLowerCase(), new Date().toISOString());
  }

  /**
   * Create a notification directly (backward compat with failure-alert-service).
   */
  async createNotification(params: {
    type?: string;
    title?: string;
    message: string;
    taskId?: string;
    targetAgent?: string;
    fromAgent?: string;
    taskTitle?: string;
    project?: string;
    targetUrl?: string;
    dedupeKey?: string;
    source?: NotificationSourceMetadata;
  }): Promise<Notification> {
    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      taskId: params.taskId || 'system',
      targetAgent: params.targetAgent?.toLowerCase() || 'system',
      fromAgent: params.fromAgent || 'system',
      content: params.message.slice(0, 500),
      type: params.type || 'system',
      title: params.title,
      taskTitle: params.taskTitle,
      project: params.project,
      targetUrl: params.targetUrl,
      dedupeKey: params.dedupeKey,
      source: params.source,
      delivered: false,
      createdAt: new Date().toISOString(),
    };

    await this.repository.appendNotifications([notification]);
    return notification;
  }

  /**
   * Clear all notifications.
   */
  async clearNotifications(): Promise<number> {
    return this.repository.clearNotifications();
  }

  async getStats(): Promise<NotificationStats> {
    return this.repository.getStats();
  }

  async subscribe(
    taskId: string,
    agent: string,
    reason: ThreadSubscription['reason']
  ): Promise<void> {
    await this.repository.subscribe({
      taskId,
      agent: agent.toLowerCase(),
      reason,
      subscribedAt: new Date().toISOString(),
    });
  }

  async getSubscriptions(taskId: string): Promise<ThreadSubscription[]> {
    return this.repository.getSubscriptions(taskId);
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
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
