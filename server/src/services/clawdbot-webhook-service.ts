/**
 * Clawdbot Webhook Service
 *
 * Sends task and chat events to a configured webhook URL (e.g. Clawdbot Gateway)
 * so an AI agent can react in real-time instead of polling.
 *
 * Features:
 * - Non-blocking fire-and-forget delivery
 * - Single retry after 2 seconds on failure
 * - Optional HMAC-SHA256 payload signing
 * - Env var override for webhook URL and secret
 */

import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';
import { validateWebhookUrl } from '../utils/url-validation.js';
import type { TaskChangeType } from './broadcast-service.js';

const log = createLogger('webhook');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookTaskPayload {
  event:
    | 'task:created'
    | 'task:updated'
    | 'task:deleted'
    | 'task:archived'
    | 'task:restored'
    | 'task:reordered';
  taskId?: string;
  taskTitle?: string;
  status?: string;
  previousStatus?: string;
  assignee?: string;
  project?: string;
  timestamp: string;
}

export interface WebhookChatPayload {
  event: 'chat:message' | 'chat:delta' | 'chat:error';
  chatSessionId: string;
  message?: string;
  timestamp: string;
}

export type WebhookPayload = WebhookTaskPayload | WebhookChatPayload;

export interface TaskContext {
  title?: string;
  status?: string;
  previousStatus?: string;
  assignee?: string;
  project?: string;
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/** Cached settings-based webhook URL (set via setWebhookUrl). */
let settingsWebhookUrl: string | undefined;

/**
 * Allow the settings layer (or tests) to provide a webhook URL at runtime.
 */
export function setWebhookUrl(url: string | undefined): void {
  settingsWebhookUrl = url;
}

/**
 * Resolve the effective webhook URL.
 * Env var takes precedence over the settings value.
 */
export function getWebhookUrl(): string | undefined {
  return process.env.VERITAS_WEBHOOK_URL || settingsWebhookUrl;
}

/**
 * Return the signing secret (env var only).
 */
function getWebhookSecret(): string | undefined {
  return process.env.VERITAS_WEBHOOK_SECRET;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 hex digest for the given body using the webhook secret.
 */
export function signPayload(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// Delivery (fire-and-forget with 1 retry)
// ---------------------------------------------------------------------------

/**
 * POST a JSON payload to `url`.  Returns true on 2xx, false otherwise.
 */
async function postPayload(url: string, body: string, secret?: string): Promise<boolean> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'VeritasKanban-Webhook/1.0',
  };

  if (secret) {
    headers['X-Webhook-Signature'] = signPayload(body, secret);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000), // 10 s hard timeout per attempt
  });

  return res.ok;
}

/**
 * Deliver `payload` to the configured webhook URL.
 * Non-blocking: failures are logged, never thrown.
 * On first failure, retries once after 2 seconds.
 */
export async function deliverWebhook(payload: WebhookPayload): Promise<void> {
  const url = getWebhookUrl();
  if (!url) return; // webhook not configured — silently skip

  // Validate URL to prevent SSRF attacks
  const validation = validateWebhookUrl(url);
  if (!validation.valid) {
    log.warn({ reason: validation.reason }, 'Webhook URL blocked (SSRF prevention)');
    return;
  }

  const body = JSON.stringify(payload);
  const secret = getWebhookSecret();

  try {
    const ok = await postPayload(url, body, secret);
    if (ok) {
      log.debug({ event: payload.event }, 'Webhook delivered');
      return;
    }
    log.warn({ event: payload.event }, 'Webhook delivery failed, retrying in 2 s');
  } catch (err) {
    log.warn({ err, event: payload.event }, 'Webhook delivery error, retrying in 2 s');
  }

  // --- single retry after 2 s ---
  setTimeout(async () => {
    try {
      const ok = await postPayload(url, body, secret);
      if (!ok) {
        log.error({ event: payload.event }, 'Webhook retry failed (non-2xx)');
      } else {
        log.debug({ event: payload.event }, 'Webhook delivered on retry');
      }
    } catch (err) {
      log.error({ err, event: payload.event }, 'Webhook retry error');
    }
  }, 2_000);
}

// ---------------------------------------------------------------------------
// Public helpers for callers
// ---------------------------------------------------------------------------

/**
 * Fire a webhook for a task change event.
 * Called from broadcast-service after the WebSocket broadcast.
 */
export function notifyTaskChange(
  changeType: TaskChangeType,
  taskId?: string,
  context?: TaskContext
): void {
  const payload: WebhookTaskPayload = {
    event: `task:${changeType}` as WebhookTaskPayload['event'],
    taskId,
    taskTitle: context?.title,
    status: context?.status,
    previousStatus: context?.previousStatus,
    assignee: context?.assignee,
    project: context?.project,
    timestamp: new Date().toISOString(),
  };

  // Fire-and-forget
  deliverWebhook(payload).catch(() => {
    /* already logged inside deliverWebhook */
  });
}

/**
 * Fire a webhook for a chat event.
 * Called from broadcast-service after the WebSocket broadcast.
 */
export function notifyChatMessage(
  sessionId: string,
  eventType: 'chat:message' | 'chat:delta' | 'chat:error',
  message?: string
): void {
  const payload: WebhookChatPayload = {
    event: eventType,
    chatSessionId: sessionId,
    message,
    timestamp: new Date().toISOString(),
  };

  deliverWebhook(payload).catch(() => {
    /* already logged inside deliverWebhook */
  });
}
