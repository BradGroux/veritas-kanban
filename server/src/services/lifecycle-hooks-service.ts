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
import {
  FileLifecycleHooksRepository,
  type LifecycleHooksRepository,
} from '../storage/lifecycle-hooks-repository.js';
import { getLegacyRuntimeDirs, getRuntimeDir } from '../utils/paths.js';
import { migrateLegacyFiles } from '../utils/migrate-legacy-files.js';
import { getOutboundIntegrationService } from './outbound-integration-service.js';
const DATA_DIR = getRuntimeDir();
const LEGACY_DATA_DIRS = getLegacyRuntimeDirs();
let migrationPromise: Promise<void> | null = null;

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
  // Hook handlers — extensible
  private handlers = new Map<
    HookAction,
    (hook: HookConfig, context: HookContext) => Promise<void>
  >();

  constructor(
    private readonly repository: LifecycleHooksRepository = new FileLifecycleHooksRepository(
      DATA_DIR
    )
  ) {
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
      const delivery = await getOutboundIntegrationService().deliver(
        {
          id: `lifecycle-hooks.${hook.id}`,
          type: 'lifecycle-hook-webhook',
          displayName: hook.name,
          url,
          enabled: hook.enabled,
          owner: { source: 'hook', resourceId: hook.id },
        },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hookId: hook.id,
            hookName: hook.name,
            event: hook.event,
            context: ctx,
          }),
          timeoutMs: 10_000,
        }
      );

      if (!delivery.ok) {
        throw new Error(delivery.error || `Webhook delivery failed: ${delivery.status}`);
      }

      log.info({ taskId: ctx.taskId, hookId: hook.id }, 'Webhook delivered via lifecycle hook');
    });
  }

  private async ensureReady(): Promise<void> {
    migrationPromise ??= migrateLegacyFiles(
      LEGACY_DATA_DIRS,
      DATA_DIR,
      ['lifecycle-hooks.json', 'hook-executions.json'],
      'lifecycle hook'
    );
    try {
      await migrationPromise;
    } catch (error) {
      migrationPromise = null;
      throw error;
    }

    if ((await this.repository.readHooks()) === null) {
      const now = new Date().toISOString();
      await this.repository.updateHooks(
        (hooks) =>
          hooks ??
          BUILT_IN_HOOKS.map((hook, index) => ({
            ...hook,
            id: `hook_builtin_${index}`,
            createdAt: now,
            updatedAt: now,
          }))
      );
    }
  }

  /**
   * Fire hooks for a lifecycle event.
   */
  async fireEvent(event: LifecycleEvent, context: HookContext): Promise<HookExecution[]> {
    await this.ensureReady();

    const matchingHooks = ((await this.repository.readHooks()) ?? [])
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
      results.push(execution);
    }

    if (results.length > 0) {
      await this.repository.updateExecutions((executions) =>
        [...executions, ...results].slice(-500)
      );
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
    await this.ensureReady();

    let results = [...((await this.repository.readHooks()) ?? [])];
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
    await this.ensureReady();

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

    await this.repository.updateHooks((hooks) => [...(hooks ?? []), hook]);
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
    await this.ensureReady();

    let updatedHook: HookConfig | null = null;
    await this.repository.updateHooks((hooks) =>
      (hooks ?? []).map((hook) => {
        if (hook.id !== id) return hook;
        updatedHook = { ...hook, ...update, updatedAt: new Date().toISOString() };
        return updatedHook;
      })
    );
    return updatedHook;
  }

  /**
   * Delete a custom hook (built-in hooks can only be disabled).
   */
  async deleteHook(id: string): Promise<boolean> {
    await this.ensureReady();

    let deleted = false;
    await this.repository.updateHooks((hooks) =>
      (hooks ?? []).flatMap((hook) => {
        if (hook.id !== id) return [hook];
        deleted = true;
        return hook.builtIn
          ? [{ ...hook, enabled: false, updatedAt: new Date().toISOString() }]
          : [];
      })
    );
    return deleted;
  }

  /**
   * Get recent hook executions.
   */
  async getExecutions(filters?: {
    hookId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<HookExecution[]> {
    await this.ensureReady();

    let results = (await this.repository.readExecutions()).slice(-500);
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
