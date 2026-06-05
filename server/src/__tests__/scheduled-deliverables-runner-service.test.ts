import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ScheduledDeliverablesService } from '../services/scheduled-deliverables-service.js';
import {
  ScheduledDeliverablesRunner,
  type ScheduledDeliverablesRunnerResult,
} from '../services/scheduled-deliverables-runner-service.js';
import type { AgentOperationsDigest } from '../services/digest-service.js';
import type { Deliverable, DeliverableRun } from '../services/scheduled-deliverables-service.js';

describe('ScheduledDeliverablesService due scheduling', () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-scheduled-due-'));
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('sets initial nextRunAt when scheduled deliverables are created', async () => {
    const service = new ScheduledDeliverablesService({ dataDir: testRoot, storageType: 'file' });

    const deliverable = await service.create({
      name: 'Daily Operations Digest',
      description: 'Daily deterministic operations digest.',
      schedule: 'daily',
      tags: ['operations-digest'],
    });

    expect(deliverable.nextRunAt).toEqual(expect.any(String));
    expect(Date.parse(deliverable.nextRunAt as string)).toBeGreaterThan(
      Date.parse(deliverable.createdAt)
    );
  });

  it('lists only enabled deliverables due at or before the requested time', async () => {
    const dueNow = '2026-06-05T09:00:00.000Z';
    await fs.mkdir(testRoot, { recursive: true });
    await fs.writeFile(
      path.join(testRoot, 'scheduled-deliverables.json'),
      JSON.stringify([
        scheduledDeliverable({
          id: 'del_due',
          name: 'Due Digest',
          nextRunAt: '2026-06-05T08:59:59.000Z',
          enabled: true,
        }),
        scheduledDeliverable({
          id: 'del_future',
          name: 'Future Digest',
          nextRunAt: '2026-06-05T09:00:01.000Z',
          enabled: true,
        }),
        scheduledDeliverable({
          id: 'del_disabled',
          name: 'Disabled Digest',
          nextRunAt: '2026-06-05T08:00:00.000Z',
          enabled: false,
        }),
      ])
    );
    await fs.writeFile(path.join(testRoot, 'deliverable-runs.json'), '[]');
    const service = new ScheduledDeliverablesService({ dataDir: testRoot, storageType: 'file' });

    await expect(service.listDue(new Date(dueNow))).resolves.toEqual([
      expect.objectContaining({ id: 'del_due' }),
    ]);
  });
});

describe('ScheduledDeliverablesRunner', () => {
  it('records a successful operations digest run for due digest deliverables', async () => {
    const runs: Array<Parameters<ScheduledDeliverablesStore['recordRun']>[0]> = [];
    const deliverablesService = fakeDeliverablesService({
      due: [
        scheduledDeliverable({
          id: 'del_ops',
          tags: ['operations-digest', 'standup'],
          outputPath: 'operations/digests',
        }),
      ],
      runs,
    });
    const digest = makeOperationsDigest();
    const digestService = {
      generateOperationsDigest: vi.fn().mockResolvedValue(digest),
      formatOperationsDigestMarkdown: vi
        .fn()
        .mockReturnValue({ isEmpty: false, markdown: '# Operations Digest' }),
    };
    const runner = new ScheduledDeliverablesRunner({
      deliverablesService,
      digestService,
      logger: silentLogger(),
    });

    await expect(runner.runDue(new Date('2026-06-05T09:00:00.000Z'))).resolves.toMatchObject({
      checked: 1,
      executed: 1,
      skipped: 0,
      failed: 0,
      overlapping: false,
    } satisfies ScheduledDeliverablesRunnerResult);
    expect(digestService.generateOperationsDigest).toHaveBeenCalledTimes(1);
    expect(runs).toEqual([
      expect.objectContaining({
        deliverableId: 'del_ops',
        status: 'success',
        workflowId: 'operations-digest',
        outputFile: 'operations/digests/operations-digest-2026-06-05.md',
        summary: 'Operations digest generated, 1 groups, 3 completed, 1 failed, 2 open approvals',
        snapshotMetadata: expect.objectContaining({
          generatedAt: '2026-06-05T09:00:00.000Z',
          completed: 3,
          failed: 1,
          openApprovals: 2,
          markdownBytes: 19,
        }),
      }),
    ]);
  });

  it('records unsupported due deliverables as skipped so they do not spin every tick', async () => {
    const runs: Array<Parameters<ScheduledDeliverablesStore['recordRun']>[0]> = [];
    const runner = new ScheduledDeliverablesRunner({
      deliverablesService: fakeDeliverablesService({
        due: [scheduledDeliverable({ id: 'del_unknown', tags: ['weekly-report'] })],
        runs,
      }),
      digestService: fakeDigestService(),
      logger: silentLogger(),
    });

    await expect(runner.runDue()).resolves.toMatchObject({
      checked: 1,
      executed: 0,
      skipped: 1,
      failed: 0,
    });
    expect(runs).toEqual([
      expect.objectContaining({
        deliverableId: 'del_unknown',
        status: 'skipped',
        summary: 'No runner is registered for this scheduled deliverable.',
      }),
    ]);
  });

  it('records failed operations digest generation', async () => {
    const runs: Array<Parameters<ScheduledDeliverablesStore['recordRun']>[0]> = [];
    const runner = new ScheduledDeliverablesRunner({
      deliverablesService: fakeDeliverablesService({
        due: [scheduledDeliverable({ id: 'del_ops', tags: ['operations-digest'] })],
        runs,
      }),
      digestService: {
        generateOperationsDigest: vi.fn().mockRejectedValue(new Error('digest unavailable')),
        formatOperationsDigestMarkdown: vi.fn(),
      },
      logger: silentLogger(),
    });

    await expect(runner.runDue()).resolves.toMatchObject({
      checked: 1,
      executed: 0,
      skipped: 0,
      failed: 1,
    });
    expect(runs).toEqual([
      expect.objectContaining({
        deliverableId: 'del_ops',
        status: 'failed',
        workflowId: 'operations-digest',
        summary: 'Operations digest generation failed.',
        error: 'digest unavailable',
      }),
    ]);
  });

  it('refuses overlapping due passes', async () => {
    let releaseListDue: (() => void) | undefined;
    const deliverablesService = {
      listDue: vi.fn(
        () =>
          new Promise<Deliverable[]>((resolve) => {
            releaseListDue = () => resolve([]);
          })
      ),
      recordRun: vi.fn(),
    };
    const runner = new ScheduledDeliverablesRunner({
      deliverablesService,
      digestService: fakeDigestService(),
      logger: silentLogger(),
    });

    const firstRun = runner.runDue();
    await expect(runner.runDue()).resolves.toMatchObject({ overlapping: true });
    releaseListDue?.();
    await expect(firstRun).resolves.toMatchObject({ overlapping: false });
  });
});

