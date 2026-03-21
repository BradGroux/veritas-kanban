import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyTelemetryEvent } from '@veritas-kanban/shared';
import { DriftService } from '../services/drift-service.js';

const getEventsMock = vi.fn<() => Promise<AnyTelemetryEvent[]>>();

vi.mock('../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({
    getEvents: getEventsMock,
  }),
}));

function atDay(day: string, hour: number) {
  return `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

describe('DriftService', () => {
  let baseDir: string;
  let service: DriftService;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-drift-'));
    service = new DriftService({
      alertsDir: path.join(baseDir, 'alerts'),
      baselinesDir: path.join(baseDir, 'baselines'),
    });
    getEventsMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('computes baselines and emits alerts for a drifting agent', async () => {
    getEventsMock.mockResolvedValue([
      {
        id: '1',
        type: 'run.started',
        timestamp: atDay('2025-01-01', 9),
        taskId: 'task_1',
        agent: 'amp',
      },
      {
        id: '2',
        type: 'run.completed',
        timestamp: atDay('2025-01-01', 10),
        taskId: 'task_1',
        agent: 'amp',
        success: true,
        durationMs: 1000,
      },
      {
        id: '3',
        type: 'run.tokens',
        timestamp: atDay('2025-01-01', 10),
        taskId: 'task_1',
        agent: 'amp',
        inputTokens: 50,
        outputTokens: 50,
        totalTokens: 100,
        cost: 0.1,
      },
      {
        id: '4',
        type: 'run.started',
        timestamp: atDay('2025-01-02', 9),
        taskId: 'task_2',
        agent: 'amp',
      },
      {
        id: '5',
        type: 'run.completed',
        timestamp: atDay('2025-01-02', 10),
        taskId: 'task_2',
        agent: 'amp',
        success: true,
        durationMs: 1100,
      },
      {
        id: '6',
        type: 'run.tokens',
        timestamp: atDay('2025-01-02', 10),
        taskId: 'task_2',
        agent: 'amp',
        inputTokens: 50,
        outputTokens: 60,
        totalTokens: 110,
        cost: 0.11,
      },
      {
        id: '7',
        type: 'run.started',
        timestamp: atDay('2025-01-03', 9),
        taskId: 'task_3',
        agent: 'amp',
      },
      {
        id: '8',
        type: 'run.completed',
        timestamp: atDay('2025-01-03', 10),
        taskId: 'task_3',
        agent: 'amp',
        success: true,
        durationMs: 900,
      },
      {
        id: '9',
        type: 'run.tokens',
        timestamp: atDay('2025-01-03', 10),
        taskId: 'task_3',
        agent: 'amp',
        inputTokens: 40,
        outputTokens: 60,
        totalTokens: 100,
        cost: 0.09,
      },
      {
        id: '10',
        type: 'run.started',
        timestamp: atDay('2025-01-04', 9),
        taskId: 'task_4',
        agent: 'amp',
      },
      {
        id: '11',
        type: 'run.started',
        timestamp: atDay('2025-01-04', 10),
        taskId: 'task_5',
        agent: 'amp',
      },
      {
        id: '12',
        type: 'run.started',
        timestamp: atDay('2025-01-04', 11),
        taskId: 'task_6',
        agent: 'amp',
      },
      {
        id: '13',
        type: 'run.completed',
        timestamp: atDay('2025-01-04', 12),
        taskId: 'task_4',
        agent: 'amp',
        success: false,
        durationMs: 8000,
      },
      {
        id: '14',
        type: 'run.error',
        timestamp: atDay('2025-01-04', 13),
        taskId: 'task_5',
        agent: 'amp',
        error: 'boom',
      },
      {
        id: '15',
        type: 'run.tokens',
        timestamp: atDay('2025-01-04', 12),
        taskId: 'task_4',
        agent: 'amp',
        inputTokens: 500,
        outputTokens: 500,
        totalTokens: 1000,
        cost: 1.25,
      },
    ] as AnyTelemetryEvent[]);

    const result = await service.analyzeAgent('amp');

    expect(result.agentId).toBe('amp');
    expect(result.baselines.length).toBeGreaterThan(0);
    expect(result.alerts.length).toBeGreaterThan(0);

    const durationBaseline = result.baselines.find((baseline) => baseline.metric === 'duration');
    expect(durationBaseline?.sampleCount).toBe(3);
    expect(durationBaseline?.mean).toBeCloseTo(1000, -1);

    const durationAlert = result.alerts.find((alert) => alert.metric === 'duration');
    expect(durationAlert).toBeDefined();
    expect(durationAlert?.acknowledged).toBe(false);

    const persistedAlerts = await service.listAlerts({ agentId: 'amp' });
    const persistedBaselines = await service.listBaselines({ agentId: 'amp' });
    expect(persistedAlerts.length).toBe(result.alerts.length);
    expect(persistedBaselines.length).toBe(result.baselines.length);
  });

  it('acknowledges alerts and resets baselines by agent', async () => {
    getEventsMock.mockResolvedValue([
      {
        id: '1',
        type: 'run.started',
        timestamp: atDay('2025-01-01', 9),
        taskId: 'task_1',
        agent: 'veritas',
      },
      {
        id: '2',
        type: 'run.completed',
        timestamp: atDay('2025-01-01', 10),
        taskId: 'task_1',
        agent: 'veritas',
        success: true,
        durationMs: 1000,
      },
      {
        id: '3',
        type: 'run.tokens',
        timestamp: atDay('2025-01-01', 10),
        taskId: 'task_1',
        agent: 'veritas',
        inputTokens: 50,
        outputTokens: 50,
        totalTokens: 100,
        cost: 0.1,
      },
      {
        id: '4',
        type: 'run.started',
        timestamp: atDay('2025-01-02', 9),
        taskId: 'task_2',
        agent: 'veritas',
      },
      {
        id: '5',
        type: 'run.completed',
        timestamp: atDay('2025-01-02', 10),
        taskId: 'task_2',
        agent: 'veritas',
        success: true,
        durationMs: 1000,
      },
      {
        id: '6',
        type: 'run.tokens',
        timestamp: atDay('2025-01-02', 10),
        taskId: 'task_2',
        agent: 'veritas',
        inputTokens: 50,
        outputTokens: 50,
        totalTokens: 100,
        cost: 0.1,
      },
      {
        id: '7',
        type: 'run.started',
        timestamp: atDay('2025-01-03', 9),
        taskId: 'task_3',
        agent: 'veritas',
      },
      {
        id: '8',
        type: 'run.completed',
        timestamp: atDay('2025-01-03', 10),
        taskId: 'task_3',
        agent: 'veritas',
        success: true,
        durationMs: 1000,
      },
      {
        id: '9',
        type: 'run.tokens',
        timestamp: atDay('2025-01-03', 10),
        taskId: 'task_3',
        agent: 'veritas',
        inputTokens: 50,
        outputTokens: 50,
        totalTokens: 100,
        cost: 0.1,
      },
      {
        id: '10',
        type: 'run.started',
        timestamp: atDay('2025-01-04', 9),
        taskId: 'task_4',
        agent: 'veritas',
      },
      {
        id: '11',
        type: 'run.started',
        timestamp: atDay('2025-01-04', 10),
        taskId: 'task_5',
        agent: 'veritas',
      },
      {
        id: '12',
        type: 'run.completed',
        timestamp: atDay('2025-01-04', 12),
        taskId: 'task_4',
        agent: 'veritas',
        success: false,
        durationMs: 6000,
      },
      {
        id: '13',
        type: 'run.tokens',
        timestamp: atDay('2025-01-04', 12),
        taskId: 'task_4',
        agent: 'veritas',
        inputTokens: 400,
        outputTokens: 300,
        totalTokens: 700,
        cost: 0.9,
      },
    ] as AnyTelemetryEvent[]);

    const analysis = await service.analyzeAgent('veritas');
    const firstAlert = analysis.alerts[0];

    expect(firstAlert).toBeDefined();

    const acknowledged = await service.acknowledgeAlert(firstAlert.id);
    expect(acknowledged?.acknowledged).toBe(true);

    const reset = await service.resetBaselines('veritas');
    expect(reset.deleted).toBeGreaterThan(0);

    const remaining = await service.listBaselines({ agentId: 'veritas' });
    expect(remaining).toHaveLength(0);
  });
});
