import type { Task } from '@veritas-kanban/shared';
import { readFileSync } from 'node:fs';
import { createLogger } from '../lib/logger.js';
import { getNotificationService } from './notification-service.js';

const log = createLogger('blocked-alerts');
const DEFAULT_ANDY_CHAT_ID = '8601358413';
const BLOCKED_ALERT_LOCK_TTL_MS = 5 * 60_000;

const ENV_CANDIDATE_PATHS = [
  '/Users/admin/.hermes/profiles/hawk/.env',
  '/Users/admin/Projects/mission-control-production/.env.local',
  '/Users/admin/Projects/mission-control/.env.local',
  '/Users/admin/Projects/veritas-kanban/server/.env',
] as const;

const activeBlockedAlerts = new Map<string, number>();

function stripEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFromFiles(key: string): string {
  for (const filePath of ENV_CANDIDATE_PATHS) {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const line = raw
        .split(/\r?\n/)
        .find((entry) => entry.startsWith(`${key}=`) || entry.startsWith(`export ${key}=`));
      if (!line) continue;
      const value = line.slice(line.indexOf('=') + 1);
      const parsed = stripEnvValue(value);
      if (parsed) return parsed;
    } catch {
      // Keep trying fallback files. Never log env file contents.
    }
  }
  return '';
}

function resolveTelegramBotToken(): string {
  return (
    process.env.TELEGRAM_BOT_TOKEN_HAWK ||
    process.env.TELEGRAM_BOT_TOKEN_LINK ||
    process.env.TELEGRAM_BOT_TOKEN ||
    readEnvFromFiles('TELEGRAM_BOT_TOKEN_HAWK') ||
    readEnvFromFiles('TELEGRAM_BOT_TOKEN_LINK') ||
    readEnvFromFiles('TELEGRAM_BOT_TOKEN') ||
    ''
  ).trim();
}

function resolveTelegramChatId(): string {
  return (
    process.env.TELEGRAM_CHAT_ID_HAWK ||
    process.env.TELEGRAM_CHAT_ID_LINK ||
    process.env.TELEGRAM_CHAT_ID ||
    readEnvFromFiles('TELEGRAM_CHAT_ID_HAWK') ||
    readEnvFromFiles('TELEGRAM_CHAT_ID_LINK') ||
    readEnvFromFiles('TELEGRAM_CHAT_ID') ||
    DEFAULT_ANDY_CHAT_ID
  ).trim();
}

function resolveDiscordWebhookUrl(): string {
  return (
    process.env.DISCORD_BLOCKED_ALERT_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL ||
    readEnvFromFiles('DISCORD_BLOCKED_ALERT_WEBHOOK_URL') ||
    readEnvFromFiles('DISCORD_WEBHOOK_URL') ||
    ''
  ).trim();
}

function truncate(value: string, max = 1200): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function evictExpiredBlockedAlertLocks(): void {
  const cutoff = Date.now() - BLOCKED_ALERT_LOCK_TTL_MS;
  for (const [taskId, timestamp] of activeBlockedAlerts.entries()) {
    if (timestamp < cutoff) {
      activeBlockedAlerts.delete(taskId);
    }
  }
}

function tryAcquireBlockedAlertLock(taskId: string): boolean {
  evictExpiredBlockedAlertLocks();
  if (activeBlockedAlerts.has(taskId)) return false;
  activeBlockedAlerts.set(taskId, Date.now());
  return true;
}

function releaseBlockedAlertLock(taskId: string): void {
  activeBlockedAlerts.delete(taskId);
}

function describeBlockedReason(task: Task): string {
  const reason = task.blockedReason;
  if (!reason) return 'No blocked reason attached.';
  if (typeof reason === 'string') return reason;

  const parts: string[] = [];
  const shaped = reason as unknown as Record<string, unknown>;
  for (const key of ['category', 'reason', 'message', 'details', 'source']) {
    const value = shaped[key];
    if (typeof value === 'string' && value.trim()) {
      parts.push(`${key}: ${value.trim()}`);
    }
  }
  return parts.length ? parts.join(' · ') : JSON.stringify(reason).slice(0, 400);
}

function notificationTargets(task: Task): string[] {
  const targets = new Set<string>(['hawk']);
  const agent = String(task.agent || '')
    .trim()
    .toLowerCase();
  if (agent && agent !== 'auto' && agent !== 'veritas') {
    targets.add(agent);
  }
  return Array.from(targets);
}

export function buildBlockedTaskAlertMessage(task: Task, previousStatus: string): string {
  const title = String(task.title || task.id || 'Untitled task');
  const agent = String(task.agent || 'unassigned');
  const reason = truncate(describeBlockedReason(task), 900);

  return [
    `🚨 VERITAS BLOCKED: ${title}`,
    `Task: ${task.id}`,
    `Agent: ${agent}`,
    `Transition: ${previousStatus} → blocked`,
    '',
    reason,
  ].join('\n');
}

async function sendTelegramAlert(message: string): Promise<void> {
  const token = resolveTelegramBotToken();
  if (!token) {
    log.warn('Telegram bot token not configured; blocked alert kept as Veritas notification only');
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: resolveTelegramChatId(),
      text: message,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await response.json().catch(() => ({ ok: false }))) as { ok?: boolean };
  if (!response.ok || data.ok !== true) {
    throw new Error(`Telegram blocked alert failed: ${JSON.stringify(data)}`);
  }
}

async function sendDiscordAlert(message: string): Promise<void> {
  const webhookUrl = resolveDiscordWebhookUrl();
  if (!webhookUrl) {
    log.warn(
      'Discord webhook not configured; blocked alert kept on Telegram and Veritas notifications'
    );
    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: truncate(message, 1900),
      allowed_mentions: { parse: [] },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord blocked alert failed: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
}

export async function alertTaskBlocked(task: Task, previousStatus: string): Promise<void> {
  if (task.status !== 'blocked') return;
  if (!tryAcquireBlockedAlertLock(task.id)) return;

  try {
    const message = buildBlockedTaskAlertMessage(task, previousStatus);
    const notificationService = getNotificationService();
    await notificationService.notifyStatusChange({
      taskId: task.id,
      targetAgents: notificationTargets(task),
      fromAgent: 'veritas',
      content: message,
    });

    try {
      await sendTelegramAlert(message);
    } catch (err) {
      log.warn({ taskId: task.id, err }, 'Telegram blocked alert delivery failed');
    }

    try {
      await sendDiscordAlert(message);
    } catch (err) {
      log.warn({ taskId: task.id, err }, 'Discord blocked alert delivery failed');
    }
  } finally {
    releaseBlockedAlertLock(task.id);
  }
}
