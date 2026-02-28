import fs from 'fs/promises';
import { watch, type FSWatcher } from '../storage/fs-helpers.js';
import path from 'path';
import matter from 'gray-matter';
import { nanoid } from 'nanoid';
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ReviewComment,
  Subtask,
  TaskTelemetryEvent,
  TimeTracking,
  RunStartedEvent,
  RunCompletedEvent,
} from '@veritas-kanban/shared';
import { getTelemetryService, type TelemetryService } from './telemetry-service.js';
import { ConfigService } from './config-service.js';
import { withFileLock } from './file-lock.js';
import { createLogger } from '../lib/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { fireHook, getHookEventForStatusChange } from './hook-service.js';
import {
  validateTransition,
  executePostTransitionActions,
  type TransitionActionCallbacks,
} from './transition-hooks-service.js';
import { getAgentRegistryService } from './agent-registry-service.js';
import { getTasksActiveDir, getTasksArchiveDir } from '../utils/paths.js';

const log = createLogger('task-cache');

/**
 * Task ID format validation
 * Production format: task_YYYYMMDD_XXXXXX (date + 6-char nanoid)
 * Legacy/test formats also accepted: task_YYYYMMDD_X{1,20} or task_WORD
 */
const TASK_ID_REGEX = /^task_(\d{8}_[a-zA-Z0-9_-]{1,20}|[a-zA-Z0-9_-]+)$/;

/**
 * Task types that require 4x10 review gate (when enforcement is enabled)
 */
const CODE_TASK_TYPES = ['code', 'bug', 'feature', 'automation', 'system'];

/** Validate task ID format */
function isValidTaskId(id: string): boolean {
  return TASK_ID_REGEX.test(id);
}

// Simple slug function to avoid CJS/ESM issues with slugify
function makeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// Default paths are resolved via the shared paths utility so Docker, tests,
// and local dev all agree on where tasks live.
const DEFAULT_TASKS_DIR = getTasksActiveDir();
const DEFAULT_ARCHIVE_DIR = getTasksArchiveDir();

export interface TaskServiceOptions {
  tasksDir?: string;
  archiveDir?: string;
  telemetryService?: TelemetryService;
}

/** Ignore file-watcher events within this window after our own writes */
const WRITE_DEBOUNCE_MS = 200;

export class TaskService {
  private tasksDir: string;
  private archiveDir: string;
  private telemetry: TelemetryService;

  // ============ In-Memory Cache ============
  private cache: Map<string, Task> = new Map();
  private cacheInitialized = false;
  private cacheLoading: Promise<void> | null = null;
  private watcher: FSWatcher | null = null;
  private lastWriteTime = 0;
  private cacheStats = { hits: 0, misses: 0 };
  private taskSyncReconcileInterval: ReturnType<typeof setInterval> | null = null;
  private reconcileRunning = false;

  constructor(options: TaskServiceOptions = {}) {
    this.tasksDir = options.tasksDir || DEFAULT_TASKS_DIR;
    this.archiveDir = options.archiveDir || DEFAULT_ARCHIVE_DIR;
    this.telemetry = options.telemetryService || getTelemetryService();
    this.ensureDirectories();
    this.startTaskSyncReconciler();
  }

  // ============ Cache Helpers ============

  /**
   * Initialize the cache by loading all tasks from disk and starting the file watcher.
   * Safe to call multiple times; only the first call does work.
   */
  private async initCache(): Promise<void> {
    if (this.cacheInitialized) return;

    // Prevent concurrent initialization (e.g. parallel listTasks + getTask)
    if (this.cacheLoading) {
      await this.cacheLoading;
      return;
    }

    this.cacheLoading = this.loadCacheFromDisk();
    await this.cacheLoading;
    this.cacheLoading = null;
    this.cacheInitialized = true;
    this.startWatcher();
    log.debug({ count: this.cache.size }, 'Cache initialized');
  }

  /** Read every .md file in tasksDir and populate the cache */
  private async loadCacheFromDisk(): Promise<void> {
    await this.ensureDirectories();
    await this.seedIfEmpty();
    const files = await fs.readdir(this.tasksDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    this.cache.clear();
    await Promise.all(
      mdFiles.map(async (filename) => {
        const filepath = path.join(this.tasksDir, filename);
        const content = await fs.readFile(filepath, 'utf-8');
        const task = this.parseTaskFile(content, filename);
        if (task) {
          this.cache.set(task.id, task);
        }
      })
    );
  }

  /**
   * First-run seed: if tasks/active/ is empty, copy example tasks from
   * tasks/examples/ so new users see a populated board out of the box.
   */
  private async seedIfEmpty(): Promise<void> {
    const files = await fs.readdir(this.tasksDir);
    const hasTasks = files.some((f) => f.endsWith('.md'));
    if (hasTasks) return;

    const examplesDir = path.join(this.tasksDir, '..', 'examples');
    try {
      const examples = await fs.readdir(examplesDir);
      const mdExamples = examples.filter((f) => f.endsWith('.md'));
      if (mdExamples.length === 0) return;

      await Promise.all(
        mdExamples.map((filename) =>
          fs.copyFile(path.join(examplesDir, filename), path.join(this.tasksDir, filename))
        )
      );
      log.info({ count: mdExamples.length }, 'Seeded example tasks for first run');
    } catch {
      // examples/ doesn't exist — that's fine, skip silently
    }
  }

  /** Reload a single file from disk into the cache */
  private async reloadFile(filename: string): Promise<void> {
    const filepath = path.join(this.tasksDir, filename);
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      const task = this.parseTaskFile(content, filename);
      if (task) {
        log.debug({ taskId: task.id }, 'Reloaded from disk');
        this.cache.set(task.id, task);
      }
    } catch {
      // File was deleted — find and remove matching cache entry
      this.invalidateByFilename(filename);
    }
  }

  /** Remove a cache entry whose filename matches (used when a file is deleted externally) */
  private invalidateByFilename(filename: string): void {
    // Task IDs are the first segment of the filename (before the slug)
    const idMatch = filename.match(/^(task_[a-zA-Z0-9_-]+)-/);
    if (idMatch) {
      const id = idMatch[1];
      if (this.cache.delete(id)) {
        log.debug({ taskId: id }, 'Invalidated (file removed)');
      }
    }
  }

