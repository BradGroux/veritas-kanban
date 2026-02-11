/**
 * Task Lifecycle Hooks Service
 *
 * Configurable automation triggers on task state transitions.
 * Inspired by Monika Voutov's BoardKit Orchestrator.
 *
 * Events:
 * - task.created, task.started, task.blocked, task.done, task.cancelled
 * - task.assigned, task.commented, task.reviewed
 *
 * Built-in hooks:
 * - on-done: notify, run verification checklist, log completion
 * - on-blocked: request context, notify assignees
 * - on-started: start time tracking, log telemetry
 */

import { createLogger } from '../lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getRuntimeDir } from '../utils/paths.js';
import { migrateLegacyFiles } from '../utils/migrate-legacy-files.js';
const DATA_DIR = getRuntimeDir();
const LEGACY_DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');
let migrationChecked = false;

const log = createLogger('lifecycle-hooks');

// ─── Types ───────────────────────────────────────────────────────

export type LifecycleEvent =
  | 'task.created'
  | 'task.started'
  | 'task.blocked'
  | 'task.done'
  | 'task.cancelled'
  | 'task.assigned'
  | 'task.commented'
  | 'task.reviewed';

export type HookAction =
  | 'notify' // Send notification
  | 'log_activity' // Log to activity feed
  | 'start_time' // Start time tracking
  | 'stop_time' // Stop time tracking
  | 'verify_checklist' // Run verification checklist
  | 'request_context' // Ask for blocked reason/context
  | 'emit_telemetry' // Emit telemetry event
  | 'webhook' // Call external webhook URL
  | 'custom'; // Custom action (for extensibility)

export interface HookConfig {
  id: string;
  /** Display name */
  name: string;
  /** Which lifecycle event triggers this hook */
  event: LifecycleEvent;
  /** What action to take */
  action: HookAction;
  /** Is this hook enabled? */
  enabled: boolean;
  /** Optional filter: only trigger for specific task types */
  taskTypeFilter?: string[];
  /** Optional filter: only trigger for specific projects */
  projectFilter?: string[];
  /** Optional filter: only trigger for specific priority levels */
  priorityFilter?: string[];
  /** Hook-specific config */
  config?: Record<string, unknown>;
  /** Is this a built-in hook? */
  builtIn: boolean;
  /** Order of execution (lower = first) */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface HookExecution {
  hookId: string;
  hookName: string;
  event: LifecycleEvent;
  taskId: string;
  action: HookAction;
  success: boolean;
  error?: string;
  durationMs: number;
  executedAt: string;
}

export interface HookContext {
  taskId: string;
  taskTitle?: string;
  taskType?: string;
  project?: string;
  priority?: string;
  agent?: string;
  previousStatus?: string;
  newStatus?: string;
  metadata?: Record<string, unknown>;
}

// ─── Built-in Hooks ──────────────────────────────────────────────

const BUILT_IN_HOOKS: Omit<HookConfig, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Log status changes',
    event: 'task.started',
    action: 'log_activity',
    enabled: true,
    builtIn: true,
    order: 0,
  },
  {
    name: 'Start time tracking on task start',
    event: 'task.started',
    action: 'start_time',
    enabled: true,
    builtIn: true,
    order: 10,
  },
  {
    name: 'Stop time tracking on task done',
    event: 'task.done',
    action: 'stop_time',
    enabled: true,
    builtIn: true,
    order: 10,
  },
  {
    name: 'Verify checklist on completion',
    event: 'task.done',
    action: 'verify_checklist',
    enabled: true,
    builtIn: true,
    order: 20,
  },
  {
    name: 'Request context when blocked',
    event: 'task.blocked',
    action: 'request_context',
    enabled: true,
    builtIn: true,
    order: 10,
  },
  {
    name: 'Notify assignees on block',
    event: 'task.blocked',
    action: 'notify',
    enabled: true,
    builtIn: true,
    order: 20,
  },
  {
    name: 'Emit completion telemetry',
    event: 'task.done',
    action: 'emit_telemetry',
    enabled: true,
    builtIn: true,
    order: 30,
  },
];

// ─── Service ─────────────────────────────────────────────────────

class LifecycleHooksService {
  private hooks: HookConfig[] = [];
  private executions: HookExecution[] = [];
  private loaded = false;

