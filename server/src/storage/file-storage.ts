/**
 * File-based StorageProvider implementation.
 *
 * This is a thin adapter that delegates to the existing TaskService and
 * ConfigService so we don't duplicate any logic.  The rest of the codebase
 * continues to use those services directly — this layer exists so that
 * future backends can be swapped in behind the same interface.
 */

import type {
  Task,
  FeatureSettings,
  TaskTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  ManagedListItem,
  PromptStats,
  PromptTemplate,
  PromptUsage,
  PromptVersion,
  CreatePromptTemplateInput,
  UpdatePromptTemplateInput,
  RenderPreviewRequest,
  RenderPreviewResponse,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryConfig,
  TelemetryQueryOptions,
  AnyTelemetryEvent,
} from '@veritas-kanban/shared';
import type {
  TaskRepository,
  SettingsRepository,
  StorageProvider,
  ActivityRepository,
  TemplateRepository,
  PromptRegistryRepository,
  StatusHistoryRepository,
  ManagedListRepository,
  ManagedListProvider,
  TelemetryRepository,
} from './interfaces.js';
import { TaskService, type TaskServiceOptions } from '../services/task-service.js';
import { ConfigService, type ConfigServiceOptions } from '../services/config-service.js';
import {
  ActivityService,
  type Activity,
  type ActivityType,
  type ActivityServiceOptions,
} from '../services/activity-service.js';
import { TemplateService, type TemplateServiceOptions } from '../services/template-service.js';
import {
  PromptRegistryService,
  type PromptRegistryServiceOptions,
} from '../services/prompt-registry-service.js';
import {
  StatusHistoryService,
  type StatusHistoryEntry,
  type DailySummary,
  type AgentStatusState,
  type StatusHistoryServiceOptions,
} from '../services/status-history-service.js';
import { ManagedListService } from '../services/managed-list-service.js';
import { TelemetryService, type TelemetryServiceOptions } from '../services/telemetry-service.js';

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
// FileActivityRepository
// ---------------------------------------------------------------------------

export class FileActivityRepository implements ActivityRepository {
  private service: ActivityService;

  constructor(service: ActivityService) {
    this.service = service;
  }

  async getActivities(limit?: number): Promise<Activity[]> {
    return this.service.getActivities(limit);
  }

  async logActivity(
    type: ActivityType,
    taskId: string,
    taskTitle: string,
    details?: Record<string, unknown>,
    agent?: string,
    actor?: string
  ): Promise<Activity> {
    return this.service.logActivity(type, taskId, taskTitle, details, agent, actor);
  }

  async clearActivities(): Promise<void> {
    return this.service.clearActivities();
  }
}

// ---------------------------------------------------------------------------
// FileTemplateRepository
// ---------------------------------------------------------------------------

export class FileTemplateRepository implements TemplateRepository {
  private service: TemplateService;

  constructor(service: TemplateService) {
    this.service = service;
  }

  async getTemplates(): Promise<TaskTemplate[]> {
    return this.service.getTemplates();
  }

  async getTemplate(id: string): Promise<TaskTemplate | null> {
    return this.service.getTemplate(id);
  }

  async createTemplate(input: CreateTemplateInput): Promise<TaskTemplate> {
    return this.service.createTemplate(input);
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<TaskTemplate | null> {
    return this.service.updateTemplate(id, input);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.service.deleteTemplate(id);
  }
}

// ---------------------------------------------------------------------------
// FilePromptRegistryRepository
// ---------------------------------------------------------------------------

export class FilePromptRegistryRepository implements PromptRegistryRepository {
  constructor(private readonly service: PromptRegistryService) {}

  async getTemplates(): Promise<PromptTemplate[]> {
    return this.service.getTemplates();
  }

  async getTemplate(id: string): Promise<PromptTemplate | null> {
    return this.service.getTemplate(id);
  }

  async createTemplate(input: CreatePromptTemplateInput): Promise<PromptTemplate> {
    return this.service.createTemplate(input);
  }

  async updateTemplate(
    id: string,
    input: UpdatePromptTemplateInput
  ): Promise<PromptTemplate | null> {
    return this.service.updateTemplate(id, input);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.service.deleteTemplate(id);
  }

  async getVersionHistory(templateId: string): Promise<PromptVersion[]> {
    return this.service.getVersionHistory(templateId);
  }

