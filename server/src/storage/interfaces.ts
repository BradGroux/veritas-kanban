/**
 * Storage abstraction interfaces.
 *
 * These define a backend-agnostic contract for persisting tasks and settings.
 * The first concrete implementation wraps the existing file-based services;
 * future implementations (SQLite, PostgreSQL, S3, …) can be added without
 * touching business logic.
 */

import type {
  Task,
  FeatureSettings,
  TaskTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  ManagedListItem,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryConfig,
  TelemetryQueryOptions,
  AnyTelemetryEvent,
} from '@veritas-kanban/shared';
import type { Activity, ActivityType } from '../services/activity-service.js';
import type {
  StatusHistoryEntry,
  DailySummary,
  AgentStatusState,
} from '../services/status-history-service.js';
import type { ManagedListServiceConfig } from '../services/managed-list-service.js';

// ---------------------------------------------------------------------------
// Task Repository
// ---------------------------------------------------------------------------

export interface TaskRepository {
  /** Return every active task (not archived). */
  findAll(): Promise<Task[]>;

  /** Look up a single task by ID. Returns null when not found. */
  findById(id: string): Promise<Task | null>;

  /** Persist a brand-new task and return it (with generated ID, timestamps, …). */
  create(task: Task): Promise<Task>;

  /** Apply a partial update and return the full updated task. Throws if not found. */
  update(id: string, updates: Partial<Task>): Promise<Task>;

  /** Delete a task by ID. Throws if not found. */
  delete(id: string): Promise<void>;

  /** Full-text(-ish) search over tasks. */
  search(query: string): Promise<Task[]>;
}

// ---------------------------------------------------------------------------
// Settings Repository
// ---------------------------------------------------------------------------

export interface SettingsRepository {
  /** Return the current feature settings (merged with defaults). */
  get(): Promise<FeatureSettings>;

  /** Deep-merge a partial patch and return the resulting settings. */
  update(settings: Partial<FeatureSettings>): Promise<FeatureSettings>;
}

// ---------------------------------------------------------------------------
// Activity Repository
// ---------------------------------------------------------------------------

export interface ActivityRepository {
  /** Return recent activities, ordered newest-first. */
  getActivities(limit?: number): Promise<Activity[]>;

  /** Append a new activity entry and return it. */
  logActivity(
    type: ActivityType,
    taskId: string,
    taskTitle: string,
    details?: Record<string, unknown>,
    agent?: string
  ): Promise<Activity>;

