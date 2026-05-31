import type { ActivityRepository } from '../interfaces.js';
import type { Activity, ActivityType } from '../../services/activity-service.js';
import type { SqliteDatabase } from './database.js';

const MAX_ACTIVITIES = 5000;

interface ActivityRow {
  activity_json: string;
}

export class SqliteActivityRepository implements ActivityRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async getActivities(limit = 50): Promise<Activity[]> {
    const effectiveLimit = Math.min(Math.max(limit, 1), MAX_ACTIVITIES);
    const rows = this.database
      .getConnection()
      .prepare(
        `
          SELECT activity_json
          FROM activity_events
          WHERE workspace_id = 'local'
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT ?
        `
      )
      .all(effectiveLimit) as unknown as ActivityRow[];

    return rows.map((row) => JSON.parse(row.activity_json) as Activity);
  }

  async logActivity(
    type: ActivityType,
    taskId: string,
    taskTitle: string,
    details?: Record<string, unknown>,
    agent?: string
  ): Promise<Activity> {
    const activity: Activity = {
      id: `activity_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type,
      taskId,
      taskTitle,
      ...(agent && { agent }),
      details,
      timestamp: new Date().toISOString(),
    };

    this.transaction(() => {
      this.database
        .getConnection()
        .prepare(
          `
            INSERT INTO activity_events (
              id,
              workspace_id,
              type,
              task_id,
              task_title,
              agent,
              details_json,
              activity_json,
              created_at
            )
            VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          activity.id,
          activity.type,
          activity.taskId,
          activity.taskTitle,
          activity.agent ?? null,
          activity.details ? JSON.stringify(activity.details) : null,
          JSON.stringify(activity),
          activity.timestamp
        );

      this.trimOldActivities();
    });

    return activity;
  }

  async clearActivities(): Promise<void> {
    this.database
      .getConnection()
      .prepare("DELETE FROM activity_events WHERE workspace_id = 'local'")
      .run();
  }

  private trimOldActivities(): void {
    this.database
      .getConnection()
      .prepare(
        `
        DELETE FROM activity_events
        WHERE id IN (
          SELECT id
          FROM activity_events
          WHERE workspace_id = 'local'
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT -1 OFFSET ?
        )
      `
      )
      .run(MAX_ACTIVITIES);
  }

  private transaction<T>(callback: () => T): T {
    const db = this.database.getConnection();

    try {
      db.exec('BEGIN IMMEDIATE;');
      const result = callback();
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }
}