  async recordUsage(
    templateId: string,
    usedBy?: string,
    renderedPrompt?: string,
    model?: string,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<PromptUsage> {
    return this.service.recordUsage(
      templateId,
      usedBy,
      renderedPrompt,
      model,
      inputTokens,
      outputTokens
    );
  }

  async getUsageRecords(templateId: string): Promise<PromptUsage[]> {
    return this.service.getUsageRecords(templateId);
  }

  async getStats(templateId: string): Promise<PromptStats | null> {
    return this.service.getStats(templateId);
  }

  async getAllStats(): Promise<PromptStats[]> {
    return this.service.getAllStats();
  }

  async renderPreview(request: RenderPreviewRequest): Promise<RenderPreviewResponse> {
    return this.service.renderPreview(request);
  }
}

// ---------------------------------------------------------------------------
// FileStatusHistoryRepository
// ---------------------------------------------------------------------------

export class FileStatusHistoryRepository implements StatusHistoryRepository {
  private service: StatusHistoryService;

  constructor(service: StatusHistoryService) {
    this.service = service;
  }

  async getHistory(limit?: number, offset?: number): Promise<StatusHistoryEntry[]> {
    return this.service.getHistory(limit, offset);
  }

  async logStatusChange(
    previousStatus: AgentStatusState,
    newStatus: AgentStatusState,
    taskId?: string,
    taskTitle?: string,
    subAgentCount?: number
  ): Promise<StatusHistoryEntry> {
    return this.service.logStatusChange(
      previousStatus,
      newStatus,
      taskId,
      taskTitle,
      subAgentCount
    );
  }

  async getHistoryByDateRange(startDate: string, endDate: string): Promise<StatusHistoryEntry[]> {
    return this.service.getHistoryByDateRange(startDate, endDate);
  }

  async getDailySummary(date?: string): Promise<DailySummary> {
    return this.service.getDailySummary(date);
  }

  async getWeeklySummary(): Promise<DailySummary[]> {
    return this.service.getWeeklySummary();
  }

  async clearHistory(): Promise<void> {
    return this.service.clearHistory();
  }
}

// ---------------------------------------------------------------------------
// FileManagedListRepository / Provider
// ---------------------------------------------------------------------------

export class FileManagedListRepository<
  T extends ManagedListItem,
> implements ManagedListRepository<T> {
  private service: ManagedListService<T>;

  constructor(service: ManagedListService<T>) {
    this.service = service;
  }

  async init(): Promise<void> {
    return this.service.init();
  }

  async list(includeHidden?: boolean): Promise<T[]> {
    return this.service.list(includeHidden);
  }

  async get(id: string): Promise<T | null> {
    return this.service.get(id);
  }

  async create(input: Omit<T, 'order' | 'created' | 'updated'> & { id?: string }): Promise<T> {
    return this.service.create(input);
  }

  async seedItem(item: T): Promise<T> {
    return this.service.seedItem(item);
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    return this.service.update(id, patch);
  }

  async canDelete(
    id: string
  ): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }> {
    return this.service.canDelete(id);
  }

  async delete(
    id: string,
    force?: boolean
  ): Promise<{ deleted: boolean; referenceCount?: number }> {
    return this.service.delete(id, force);
  }

  async reorder(orderedIds: string[]): Promise<T[]> {
    return this.service.reorder(orderedIds);
  }
}

export class FileManagedListProvider implements ManagedListProvider {
  create<T extends ManagedListItem>(
    config: import('../services/managed-list-service.js').ManagedListServiceConfig<T>
  ): ManagedListRepository<T> {
    const service = new ManagedListService<T>(config);
    return new FileManagedListRepository(service);
  }
}

// ---------------------------------------------------------------------------
// FileTelemetryRepository
// ---------------------------------------------------------------------------

export class FileTelemetryRepository implements TelemetryRepository {
  private service: TelemetryService;

  constructor(service: TelemetryService) {
    this.service = service;
  }

  async init(): Promise<void> {
    return this.service.init();
  }

  async emit<T extends TelemetryEvent>(
    event: Omit<T, 'id' | 'timestamp'> & { timestamp?: string }
  ): Promise<T> {
    return this.service.emit(event);
  }

  async getEvents(options?: TelemetryQueryOptions): Promise<AnyTelemetryEvent[]> {
    return this.service.getEvents(options);
  }

  async getTaskEvents(taskId: string): Promise<AnyTelemetryEvent[]> {
    return this.service.getTaskEvents(taskId);
  }