interface ScheduledDeliverablesStore {
  listDue(now?: Date): Promise<Deliverable[]>;
  recordRun(params: {
    deliverableId: string;
    status: DeliverableRun['status'];
    outputFile?: string;
    summary?: string;
    durationMs?: number;
    error?: string;
    sourceRunId?: string;
    workflowId?: string;
    snapshotMetadata?: Record<string, string | number | boolean | null>;
  }): Promise<DeliverableRun>;
}

function scheduledDeliverable(overrides: Partial<Deliverable> = {}): Deliverable {
  return {
    id: 'del_default',
    name: 'Scheduled Deliverable',
    description: 'Scheduled deliverable fixture.',
    schedule: 'daily',
    scheduleDescription: 'Every day',
    enabled: true,
    outputPath: 'operations/digests',
    tags: ['operations-digest'],
    createdAt: '2026-06-04T09:00:00.000Z',
    nextRunAt: '2026-06-05T09:00:00.000Z',
    totalRuns: 0,
    ...overrides,
  };
}

function fakeDeliverablesService({
  due,
  runs,
}: {
  due: Deliverable[];
  runs: Array<Parameters<ScheduledDeliverablesStore['recordRun']>[0]>;
}): ScheduledDeliverablesStore {
  return {
    listDue: vi.fn().mockResolvedValue(due),
    recordRun: vi.fn(async (params) => {
      runs.push(params);
      return {
        id: `run_${runs.length}`,
        deliverableId: params.deliverableId,
        status: params.status,
        outputFile: params.outputFile,
        summary: params.summary,
        durationMs: params.durationMs,
        error: params.error,
        sourceRunId: params.sourceRunId,
        workflowId: params.workflowId,
        snapshot: params.snapshotMetadata
          ? {
              status: params.status,
              capturedAt: '2026-06-05T09:00:00.000Z',
              metadata: params.snapshotMetadata,
            }
          : undefined,
        runAt: '2026-06-05T09:00:00.000Z',
      };
    }),
  };
}

function fakeDigestService() {
  return {
    generateOperationsDigest: vi.fn().mockResolvedValue(makeOperationsDigest()),
    formatOperationsDigestMarkdown: vi.fn().mockReturnValue({ isEmpty: false, markdown: '' }),
  };
}

function makeOperationsDigest(): AgentOperationsDigest {
  return {
    period: {
      start: '2026-06-04T09:00:00.000Z',
      end: '2026-06-05T09:00:00.000Z',
      windowHours: 24,
    },
    generatedAt: '2026-06-05T09:00:00.000Z',
    hasActivity: true,
    groups: [
      {
        key: 'platform::veritas-kanban::/worktrees/veritas',
        project: 'platform',
        repo: 'veritas-kanban',
        cwd: '/worktrees/veritas',
        totals: {
          active: 4,
          blocked: 1,
          stuck: 1,
          completed: 3,
          failed: 1,
          runs: 5,
          tokenCost: 0.42,
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          wallTimeMs: 120000,
          activeTimeMs: 90000,
        },
        sourceLinks: {
          activeTasks: [],
          blockedTasks: [],
          stuckTasks: [],
          completedTasks: [],
          failedRuns: [],
          tokenEvents: [],
        },
        topPlanCompletions: [],
        notableFailures: [],
        openApprovals: [],
      },
    ],
    totals: {
      active: 4,
      blocked: 1,
      stuck: 1,
      completed: 3,
      failed: 1,
      runs: 5,
      tokenCost: 0.42,
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      wallTimeMs: 120000,
      activeTimeMs: 90000,
      openApprovals: 2,
      groups: 1,
    },
    refresh: {
      manual: true,
      schedule: 'daily-ready',
      narrative: 'deterministic-only',
    },
  };
}

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
