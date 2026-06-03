/**
 * TraceService Tests
 * Tests trace lifecycle: start, step, complete, retrieve.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TraceService } from '../services/trace-service.js';

// Mock telemetry service
vi.mock('../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({
    getConfig: () => ({ traces: true }),
  }),
}));

describe('TraceService', () => {
  let service: TraceService;
  let testDir: string;
  let tracesDir: string;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `veritas-test-traces-${suffix}`);
    tracesDir = path.join(testDir, 'traces');
    await fs.mkdir(tracesDir, { recursive: true });

    service = new TraceService();
    // Override private fields
    (service as any).tracesDir = tracesDir;
    (service as any).enabled = true;
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('isEnabled/setEnabled', () => {
    it('should report enabled state', () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('should allow toggling enabled state', () => {
      service.setEnabled(false);
      expect(service.isEnabled()).toBe(false);
      service.setEnabled(true);
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('startTrace', () => {
    it('should return null when disabled', () => {
      service.setEnabled(false);
      const trace = service.startTrace('attempt-1', 'task-1', 'veritas');
      expect(trace).toBeNull();
    });

    it('should create a new trace when enabled', () => {
      const trace = service.startTrace('attempt-1', 'task-1', 'veritas', 'my-project', {
        clientSource: 'agent-service',
        mode: 'eng-review',
        capabilitySet: ['start', 'status', 'logs', 'complete'],
        workspaceId: 'local',
        runKey: 'attempt-1',
        policyProfile: 'codex-cli:workspace-write',
      });
      expect(trace).not.toBeNull();
      expect(trace!.traceId).toBe('attempt-1');
      expect(trace!.taskId).toBe('task-1');
      expect(trace!.agent).toBe('veritas');
      expect(trace!.project).toBe('my-project');
      expect(trace!.status).toBe('running');
      expect(trace!.steps).toHaveLength(0);
      expect(trace!.startedAt).toBeDefined();
      expect(trace!.metadata).toMatchObject({
        clientSource: 'agent-service',
        runKey: 'attempt-1',
        policyProfile: 'codex-cli:workspace-write',
      });
    });
  });

  describe('startStep', () => {
    it('should return null when disabled', () => {
      service.setEnabled(false);
      const step = service.startStep('attempt-1', 'init');
      expect(step).toBeNull();
    });

    it('should return null for unknown trace', () => {
      const step = service.startStep('nonexistent', 'init');
      expect(step).toBeNull();
    });

    it('should add a step to an existing trace', () => {
      service.startTrace('attempt-1', 'task-1', 'veritas');
      const step = service.startStep('attempt-1', 'execute', { tool: 'vitest' });

      expect(step).not.toBeNull();
      expect(step!.type).toBe('execute');
      expect(step!.sequence).toBe(1);
      expect(step!.startedAt).toBeDefined();
      expect(step!.metadata).toEqual({ tool: 'vitest' });

      const trace = service.getActiveTrace('attempt-1');
      expect(trace!.steps).toHaveLength(1);
    });

    it('should preserve stream, retry, abort, and finalize lifecycle steps', () => {
      service.startTrace('attempt-lifecycle', 'task-1', 'veritas');
      service.startStep('attempt-lifecycle', 'stream', {
        eventType: 'stream.stdout',
        content: 'partial output',
      });
      service.endStep('attempt-lifecycle', 'stream');
      service.startStep('attempt-lifecycle', 'retry', {
        eventType: 'turn.retrying',
        retryAttempt: 2,
      });
      service.endStep('attempt-lifecycle', 'retry');
      service.startStep('attempt-lifecycle', 'abort', {
        eventType: 'run.aborted',
        reason: 'Stopped by user',
      });
      service.endStep('attempt-lifecycle', 'abort');
      service.startStep('attempt-lifecycle', 'finalize', {
        eventType: 'run.finalizing',
        exitCode: 143,
      });
      service.endStep('attempt-lifecycle', 'finalize');

      const trace = service.getActiveTrace('attempt-lifecycle');
      expect(trace!.steps.map((step) => step.type)).toEqual([
        'stream',
        'retry',
        'abort',
        'finalize',
      ]);
      expect(trace!.steps.every((step) => step.endedAt)).toBe(true);
    });
  });

  describe('endStep', () => {
    it('should do nothing when disabled', () => {
      service.setEnabled(false);
      service.endStep('attempt-1', 'init');
      // No error thrown
    });

    it('should end the last matching step', () => {
      service.startTrace('attempt-1', 'task-1', 'veritas');
      service.startStep('attempt-1', 'execute');

      // Small delay for duration
      service.endStep('attempt-1', 'execute');

      const trace = service.getActiveTrace('attempt-1');
      const step = trace!.steps[0];
      expect(step.endedAt).toBeDefined();
      expect(step.durationMs).toBeDefined();
      expect(step.durationMs!).toBeGreaterThanOrEqual(0);
    });
  });

  describe('completeTrace', () => {
    it('should return null when disabled', async () => {
      service.setEnabled(false);
      const result = await service.completeTrace('attempt-1', 'completed');
      expect(result).toBeNull();
    });

    it('should return null for unknown trace', async () => {
      const result = await service.completeTrace('nonexistent', 'completed');
      expect(result).toBeNull();
    });

    it('should complete a trace and save to disk', async () => {
      service.startTrace('attempt-1', 'task-1', 'veritas');
      service.startStep('attempt-1', 'init');
      service.endStep('attempt-1', 'init');
      service.startStep('attempt-1', 'execute');

      const trace = await service.completeTrace('attempt-1', 'completed');
      expect(trace).not.toBeNull();
      expect(trace!.status).toBe('completed');
      expect(trace!.endedAt).toBeDefined();
      expect(trace!.totalDurationMs).toBeDefined();

      // All open steps should be closed
      for (const step of trace!.steps) {
        expect(step.endedAt).toBeDefined();
      }

      // Should be saved to disk
      const filePath = path.join(tracesDir, 'attempt-1.json');
      const content = await fs.readFile(filePath, 'utf-8');
      const saved = JSON.parse(content);
      expect(saved.traceId).toBe('attempt-1');

      // Should be removed from active traces
      const active = service.getActiveTrace('attempt-1');
      expect(active).toBeNull();
    });

    it('should handle failed status', async () => {
      service.startTrace('attempt-2', 'task-2', 'copilot');
      const trace = await service.completeTrace('attempt-2', 'failed');
      expect(trace!.status).toBe('failed');
    });
  });

  describe('getActiveTrace', () => {
    it('should return null for non-existent trace', () => {
      expect(service.getActiveTrace('nonexistent')).toBeNull();
    });

    it('should return active trace', () => {
      service.startTrace('attempt-1', 'task-1', 'veritas');
      const trace = service.getActiveTrace('attempt-1');
      expect(trace).not.toBeNull();
      expect(trace!.traceId).toBe('attempt-1');
    });
  });

  describe('getTrace', () => {
    it('should return active trace if available', async () => {
      service.startTrace('attempt-1', 'task-1', 'veritas');
      const trace = await service.getTrace('attempt-1');
      expect(trace).not.toBeNull();
      expect(trace!.traceId).toBe('attempt-1');
    });

    it('should load completed trace from disk', async () => {
      const traceData = {
        traceId: 'attempt-saved',
        taskId: 'task-1',
        agent: 'veritas',
        startedAt: '2024-01-01T00:00:00.000Z',
        endedAt: '2024-01-01T00:01:00.000Z',
        totalDurationMs: 60000,
        steps: [],
        status: 'completed',
      };
      await fs.writeFile(
        path.join(tracesDir, 'attempt-saved.json'),
        JSON.stringify(traceData),
        'utf-8'
      );

      const trace = await service.getTrace('attempt-saved');
      expect(trace).not.toBeNull();
      expect(trace!.traceId).toBe('attempt-saved');
      expect(trace!.status).toBe('completed');
    });

    it('should return null for non-existent trace', async () => {
      const trace = await service.getTrace('nonexistent');
      expect(trace).toBeNull();
    });
  });

  describe('listTraces', () => {
    it('should list active traces for a task', async () => {
      service.startTrace('list-attempt-1', 'task-list-1', 'veritas');
      service.startTrace('list-attempt-2', 'task-list-1', 'copilot');
      service.startTrace('list-attempt-3', 'task-list-2', 'veritas'); // different task

      const traces = await service.listTraces('task-list-1');
      const matching = traces.filter((t) => t.taskId === 'task-list-1');
      expect(matching).toHaveLength(2);

      // Clean up active traces
      await service.completeTrace('list-attempt-1', 'completed');
      await service.completeTrace('list-attempt-2', 'completed');
      await service.completeTrace('list-attempt-3', 'completed');
    });

    it('should list completed traces from disk', async () => {
      const traceData = {
        traceId: 'completed-disk-1',
        taskId: 'task-disk-1',
        agent: 'veritas',
        startedAt: '2024-01-01T00:00:00.000Z',
        endedAt: '2024-01-01T00:01:00.000Z',
        totalDurationMs: 60000,
        steps: [],
        status: 'completed',
      };
      await fs.writeFile(
        path.join(tracesDir, 'completed-disk-1.json'),
        JSON.stringify(traceData),
        'utf-8'
      );

      const traces = await service.listTraces('task-disk-1');
      const matching = traces.filter((t) => t.taskId === 'task-disk-1');
      expect(matching).toHaveLength(1);
      expect(matching[0].traceId).toBe('completed-disk-1');
    });

    it('should sort traces by startedAt descending', async () => {
      service.startTrace('sort-attempt-new', 'task-sort-1', 'veritas');

      const oldTrace = {
        traceId: 'sort-attempt-old',
        taskId: 'task-sort-1',
        agent: 'veritas',
        startedAt: '2024-01-01T00:00:00.000Z',
        endedAt: '2024-01-01T00:01:00.000Z',
        totalDurationMs: 60000,
        steps: [],
        status: 'completed',
      };
      await fs.writeFile(
        path.join(tracesDir, 'sort-attempt-old.json'),
        JSON.stringify(oldTrace),
        'utf-8'
      );

      const traces = await service.listTraces('task-sort-1');
      const matching = traces.filter((t) => t.taskId === 'task-sort-1');
      expect(matching).toHaveLength(2);
      // Active trace (current time) should come first
      expect(matching[0].traceId).toBe('sort-attempt-new');
      expect(matching[1].traceId).toBe('sort-attempt-old');

      // Clean up
      await service.completeTrace('sort-attempt-new', 'completed');
    });
  });
});
