import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TelemetryService } from '../services/telemetry-service.js';
import type {
  TaskTelemetryEvent,
  RunTelemetryEvent,
  TokenTelemetryEvent,
} from '@veritas-kanban/shared';

describe('TelemetryService', () => {
  let service: TelemetryService;
  let testDir: string;

  beforeEach(async () => {
    // Create a temp directory for tests
    testDir = path.join(os.tmpdir(), `telemetry-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    service = new TelemetryService({
      telemetryDir: testDir,
      config: { enabled: true, retention: 7 },
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('emit', () => {
    it('should emit task events with generated id and timestamp', async () => {
      const event = await service.emit<TaskTelemetryEvent>({
        type: 'task.created',
        taskId: 'task_123',
        project: 'test-project',
        status: 'todo',
      });

      expect(event.id).toMatch(/^evt_/);
      expect(event.timestamp).toBeDefined();
      expect(event.type).toBe('task.created');
      expect(event.taskId).toBe('task_123');
      expect(event.project).toBe('test-project');
    });

    it('should emit run events', async () => {
      const event = await service.emit<RunTelemetryEvent>({
        type: 'run.completed',
        taskId: 'task_123',
        attemptId: 'attempt_abc',
        agent: 'claude-code',
        durationMs: 5000,
        exitCode: 0,
        success: true,
      });

      expect(event.type).toBe('run.completed');
      expect(event.attemptId).toBe('attempt_abc');
      expect(event.durationMs).toBe(5000);
      expect(event.success).toBe(true);
    });

    it('should emit token events', async () => {
      const event = await service.emit<TokenTelemetryEvent>({
        type: 'run.tokens',
        taskId: 'task_123',
        attemptId: 'attempt_abc',
        agent: 'claude-code',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        model: 'claude-opus-4-5',
      });

      expect(event.type).toBe('run.tokens');
      expect(event.totalTokens).toBe(1500);
    });

    it('should write events to date-partitioned files', async () => {
      await service.emit<TaskTelemetryEvent>({
        type: 'task.created',
        taskId: 'task_123',
      });

      const files = await fs.readdir(testDir);
      const eventFiles = files.filter((f) => f.startsWith('events-'));
      expect(eventFiles.length).toBe(1);

      const today = new Date().toISOString().slice(0, 10);
      expect(eventFiles[0]).toBe(`events-${today}.ndjson`);
    });

    it('should not write when disabled', async () => {
      service.configure({ enabled: false });

      const event = await service.emit<TaskTelemetryEvent>({
        type: 'task.created',
        taskId: 'task_123',
      });

      expect(event.id).toMatch(/^disabled_/);

      const files = await fs.readdir(testDir);
      const eventFiles = files.filter((f) => f.startsWith('events-'));
      expect(eventFiles.length).toBe(0);
    });
  });

  describe('getEvents', () => {
    it('should return all events when no filters', async () => {
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_2' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_3' });

      const events = await service.getEvents();
      expect(events.length).toBe(3);
    });

    it('should filter by type', async () => {
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({
        type: 'task.status_changed',
        taskId: 'task_1',
        status: 'in-progress',
      });
      await service.emit<TaskTelemetryEvent>({ type: 'task.archived', taskId: 'task_1' });

      const events = await service.getEvents({ type: 'task.created' });
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('task.created');
    });

    it('should filter by multiple types', async () => {
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.status_changed', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.archived', taskId: 'task_1' });

      const events = await service.getEvents({ type: ['task.created', 'task.archived'] });
      expect(events.length).toBe(2);
    });

    it('should filter by taskId', async () => {
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_2' });

      const events = await service.getEvents({ taskId: 'task_1' });
      expect(events.length).toBe(1);
      expect(events[0].taskId).toBe('task_1');
    });

    it('should filter by project', async () => {
      await service.emit<TaskTelemetryEvent>({
        type: 'task.created',
        taskId: 'task_1',
        project: 'projectA',
      });
      await service.emit<TaskTelemetryEvent>({
        type: 'task.created',
        taskId: 'task_2',
        project: 'projectB',
      });

      const events = await service.getEvents({ project: 'projectA' });
      expect(events.length).toBe(1);
      expect(events[0].project).toBe('projectA');
    });

    it('should apply limit', async () => {
      for (let i = 0; i < 10; i++) {
        await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: `task_${i}` });
      }

      const events = await service.getEvents({ limit: 5 });
      expect(events.length).toBe(5);
    });

    it('should sort by timestamp descending (newest first)', async () => {
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      await new Promise((r) => setTimeout(r, 10)); // Small delay to ensure different timestamps
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_2' });
      await new Promise((r) => setTimeout(r, 10));
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_3' });

      const events = await service.getEvents();
      expect(events[0].taskId).toBe('task_3');
      expect(events[2].taskId).toBe('task_1');
    });
  });

  describe('countEvents', () => {
    it('should count events by type', async () => {
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_2' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.archived', taskId: 'task_1' });

      const count = await service.countEvents('task.created');
      expect(count).toBe(2);
    });
  });

  describe('getTaskEvents', () => {
    it('should return all events for a specific task', async () => {
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.status_changed', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_2' });

      const events = await service.getTaskEvents('task_1');
      expect(events.length).toBe(2);
      expect(events.every((e) => e.taskId === 'task_1')).toBe(true);
    });
  });

  describe('getBulkTaskEvents', () => {
    it('should respect per-task limit guardrails', async () => {
      for (let i = 0; i < 8; i++) {
        await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      }
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_2' });

      const eventsByTask = await service.getBulkTaskEvents(['task_1', 'task_2'], 3);

      expect(eventsByTask.get('task_1')?.length).toBe(3);
      expect(eventsByTask.get('task_2')?.length).toBe(1);
    });
  });

  describe('clear', () => {
    it('should delete all event files', async () => {
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_1' });
      await service.emit<TaskTelemetryEvent>({ type: 'task.created', taskId: 'task_2' });

      await service.clear();

      const files = await fs.readdir(testDir);
      const eventFiles = files.filter((f) => f.endsWith('.ndjson'));
      expect(eventFiles.length).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should return current config', () => {
      const config = service.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.retention).toBe(7);
    });

    it('should update config', () => {
      service.configure({ retention: 14 });
      const config = service.getConfig();
      expect(config.retention).toBe(14);
    });

    it('should report enabled status', () => {
      expect(service.isEnabled()).toBe(true);
      service.configure({ enabled: false });
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('durationMs validation', () => {
    it('should reject durationMs values exceeding 7 days', async () => {
      const sevenDaysMs = 604800000; // 7 days in milliseconds

      // Test: value exactly at limit (should pass)
      const validEvent = await service.emit<RunTelemetryEvent>({
        type: 'run.completed',
        taskId: 'task_123',
        agent: 'veritas',
        durationMs: sevenDaysMs,
        success: true,
      });
      expect(validEvent.durationMs).toBe(sevenDaysMs);

      // Test: value exceeding limit (should be capped or rejected)
      const invalidEvent = await service.emit<RunTelemetryEvent>({
        type: 'run.completed',
        taskId: 'task_456',
        agent: 'veritas',
        durationMs: sevenDaysMs + 1000, // 7 days + 1 second
        success: true,
      });

      // Verify the excessive value is either capped at 7 days or flagged
      expect(invalidEvent.durationMs).toBeLessThanOrEqual(sevenDaysMs);
    });
  });
});
