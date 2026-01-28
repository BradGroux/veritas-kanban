/**
 * FailureAlertService Tests
 * Tests failure detection, deduplication, formatting, and alert processing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { FailureAlertService } from '../services/failure-alert-service.js';
import { NotificationService } from '../services/notification-service.js';
import { ConfigService } from '../services/config-service.js';
import type { TelemetryEventIngestion } from '../schemas/telemetry-schemas.js';

describe('FailureAlertService', () => {
  let testDir: string;
  let notifService: NotificationService;
  let configService: ConfigService;
  let service: FailureAlertService;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `veritas-test-failure-${suffix}`);
    await fs.mkdir(testDir, { recursive: true });
    
    const configDir = path.join(testDir, '.veritas-kanban');
    await fs.mkdir(configDir, { recursive: true });
    
    // Write a minimal config with notifications enabled
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        repos: [],
        agents: [],
        features: {
          notifications: {
            enabled: true,
            onAgentFailure: true,
            channel: 'test-channel',
          },
        },
      })
    );

    notifService = new NotificationService({
      notificationsFile: path.join(testDir, 'notifications.json'),
    });
    configService = new ConfigService({
      configDir,
      configFile: path.join(configDir, 'config.json'),
    });

    service = new FailureAlertService({
      notificationService: notifService,
      configService,
      dedupWindowMs: 1000, // Short window for testing
    });
  });

  afterEach(async () => {
    service.clearDedupCache();
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('isFailureEvent()', () => {
    it('should detect run.error events', () => {
      const event = { type: 'run.error', taskId: 't1', error: 'fail', agent: 'amp' } as TelemetryEventIngestion;
      expect(service.isFailureEvent(event)).toBe(true);
    });

    it('should detect run.completed with success:false', () => {
      const event = { type: 'run.completed', taskId: 't1', success: false, agent: 'amp' } as TelemetryEventIngestion;
      expect(service.isFailureEvent(event)).toBe(true);
    });

    it('should not flag successful completions', () => {
      const event = { type: 'run.completed', taskId: 't1', success: true, agent: 'amp' } as TelemetryEventIngestion;
      expect(service.isFailureEvent(event)).toBe(false);
    });

    it('should not flag other event types', () => {
      const event = { type: 'run.started', taskId: 't1', agent: 'amp' } as TelemetryEventIngestion;
      expect(service.isFailureEvent(event)).toBe(false);
    });
  });

  describe('isRecentlyAlerted()', () => {
    it('should return false for unknown task', () => {
      expect(service.isRecentlyAlerted('unknown_task')).toBe(false);
    });
  });

  describe('processEvent()', () => {
    it('should skip non-failure events', async () => {
      const event = { type: 'run.started', taskId: 't1', agent: 'amp' } as TelemetryEventIngestion;
      const result = await service.processEvent(event);
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('not-failure');
    });

    it('should create notification for failure events', async () => {
      const event = {
        type: 'run.error',
        taskId: 'task_fail_1',
        error: 'Something broke',
        agent: 'claude-code',
        project: 'test-proj',
      } as TelemetryEventIngestion;

      const result = await service.processEvent(event, 'My Failing Task');
      expect(result.sent).toBe(true);
      expect(result.notificationId).toBeDefined();
    });

    it('should deduplicate alerts for same task', async () => {
      const event = {
        type: 'run.error',
        taskId: 'task_dedup',
        error: 'Error',
        agent: 'amp',
      } as TelemetryEventIngestion;

      const first = await service.processEvent(event);
      expect(first.sent).toBe(true);

      const second = await service.processEvent(event);
      expect(second.sent).toBe(false);
      expect(second.reason).toBe('deduplicated');
    });

    it('should handle disabled notifications', async () => {
      // Write config with notifications disabled
      const configDir = path.join(testDir, '.veritas-kanban');
      await fs.writeFile(
        path.join(configDir, 'config.json'),
        JSON.stringify({
          repos: [],
          agents: [],
          features: {
            notifications: {
              enabled: false,
              onAgentFailure: false,
            },
          },
        })
      );
      configService.invalidateCache();

      const event = {
        type: 'run.error',
        taskId: 'task_disabled',
        error: 'Error',
        agent: 'amp',
      } as TelemetryEventIngestion;

      const result = await service.processEvent(event);
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('disabled');
    });

    it('should handle error message from run.completed', async () => {
      const event = {
        type: 'run.completed',
        taskId: 'task_comp_fail',
        success: false,
        error: 'Compilation error',
        agent: 'copilot',
      } as TelemetryEventIngestion;

      const result = await service.processEvent(event, 'Build Task');
      expect(result.sent).toBe(true);
    });
  });

  describe('formatFailureMessage()', () => {
    it('should format a failure message for Teams', () => {
      const msg = service.formatFailureMessage(
        'claude-code',
        'Fix Bug',
        'task_20240101_abc',
        'TypeError: cannot read property',
        'my-project'
      );

      expect(msg).toContain('❌');
      expect(msg).toContain('claude-code');
      expect(msg).toContain('Fix Bug');
      expect(msg).toContain('my-project');
      expect(msg).toContain('TypeError');
      expect(msg).toContain('vk show');
    });

    it('should truncate long error messages', () => {
      const longError = 'x'.repeat(500);
      const msg = service.formatFailureMessage('amp', 'Task', 'task_1', longError);
      expect(msg.length).toBeLessThan(700);
      expect(msg).toContain('...');
    });

    it('should handle missing project', () => {
      const msg = service.formatFailureMessage('amp', 'Task', 'task_1', 'Error');
      expect(msg).not.toContain('Project');
    });
  });

  describe('clearDedupCache()', () => {
    it('should clear the dedup cache', async () => {
      const event = {
        type: 'run.error',
        taskId: 'task_clear',
        error: 'Error',
        agent: 'amp',
      } as TelemetryEventIngestion;

      await service.processEvent(event);
      service.clearDedupCache();
      
      // Should be able to alert again after clearing
      expect(service.isRecentlyAlerted('task_clear')).toBe(false);
    });
  });
});
