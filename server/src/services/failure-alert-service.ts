/**
 * Failure Alert Service
 * 
 * Automatically notifies Teams when agent runs fail.
 * Detects run.error and run.completed with success:false telemetry events.
 * 
 * Features:
 * - Configurable on/off (default off)
 * - Deduplication: won't spam for same task retries within 5 min
 * - Graceful failure: logs but doesn't crash if notification fails
 * - Supports immediate delivery via Teams webhook (if configured)
 */

import { getNotificationService, type NotificationService } from './notification-service.js';
import { getConfigService, type ConfigService } from './config-service.js';
import type { TelemetryEventIngestion } from '../schemas/telemetry-schemas.js';

// Deduplication cache: taskId -> last alert timestamp
const recentAlerts = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Teams channel for failure alerts (Tasks channel from TOOLS.md)
const DEFAULT_TASKS_CHANNEL = '19:abdf236ec5424dbcb57676ba630c8434@thread.tacv2';

export interface FailureAlertResult {
  sent: boolean;
  reason?: 'disabled' | 'not-failure' | 'deduplicated' | 'error';
  notificationId?: string;
  error?: string;
}

export interface FailureAlertServiceOptions {
  notificationService?: NotificationService;
  configService?: ConfigService;
  dedupWindowMs?: number;
}

export class FailureAlertService {
  private notifications: NotificationService;
  private configService: ConfigService;
  private dedupWindowMs: number;

  constructor(options: FailureAlertServiceOptions = {}) {
    this.notifications = options.notificationService || getNotificationService();
    this.configService = options.configService || getConfigService();
    this.dedupWindowMs = options.dedupWindowMs || DEDUP_WINDOW_MS;
  }

  /**
   * Check if an event is a failure that should trigger an alert
   */
  isFailureEvent(event: TelemetryEventIngestion): boolean {
    if (event.type === 'run.error') return true;
    if (event.type === 'run.completed' && !event.success) return true;
    return false;
  }

  /**
   * Check if we've recently alerted for this task (deduplication)
   */
  isRecentlyAlerted(taskId: string): boolean {
    const lastAlert = recentAlerts.get(taskId);
    if (!lastAlert) return false;
    
    const elapsed = Date.now() - lastAlert;
    return elapsed < this.dedupWindowMs;
  }

  /**
   * Record that we've sent an alert for this task
   */
  private recordAlert(taskId: string): void {
    recentAlerts.set(taskId, Date.now());
    
    // Clean up old entries periodically
    if (recentAlerts.size > 100) {
      const cutoff = Date.now() - this.dedupWindowMs;
      for (const [id, timestamp] of recentAlerts.entries()) {
        if (timestamp < cutoff) {
          recentAlerts.delete(id);
        }
      }
    }
  }

  /**
   * Extract error message from event
   */
  private getErrorMessage(event: TelemetryEventIngestion): string {
    if (event.type === 'run.error') {
      return event.error;
    }
    if (event.type === 'run.completed' && event.error) {
      return event.error;
    }
    return 'Unknown error';
  }

  /**
   * Get agent name from event
   */
  private getAgentName(event: TelemetryEventIngestion): string {
    if ('agent' in event) {
      return event.agent;
    }
    return 'Unknown agent';
  }

  /**
   * Process a telemetry event and send failure alert if appropriate
   */
  async processEvent(
    event: TelemetryEventIngestion,
    taskTitle?: string
  ): Promise<FailureAlertResult> {
    try {
      // Check if it's a failure event
      if (!this.isFailureEvent(event)) {
        return { sent: false, reason: 'not-failure' };
      }

      // Check if notifications are enabled
      const features = await this.configService.getFeatureSettings();
      const notifSettings = features.notifications;
      
      if (!notifSettings.enabled || !notifSettings.onAgentFailure) {
        return { sent: false, reason: 'disabled' };
      }

      // Check deduplication
      if (this.isRecentlyAlerted(event.taskId)) {
        console.log(`[FailureAlert] Skipping duplicate alert for task ${event.taskId}`);
        return { sent: false, reason: 'deduplicated' };
      }

      // Create notification
      const agent = this.getAgentName(event);
      const error = this.getErrorMessage(event);
      const title = taskTitle || event.taskId;

      const notification = await this.notifications.createNotification({
        type: 'agent_failed',
        title: 'Agent Run Failed',
        message: `**${agent}** failed on "${title}"\n\n**Error:** ${this.truncateError(error)}`,
        taskId: event.taskId,
        taskTitle: taskTitle,
        project: event.project,
      });

      // Record for deduplication
      this.recordAlert(event.taskId);

      // Try to send via webhook for immediate delivery (non-blocking)
      const formattedMessage = this.formatFailureMessage(
        agent,
        title,
        event.taskId,
        error,
        event.project
      );
      this.sendToWebhook(formattedMessage).catch(() => {
        // Ignore webhook errors - notification is still stored for polling
      });

      // Log success
      console.log(`[FailureAlert] Created notification ${notification.id} for task ${event.taskId}`);

      return { sent: true, notificationId: notification.id };
    } catch (err) {
      // Graceful failure: log but don't crash
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[FailureAlert] Failed to send alert: ${errorMsg}`);
      return { sent: false, reason: 'error', error: errorMsg };
    }
  }

  /**
   * Truncate long error messages for notification
   */
  private truncateError(error: string, maxLength = 200): string {
    if (error.length <= maxLength) return error;
    return error.slice(0, maxLength - 3) + '...';
  }

  /**
   * Get the configured Teams channel for alerts
   */
  async getAlertChannel(): Promise<string> {
    const features = await this.configService.getFeatureSettings();
    return features.notifications.channel || DEFAULT_TASKS_CHANNEL;
  }

  /**
   * Send immediate notification via Teams webhook (if configured)
   * Falls back silently if webhook not configured or delivery fails
   */
  async sendToWebhook(message: string): Promise<boolean> {
    try {
      const features = await this.configService.getFeatureSettings();
      const webhookUrl = features.notifications.webhookUrl;
      
      if (!webhookUrl) {
        // No webhook configured - notification will be available via polling
        return false;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
        }),
      });

      if (!response.ok) {
        console.warn(`[FailureAlert] Webhook delivery failed: ${response.status}`);
        return false;
      }

      console.log('[FailureAlert] Webhook delivery successful');
      return true;
    } catch (err) {
      console.warn('[FailureAlert] Webhook error:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * Format a failure message for Teams
   */
  formatFailureMessage(
    agent: string,
    taskTitle: string,
    taskId: string,
    error: string,
    project?: string
  ): string {
    let message = `❌ **Agent Run Failed**\n\n`;
    message += `**Agent:** ${agent}\n`;
    message += `**Task:** ${taskTitle}\n`;
    if (project) message += `**Project:** ${project}\n`;
    message += `**Error:** ${this.truncateError(error)}\n\n`;
    message += `🔗 \`vk show ${taskId.slice(-8)}\``;
    return message;
  }

  /**
   * Clear deduplication cache (for testing)
   */
  clearDedupCache(): void {
    recentAlerts.clear();
  }
}

// Singleton instance
let instance: FailureAlertService | null = null;

export function getFailureAlertService(): FailureAlertService {
  if (!instance) {
    instance = new FailureAlertService();
  }
  return instance;
}

// Re-export ConfigService getter for completeness
export { getConfigService } from './config-service.js';
