import { TaskService } from './task-service.js';
import type { TaskStatus } from '@veritas-kanban/shared';

/**
 * One-time data migrations that run on server startup.
 * Each migration should be idempotent (safe to run multiple times).
 */
export class MigrationService {
  private taskService: TaskService;

  constructor(taskService?: TaskService) {
    this.taskService = taskService || new TaskService();
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<void> {
    await this.migrateReviewToBlocked();
  }

  /**
   * Migrate tasks with status "review" to "blocked"
   * 
   * Background: The "review" status was removed from the workflow.
   * Any existing tasks with that status should be converted to "blocked"
   * so they remain visible and actionable.
   * 
   * This migration is idempotent - if no tasks have status "review",
   * it does nothing.
   */
  private async migrateReviewToBlocked(): Promise<void> {
    let migratedCount = 0;

    // Cast to string for comparison since "review" is no longer in TaskStatus type
    // but may exist in legacy data
    const isReviewStatus = (status: TaskStatus): boolean => 
      (status as string) === 'review';

    // Migrate active tasks
    const activeTasks = await this.taskService.listTasks();
    for (const task of activeTasks) {
      if (isReviewStatus(task.status)) {
        await this.taskService.updateTask(task.id, { status: 'blocked' });
        migratedCount++;
      }
    }

    // Migrate archived tasks
    const archivedTasks = await this.taskService.listArchivedTasks();
    for (const task of archivedTasks) {
      if (isReviewStatus(task.status)) {
        // For archived tasks, we need to update the file directly
        // since updateTask only works with active tasks
        await this.updateArchivedTaskStatus(task.id);
        migratedCount++;
      }
    }

    if (migratedCount > 0) {
      console.log(`Migrated ${migratedCount} tasks from review → blocked`);
    }
  }

  /**
   * Update an archived task's status to blocked
   * (The TaskService.updateTask only works with active tasks)
   */
  private async updateArchivedTaskStatus(taskId: string): Promise<void> {
    // Restore, update, and re-archive
    // This is a bit roundabout but ensures we use the existing task parsing/writing logic
    const task = await this.taskService.getArchivedTask(taskId);
    if (!task) return;

    // Temporarily restore
    await this.taskService.restoreTask(taskId);
    
    // Update status (restoreTask sets status to 'done', so we need to correct it)
    await this.taskService.updateTask(taskId, { status: 'blocked' });
    
    // Re-archive
    await this.taskService.archiveTask(taskId);
  }
}

// Singleton for convenience
let migrationService: MigrationService | null = null;

export function getMigrationService(): MigrationService {
  if (!migrationService) {
    migrationService = new MigrationService();
  }
  return migrationService;
}

/**
 * Run all migrations - call this on server startup
 */
export async function runStartupMigrations(): Promise<void> {
  const service = getMigrationService();
  await service.runMigrations();
}
