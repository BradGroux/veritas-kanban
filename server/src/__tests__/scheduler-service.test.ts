import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { QueueMonitorSnapshot, WorkflowDefinition } from '@veritas-kanban/shared';
import { SchedulerService } from '../services/scheduler-service.js';
import {
  ScheduledDeliverablesService,
  type Deliverable,
} from '../services/scheduled-deliverables-service.js';
import { WorkflowService } from '../services/workflow-service.js';

describe('SchedulerService', () => {
  let testRoot: string;
  let deliverablesService: ScheduledDeliverablesService;
  let workflowService: WorkflowService;
  let telemetry: { emit: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-scheduler-'));
    await fs.mkdir(path.join(testRoot, 'workflows'), { recursive: true });
    deliverablesService = new ScheduledDeliverablesService({
      dataDir: testRoot,
      storageType: 'file',
    });
    workflowService = new WorkflowService({
      workflowsDir: path.join(testRoot, 'workflows'),
      storageType: 'file',
    });
    telemetry = { emit: vi.fn(async (event) => event) };
  });

  afterEach(async () => {
    deliverablesService.dispose();
    workflowService.dispose();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('lists deliverable and workflow schedules with due summary', async () => {
    await seedDeliverables(testRoot, [
      scheduledDeliverable({
        id: 'del_due',
        nextRunAt: '2026-06-05T08:59:00.000Z',
      }),
    ]);
    await workflowService.saveWorkflow(
      workflowDefinition({
        id: 'weekly-snapshot',
        schedule: {
          mode: 'weekly',
          enabled: true,
          startAt: '2026-06-06T09:00:00.000Z',
          timezone: 'UTC',
        },
      })
    );
    const service = schedulerService();

    const result = await service.list(new Date('2026-06-05T09:00:00.000Z'));

    expect(result.summary).toMatchObject({ total: 2, enabled: 2, due: 1 });
    expect(result.items.map((item) => item.id)).toEqual([
      'scheduled-deliverable:del_due',
      'workflow:weekly-snapshot',
    ]);
  });

  it('pauses and resumes scheduled deliverables through the existing service', async () => {
    await seedDeliverables(testRoot, [scheduledDeliverable({ id: 'del_ops' })]);
    const service = schedulerService();

    const paused = await service.pause('scheduled-deliverable:del_ops');
    expect(paused.item.enabled).toBe(false);
    expect(paused.event.summary).toBe('Scheduler item paused.');

    const resumed = await service.resume('scheduled-deliverable:del_ops');
    expect(resumed.item.enabled).toBe(true);
    expect(resumed.event.summary).toBe('Scheduler item resumed.');
  });

  it('validates custom cron schedules without a due-run adapter', async () => {
    await seedDeliverables(testRoot, [
      scheduledDeliverable({
        id: 'del_custom',
        schedule: 'custom',
        cronExpr: '0 9 * * 1',
        scheduleDescription: 'Cron: 0 9 * * 1',
        nextRunAt: undefined,
      }),
    ]);
    const service = schedulerService();

    const result = await service.validate('scheduled-deliverable:del_custom');

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        path: 'trigger.mode',
      }),
    ]);
  });

  it('runs due deliverables and records scheduler telemetry', async () => {
    await seedDeliverables(testRoot, [
      scheduledDeliverable({
        id: 'del_due',
        tags: ['unsupported-report'],
        nextRunAt: '2026-06-05T08:59:00.000Z',
      }),
    ]);
    const service = schedulerService();

    const result = await service.runDue(new Date('2026-06-05T09:00:00.000Z'));

    expect(result).toMatchObject({
      checked: 1,
      executed: 0,
      skipped: 1,
      failed: 0,
      overlapping: false,
    });
    expect(result.events[0]).toMatchObject({
      itemId: 'scheduled-deliverable:del_due',
      status: 'skipped',
    });
    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.completed',
        taskId: 'scheduled-deliverable:del_due',
        agent: 'scheduler',
        project: 'operations',
      })
    );
  });

  it('exposes due queue monitors through scheduler run-due', async () => {
    const monitor = queueMonitorSnapshot({
      nextRunAt: '2026-06-05T08:59:00.000Z',
    });
    const queueMonitorService = {
      list: vi.fn(async () => ({
        generatedAt: '2026-06-05T09:00:00.000Z',
        summary: { total: 1, enabled: 1, paused: 0, blocked: 0, failed: 0, due: 1 },
        monitors: [monitor],
        recentEvents: [],
      })),
      updateMonitor: vi.fn(),
      runOnce: vi.fn(async () => ({
        monitor: {
          ...monitor,
          lastScanAt: '2026-06-05T09:00:00.000Z',
          nextRunAt: '2026-06-05T09:30:00.000Z',
        },
        packet: monitor.lastPacket,
        action: monitor.lastAction,
        event: {
          id: 'qm_evt_1',
          monitorId: monitor.id,
          type: 'due-run',
          status: 'success',
          action: 'dry-run',
          summary: 'Dry run selected BradGroux/veritas-kanban#736.',
          createdAt: '2026-06-05T09:00:00.000Z',
          skippedReasons: [],
        },
      })),
    };
    const service = new SchedulerService({
      stateFile: path.join(testRoot, 'scheduler-state.json'),
      deliverablesService,
      workflowService,
      queueMonitorService: queueMonitorService as never,
      telemetryService: telemetry as never,
    });

    const list = await service.list(new Date('2026-06-05T09:00:00.000Z'));
    expect(list.items.map((item) => item.id)).toContain('queue-monitor:veritas-backlog');

    const result = await service.runDue(new Date('2026-06-05T09:00:00.000Z'));
    expect(result.executed).toBe(1);
    expect(queueMonitorService.runOnce).toHaveBeenCalledWith(
      'veritas-backlog',
      'due-run',
      new Date('2026-06-05T09:00:00.000Z')
    );
  });

  function schedulerService(): SchedulerService {
    return new SchedulerService({
      stateFile: path.join(testRoot, 'scheduler-state.json'),
      deliverablesService,
      workflowService,
      queueMonitorService: emptyQueueMonitorService() as never,
      telemetryService: telemetry as never,
    });
  }
});

