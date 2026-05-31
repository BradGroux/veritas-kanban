import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { AnyTelemetryEvent } from '@veritas-kanban/shared';
import { DecisionService } from '../../services/decision-service.js';
import { DriftService } from '../../services/drift-service.js';
import { FeedbackService } from '../../services/feedback-service.js';
import { ScoringService } from '../../services/scoring-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

const getEventsMock = vi.fn<() => Promise<AnyTelemetryEvent[]>>();

vi.mock('../../services/telemetry-service.js', () => ({
  getTelemetryService: () => ({
    getEvents: getEventsMock,
  }),
}));

function atDay(day: string, hour: number): string {
  return `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

function driftEvents(agent: string): AnyTelemetryEvent[] {
  return [
    {
      id: '1',
      type: 'run.started',
      timestamp: atDay('2025-01-01', 9),
      taskId: 'task_1',
      agent,
    },
    {
      id: '2',
      type: 'run.completed',
      timestamp: atDay('2025-01-01', 10),
      taskId: 'task_1',
      agent,
      success: true,
      durationMs: 1000,
    },
    {
      id: '3',
      type: 'run.tokens',
      timestamp: atDay('2025-01-01', 10),
      taskId: 'task_1',
      agent,
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
      agent,
    },
    {
      id: '5',
      type: 'run.completed',
      timestamp: atDay('2025-01-02', 10),
      taskId: 'task_2',
      agent,
      success: true,
      durationMs: 1000,
    },
    {
      id: '6',
      type: 'run.tokens',
      timestamp: atDay('2025-01-02', 10),
      taskId: 'task_2',
      agent,
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
      agent,
    },
    {
      id: '8',
      type: 'run.completed',
      timestamp: atDay('2025-01-03', 10),
      taskId: 'task_3',
      agent,
      success: true,
      durationMs: 1000,
    },
    {
      id: '9',
      type: 'run.tokens',
      timestamp: atDay('2025-01-03', 10),
      taskId: 'task_3',
      agent,
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
      agent,
    },
    {
      id: '11',
      type: 'run.completed',
      timestamp: atDay('2025-01-04', 12),
      taskId: 'task_4',
      agent,
      success: false,
      durationMs: 6000,
    },
    {
      id: '12',
      type: 'run.tokens',
      timestamp: atDay('2025-01-04', 12),
      taskId: 'task_4',
      agent,
      inputTokens: 400,
      outputTokens: 300,
      totalTokens: 700,
      cost: 0.9,
    },
  ] as AnyTelemetryEvent[];
}

describe('SQLite governance repositories', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-governance-'));
    getEventsMock.mockReset();
  });

  afterEach(async () => {
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('stores decisions in SQLite with filtering, chains, and assumption updates', async () => {
    const decisionsDir = path.join(testRoot, 'storage', 'decisions');
    const service = new DecisionService({
      decisionsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const root = await service.create({
      inputContext: 'root context',
      outputAction: 'root action',
      assumptions: ['traffic stays low'],
      confidenceLevel: 0.8,
      riskScore: 0.2,
      agentId: 'codex',
      taskId: 'task_1',
      timestamp: '2026-03-01T00:00:00.000Z',
    });
    const child = await service.create({
      inputContext: 'child context',
      outputAction: 'child action',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      parentDecisionId: root.id,
      agentId: 'codex',
      taskId: 'task_1',
      timestamp: '2026-03-02T00:00:00.000Z',
    });

    expect((await service.list({ minConfidence: 0.85 })).map((decision) => decision.id)).toEqual([
      child.id,
    ]);
    expect((await service.getChain(child.id)).map((decision) => decision.id)).toEqual([
      root.id,
      child.id,
    ]);

    const updated = await service.updateAssumption(root.id, 0, {
      status: 'validated',
      note: 'checked',
    });
    expect(updated.assumptions[0].status).toBe('validated');
    await expect(fs.access(decisionsDir)).rejects.toThrow();
  });

  it('stores feedback in SQLite with analytics and unresolved helpers', async () => {
    const feedbackDir = path.join(testRoot, 'storage', 'feedback');
    const service = new FeedbackService({
      feedbackDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const positive = await service.create({
      taskId: 'task_1',
      agent: 'codex',
      rating: 5,
      comment: 'Great and helpful',
      categories: ['quality', 'ux'],
    });
    const negative = await service.create({
      taskId: 'task_2',
      agent: 'amp',
      rating: 2,
      comment: 'Broken and confusing',
      categories: ['accuracy'],
    });
    await service.update(negative.id, { resolved: true });

    expect((await service.list({ agent: 'codex' })).map((item) => item.id)).toEqual([positive.id]);
    expect((await service.listUnresolved()).map((item) => item.id)).toEqual([positive.id]);

    const analytics = await service.getAnalytics();
    expect(analytics.totalFeedback).toBe(2);
    expect(analytics.sentimentBreakdown).toEqual({ positive: 1, neutral: 0, negative: 1 });
    expect(analytics.unresolvedCount).toBe(1);

    expect(await service.delete(positive.id)).toBe(true);
    expect(await service.get(positive.id)).toBeNull();
    await expect(fs.access(feedbackDir)).rejects.toThrow();
  });

  it('stores scoring profiles and evaluation history in SQLite', async () => {
    const profilesDir = path.join(testRoot, 'storage', 'scoring');
    const evaluationsDir = path.join(testRoot, 'storage', 'evaluations');
    const service = new ScoringService({
      profilesDir,
      evaluationsDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    expect((await service.listProfiles()).map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['code-quality', 'task-efficiency', 'convention-compliance'])
    );

    const profile = await service.createProfile({
      name: 'SQLite Score',
      compositeMethod: 'weightedAvg',
      scorers: [
        {
          id: 'mentions-tests',
          name: 'Mentions tests',
          type: 'KeywordContains',
          weight: 1,
          target: 'output',
          keywords: ['tested'],
          matchMode: 'any',
        },
      ],
    });

    const result = await service.evaluate({
      profileId: profile.id,
      agent: 'codex',
      taskId: 'task_1',
      output: 'tested and verified',
    });

    expect(result.compositeScore).toBe(1);
    expect((await service.getHistory({ profileId: profile.id })).map((item) => item.id)).toEqual([
      result.id,
    ]);

    await expect(fs.access(profilesDir)).rejects.toThrow();
    await expect(fs.access(evaluationsDir)).rejects.toThrow();
  });

  it('stores drift alerts and baselines in SQLite', async () => {
    const alertsDir = path.join(testRoot, 'storage', 'drift', 'alerts');
    const baselinesDir = path.join(testRoot, 'storage', 'drift', 'baselines');
    const service = new DriftService({
      alertsDir,
      baselinesDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });
    getEventsMock.mockResolvedValue(driftEvents('codex'));

    const analysis = await service.analyzeAgent('codex');
    expect(analysis.alerts.length).toBeGreaterThan(0);
    expect(analysis.baselines.length).toBeGreaterThan(0);

    const firstAlert = analysis.alerts[0];
    const acknowledged = await service.acknowledgeAlert(firstAlert.id);
    expect(acknowledged?.acknowledged).toBe(true);
    expect(await service.listAlerts({ agentId: 'codex', acknowledged: true })).toHaveLength(1);

    const reset = await service.resetBaselines('codex');
    expect(reset.deleted).toBeGreaterThan(0);
    expect(await service.listBaselines({ agentId: 'codex' })).toEqual([]);

    await expect(fs.access(alertsDir)).rejects.toThrow();
    await expect(fs.access(baselinesDir)).rejects.toThrow();
  });
});