  // Hook handlers — extensible
  private handlers = new Map<
    HookAction,
    (hook: HookConfig, context: HookContext) => Promise<void>
  >();

  constructor() {
    // Register built-in handlers
    this.handlers.set('log_activity', async (_hook, ctx) => {
      log.info({ taskId: ctx.taskId, event: ctx.newStatus }, 'Activity logged');
    });

    this.handlers.set('start_time', async (_hook, ctx) => {
      log.info({ taskId: ctx.taskId }, 'Time tracking started via hook');
    });

    this.handlers.set('stop_time', async (_hook, ctx) => {
      log.info({ taskId: ctx.taskId }, 'Time tracking stopped via hook');
    });

    this.handlers.set('verify_checklist', async (_hook, ctx) => {
      log.info({ taskId: ctx.taskId }, 'Verification checklist check triggered');
    });

    this.handlers.set('request_context', async (_hook, ctx) => {
      log.info({ taskId: ctx.taskId }, 'Context request triggered for blocked task');
    });

    this.handlers.set('notify', async (_hook, ctx) => {
      log.info({ taskId: ctx.taskId, agent: ctx.agent }, 'Notification triggered');
    });

    this.handlers.set('emit_telemetry', async (_hook, ctx) => {
      log.info({ taskId: ctx.taskId }, 'Telemetry event emitted');
    });

    this.handlers.set('webhook', async (hook, ctx) => {
      const url = hook.config?.url as string;
      if (!url) {
        throw new Error('Webhook URL not configured');
      }
      log.info({ taskId: ctx.taskId, url }, 'Webhook would fire (not implemented in core)');
    });
  }

  private get storagePath(): string {
    return path.join(DATA_DIR, 'lifecycle-hooks.json');
  }

  private get executionsPath(): string {
    return path.join(DATA_DIR, 'hook-executions.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (!migrationChecked) {
      migrationChecked = true;
      await migrateLegacyFiles(
        LEGACY_DATA_DIR,
        DATA_DIR,
        ['lifecycle-hooks.json', 'hook-executions.json'],
        'lifecycle hook'
      );
    }

    if (this.loaded) return;

    try {
      const data = await fs.readFile(this.storagePath, 'utf-8');
      this.hooks = JSON.parse(data);
    } catch {
      // Initialize with built-in hooks
      const now = new Date().toISOString();
      this.hooks = BUILT_IN_HOOKS.map((h, i) => ({
        ...h,
        id: `hook_builtin_${i}`,
        createdAt: now,
        updatedAt: now,
      }));
      await this.saveHooks();
    }

    try {
      const data = await fs.readFile(this.executionsPath, 'utf-8');
      this.executions = JSON.parse(data);
      // Keep only last 500 executions
      if (this.executions.length > 500) {
        this.executions = this.executions.slice(-500);
      }
    } catch {
      this.executions = [];
    }

    this.loaded = true;
  }

  private async saveHooks(): Promise<void> {
    await fs.writeFile(this.storagePath, JSON.stringify(this.hooks, null, 2));
  }

  private async saveExecutions(): Promise<void> {
    await fs.writeFile(this.executionsPath, JSON.stringify(this.executions, null, 2));
  }

  /**
   * Fire hooks for a lifecycle event.
   */
  async fireEvent(event: LifecycleEvent, context: HookContext): Promise<HookExecution[]> {
    await this.ensureLoaded();

    const matchingHooks = this.hooks
      .filter((h) => h.enabled && h.event === event)
      .filter((h) => {
        if (
          h.taskTypeFilter?.length &&
          context.taskType &&
          !h.taskTypeFilter.includes(context.taskType)
        )
          return false;
        if (
          h.projectFilter?.length &&
          context.project &&
          !h.projectFilter.includes(context.project)
        )
          return false;
        if (
          h.priorityFilter?.length &&
          context.priority &&
          !h.priorityFilter.includes(context.priority)
        )
          return false;
        return true;
      })
      .sort((a, b) => a.order - b.order);

    const results: HookExecution[] = [];

    for (const hook of matchingHooks) {
      const start = Date.now();
      const execution: HookExecution = {
        hookId: hook.id,
        hookName: hook.name,
        event,
        taskId: context.taskId,
        action: hook.action,
        success: false,
        durationMs: 0,
        executedAt: new Date().toISOString(),
      };

      try {
        const handler = this.handlers.get(hook.action);
        if (handler) {
          await handler(hook, context);
          execution.success = true;
        } else {
          execution.error = `No handler for action: ${hook.action}`;
        }
      } catch (err) {
        execution.error = err instanceof Error ? err.message : String(err);
        log.warn({ hookId: hook.id, error: execution.error }, 'Hook execution failed');
      }

      execution.durationMs = Date.now() - start;
      this.executions.push(execution);
      results.push(execution);
    }

    if (results.length > 0) {
      await this.saveExecutions();
      log.info(
        { event, taskId: context.taskId, hooksRun: results.length },
        'Lifecycle event fired'
      );
    }

    return results;
  }