  /** Invalidate a specific task by ID */
  private cacheInvalidate(id: string): boolean {
    const deleted = this.cache.delete(id);
    if (deleted) {
      log.debug({ taskId: id }, 'Invalidated');
    }
    return deleted;
  }

  /** Get a task from the cache */
  private cacheGet(id: string): Task | undefined {
    const task = this.cache.get(id);
    if (task) {
      this.cacheStats.hits++;
      log.trace({ taskId: id, hits: this.cacheStats.hits }, 'Cache HIT');
    } else {
      this.cacheStats.misses++;
      log.trace({ taskId: id, misses: this.cacheStats.misses }, 'Cache MISS');
    }
    return task;
  }

  /** Get all cached tasks sorted by updated date descending */
  private cacheList(): Task[] {
    const tasks = Array.from(this.cache.values());
    return tasks.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  /** Record that we are about to write — suppresses watcher for WRITE_DEBOUNCE_MS */
  private markWrite(): void {
    this.lastWriteTime = Date.now();
  }

  /** Start watching tasksDir for external file changes */
  private startWatcher(): void {
    try {
      this.watcher = watch(this.tasksDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return;

        // Ignore events caused by our own writes
        if (Date.now() - this.lastWriteTime < WRITE_DEBOUNCE_MS) return;

        log.debug({ eventType, filename }, 'File change detected');
        // Re-read the changed file (or remove from cache if deleted)
        this.reloadFile(filename).catch((err) =>
          log.error({ err, filename }, 'Error reloading file')
        );
      });
    } catch (err) {
      // fs.watch can fail on some platforms or when dir doesn't exist yet
      log.warn({ err }, 'Could not start file watcher');
    }
  }