  /** Delete all activity entries. */
  clearActivities(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Template Repository
// ---------------------------------------------------------------------------

export interface TemplateRepository {
  /** Return all task templates, sorted by name. */
  getTemplates(): Promise<TaskTemplate[]>;

  /** Look up a single template by ID. Returns null when not found. */
  getTemplate(id: string): Promise<TaskTemplate | null>;

  /** Create a new template and return it. */
  createTemplate(input: CreateTemplateInput): Promise<TaskTemplate>;

  /** Partial-update a template. Returns null when not found. */
  updateTemplate(id: string, input: UpdateTemplateInput): Promise<TaskTemplate | null>;

  /** Delete a template by ID. Returns true if deleted, false if not found. */
  deleteTemplate(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Status History Repository
// ---------------------------------------------------------------------------

export interface StatusHistoryRepository {
  /** Return history entries with pagination. */
  getHistory(limit?: number, offset?: number): Promise<StatusHistoryEntry[]>;

  /** Record a status transition and return the new entry. */
  logStatusChange(
    previousStatus: AgentStatusState,
    newStatus: AgentStatusState,
    taskId?: string,
    taskTitle?: string,
    subAgentCount?: number
  ): Promise<StatusHistoryEntry>;

  /** Return entries within a time range. */
  getHistoryByDateRange(startDate: string, endDate: string): Promise<StatusHistoryEntry[]>;

  /** Compute an activity summary for a single day. */
  getDailySummary(date?: string): Promise<DailySummary>;

  /** Compute daily summaries for the past 7 days. */
  getWeeklySummary(): Promise<DailySummary[]>;

  /** Delete all history entries. */
  clearHistory(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Managed List Repository (generic — priorities, projects, sprints, …)
// ---------------------------------------------------------------------------

export interface ManagedListRepository<T extends ManagedListItem> {
  /** Initialise the list (seed defaults, etc.). */
  init(): Promise<void>;

  /** Return all items, optionally including hidden ones. */
  list(includeHidden?: boolean): Promise<T[]>;

  /** Look up a single item by ID. */
  get(id: string): Promise<T | null>;

  /** Create a new item. */
  create(input: Omit<T, 'order' | 'created' | 'updated'> & { id?: string }): Promise<T>;

  /** Seed a pre-built item (for migrations). */
  seedItem(item: T): Promise<T>;

  /** Partial-update an item. Returns null when not found. */
  update(id: string, patch: Partial<T>): Promise<T | null>;

  /** Check whether an item can be safely deleted. */
  canDelete(id: string): Promise<{ allowed: boolean; referenceCount: number; isDefault: boolean }>;

  /** Delete an item. */
  delete(id: string, force?: boolean): Promise<{ deleted: boolean; referenceCount?: number }>;

  /** Reorder items by providing an ordered list of IDs. */
  reorder(orderedIds: string[]): Promise<T[]>;
}

export interface ManagedListProvider {
  /**
   * Create a managed-list repository for the given config.
   *
   * Concrete storage implementations decide how/where list data is persisted.
   */
  create<T extends ManagedListItem>(config: ManagedListServiceConfig<T>): ManagedListRepository<T>;
}

// ---------------------------------------------------------------------------
// Telemetry Repository
// ---------------------------------------------------------------------------

export interface TelemetryRepository {
  /** One-time setup (create directories, run retention cleanup). */
  init(): Promise<void>;

  /** Emit a telemetry event. */
  emit<T extends TelemetryEvent>(event: Omit<T, 'id' | 'timestamp'>): Promise<T>;

  /** Query events with optional filters. */
  getEvents(options?: TelemetryQueryOptions): Promise<AnyTelemetryEvent[]>;

  /** Get all events for a specific task. */
  getTaskEvents(taskId: string): Promise<AnyTelemetryEvent[]>;

  /** Batch-query events for multiple tasks. */
  getBulkTaskEvents(taskIds: string[]): Promise<Map<string, AnyTelemetryEvent[]>>;

  /** Get events since a given timestamp. */
  getEventsSince(since: string): Promise<AnyTelemetryEvent[]>;

  /** Count events by type within a time period. */
  countEvents(
    type: TelemetryEventType | TelemetryEventType[],
    since?: string,
    until?: string
  ): Promise<number>;

  /** Delete all events. */
  clear(): Promise<void>;

  /** Wait for pending writes to complete. */
  flush(): Promise<void>;

  /** Export events as JSON. */
  exportAsJson(options?: TelemetryQueryOptions): Promise<string>;

  /** Export events as CSV. */
  exportAsCsv(options?: TelemetryQueryOptions): Promise<string>;

  /** Update runtime configuration. */
  configure(config: Partial<TelemetryConfig>): void;

  /** Get current configuration. */
  getConfig(): TelemetryConfig;

  /** Check if telemetry is enabled. */
  isEnabled(): boolean;
}

// ---------------------------------------------------------------------------
// Storage Provider (top-level aggregate)
// ---------------------------------------------------------------------------

export interface StorageProvider {
  readonly tasks: TaskRepository;
  readonly settings: SettingsRepository;
  readonly activities: ActivityRepository;
  readonly templates: TemplateRepository;
  readonly statusHistory: StatusHistoryRepository;
  readonly managedLists: ManagedListProvider;
  readonly telemetry: TelemetryRepository;

  /** One-time startup hook (create dirs, open connections, etc.). */
  initialize(): Promise<void>;

  /** Graceful shutdown (close watchers, release connections, etc.). */
  shutdown(): Promise<void>;
}