  /**
   * List all configured hooks.
   */
  async listHooks(options?: {
    event?: LifecycleEvent;
    enabledOnly?: boolean;
  }): Promise<HookConfig[]> {
    await this.ensureLoaded();

    let results = [...this.hooks];
    if (options?.event) results = results.filter((h) => h.event === options.event);
    if (options?.enabledOnly) results = results.filter((h) => h.enabled);

    return results.sort((a, b) => a.order - b.order);
  }

  /**
   * Create a custom hook.
   */
  async createHook(params: {
    name: string;
    event: LifecycleEvent;
    action: HookAction;
    enabled?: boolean;
    taskTypeFilter?: string[];
    projectFilter?: string[];
    priorityFilter?: string[];
    config?: Record<string, unknown>;
    order?: number;
  }): Promise<HookConfig> {
    await this.ensureLoaded();

    const hook: HookConfig = {
      id: `hook_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: params.name,
      event: params.event,
      action: params.action,
      enabled: params.enabled ?? true,
      taskTypeFilter: params.taskTypeFilter,
      projectFilter: params.projectFilter,
      priorityFilter: params.priorityFilter,
      config: params.config,
      builtIn: false,
      order: params.order ?? 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.hooks.push(hook);
    await this.saveHooks();
    return hook;
  }

  /**
   * Update a hook.
   */
  async updateHook(
    id: string,
    update: Partial<
      Pick<
        HookConfig,
        | 'name'
        | 'enabled'
        | 'taskTypeFilter'
        | 'projectFilter'
        | 'priorityFilter'
        | 'config'
        | 'order'
      >
    >
  ): Promise<HookConfig | null> {
    await this.ensureLoaded();

    const hook = this.hooks.find((h) => h.id === id);
    if (!hook) return null;

    Object.assign(hook, update, { updatedAt: new Date().toISOString() });
    await this.saveHooks();
    return hook;
  }

  /**
   * Delete a custom hook (built-in hooks can only be disabled).
   */
  async deleteHook(id: string): Promise<boolean> {
    await this.ensureLoaded();

    const hook = this.hooks.find((h) => h.id === id);
    if (!hook) return false;
    if (hook.builtIn) {
      // Just disable it
      hook.enabled = false;
      hook.updatedAt = new Date().toISOString();
      await this.saveHooks();
      return true;
    }

    this.hooks = this.hooks.filter((h) => h.id !== id);
    await this.saveHooks();
    return true;
  }

  /**
   * Get recent hook executions.
   */
  async getExecutions(filters?: {
    hookId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<HookExecution[]> {
    await this.ensureLoaded();

    let results = [...this.executions];
    if (filters?.hookId) results = results.filter((e) => e.hookId === filters.hookId);
    if (filters?.taskId) results = results.filter((e) => e.taskId === filters.taskId);

    results.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());
    if (filters?.limit) results = results.slice(0, filters.limit);

    return results;
  }

  /**
   * Register a custom handler for an action type.
   */
  registerHandler(
    action: HookAction,
    handler: (hook: HookConfig, context: HookContext) => Promise<void>
  ): void {
    this.handlers.set(action, handler);
  }
}

// Singleton
let instance: LifecycleHooksService | null = null;

export function getLifecycleHooksService(): LifecycleHooksService {
  if (!instance) {
    instance = new LifecycleHooksService();
  }
  return instance;
}
