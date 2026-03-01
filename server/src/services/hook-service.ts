/**
 * Task Lifecycle Hook Service
 *
 * Fires configured hooks on task state transitions:
 * - onCreated: Task is created
 * - onStarted: Task moves to in-progress
 * - onBlocked: Task moves to blocked
 * - onCompleted: Task moves to done
 * - onArchived: Task is archived
 *
 * Each hook can trigger:
 * - Webhook POST to configured URL
 * - Notification to configured channel
 * - Activity log entry
 *
 * Inspired by BoardKit Orchestrator's hook system.
 */

import { createLogger } from '../lib/logger.js';
import { validateWebhookUrl } from '../utils/url-validation.js';
import type { Task, EnforcementSettings } from '@veritas-kanban/shared';
import { getChatService } from './chat-service.js';

const log = createLogger('hooks');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookEvent = 'onCreated' | 'onStarted' | 'onBlocked' | 'onCompleted' | 'onArchived';

export interface HookConfig {
  enabled?: boolean;
  webhook?: string;
  notify?: boolean;
  logActivity?: boolean;
  squadChat?: boolean;
}

export interface HooksSettings {
  enabled?: boolean;
  onCreated?: HookConfig;
  onStarted?: HookConfig;
  onBlocked?: HookConfig;
  onCompleted?: HookConfig;
  onArchived?: HookConfig;
}

export interface HookPayload {
  event: HookEvent;
  taskId: string;
  taskTitle: string;
  previousStatus?: string;
  newStatus?: string;
  project?: string;
  sprint?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Settings Cache
// ---------------------------------------------------------------------------

let cachedSettings: HooksSettings | undefined;
let cachedEnforcement: EnforcementSettings | undefined;

/**
 * Set the hooks configuration. Called by settings service on load/change.
 */
export function setHooksSettings(settings: HooksSettings | undefined): void {
  cachedSettings = settings;
  log.info({ enabled: settings?.enabled ?? false }, 'Hooks settings updated');
}

/**
 * Set enforcement settings. Called by settings service on load/change.
 */
export function setEnforcementSettings(settings: EnforcementSettings | undefined): void {
  cachedEnforcement = settings;
  log.info(
    {
      squadChat: settings?.squadChat ?? true,
      reviewGate: settings?.reviewGate ?? true,
      closingComments: settings?.closingComments ?? true,
      autoTelemetry: settings?.autoTelemetry ?? true,
      autoTimeTracking: settings?.autoTimeTracking ?? true,
    },
    'Enforcement settings updated'
  );
}

/**
 * Get the current hooks configuration.
 */
export function getHooksSettings(): HooksSettings | undefined {
  return cachedSettings;
}

// ---------------------------------------------------------------------------
// Hook Execution
// ---------------------------------------------------------------------------

/**
 * Fire a lifecycle hook for a task event.
 * Non-blocking — errors are logged but don't propagate.
 */
export async function fireHook(
  event: HookEvent,
  task: Pick<Task, 'id' | 'title' | 'status' | 'project' | 'sprint' | 'agent'>,
  previousStatus?: string
): Promise<void> {
  const settings = cachedSettings;

  // Check if hooks are globally enabled
  if (!settings?.enabled) {
    return;
  }

  // Get the specific hook config
  const hookConfig = settings[event];
  if (!hookConfig?.enabled) {
    return;
  }

  const payload: HookPayload = {
    event,
    taskId: task.id,
    taskTitle: task.title,
    previousStatus,
    newStatus: task.status,
    project: task.project,
    sprint: task.sprint,
    timestamp: new Date().toISOString(),
  };

  log.info({ event, taskId: task.id }, 'Firing hook');

  // Fire webhook if configured
  if (hookConfig.webhook) {
    fireWebhook(hookConfig.webhook, payload).catch((err) => {
      log.warn({ event, taskId: task.id, error: err.message }, 'Webhook delivery failed');
    });
  }

  // Fire squad chat if configured
  if (hookConfig.squadChat && (cachedEnforcement?.squadChat ?? true)) {
    fireSquadChat(event, task, previousStatus).catch((err) => {
      log.warn({ event, taskId: task.id, error: err.message }, 'Squad chat post failed');
    });
  }

  // TODO: Fire notification if configured (integrate with notification-service)
  // if (hookConfig.notify) {
  //   notifyHookEvent(event, payload);
  // }

  // Activity logging is handled by the existing activity service
  // The logActivity flag could be used to suppress logging if needed
}

/**
 * Post a lifecycle event to squad chat.
 * Maps hook events to human-readable messages.
 */
async function fireSquadChat(
  event: HookEvent,
  task: Pick<Task, 'id' | 'title' | 'status' | 'project' | 'sprint' | 'agent'>,
  previousStatus?: string
): Promise<void> {
  const chatService = getChatService();

  // Map event to human-readable message
  const messages: Record<HookEvent, string> = {
    onCreated: `Task created: ${task.title}`,
    onStarted: `Started working on: ${task.title}`,
    onBlocked: `Task blocked: ${task.title}`,
    onCompleted: `Task completed: ${task.title}`,
    onArchived: `Task archived: ${task.title}`,
  };

  const message = messages[event];
  const agent = task.agent || 'veritas';
  const tags = ['task-lifecycle'];

  // Add project/sprint tags if present
  if (task.project) tags.push(task.project);
  if (task.sprint) tags.push(task.sprint);

  // Map hook events to squad chat event types
  const eventMap: Record<HookEvent, 'agent.status' | undefined> = {
    onCreated: 'agent.status',
    onStarted: 'agent.status',
    onBlocked: 'agent.status',
    onCompleted: 'agent.status',
    onArchived: undefined,
  };

  await chatService.sendSquadMessage({
    agent: agent.toUpperCase(),
    message,
    tags,
    system: true,
    event: eventMap[event],
    taskTitle: task.title,
  });

  log.debug({ event, taskId: task.id }, 'Squad chat notification sent');
}

/**
 * Deliver a webhook payload to the configured URL.
 * Single retry after 2 seconds on failure.
 */
async function fireWebhook(url: string, payload: HookPayload): Promise<void> {
  // Validate URL to prevent SSRF attacks
  const validation = validateWebhookUrl(url);
  if (!validation.valid) {
    log.warn({ url, reason: validation.reason }, 'Webhook URL blocked (SSRF prevention)');
    return;
  }

  const body = JSON.stringify(payload);

  const doFetch = async (): Promise<void> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VK-Event': payload.event,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  };

  try {
    await doFetch();
    log.debug({ event: payload.event, url }, 'Webhook delivered');
  } catch (err) {
    log.warn(
      { event: payload.event, url, error: (err as Error).message },
      'Webhook failed, retrying in 2s'
    );

    // Single retry after 2 seconds
    setTimeout(async () => {
      try {
        await doFetch();
        log.debug({ event: payload.event, url }, 'Webhook retry succeeded');
      } catch (retryErr) {
        log.error(
          { event: payload.event, url, error: (retryErr as Error).message },
          'Webhook retry failed'
        );
      }
    }, 2000);
  }
}

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Map a status change to the appropriate hook event.
 */
export function getHookEventForStatusChange(
  previousStatus: string | undefined,
  newStatus: string
): HookEvent | null {
  // Status transitions that trigger hooks
  if (newStatus === 'in-progress' && previousStatus !== 'in-progress') {
    return 'onStarted';
  }
  if (newStatus === 'blocked' && previousStatus !== 'blocked') {
    return 'onBlocked';
  }
  if (newStatus === 'done' && previousStatus !== 'done') {
    return 'onCompleted';
  }
  return null;
}
