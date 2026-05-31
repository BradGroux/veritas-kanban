import { readFile, writeFile, mkdir } from 'fs/promises';
import { fileExists } from '../storage/fs-helpers.js';
import { join } from 'path';
import { createLogger } from '../lib/logger.js';
import { withFileLock } from './file-lock.js';
import { getDataDir } from '../utils/paths.js';
import type { ActivityRepository } from '../storage/interfaces.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteActivityRepository } from '../storage/sqlite/activity-repository.js';
const log = createLogger('activity-service');

export type ActivityType =
  | 'task_created'
  | 'task_updated'
  | 'status_changed'
  | 'agent_started'
  | 'agent_stopped'
  | 'agent_completed'
  | 'agent_event'
  | 'task_archived'
  | 'task_deleted'
  | 'task_promoted'
  | 'task_demoted'
  | 'worktree_created'
  | 'worktree_merged'
  | 'project_archived'
  | 'sprint_archived'
  | 'template_applied'
  | 'comment_added'
  | 'comment_deleted'
  | 'deliverable_added'
  | 'deliverable_updated'
  | 'deliverable_deleted'
  | 'observation_added'
  | 'observation_deleted'
  | 'dependency_added'
  | 'dependency_removed'
  | 'membership_updated';

export interface Activity {
  id: string;
  type: ActivityType;
  taskId: string;
  taskTitle: string;
  agent?: string;
  actor?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface ActivityFilters {
  agent?: string;
  type?: ActivityType;
  taskId?: string;
  since?: string;
  until?: string;
}

export interface ActivityServiceOptions {
  activityFile?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
}

export class ActivityService {
  private activityFile: string;
  private readonly MAX_ACTIVITIES = 5000; // Increased from 1000 for longer history
  private repository: ActivityRepository | null = null;
  private sqliteDatabase: SqliteDatabase | null = null;
  private ownsSqliteDatabase = false;

  constructor(options: ActivityServiceOptions = {}) {
    this.activityFile = options.activityFile || join(getDataDir(), 'activity.json');
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteActivityRepository(this.sqliteDatabase);
    }
  }

  private async ensureDir() {
    const dir = getDataDir();
    await mkdir(dir, { recursive: true });
  }

  /**
   * Load all activities from disk (already sorted newest-first).
   */
  private async loadAll(): Promise<Activity[]> {
    if (this.repository) {
      return this.repository.getActivities(this.MAX_ACTIVITIES);
    }

    await this.ensureDir();

    if (!(await fileExists(this.activityFile))) {
      return [];
    }

    try {
      const content = await readFile(this.activityFile, 'utf-8');
      return JSON.parse(content) as Activity[];
    } catch {
      // Intentionally silent: file may not exist or contain invalid JSON — return empty list
      return [];
    }
  }

  async getActivities(
    limit: number = 50,
    filters?: ActivityFilters,
    offset: number = 0
  ): Promise<Activity[]> {
    let activities = await this.loadAll();

    // Apply filters
    if (filters) {
      if (filters.agent) {
        const agentLower = filters.agent.toLowerCase();
        activities = activities.filter((a) => a.agent?.toLowerCase() === agentLower);
      }
      if (filters.type) {
        activities = activities.filter((a) => a.type === filters.type);
      }
      if (filters.taskId) {
        activities = activities.filter((a) => a.taskId === filters.taskId);
      }
      if (filters.since) {
        const sinceDate = new Date(filters.since).getTime();
        activities = activities.filter((a) => new Date(a.timestamp).getTime() >= sinceDate);
      }
      if (filters.until) {
        const untilDate = new Date(filters.until).getTime();
        activities = activities.filter((a) => new Date(a.timestamp).getTime() <= untilDate);
      }
    }

    return activities.slice(offset, offset + limit);
  }

  /**
   * Return total count of activities matching the given filters (for pagination).
   */
  async countActivities(filters?: ActivityFilters): Promise<number> {
    // Re-use getActivities with a high limit to count — simpler than duplicating filter logic
    const all = await this.getActivities(this.MAX_ACTIVITIES, filters);
    return all.length;
  }

  /**
   * Return distinct agent names found in the activity log.
   */
  async getDistinctAgents(): Promise<string[]> {
    const activities = await this.loadAll();
    const agents = new Set<string>();
    for (const a of activities) {
      if (a.agent) agents.add(a.agent);
    }
    return [...agents].sort();
  }

  /**
   * Return distinct activity types found in the activity log.
   */
  async getDistinctTypes(): Promise<ActivityType[]> {
    const activities = await this.loadAll();
    const types = new Set<ActivityType>();
    for (const a of activities) {
      types.add(a.type);
    }
    return [...types].sort();
  }

  async logActivity(
    type: ActivityType,
    taskId: string,
    taskTitle: string,
    details?: Record<string, unknown>,
    agent?: string,
    actor?: string
  ): Promise<Activity> {
    if (this.repository) {
      return this.repository.logActivity(type, taskId, taskTitle, details, agent, actor);
    }

    await this.ensureDir();

    const activity: Activity = {
      id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      taskId,
      taskTitle,
      ...(agent && { agent }),
      ...(actor && { actor }),
      details,
      timestamp: new Date().toISOString(),
    };

    await withFileLock(this.activityFile, async () => {
      let activities: Activity[] = [];

      if (await fileExists(this.activityFile)) {
        try {
          const content = await readFile(this.activityFile, 'utf-8');
          activities = JSON.parse(content);
        } catch (err) {
          log.warn({ err }, 'Corrupted activity file — resetting to empty list');
          activities = [];
        }
      }

      // Prepend new activity and limit to MAX_ACTIVITIES
      activities = [activity, ...activities].slice(0, this.MAX_ACTIVITIES);

      if (activities.length >= this.MAX_ACTIVITIES) {
        log.warn(
          `[Activity] Activity limit reached (${this.MAX_ACTIVITIES}), trimming oldest entries`
        );
      }

      await writeFile(this.activityFile, JSON.stringify(activities, null, 2), 'utf-8');
    });

    return activity;
  }

  async clearActivities(): Promise<void> {
    if (this.repository) {
      await this.repository.clearActivities();
      return;
    }

    await this.ensureDir();
    await writeFile(this.activityFile, '[]', 'utf-8');
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
    this.sqliteDatabase = null;
    this.repository = null;
  }
}

// Singleton instance
export const activityService = new ActivityService();