function emptyQueueMonitorService() {
  return {
    list: vi.fn(async () => ({
      generatedAt: '2026-06-05T09:00:00.000Z',
      summary: { total: 0, enabled: 0, paused: 0, blocked: 0, failed: 0, due: 0 },
      monitors: [],
      recentEvents: [],
    })),
    updateMonitor: vi.fn(),
    runOnce: vi.fn(),
  };
}

async function seedDeliverables(root: string, deliverables: Deliverable[]): Promise<void> {
  await fs.writeFile(path.join(root, 'scheduled-deliverables.json'), JSON.stringify(deliverables));
  await fs.writeFile(path.join(root, 'deliverable-runs.json'), '[]');
}

function queueMonitorSnapshot(overrides: Partial<QueueMonitorSnapshot> = {}): QueueMonitorSnapshot {
  return {
    id: 'veritas-backlog',
    name: 'Veritas backlog',
    description: 'Scan backlog.',
    enabled: true,
    source: {
      kind: 'github',
      repo: 'BradGroux/veritas-kanban',
      state: 'open',
      labels: ['priority: high'],
      includeIssues: true,
      includePullRequests: true,
    },
    mode: 'dry-run',
    runner: 'local',
    intervalMinutes: 30,
    maxCandidates: 20,
    stopConditions: {
      maxFailureStreak: 3,
      skipBlockedLabels: ['blocked'],
      skipDraftPullRequests: true,
      skipFailedChecks: true,
    },
    tags: ['backlog'],
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T09:00:00.000Z',
    health: 'healthy',
    healthSummary: 'Ready',
    failureStreak: 0,
    nextRunAt: '2026-06-05T08:59:00.000Z',
    actions: {
      canRun: true,
      canPause: true,
      canResume: false,
      canExplain: true,
    },
    ...overrides,
  };
}

function scheduledDeliverable(overrides: Partial<Deliverable> = {}): Deliverable {
  return {
    id: 'del_ops',
    name: 'Operations Digest',
    description: 'Generate operations digest.',
    schedule: 'daily',
    scheduleDescription: 'Every day',
    enabled: true,
    tags: ['operations-digest'],
    createdAt: '2026-06-01T09:00:00.000Z',
    lastRunAt: undefined,
    nextRunAt: '2026-06-06T09:00:00.000Z',
    totalRuns: 0,
    ...overrides,
  };
}

function workflowDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'weekly-snapshot',
    name: 'Weekly Snapshot',
    version: 1,
    description: 'Create weekly operational snapshot.',
    agents: [
      {
        id: 'writer',
        name: 'Writer',
        role: 'general',
        description: 'Writes the snapshot.',
      },
    ],
    steps: [
      {
        id: 'write',
        name: 'Write snapshot',
        type: 'agent',
        agent: 'writer',
        input: 'Write snapshot.',
      },
    ],
    schedule: { mode: 'weekly', enabled: true, timezone: 'UTC' },
    outputTargets: [{ type: 'scheduled-snapshot', label: 'Snapshot', required: true }],
    ...overrides,
  };
}
