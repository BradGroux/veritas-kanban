import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export type ActivityType = 
  | 'task_created'
  | 'task_updated'
  | 'status_changed'
  | 'agent_started'
  | 'agent_stopped'
  | 'agent_completed'
  | 'task_archived'
  | 'task_deleted'
  | 'worktree_created'
  | 'worktree_merged'
  | 'project_archived'
  | 'template_applied';

export interface Activity {
  id: string;
  type: ActivityType;
  taskId: string;
  taskTitle: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export class ActivityService {
  private activityFile: string;
  private maxActivities: number = 100;

  constructor() {
    this.activityFile = join(process.cwd(), '.veritas-kanban', 'activity.json');
    this.ensureDir();
  }

  private async ensureDir() {
    const dir = join(process.cwd(), '.veritas-kanban');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async getActivities(limit: number = 50): Promise<Activity[]> {
    await this.ensureDir();
    
    if (!existsSync(this.activityFile)) {
      return [];
    }

    try {
      const content = await readFile(this.activityFile, 'utf-8');
      const activities: Activity[] = JSON.parse(content);
      return activities.slice(0, limit);
    } catch {
      return [];
    }
  }

  async logActivity(
    type: ActivityType,
    taskId: string,
    taskTitle: string,
    details?: Record<string, unknown>
  ): Promise<Activity> {
    await this.ensureDir();
    
    const activity: Activity = {
      id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      taskId,
      taskTitle,
      details,
      timestamp: new Date().toISOString(),
    };

    let activities: Activity[] = [];
    
    if (existsSync(this.activityFile)) {
      try {
        const content = await readFile(this.activityFile, 'utf-8');
        activities = JSON.parse(content);
      } catch {
        activities = [];
      }
    }

    // Prepend new activity and limit to maxActivities
    activities = [activity, ...activities].slice(0, this.maxActivities);
    
    await writeFile(this.activityFile, JSON.stringify(activities, null, 2), 'utf-8');
    
    return activity;
  }

  async clearActivities(): Promise<void> {
    await this.ensureDir();
    await writeFile(this.activityFile, '[]', 'utf-8');
  }
}

// Singleton instance
export const activityService = new ActivityService();