  async getBulkTaskEvents(
    taskIds: string[],
    perTaskLimit?: number
  ): Promise<Map<string, AnyTelemetryEvent[]>> {
    return this.service.getBulkTaskEvents(taskIds, perTaskLimit);
  }

  async getEventsSince(since: string): Promise<AnyTelemetryEvent[]> {
    return this.service.getEventsSince(since);
  }

  async countEvents(
    type: TelemetryEventType | TelemetryEventType[],
    since?: string,
    until?: string
  ): Promise<number> {
    return this.service.countEvents(type, since, until);
  }

  async clear(): Promise<void> {
    return this.service.clear();
  }

  async flush(): Promise<void> {
    return this.service.flush();
  }

  async exportAsJson(options?: TelemetryQueryOptions): Promise<string> {
    return this.service.exportAsJson(options);
  }

  async exportAsCsv(options?: TelemetryQueryOptions): Promise<string> {
    return this.service.exportAsCsv(options);
  }

  configure(config: Partial<TelemetryConfig>): void {
    return this.service.configure(config);
  }

  getConfig(): TelemetryConfig {
    return this.service.getConfig();
  }

  isEnabled(): boolean {
    return this.service.isEnabled();
  }
}

// ---------------------------------------------------------------------------
// FileStorageProvider
// ---------------------------------------------------------------------------

export interface FileStorageOptions {
  taskServiceOptions?: TaskServiceOptions;
  configServiceOptions?: ConfigServiceOptions;
  activityServiceOptions?: ActivityServiceOptions;
  templateServiceOptions?: TemplateServiceOptions;
  promptRegistryServiceOptions?: PromptRegistryServiceOptions;
  statusHistoryServiceOptions?: StatusHistoryServiceOptions;
  telemetryServiceOptions?: TelemetryServiceOptions;
}

export class FileStorageProvider implements StorageProvider {
  readonly tasks: FileTaskRepository;
  readonly settings: FileSettingsRepository;
  readonly activities: FileActivityRepository;
  readonly templates: FileTemplateRepository;
  readonly promptRegistry: FilePromptRegistryRepository;
  readonly statusHistory: FileStatusHistoryRepository;
  readonly managedLists: FileManagedListProvider;
  readonly telemetry: FileTelemetryRepository;

  private taskService: TaskService;
  private configService: ConfigService;
  private activityService: ActivityService;
  private templateService: TemplateService;
  private promptRegistryService: PromptRegistryService;
  private statusHistoryService: StatusHistoryService;
  private telemetryService: TelemetryService;

  constructor(options: FileStorageOptions = {}) {
    this.telemetryService = new TelemetryService({
      ...(options.telemetryServiceOptions || {}),
      storageType: 'file',
    });

    this.taskService = new TaskService({
      ...(options.taskServiceOptions || {}),
      storageType: 'file',
      telemetryService: this.telemetryService,
    });
    this.configService = new ConfigService({
      ...(options.configServiceOptions || {}),
      storageType: 'file',
    });
    this.activityService = new ActivityService({
      ...(options.activityServiceOptions || {}),
      storageType: 'file',
    });
    this.templateService = new TemplateService({
      ...(options.templateServiceOptions || {}),
      storageType: 'file',
    });
    this.promptRegistryService = new PromptRegistryService({
      ...(options.promptRegistryServiceOptions || {}),
      storageType: 'file',
    });
    this.statusHistoryService = new StatusHistoryService({
      ...(options.statusHistoryServiceOptions || {}),
      storageType: 'file',
    });

    this.tasks = new FileTaskRepository(this.taskService);
    this.settings = new FileSettingsRepository(this.configService);
    this.activities = new FileActivityRepository(this.activityService);
    this.templates = new FileTemplateRepository(this.templateService);
    this.promptRegistry = new FilePromptRegistryRepository(this.promptRegistryService);
    this.statusHistory = new FileStatusHistoryRepository(this.statusHistoryService);
    this.managedLists = new FileManagedListProvider();
    this.telemetry = new FileTelemetryRepository(this.telemetryService);
  }

  async initialize(): Promise<void> {
    // Warm caches / ensure directories exist.
    await this.telemetry.init();
    await this.tasks.findAll();
  }

  async shutdown(): Promise<void> {
    await this.telemetry.flush().catch(() => {});
    this.taskService.dispose();
    this.configService.dispose();
    this.activityService.dispose();
    this.statusHistoryService.dispose();
    this.telemetryService.dispose();
  }
}
