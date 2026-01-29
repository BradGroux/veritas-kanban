/**
 * File-based StorageProvider implementation.
 *
 * This is a thin adapter that delegates to the existing TaskService and
 * ConfigService so we don't duplicate any logic.  The rest of the codebase
 * continues to use those services directly — this layer exists so that
 * future backends can be swapped in behind the same interface.
 */

import type { Task, FeatureSettings } from '@veritas-kanban/shared';
import type { TaskRepository, SettingsRepository, StorageProvider } from './interfaces.js';
import { TaskService, type TaskServiceOptions } from '../services/task-service.js';
import { ConfigService, type ConfigServiceOptions } from '../services/config-service.js';

// ---------------------------------------------------------------------------
// FileTaskRepository
// ---------------------------------------------------------------------------

export class FileTaskRepository implements TaskRepository {
  private service: TaskService;

  constructor(service: TaskService) {
    this.service = service;
  }

  async findAll(): Promise<Task[]> {
    return this.service.listTasks();
  }

  async findById(id: string): Promise<Task | null> {
    return this.service.getTask(id);
  }

  async create(task: Task): Promise<Task> {
    // TaskService.createTask expects a CreateTaskInput, but the interface
    // contract says we receive a full Task object.  We forward the relevant
    // fields and let the service generate its own ID / timestamps.
    return this.service.createTask({
      title: task.title,
      description: task.description,
      type: task.type,
      priority: task.priority,
      project: task.project,
      sprint: task.sprint,
      subtasks: task.subtasks,
      blockedBy: task.blockedBy,
    });
  }

  async update(id: string, updates: Partial<Task>): Promise<Task> {
    const result = await this.service.updateTask(id, updates);
    if (!result) {
      throw new Error(`Task not found: ${id}`);
    }
    return result;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.service.deleteTask(id);
    if (!deleted) {
      throw new Error(`Task not found: ${id}`);
    }
  }

  async search(query: string): Promise<Task[]> {
    const all = await this.service.listTasks();
    const lower = query.toLowerCase();
    return all.filter(
      (t) =>
        t.title.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower) ||
        t.id.toLowerCase().includes(lower)
    );
  }
}

// ---------------------------------------------------------------------------
// FileSettingsRepository
// ---------------------------------------------------------------------------

export class FileSettingsRepository implements SettingsRepository {
  private service: ConfigService;

  constructor(service: ConfigService) {
    this.service = service;
  }

  async get(): Promise<FeatureSettings> {
    return this.service.getFeatureSettings();
  }

  async update(settings: Partial<FeatureSettings>): Promise<FeatureSettings> {
    return this.service.updateFeatureSettings(settings as Record<string, unknown>);
  }
}

// ---------------------------------------------------------------------------
// FileStorageProvider
// ---------------------------------------------------------------------------

export interface FileStorageOptions {
  taskServiceOptions?: TaskServiceOptions;
  configServiceOptions?: ConfigServiceOptions;
}

export class FileStorageProvider implements StorageProvider {
  readonly tasks: FileTaskRepository;
  readonly settings: FileSettingsRepository;

  private taskService: TaskService;
  private configService: ConfigService;

  constructor(options: FileStorageOptions = {}) {
    this.taskService = new TaskService(options.taskServiceOptions);
    this.configService = new ConfigService(options.configServiceOptions);

    this.tasks = new FileTaskRepository(this.taskService);
    this.settings = new FileSettingsRepository(this.configService);
  }

  async initialize(): Promise<void> {
    // TaskService initialises lazily on first access (initCache).
    // ConfigService reads on demand too.
    // Nothing extra needed, but calling findAll once warms the cache.
    await this.tasks.findAll();
  }

  async shutdown(): Promise<void> {
    this.taskService.dispose();
    this.configService.dispose();
  }
}
