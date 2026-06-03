/**
 * Squad Webhook Service
 *
 * Fires HTTP webhooks when squad messages are posted.
 * Supports HMAC-SHA256 signing for verification.
 */

import crypto from 'crypto';
import type { SquadMessage, SquadWebhookSettings } from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { getOutboundIntegrationService } from './outbound-integration-service.js';

const log = createLogger('squad-webhook');

interface WebhookPayload {
  event: 'squad.message';
  message: {
    id: string;
    agent: string;
    displayName?: string;
    message: string;
    tags?: string[];
    timestamp: string;
    card?: Record<string, unknown>;
  };
  isHuman: boolean;
}

/**
 * Fire a webhook for a squad message.
 * Fire-and-forget: doesn't block on failure, just logs.
 */
export async function fireSquadWebhook(
  message: SquadMessage,
  settings: SquadWebhookSettings
): Promise<void> {
  if (!settings.enabled) {
    return;
  }

  // Determine if this is a human message
  const isHuman = message.agent === 'Human' || message.agent.toLowerCase() === 'human';

  // Check if we should fire for this message type
  if (isHuman && !settings.notifyOnHuman) {
    log.debug({ messageId: message.id }, 'Skipping webhook: notifyOnHuman disabled');
    return;
  }

  if (!isHuman && !settings.notifyOnAgent) {
    log.debug({ messageId: message.id }, 'Skipping webhook: notifyOnAgent disabled');
    return;
  }

  // Route based on mode
  if (settings.mode === 'openclaw') {
    await fireOpenClawWake(message, settings);
  } else {
    await fireGenericWebhook(message, settings, isHuman);
  }
}

/**
 * Fire an OpenClaw gateway wake call
 */
async function fireOpenClawWake(
  message: SquadMessage,
  settings: SquadWebhookSettings
): Promise<void> {
  if (!settings.openclawGatewayUrl || !settings.openclawGatewayToken) {
    log.warn('OpenClaw mode enabled but gatewayUrl or gatewayToken missing');
    return;
  }

  const displayName = message.displayName || message.agent;
  const wakeText = `🗨️ Squad chat from ${displayName}: ${message.message}`;

  const payload = {
    tool: 'cron',
    args: {
      action: 'wake',
      text: wakeText,
      mode: 'now',
    },
  };

  const url = `${settings.openclawGatewayUrl}/tools/invoke`;

  try {
    const delivery = await getOutboundIntegrationService().deliver(
      {
        id: 'squad.openclawWake',
        type: 'openclaw-wake',
        displayName: 'Squad Chat OpenClaw wake',
        url,
        enabled: settings.enabled && settings.mode === 'openclaw',
        auth: {
          type: 'bearer',
          secretRef: 'featureSettings.squadWebhook.openclawGatewayToken',
          hasSecret: Boolean(settings.openclawGatewayToken),
        },
        owner: { source: 'feature-settings', resourceId: 'squadWebhook.openclawGatewayUrl' },
        validationOptions: { allowHttp: true, allowLocalhost: true },
      },
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.openclawGatewayToken}`,
        },
        body: JSON.stringify(payload),
        timeoutMs: 5_000,
      }
    );

    if (delivery.status === 'blocked') {
      log.warn('OpenClaw wake call URL blocked (SSRF prevention)');
      return;
    }

    if (delivery.status === 'timeout') {
      log.warn('OpenClaw wake call timed out after 5 seconds');
      return;
    }

    if (!delivery.ok) {
      log.warn(
        { status: delivery.responseStatus || delivery.status },
        'OpenClaw wake call returned non-2xx status'
      );
      return;
    }

    log.info({ messageId: message.id, displayName }, 'OpenClaw wake call fired successfully');
  } catch (err: any) {
    if (err.name === 'AbortError') {
      log.warn({ url }, 'OpenClaw wake call timed out after 5 seconds');
    } else {
      log.error({ err: err.message }, 'OpenClaw wake call failed');
    }
  }
}

/**
 * Fire a generic webhook (original behavior)
 */
async function fireGenericWebhook(
  message: SquadMessage,
  settings: SquadWebhookSettings,
  isHuman: boolean
): Promise<void> {
  if (!settings.url) {
    return;
  }

  // Build payload
  const payload: WebhookPayload = {
    event: 'squad.message',
    message: {
      id: message.id,
      agent: message.agent,
      displayName: message.displayName,
      message: message.message,
      tags: message.tags,
      timestamp: message.timestamp,
      ...(message.card && { card: message.card }),
    },
    isHuman,
  };

  // Fire asynchronously (don't block)
  fireWebhookAsync(settings.url, payload, settings.secret).catch((err) => {
    log.error({ err: err.message, messageId: message.id }, 'Squad webhook failed');
  });
}

/**
 * Actually send the webhook (async, with timeout and signing)
 */
async function fireWebhookAsync(
  url: string,
  payload: WebhookPayload,
  secret?: string
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Veritas-Kanban-Squad-Webhook/1.0',
  };

  // Add HMAC signature if secret is configured
  if (secret) {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-VK-Signature'] = `sha256=${signature}`;
  }

  try {
    const delivery = await getOutboundIntegrationService().deliver(
      {
        id: 'squad.webhook',
        type: 'squad-webhook',
        displayName: 'Squad Chat webhook',
        url,
        enabled: true,
        auth: {
          type: 'hmac-sha256',
          headerName: 'X-VK-Signature',
          secretRef: secret ? 'featureSettings.squadWebhook.secret' : undefined,
          hasSecret: Boolean(secret),
        },
        owner: { source: 'feature-settings', resourceId: 'squadWebhook.url' },
      },
      {
        method: 'POST',
        headers,
        body,
        timeoutMs: 5_000,
      }
    );

    if (delivery.status === 'blocked') {
      log.warn('Squad webhook URL blocked (SSRF prevention)');
      return;
    }

    if (delivery.status === 'timeout') {
      log.warn('Squad webhook timed out after 5 seconds');
      throw new Error('Webhook timeout');
    }

    if (!delivery.ok) {
      log.warn(
        { status: delivery.responseStatus || delivery.status },
        'Squad webhook returned non-2xx status'
      );
      return;
    }

    log.info({ messageId: payload.message.id }, 'Squad webhook fired successfully');
  } catch (err: any) {
    if (err.name === 'AbortError') {
      log.warn('Squad webhook timed out after 5 seconds');
      throw new Error('Webhook timeout');
    }
    log.error({ err: err.message }, 'Squad webhook request failed');
    throw err;
  }
}
