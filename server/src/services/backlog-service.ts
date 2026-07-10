/**
 * BacklogService - Business logic for backlog task management
 *
 * Handles CRUD operations and promote/demote logic between backlog and active board.
 */

import { nanoid } from 'nanoid';
import type { Task, CreateTaskInput } from '@veritas-kanban/shared';
import { BacklogRepository, getBacklogRepository } from '../storage/backlog-repository.js';
import { getTaskService, type TaskService } from './task-service.js';
import { activityService } from './activity-service.js';
import { getTelemetryService } from './telemetry-service.js';
import type { TaskTelemetryEvent } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { NotFoundError } from '../middleware/error-handler.js';
import {
  type TaskIdentityDiagnostics,
  type TaskIdentityScanSource,
} from './task-identity-diagnostics.js';

const log = createLogger('backlog-service');

export interface BacklogFilterOptions {
  project?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BacklogServiceOptions {
  backlogRepo?: BacklogRepository;
  taskService?: TaskService;
  telemetry?: ReturnType<typeof getTelemetryService>;
}

export class BacklogService {
  private backlogRepo: BacklogRepository;
  private taskService: TaskService;
  private telemetry: ReturnType<typeof getTelemetryService>;

  constructor(options: BacklogServiceOptions = {}) {
    this.backlogRepo = options.backlogRepo ?? getBacklogRepository();
    this.taskService = options.taskService ?? getTaskService();
    this.telemetry = options.telemetry ?? getTelemetryService();
  }

  getIdentityScanSources(): TaskIdentityScanSource[] {
    return this.backlogRepo.getIdentityScanSources();
  }

  async getTaskIdentityDiagnostics(): Promise<TaskIdentityDiagnostics> {
    // Delegate to taskService which owns the diagnostics cache (#784).
    // Passing backlog sources as extras causes a fresh uncached scan, which is
    // correct because backlog mutations also call invalidateIdentityDiagnosticsCache.
    return this.taskService.getTaskIdentityDiagnostics(this.getIdentityScanSources());
  }

  private async assertTaskIdentityIntegrity(
    operation: string,
    taskId?: string,
    destinationPath?: string
  ): Promise<void> {
    await this.taskService.assertTaskIdentityIntegrity(operation, taskId, {
      destinationPath,
      extraSources: this.getIdentityScanSources(),
    });
  }

  /** Invalidate the shared identity diagnostics cache after backlog mutations (#784). */
  private invalidateIdentityCache(): void {
    this.taskService.invalidateIdentityDiagnosticsCache();
  }

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
    await this.assertTaskIdentityIntegrity('backlog.get', id);
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

    await this.assertTaskIdentityIntegrity('backlog.create', task.id);

    const created = await this.backlogRepo.create(task);
    this.invalidateIdentityCache();

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
    await this.assertTaskIdentityIntegrity('backlog.update', id);

    const task = await this.backlogRepo.findById(id);
    if (!task) {
      throw new NotFoundError('Backlog task not found');
    }

    const updated = await this.backlogRepo.update(id, updates);
    this.invalidateIdentityCache();

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
    await this.assertTaskIdentityIntegrity('backlog.delete', id);

    const task = await this.backlogRepo.findById(id);
    if (!task) {
      return false;
    }

    const deleted = await this.backlogRepo.delete(id);

    if (deleted) {
      this.invalidateIdentityCache();
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
    const activeTasksDir = this.taskService.getActiveTasksDir();
    await this.assertTaskIdentityIntegrity(
      'backlog.promote',
      id,
      this.taskService.getActiveTasksDestinationPath()
    );

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
    await this.backlogRepo.moveToActive(id, activeTasksDir);

    // Invalidate task service cache and reload to pick up the new task
    this.invalidateIdentityCache();
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
    await this.assertTaskIdentityIntegrity('task.demote', id);

    const task = await this.taskService.getTask(id);
    if (!task) {
      throw new NotFoundError('Active task not found');
    }

    // Move file to backlog directory
    const activeTasksDir = this.taskService['tasksDir']; // Access private field
    await this.backlogRepo.moveFromActive(task, activeTasksDir);

    // Invalidate task from active cache
    this.taskService['cacheInvalidate'](id); // Access private method
    this.invalidateIdentityCache();

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
