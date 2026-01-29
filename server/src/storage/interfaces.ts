/**
 * Storage abstraction interfaces.
 *
 * These define a backend-agnostic contract for persisting tasks and settings.
 * The first concrete implementation wraps the existing file-based services;
 * future implementations (SQLite, PostgreSQL, S3, …) can be added without
 * touching business logic.
 */

import type { Task, FeatureSettings } from '@veritas-kanban/shared';

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
// Storage Provider (top-level aggregate)
// ---------------------------------------------------------------------------

export interface StorageProvider {
  readonly tasks: TaskRepository;
  readonly settings: SettingsRepository;

  /** One-time startup hook (create dirs, open connections, etc.). */
  initialize(): Promise<void>;

  /** Graceful shutdown (close watchers, release connections, etc.). */
  shutdown(): Promise<void>;
}