  /** Clean up watchers and cache. Call on server shutdown. */
  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.taskSyncReconcileInterval) {
      clearInterval(this.taskSyncReconcileInterval);
      this.taskSyncReconcileInterval = null;
    }
    this.cache.clear();
    this.cacheInitialized = false;
    this.cacheLoading = null;
    log.debug({ hits: this.cacheStats.hits, misses: this.cacheStats.misses }, 'Cache disposed');
  }

  /**
   * Clean up expired checkpoints (older than 24 hours).
   * This should be called periodically (e.g., on service startup or via a scheduled task).
   */
  /**
   * Cleanup expired checkpoints (older than 24 hours).
   * O(N) iteration over all tasks — acceptable for expected scale (hundreds of tasks).
   * Future optimization: add checkpoint index to data/checkpoints.json for O(1) lookup.
   */
  async cleanupExpiredCheckpoints(): Promise<{ cleaned: number; errors: number }> {
    await this.initCache();
    const tasks = this.cacheList();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    const now = Date.now();
    let cleaned = 0;
    let errors = 0;

    for (const task of tasks) {
      if (!task.checkpoint) continue;

      const checkpointTime = new Date(task.checkpoint.timestamp).getTime();

      // Handle invalid timestamps
      if (isNaN(checkpointTime)) {
        try {
          await this.updateTask(task.id, { checkpoint: undefined });
          cleaned++;
          log.debug({ taskId: task.id }, 'Cleared checkpoint with invalid timestamp');
        } catch (err) {
          errors++;
          log.error({ err, taskId: task.id }, 'Failed to clear invalid checkpoint');
        }
        continue;
      }

      const age = now - checkpointTime;

      if (age > maxAge) {
        try {
          // Clear the expired checkpoint
          await this.updateTask(task.id, { checkpoint: undefined });
          cleaned++;
          log.debug({ taskId: task.id, age }, 'Cleared expired checkpoint');
        } catch (err) {
          errors++;
          log.error({ err, taskId: task.id }, 'Failed to clear expired checkpoint');
        }
      }
    }

    if (cleaned > 0 || errors > 0) {
      log.info({ cleaned, errors }, 'Checkpoint cleanup completed');
    }

    return { cleaned, errors };
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.tasksDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });
  }

  private generateId(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `task_${date}_${nanoid(6)}`;
  }

  private taskToFilename(task: Task): string {
    const slug = makeSlug(task.title);
    return `${task.id}-${slug}.md`;
  }

  /**
   * Find the actual filename on disk for a task ID.
   * Files are named `{id}-{slug}.md` but the slug may have changed since creation.
   * Falls back to computed filename if no match found.
   */
  private async findTaskFile(dir: string, taskId: string): Promise<string | null> {
    const files = await fs.readdir(dir);
    // Files always start with `{taskId}-` prefix
    const prefix = `${taskId}-`;
    const match = files.find((f) => f.startsWith(prefix) && f.endsWith('.md'));
    return match ?? null;
  }

  /**
   * Find ALL files on disk for a task ID (handles stale files from title changes).
   * Files are named `{id}-{slug}.md` but the slug changes when title is updated,
   * leaving orphaned files behind. This method returns all matching files so they
   * can be cleaned up together.
   */
  private async findAllTaskFiles(dir: string, taskId: string): Promise<string[]> {
    const files = await fs.readdir(dir);
    const prefix = `${taskId}-`;
    return files.filter((f) => f.startsWith(prefix) && f.endsWith('.md'));
  }

  /** Recursively strip undefined values from an object (YAML can't serialize them) */
  private deepCleanUndefined(obj: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        clean[key] = value.map((item) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? this.deepCleanUndefined(item)
            : item
        );
      } else if (value && typeof value === 'object') {
        clean[key] = this.deepCleanUndefined(value);
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }

  private taskToMarkdown(task: Task): string {
    const { description, reviewComments, ...rest } = task;

    // Filter out undefined values (gray-matter can't serialize them)
    const frontmatter = this.deepCleanUndefined(rest);

    const content = matter.stringify(description || '', frontmatter);

    // Add review comments section if present
    if (reviewComments && reviewComments.length > 0) {
      const commentsSection = reviewComments
        .map((c: ReviewComment) => `- **${c.file}:${c.line}** - ${c.content}`)
        .join('\n');
      return content + '\n\n## Review Comments\n\n' + commentsSection;
    }

    return content;
  }

  private parseTaskFile(content: string, filename: string): Task | null {
    try {
      const { data, content: description } = matter(content);

      // Extract review comments from description if present
      let cleanDescription = description;
      const reviewComments: Task['reviewComments'] = [];

      const reviewSection = description.indexOf('## Review Comments');
      if (reviewSection !== -1) {
        cleanDescription = description.slice(0, reviewSection).trim();
      }

      // Validate required fields
      const id = data.id || filename.split('-')[0];
      if (!isValidTaskId(id)) {
        log.warn({ filename, id }, 'Invalid task ID format');
        return null;
      }

      return {
        id,
        title: data.title || 'Untitled',
        description: cleanDescription.trim(),
        type: data.type || 'code',
        status: data.status || 'todo',
        priority: data.priority || 'medium',
        project: data.project,
        sprint: data.sprint,
        created: data.created || new Date().toISOString(),
        updated: data.updated || new Date().toISOString(),
        git: data.git,
        github: data.github,
        attempt: data.attempt,
        attempts: data.attempts,
        reviewComments,
        reviewScores: data.reviewScores,
        review: data.review,
        subtasks: data.subtasks,
        autoCompleteOnSubtasks: data.autoCompleteOnSubtasks,
        blockedBy: data.blockedBy,
        blockedReason: data.blockedReason,
        automation: data.automation,
        timeTracking: data.timeTracking,
        comments: data.comments,
        observations: data.observations,
        attachments: data.attachments,
        position: data.position,
        lessonsLearned: data.lessonsLearned,
        lessonTags: data.lessonTags,
        checkpoint: data.checkpoint,
        verificationSteps: data.verificationSteps,
        deliverables: data.deliverables,
        dependencies: data.dependencies,
      };
    } catch (error) {
      log.error({ err: error, filename }, 'Failed to parse task file');
      return null;
    }
  }

  private syncAgentRegistryForStatusTransition(task: Task): void {
    if (!task.agent) return;

    if (!['todo', 'in-progress', 'blocked', 'done', 'cancelled'].includes(task.status)) return;

    const registry = getAgentRegistryService();
    registry.syncFromTask({
      agentRef: task.agent,
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: task.status,
    });
  }

  private startTaskSyncReconciler(): void {
    this.taskSyncReconcileInterval = setInterval(() => {
      this.runTaskAgentReconciliation().catch((err) => {
        log.warn({ err }, 'Task↔agent reconciliation pass failed');
      });
    }, 60_000);
  }

  private async runTaskAgentReconciliation(): Promise<void> {
    if (this.reconcileRunning) return;
    this.reconcileRunning = true;

    try {
      const tasks = await this.listTasks();
      const registry = getAgentRegistryService();
      const changes = registry.reconcileFromTasks(
        tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          agent: task.agent,
        }))
      );

      if (changes > 0) {
        log.debug({ changes }, 'Reconciled task↔agent state drift');
      }
    } finally {
      this.reconcileRunning = false;
    }
  }

  async listTasks(): Promise<Task[]> {
    await this.initCache();
    return this.cacheList();
  }

  /**
   * Batch-resolve task dependencies to avoid N+1 queries
   * Loads all tasks once, then resolves dependencies from memory
   */
  async getTasksWithDependencies(taskIds?: string[]): Promise<Task[]> {
    const allTasks = await this.listTasks();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    const tasksToResolve = taskIds ? allTasks.filter((t) => taskIds.includes(t.id)) : allTasks;

    return tasksToResolve.map((task) => {
      if (!task.blockedBy || task.blockedBy.length === 0) {
        return task;
      }

      // Resolve dependencies from the in-memory map
      const resolvedDependencies = task.blockedBy
        .map((depId: string) => taskMap.get(depId))
        .filter((t: Task | undefined): t is Task => t !== undefined);

      return {
        ...task,
        _dependencies: resolvedDependencies, // Add resolved deps without modifying schema
      };
    });
  }

  async getTask(id: string): Promise<Task | null> {
    await this.initCache();
    return this.cacheGet(id) ?? null;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString();

    const task: Task = {
      id: this.generateId(),
      title: input.title,
      description: input.description || '',
      type: input.type || 'code',
      status: 'todo',
      priority: input.priority || 'medium',
      project: input.project,
      sprint: input.sprint,
      agent: input.agent, // Pre-assigned agent (or "auto" for routing)
      subtasks: input.subtasks, // Include subtasks from template
      blockedBy: input.blockedBy, // Include dependencies from blueprint
      created: now,
      updated: now,
    };

    const filename = this.taskToFilename(task);
    const filepath = path.join(this.tasksDir, filename);
    const content = this.taskToMarkdown(task);

    await withFileLock(filepath, async () => {
      this.markWrite();
      await fs.writeFile(filepath, content, 'utf-8');
    });

    // Write-through: update cache immediately
    this.cache.set(task.id, task);

    // Emit telemetry event
    await this.telemetry.emit<TaskTelemetryEvent>({
      type: 'task.created',
      taskId: task.id,
      project: task.project,
      status: task.status,
    });

    // Fire onCreated hook
    fireHook('onCreated', task).catch((err) => {
      log.warn({ taskId: task.id }, 'onCreated hook failed: %s', err);
    });

    return task;
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
    // Initial read to check existence and compute the lock filepath.
    // NOTE: this data may be stale by the time we acquire the lock —
    // the actual merge happens inside the lock with a fresh cache read.
    const task = await this.getTask(id);
    if (!task) return null;

    // Handle git field separately to merge properly
    const {
      git: gitUpdate,
      github: githubUpdate,
      blockedReason: blockedReasonUpdate,
      ...restInput
    } = input;

    // Compute filenames for locking. We use the tentative updated task
    // to determine the new filename (title may have changed).
    const oldFilename = this.taskToFilename(task);
    const tentativeTask: Task = { ...task, ...restInput };
    const newFilename = this.taskToFilename(tentativeTask);
    const filepath = path.join(this.tasksDir, newFilename);

    let updatedTask!: Task;

    await withFileLock(filepath, async () => {
      // Re-read from cache inside the lock to get the latest state.
      // This prevents concurrent writes (e.g., debounced field save vs.
      // timer start) from overwriting each other's changes.
      const freshTask = this.cacheGet(id) ?? task;

      const previousStatus = freshTask.status;
      const statusChanged = input.status !== undefined && input.status !== previousStatus;
      let settings: Awaited<ReturnType<ConfigService['getFeatureSettings']>> | null = null;

      if (statusChanged) {
        const configService = new ConfigService();
        settings = await configService.getFeatureSettings();
      }

      // Validate transition hooks (quality gates) before allowing status change
      if (statusChanged && input.status && settings) {
        // Check requireDeliverableForDone setting
        if (input.status === 'done') {
          if (settings.tasks.requireDeliverableForDone) {
            const deliverables = input.deliverables ?? freshTask.deliverables ?? [];
            if (deliverables.length === 0) {
              throw new ValidationError(
                'Cannot complete task without at least one deliverable (required by settings)',
                [
                  {
                    code: 'DELIVERABLE_REQUIRED',
                    message: 'Task requires at least one deliverable to be marked as done',
                    path: ['status'],
                  },
                ]
              );
            }
          }

          // Enforcement: 4x10 Review Gate (only if enforcement settings are explicitly configured)
          // Only applies to code-related task types
          if (
            settings.enforcement?.reviewGate === true &&
            CODE_TASK_TYPES.includes(freshTask.type?.toLowerCase())
          ) {
            const scores = input.reviewScores ?? freshTask.reviewScores ?? [];
            const allPerfect = scores.length === 4 && scores.every((s: number) => s === 10);
            if (!allPerfect) {
              const scoresDisplay =
                scores.length === 4
                  ? scores.join('/')
                  : scores.length > 0
                    ? scores.join('/')
                    : 'none';
              const detailMessage =
                scores.length === 4
                  ? `Review Gate: This ${freshTask.type} task requires all four review scores to be 10/10/10/10 before completion. Current scores: ${scoresDisplay}`
                  : scores.length > 0
                    ? `Review Gate: This ${freshTask.type} task requires all four review scores to be 10/10/10/10 before completion. Current scores: ${scoresDisplay} (incomplete)`
                    : `Review Gate: This ${freshTask.type} task requires all four review scores to be 10/10/10/10 before completion. No review scores set yet.`;

              throw new ValidationError(detailMessage, [
                {
                  code: 'REVIEW_GATE',
                  message: detailMessage,
                  path: ['reviewScores'],
                },
              ]);
            }
          }

          // Enforcement: Closing Comments Required (only if enforcement settings are explicitly configured)
          if (settings.enforcement?.closingComments === true) {
            const comments = input.reviewComments ?? freshTask.reviewComments ?? [];
            const hasClosingComment =
              comments.length > 0 &&
              comments.some((c: { content: string }) => c.content && c.content.length >= 20);
            if (!hasClosingComment) {
              const commentCount = comments.length;
              const detailMessage =
                commentCount === 0
                  ? 'Closing Comments: At least one review comment with a deliverable summary (≥20 characters) is required before marking this task as done. No comments added yet.'
                  : 'Closing Comments: At least one review comment with a deliverable summary (≥20 characters) is required before marking this task as done. Current comments are too short.';

              throw new ValidationError(detailMessage, [
                {
                  code: 'CLOSING_COMMENTS_REQUIRED',
                  message: detailMessage,
                  path: ['reviewComments'],
                },
              ]);
            }
          }
        }

        // Create a preview of the task with proposed changes for validation
        const previewTask: Task = {
          ...freshTask,
          ...restInput,
          blockedReason:
            blockedReasonUpdate === null
              ? undefined
              : (blockedReasonUpdate ?? freshTask.blockedReason),
        };
        const validation = await validateTransition(previewTask, previousStatus, input.status);
        if (!validation.allowed) {
          throw new ValidationError(
            validation.errorMessage || 'Transition blocked by quality gates',
            validation.failedGates.map(
              (g: { gate: { type: string; name: string }; message?: string }) => ({
                code: g.gate.type,
                message: g.message || g.gate.name,
                path: ['status'],
              })
            )
          );
        }
      }

      // Handle checkpoint resumption: increment resumeCount if transitioning to in-progress with checkpoint
      let checkpointUpdate = input.checkpoint;
      if (
        !checkpointUpdate &&
        freshTask.checkpoint &&
        input.status === 'in-progress' &&
        previousStatus !== 'in-progress'
      ) {
        // Task is being resumed — increment resumeCount
        checkpointUpdate = {
          ...freshTask.checkpoint,
          resumeCount: (freshTask.checkpoint.resumeCount || 0) + 1,
        };
      }

      // Clear checkpoint when task completes successfully
      if (input.status === 'done' && freshTask.checkpoint) {
        checkpointUpdate = undefined;
      }

      updatedTask = {
        ...freshTask,
        ...restInput,
        git: gitUpdate ? ({ ...freshTask.git, ...gitUpdate } as Task['git']) : freshTask.git,
        github: githubUpdate ?? freshTask.github,
        // Handle blockedReason: null means clear, undefined means keep existing
        blockedReason:
          blockedReasonUpdate === null
            ? undefined
            : (blockedReasonUpdate ?? freshTask.blockedReason),
        // Apply checkpoint update (resume count or clear)
        checkpoint: checkpointUpdate !== undefined ? checkpointUpdate : freshTask.checkpoint,
        updated: new Date().toISOString(),
      };

      const content = this.taskToMarkdown(updatedTask);
      this.markWrite();

      if (oldFilename !== newFilename) {
        // Intentionally silent: old file may already be gone after rename
        await fs.unlink(path.join(this.tasksDir, oldFilename)).catch(() => {});
      }
      await fs.writeFile(filepath, content, 'utf-8');

      // Write-through: update cache immediately (inside lock for consistency)
      this.cache.set(updatedTask.id, updatedTask);

      // Emit telemetry event if status changed
      if (statusChanged) {
        this.syncAgentRegistryForStatusTransition(updatedTask);

        await this.telemetry.emit<TaskTelemetryEvent>({
          type: 'task.status_changed',
          taskId: updatedTask.id,
          project: updatedTask.project,
          status: updatedTask.status,
          previousStatus,
        });

        // Fire lifecycle hook if applicable
        const hookEvent = getHookEventForStatusChange(previousStatus, updatedTask.status);
        if (hookEvent) {
          fireHook(hookEvent, updatedTask, previousStatus).catch((err) => {
            log.warn({ taskId: updatedTask.id, hookEvent }, 'Hook execution failed: %s', err);
          });
        }

        // Enforcement: Auto-telemetry emission (run.started/run.completed)
        const autoTelemetry = settings?.enforcement?.autoTelemetry === true;

        if (autoTelemetry) {
          const agent = updatedTask.agent || 'veritas';
          if (updatedTask.status === 'in-progress' && previousStatus !== 'in-progress') {
            // Emit run.started
            this.telemetry
              .emit<RunStartedEvent>({
                type: 'run.started',
                taskId: updatedTask.id,
                agent,
              })
              .catch((err) => {
                log.warn({ taskId: updatedTask.id }, 'Auto run.started emission failed: %s', err);
              });
          } else if (updatedTask.status === 'done' && previousStatus !== 'done') {
            // Emit run.completed
            const durationMs = updatedTask.timeTracking?.totalSeconds
              ? updatedTask.timeTracking.totalSeconds * 1000
              : 0;
            this.telemetry
              .emit<RunCompletedEvent>({
                type: 'run.completed',
                taskId: updatedTask.id,
                agent,
                success: true,
                durationMs,
              })
              .catch((err) => {
                log.warn({ taskId: updatedTask.id }, 'Auto run.completed emission failed: %s', err);
              });
          }
        }

        // Enforcement: Auto time tracking start/stop (only if enforcement is configured)
        const autoTimeTracking = settings?.enforcement?.autoTimeTracking === true;
        if (autoTimeTracking) {
          if (updatedTask.status === 'in-progress' && previousStatus !== 'in-progress') {
            // Auto-start timer
            if (!updatedTask.timeTracking?.isRunning) {
              this.startTimer(updatedTask.id).catch((err) => {
                log.warn({ taskId: updatedTask.id }, 'Auto timer start failed: %s', err);
              });
            }
          } else if (
            (updatedTask.status === 'done' || updatedTask.status === 'blocked') &&
            previousStatus !== 'done' &&
            previousStatus !== 'blocked'
          ) {
            // Auto-stop timer
            if (updatedTask.timeTracking?.isRunning) {
              this.stopTimer(updatedTask.id).catch((err) => {
                log.warn({ taskId: updatedTask.id }, 'Auto timer stop failed: %s', err);
              });
            }
          }
        }

        // Execute post-transition actions (quality gates)
        const actionCallbacks: TransitionActionCallbacks = {
          onAutoStartTimer: async (t) => {
            // Start time tracking if not already active
            if (!t.timeTracking?.isRunning) {
              await this.startTimer(t.id);
            }
          },
          onAutoStopTimer: async (t) => {
            // Stop time tracking if currently running
            if (t.timeTracking?.isRunning) {
              await this.stopTimer(t.id);
            }
          },
          onLogActivity: async (t, from, to) => {
            log.info({ taskId: t.id, from, to }, 'Transition action: logged activity');
          },
          onPromptLessonsLearned: async (t) => {
            // Flag task for lessons learned capture (could set a field or emit event)
            log.info({ taskId: t.id }, 'Transition action: prompt lessons learned');
          },
        };

        executePostTransitionActions(
          updatedTask,
          previousStatus,
          updatedTask.status,
          actionCallbacks
        ).catch((err) => {
          log.warn({ taskId: updatedTask.id }, 'Post-transition actions failed: %s', err);
        });
      }
    });

    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    if (!task) return false;

    // Find ALL files on disk with this task ID (handles orphaned slug variations)
    const allFilenames = await this.findAllTaskFiles(this.tasksDir, id);
    if (allFilenames.length === 0) {
      log.warn({ taskId: id }, 'No task files found on disk for deletion');
      return false;
    }

    // Delete ALL matching files (cleanup orphaned files from title changes)
    await Promise.all(
      allFilenames.map(async (filename) => {
        const filepath = path.join(this.tasksDir, filename);
        await withFileLock(filepath, async () => {
          this.markWrite();
          await fs.unlink(filepath);
        });
        log.debug({ taskId: id, filename }, 'Deleted task file');
      })
    );

    // Remove from cache
    this.cacheInvalidate(id);

    // Delete attachments
    const { getAttachmentService } = await import('./attachment-service.js');
    const attachmentService = getAttachmentService();
    await attachmentService.deleteAllAttachments(id);

    return true;
  }

  async archiveTask(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    if (!task) return false;

    // Find ALL files on disk with this task ID (handles orphaned slug variations)
    const allFilenames = await this.findAllTaskFiles(this.tasksDir, id);
    if (allFilenames.length === 0) {
      log.warn({ taskId: id }, 'No task files found on disk for archiving');
      return false;
    }

    // Archive ALL matching files (cleanup orphaned files from title changes)
    await Promise.all(
      allFilenames.map(async (filename) => {
        const sourcePath = path.join(this.tasksDir, filename);
        const destPath = path.join(this.archiveDir, filename);
        await withFileLock(sourcePath, async () => {
          this.markWrite();
          await fs.rename(sourcePath, destPath);
        });
        log.debug({ taskId: id, filename }, 'Archived task file');
      })
    );

    // Remove from active cache (archived tasks are not cached)
    this.cacheInvalidate(id);

    // Move attachments to archive
    const { getAttachmentService } = await import('./attachment-service.js');
    const attachmentService = getAttachmentService();
    await attachmentService.archiveAttachments(id);

    // Delete progress file (cleanup when archived)
    const { getProgressService } = await import('./progress-service.js');
    const progressService = getProgressService();
    await progressService.deleteProgress(id);

    // Emit telemetry event
    await this.telemetry.emit<TaskTelemetryEvent>({
      type: 'task.archived',
      taskId: task.id,
      project: task.project,
      status: task.status,
    });

    // Fire onArchived hook
    fireHook('onArchived', task).catch((err) => {
      log.warn({ taskId: task.id }, 'onArchived hook failed: %s', err);
    });

    return true;
  }

  async listArchivedTasks(): Promise<Task[]> {
    await this.ensureDirectories();

    const files = await fs.readdir(this.archiveDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    const results = await Promise.all(
      mdFiles.map(async (filename) => {
        const filepath = path.join(this.archiveDir, filename);
        const content = await fs.readFile(filepath, 'utf-8');
        return this.parseTaskFile(content, filename);
      })
    );

    // Filter out null values from failed parses
    const tasks = results.filter((t: Task | null): t is Task => t !== null);

    // Sort by updated date, newest first
    return tasks.sort(
      (a: Task, b: Task) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }

  async getArchivedTask(id: string): Promise<Task | null> {
    const tasks = await this.listArchivedTasks();
    return tasks.find((t) => t.id === id) || null;
  }

  async restoreTask(id: string): Promise<Task | null> {
    const task = await this.getArchivedTask(id);
    if (!task) return null;

    // Find actual file on disk (slug may differ from current title)
    const actualFilename = await this.findTaskFile(this.archiveDir, id);
    if (!actualFilename) {
      log.warn({ taskId: id }, 'Archived task file not found on disk for restoration');
      return null;
    }

    const sourcePath = path.join(this.archiveDir, actualFilename);
    const destPath = path.join(this.tasksDir, actualFilename);

    // Update status to done
    const restoredTask: Task = {
      ...task,
      status: 'done',
      updated: new Date().toISOString(),
    };

    const content = this.taskToMarkdown(restoredTask);

    await withFileLock(destPath, async () => {
      // Move back to active and set status to done
      await fs.rename(sourcePath, destPath);
      this.markWrite();
      await fs.writeFile(destPath, content, 'utf-8');
    });

    // Restore attachments from archive
    const { getAttachmentService } = await import('./attachment-service.js');
    const attachmentService = getAttachmentService();
    await attachmentService.restoreAttachments(id);

    // Write-through: add restored task to active cache
    this.cache.set(restoredTask.id, restoredTask);

    // Emit telemetry event
    await this.telemetry.emit<TaskTelemetryEvent>({
      type: 'task.restored',
      taskId: restoredTask.id,
      project: restoredTask.project,
      status: restoredTask.status,
    });

    return restoredTask;
  }

  /**
   * Get projects that are ready to archive (all tasks are done)
   */
  async getArchiveSuggestions(): Promise<{ sprint: string; taskCount: number; tasks: Task[] }[]> {
    const tasks = await this.listTasks();

    // Group tasks by sprint
    const sprintTasks = new Map<string, Task[]>();

    for (const task of tasks) {
      if (task.sprint) {
        const existing = sprintTasks.get(task.sprint) || [];
        existing.push(task);
        sprintTasks.set(task.sprint, existing);
      }
    }

    // Find sprints where ALL tasks are done
    const suggestions: { sprint: string; taskCount: number; tasks: Task[] }[] = [];

    for (const [sprint, sprintTaskList] of Array.from(sprintTasks.entries())) {
      const allDone = sprintTaskList.every((t) => t.status === 'done');
      if (allDone && sprintTaskList.length > 0) {
        suggestions.push({
          sprint,
          taskCount: sprintTaskList.length,
          tasks: sprintTaskList,
        });
      }
    }

    return suggestions;
  }

  /**
   * Archive all tasks in a sprint
   */
  async archiveSprint(sprint: string): Promise<{ archived: number; taskIds: string[] }> {
    const tasks = await this.listTasks();
    const sprintTasks = tasks.filter((t) => t.sprint === sprint);

    if (sprintTasks.length === 0) {
      throw new ValidationError(
        `No active tasks found for sprint "${sprint}" (may already be archived)`
      );
    }

    // Check all tasks are done
    const notDone = sprintTasks.filter((t) => t.status !== 'done');
    if (notDone.length > 0) {
      throw new ValidationError(`Cannot archive sprint: ${notDone.length} task(s) are not done`);
    }

    // Archive all tasks
    const archivedIds: string[] = [];
    for (const task of sprintTasks) {
      await this.archiveTask(task.id);
      archivedIds.push(task.id);
    }

    return {
      archived: archivedIds.length,
      taskIds: archivedIds,
    };
  }

  // ============ Time Tracking Methods ============

  /**
   * Start a timer for a task.
   * Per-task exclusivity: only one timer per task (but multiple tasks can
   * each have their own running timer — supports multi-agent workflows).
   */
  async startTimer(taskId: string): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    if (task.timeTracking?.isRunning) {
      throw new ConflictError('Timer is already running for this task');
    }

    const entryId = `time_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const newEntry = {
      id: entryId,
      startTime: now,
    };

    const timeTracking = {
      entries: [...(task.timeTracking?.entries || []), newEntry],
      totalSeconds: task.timeTracking?.totalSeconds || 0,
      isRunning: true,
      activeEntryId: entryId,
    };

    return (await this.updateTask(taskId, { timeTracking })) as Task;
  }

  /**
   * Stop the running timer for a task
   */
  async stopTimer(taskId: string): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    if (!task.timeTracking?.isRunning || !task.timeTracking.activeEntryId) {
      throw new ConflictError('No timer is running for this task');
    }

    const now = new Date();
    const entries = task.timeTracking.entries.map(
      (entry: {
        id: string;
        startTime: string;
        endTime?: string;
        duration?: number;
        description?: string;
        manual?: boolean;
      }) => {
        if (entry.id === task.timeTracking!.activeEntryId) {
          const startTime = new Date(entry.startTime);
          const duration = Math.floor((now.getTime() - startTime.getTime()) / 1000);
          return {
            ...entry,
            endTime: now.toISOString(),
            duration,
          };
        }
        return entry;
      }
    );

    // Recalculate total
    const totalSeconds = entries.reduce(
      (sum: number, e: { duration?: number }) => sum + (e.duration || 0),
      0
    );

    const timeTracking: TimeTracking = {
      entries,
      totalSeconds,
      isRunning: false,
    };

    return this.updateTask(taskId, { timeTracking }) as Promise<Task>;
  }

  /**
   * Add a manual time entry
   */
  async addTimeEntry(taskId: string, duration: number, description?: string): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const entryId = `time_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const newEntry = {
      id: entryId,
      startTime: now,
      endTime: now,
      duration,
      description,
      manual: true,
    };

    const entries = [...(task.timeTracking?.entries || []), newEntry];
    const totalSeconds = entries.reduce((sum, e) => sum + (e.duration || 0), 0);

    const timeTracking = {
      entries,
      totalSeconds,
      isRunning: task.timeTracking?.isRunning || false,
      activeEntryId: task.timeTracking?.activeEntryId,
    };

    return this.updateTask(taskId, { timeTracking }) as Promise<Task>;
  }

  /**
   * Add a dependency relationship between two tasks
   * @param taskId - The task that will depend on or block another
   * @param targetId - The task to depend on or to block
   * @param type - 'depends_on' or 'blocks'
   */
  async addDependency(
    taskId: string,
    targetId: string,
    type: 'depends_on' | 'blocks'
  ): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundError(`Task ${taskId} not found`);
    }

    const targetTask = await this.getTask(targetId);
    if (!targetTask) {
      throw new NotFoundError(`Target task ${targetId} not found`);
    }

    // Initialize dependencies if needed
    const dependencies = task.dependencies || { depends_on: [], blocks: [] };
    const targetDependencies = targetTask.dependencies || { depends_on: [], blocks: [] };

    // Check for cycle BEFORE any updates
    if (type === 'depends_on') {
      // If we're adding A depends_on B, check if B (or its ancestors) already depend on A
      const hasCycle = await this.checkForCycle(targetId, taskId);
      if (hasCycle) {
        throw new ValidationError('Adding this dependency would create a cycle');
      }
    } else {
      // If we're adding A blocks B, check if A (or its ancestors) already depend on B
      const hasCycle = await this.checkForCycle(taskId, targetId);
      if (hasCycle) {
        throw new ValidationError('Adding this dependency would create a cycle');
      }
    }

    // Add the forward relationship
    if (type === 'depends_on') {
      if (!dependencies.depends_on) dependencies.depends_on = [];
      if (!dependencies.depends_on.includes(targetId)) {
        dependencies.depends_on.push(targetId);
      }
    } else {
      if (!dependencies.blocks) dependencies.blocks = [];
      if (!dependencies.blocks.includes(targetId)) {
        dependencies.blocks.push(targetId);
      }
    }

    // Add the reverse relationship
    const reverseType = type === 'depends_on' ? 'blocks' : 'depends_on';
    if (reverseType === 'depends_on') {
      if (!targetDependencies.depends_on) targetDependencies.depends_on = [];
      if (!targetDependencies.depends_on.includes(taskId)) {
        targetDependencies.depends_on.push(taskId);
      }
    } else {
      if (!targetDependencies.blocks) targetDependencies.blocks = [];
      if (!targetDependencies.blocks.includes(taskId)) {
        targetDependencies.blocks.push(taskId);
      }
    }

    // Update both tasks inside file locks to prevent race conditions
    // Update target first, then the task itself
    await this.updateTask(targetId, { dependencies: targetDependencies });

    // Re-check for cycle immediately before final write (race condition mitigation)
    // This catches the case where another request added a conflicting dependency
    // between our initial check and now
    const finalCycleCheck =
      type === 'depends_on'
        ? await this.checkForCycle(targetId, taskId)
        : await this.checkForCycle(taskId, targetId);

    if (finalCycleCheck) {
      // Rollback the target task update
      await this.updateTask(targetId, { dependencies: targetTask.dependencies });
      throw new ValidationError(
        'Adding this dependency would create a cycle (detected during final check)'
      );
    }

    return (await this.updateTask(taskId, { dependencies })) as Task;
  }

  /**
   * Remove a dependency relationship between two tasks
   * Detects which relationship exists and removes it correctly
   */
  async removeDependency(taskId: string, targetId: string): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundError(`Task ${taskId} not found`);
    }

    const targetTask = await this.getTask(targetId);
    if (!targetTask) {
      throw new NotFoundError(`Target task ${targetId} not found`);
    }

    const dependencies = task.dependencies || { depends_on: [], blocks: [] };
    const targetDependencies = targetTask.dependencies || { depends_on: [], blocks: [] };

    // Detect which relationship exists
    const taskDependsOnTarget = dependencies.depends_on?.includes(targetId);
    const taskBlocksTarget = dependencies.blocks?.includes(targetId);

    if (!taskDependsOnTarget && !taskBlocksTarget) {
      // No relationship exists
      return task;
    }

    // Remove from the correct arrays only
    if (taskDependsOnTarget) {
      // Task depends_on target → remove from task.depends_on and target.blocks
      dependencies.depends_on = dependencies.depends_on?.filter((id) => id !== targetId) || [];
      targetDependencies.blocks = targetDependencies.blocks?.filter((id) => id !== taskId) || [];
    }

    if (taskBlocksTarget) {
      // Task blocks target → remove from task.blocks and target.depends_on
      dependencies.blocks = dependencies.blocks?.filter((id) => id !== targetId) || [];
      targetDependencies.depends_on =
        targetDependencies.depends_on?.filter((id) => id !== taskId) || [];
    }

    // Update both tasks
    await this.updateTask(targetId, { dependencies: targetDependencies });
    return (await this.updateTask(taskId, { dependencies })) as Task;
  }

  /**
   * Check if adding a dependency would create a cycle
   * Performs DFS to detect cycles, traversing BOTH depends_on and blocks relationships
   * Uses batch loading to avoid N+1 queries
   */
  private async checkForCycle(startId: string, targetId: string): Promise<boolean> {
    // Load all tasks once for batch processing (performance optimization)
    const allTasks = await this.listTasks();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    const visited = new Set<string>();
    const stack = [startId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;

      if (currentId === targetId) {
        return true; // Found a cycle
      }

      if (visited.has(currentId)) {
        continue;
      }

      visited.add(currentId);

      // Get task from in-memory map (no disk I/O)
      const currentTask = taskMap.get(currentId);
      if (!currentTask?.dependencies) {
        continue;
      }

      // Traverse BOTH depends_on and blocks relationships
      // A cycle can occur through either relationship type
      const nextIds = [
        ...(currentTask.dependencies.depends_on || []),
        ...(currentTask.dependencies.blocks || []),
      ];

      for (const nextId of nextIds) {
        if (!visited.has(nextId)) {
          stack.push(nextId);
        }
      }
    }

    return false;
  }

  /**
   * Get all dependencies for a task (both directions)
   * Uses batch loading to avoid N+1 queries
   */
  async getTaskDependencies(taskId: string): Promise<{
    depends_on: Task[];
    blocks: Task[];
  }> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundError(`Task ${taskId} not found`);
    }

    // Batch load all tasks once
    const allTasks = await this.listTasks();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    const dependsOnIds = task.dependencies?.depends_on || [];
    const blocksIds = task.dependencies?.blocks || [];

    // Resolve from in-memory map (no disk I/O)
    const dependsOn = dependsOnIds
      .map((id) => taskMap.get(id))
      .filter((t): t is Task => t !== undefined);

    const blocks = blocksIds.map((id) => taskMap.get(id)).filter((t): t is Task => t !== undefined);

    return {
      depends_on: dependsOn,
      blocks: blocks,
    };
  }

  /**
   * Get the full dependency graph for a task (recursive)
   * Returns a tree structure showing all upstream and downstream dependencies
   * Uses batch loading to avoid N+1 queries
   */
  async getTaskDependencyGraph(taskId: string): Promise<{
    task: Task;
    upstream: any[];
    downstream: any[];
  }> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundError(`Task ${taskId} not found`);
    }

    // Batch load all tasks once for performance
    const allTasks = await this.listTasks();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    const buildUpstream = (id: string, visited: Set<string>, depth = 0): any[] => {
      if (visited.has(id) || depth > 10) return [];
      visited.add(id);

      const t = taskMap.get(id);
      if (!t) return [];

      const dependsOnIds = t.dependencies?.depends_on || [];
      const children = dependsOnIds
        .map((depId) => {
          const depTask = taskMap.get(depId);
          if (!depTask) return null;
          return {
            task: depTask,
            children: buildUpstream(depId, visited, depth + 1),
          };
        })
        .filter((c): c is any => c !== null);

      return children;
    };

    const buildDownstream = (id: string, visited: Set<string>, depth = 0): any[] => {
      // Add visited set to prevent diamond-dependency exponential blowup
      if (visited.has(id) || depth > 10) return [];
      visited.add(id);

      const t = taskMap.get(id);
      if (!t) return [];

      const blocksIds = t.dependencies?.blocks || [];
      const children = blocksIds
        .map((blockId) => {
          const blockTask = taskMap.get(blockId);
          if (!blockTask) return null;
          return {
            task: blockTask,
            children: buildDownstream(blockId, visited, depth + 1),
          };
        })
        .filter((c): c is any => c !== null);

      return children;
    };

    // Use separate visited sets for upstream and downstream traversal
    const upstreamVisited = new Set<string>();
    const downstreamVisited = new Set<string>();

    const upstream = buildUpstream(taskId, upstreamVisited);
    const downstream = buildDownstream(taskId, downstreamVisited);

    return {
      task,
      upstream,
      downstream,
    };
  }

  /**
   * Delete a time entry
   */
  async deleteTimeEntry(taskId: string, entryId: string): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const entries = (task.timeTracking?.entries || []).filter(
      (e: { id: string; startTime: string; endTime?: string; duration?: number }) =>
        e.id !== entryId
    );
    const totalSeconds = entries.reduce(
      (sum: number, e: { duration?: number }) => sum + (e.duration || 0),
      0
    );

    // If we deleted the active entry, stop the timer
    const wasActive = task.timeTracking?.activeEntryId === entryId;

    const timeTracking = {
      entries,
      totalSeconds,
      isRunning: wasActive ? false : task.timeTracking?.isRunning || false,
      ...(wasActive ? {} : { activeEntryId: task.timeTracking?.activeEntryId }),
    };

    return this.updateTask(taskId, { timeTracking }) as Promise<Task>;
  }

  /**
   * Reorder tasks within a status column.
   * Accepts an ordered array of task IDs and assigns sequential position values.
   */
  async reorderTasks(orderedIds: string[]): Promise<Task[]> {
    const tasks = await this.listTasks();
    const updated: Task[] = [];

    for (let i = 0; i < orderedIds.length; i++) {
      const task = tasks.find((t) => t.id === orderedIds[i]);
      if (task && task.position !== i) {
        const result = await this.updateTask(task.id, { position: i });
        if (result) updated.push(result);
      }
    }

    return updated;
  }

  /**
   * Get time summary by project
   */
  async getTimeSummary(): Promise<{
    byProject: { project: string; totalSeconds: number; taskCount: number }[];
    total: number;
  }> {
    const tasks = await this.listTasks();

    const projectMap = new Map<string, { totalSeconds: number; taskCount: number }>();
    let total = 0;

    for (const task of tasks) {
      const seconds = task.timeTracking?.totalSeconds || 0;
      if (seconds > 0) {
        total += seconds;
        const project = task.project || '(No Project)';
        const existing = projectMap.get(project) || { totalSeconds: 0, taskCount: 0 };
        projectMap.set(project, {
          totalSeconds: existing.totalSeconds + seconds,
          taskCount: existing.taskCount + 1,
        });
      }
    }

    const byProject = Array.from(projectMap.entries())
      .map(([project, data]) => ({ project, ...data }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);

    return { byProject, total };
  }
}

// Singleton instance
let taskServiceInstance: TaskService | null = null;

export function getTaskService(): TaskService {
  if (!taskServiceInstance) {
    taskServiceInstance = new TaskService();
  }
  return taskServiceInstance;
}

/** Dispose and reset the singleton (useful for tests and shutdown) */
export function disposeTaskService(): void {
  if (taskServiceInstance) {
    taskServiceInstance.dispose();
    taskServiceInstance = null;
  }
}
