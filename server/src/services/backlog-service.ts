/**
 * BacklogService - Business logic for backlog task management
 *
 * Handles CRUD operations and promote/demote logic between backlog and active board.
 */

import { nanoid } from 'nanoid';
import type { Task, CreateTaskInput } from '@veritas-kanban/shared';
import { getBacklogRepository } from '../storage/backlog-repository.js';
import { getTaskService } from './task-service.js';
import { activityService } from './activity-service.js';
import { getTelemetryService } from './telemetry-service.js';
import type { TaskTelemetryEvent } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { NotFoundError } from '../middleware/error-handler.js';

const log = createLogger('backlog-service');

export interface BacklogFilterOptions {
  project?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export class BacklogService {
  private backlogRepo = getBacklogRepository();
  private taskService = getTaskService();
  private telemetry = getTelemetryService();

  /**
   * Generate a task ID in the standard format: task_YYYYMMDD_XXXXXX
   */
  private generateTaskId(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randomId = nanoid(6);
    return `task_${dateStr}_${randomId}`;
  }

  /**
   * List all backlog tasks with optional filtering
   */
  async listBacklogTasks(options: BacklogFilterOptions = {}): Promise<{
    tasks: Task[];
    total: number;
    limit: number;
    offset: number;
  }> {
    let tasks = await this.backlogRepo.listAll();

    // Apply filters
    if (options.project) {
      tasks = tasks.filter((t) => t.project === options.project);
    }

    if (options.type) {
      tasks = tasks.filter((t) => t.type === options.type);
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(searchLower) ||
          t.description.toLowerCase().includes(searchLower) ||
          t.id.toLowerCase().includes(searchLower)
      );
    }

    const total = tasks.length;
    const offset = options.offset || 0;
    const limit = options.limit || 100;

    // Apply pagination
    const paginatedTasks = tasks.slice(offset, offset + limit);

    return {
      tasks: paginatedTasks,
      total,
      limit,
      offset,
    };
  }

  /**
   * Get a single backlog task by ID
   */
  async getBacklogTask(id: string): Promise<Task | null> {
    return this.backlogRepo.findById(id);
  }

  /**
   * Create a new task directly in the backlog
   */
  async createBacklogTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();

    const task: Task = {
      id: this.generateTaskId(),
      title: input.title,
      description: input.description || '',
      type: input.type || 'task',
      status: 'todo',
      priority: input.priority || 'medium',
      project: input.project,
      sprint: input.sprint,
      created: now,
      updated: now,
      agent: input.agent,
      subtasks: input.subtasks,
      blockedBy: input.blockedBy,
      timeTracking: {
        entries: [],
        totalSeconds: 0,
        isRunning: false,
      },
      comments: [],
      attachments: [],
    };

    const created = await this.backlogRepo.create(task);

    // Log activity
    await activityService.logActivity(
      'task_created',
      created.id,
      created.title,
      { location: 'backlog' },
      created.agent
    );

    // Emit telemetry event
    await this.telemetry.emit<TaskTelemetryEvent>({
      type: 'task.created',
      taskId: created.id,
      project: created.project,
      status: created.status,
    });

    log.info({ taskId: created.id }, 'Created task in backlog');

    return created;
  }

  /**
   * Update a backlog task
   */
  async updateBacklogTask(id: string, updates: Partial<Task>): Promise<Task> {
    const task = await this.backlogRepo.findById(id);
    if (!task) {
      throw new NotFoundError('Backlog task not found');
    }

    const updated = await this.backlogRepo.update(id, updates);

    // Log activity if title changed
    if (updates.title && updates.title !== task.title) {
      await activityService.logActivity(
        'task_updated',
        updated.id,
        updated.title,
        { field: 'title', oldValue: task.title, newValue: updates.title },
        updated.agent
      );
    }

    log.info({ taskId: id }, 'Updated backlog task');

    return updated;
  }

  /**
   * Delete a backlog task
   */
  async deleteBacklogTask(id: string): Promise<boolean> {
    const task = await this.backlogRepo.findById(id);
    if (!task) {
      return false;
    }

    const deleted = await this.backlogRepo.delete(id);

    if (deleted) {
      // Log activity
      await activityService.logActivity(
        'task_deleted',
        id,
        task.title,
        { location: 'backlog' },
        task.agent
      );

      log.info({ taskId: id }, 'Deleted backlog task');
    }

    return deleted;
  }

  /**
   * Promote a backlog task to the active board
   * Moves the file from tasks/backlog/ to tasks/active/ and sets status to 'todo'
   */
  async promoteToActive(id: string): Promise<Task> {
    const task = await this.backlogRepo.findById(id);
    if (!task) {
      throw new NotFoundError('Backlog task not found');
    }

    // Update task status to 'todo' before moving
    const updatedTask: Task = {
      ...task,
      status: 'todo',
      updated: new Date().toISOString(),
    };

    // Write the updated task to backlog first
    await this.backlogRepo.update(id, { status: 'todo' });

    // Move file to active tasks directory
    const activeTasksDir = this.taskService['tasksDir']; // Access private field
    await this.backlogRepo.moveToActive(id, activeTasksDir);

    // Invalidate task service cache and reload to pick up the new task
    await this.taskService['initCache'](); // Force cache reload

    // Log activity
    await activityService.logActivity(
      'task_promoted',
      updatedTask.id,
      updatedTask.title,
      { from: 'backlog', to: 'active' },
      updatedTask.agent
    );

    // Emit telemetry event
    await this.telemetry.emit<TaskTelemetryEvent>({
      type: 'task.status_changed',
      taskId: updatedTask.id,
      project: updatedTask.project,
      status: 'todo',
      previousStatus: task.status,
    });

    log.info({ taskId: id }, 'Promoted task to active board');

    return updatedTask;
  }

  /**
   * Demote an active task to the backlog
   * Moves the file from tasks/active/ to tasks/backlog/
   */
  async demoteToBacklog(id: string): Promise<Task> {
    const task = await this.taskService.getTask(id);
    if (!task) {
      throw new NotFoundError('Active task not found');
    }

    // Move file to backlog directory
    const activeTasksDir = this.taskService['tasksDir']; // Access private field
    await this.backlogRepo.moveFromActive(task, activeTasksDir);

    // Invalidate task from active cache
    this.taskService['cacheInvalidate'](id); // Access private method

    // Log activity
    await activityService.logActivity(
      'task_demoted',
      task.id,
      task.title,
      { from: 'active', to: 'backlog' },
      task.agent
    );

    // Emit telemetry event
    await this.telemetry.emit<TaskTelemetryEvent>({
      type: 'task.archived', // Reuse archived event type for consistency
      taskId: task.id,
      project: task.project,
      status: task.status,
    });

    log.info({ taskId: id }, 'Demoted task to backlog');

    return task;
  }

  /**
   * Get count of backlog tasks
   */
  async getBacklogCount(): Promise<number> {
    const tasks = await this.backlogRepo.listAll();
    return tasks.length;
  }

  /**
   * Bulk promote tasks to active board
   */
  async bulkPromote(ids: string[]): Promise<{ promoted: string[]; failed: string[] }> {
    const promoted: string[] = [];
    const failed: string[] = [];

    for (const id of ids) {
      try {
        await this.promoteToActive(id);
        promoted.push(id);
      } catch (err) {
        log.error({ err, taskId: id }, 'Failed to promote task');
        failed.push(id);
      }
    }

    log.info({ promoted: promoted.length, failed: failed.length }, 'Bulk promote completed');

    return { promoted, failed };
  }
}

// Singleton instance
let backlogServiceInstance: BacklogService | null = null;

export function getBacklogService(): BacklogService {
  if (!backlogServiceInstance) {
    backlogServiceInstance = new BacklogService();
  }
  return backlogServiceInstance;
}
