import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AutomationBinding,
  AutomationRunClaim,
  AutomationVersion,
  QueueMonitorSnapshot,
  WorkflowDefinition,
} from '@veritas-kanban/shared';
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

  it('claims an immutable automation version before shared workflow admission', async () => {
    const version = automationVersionFixture();
    const binding = automationBindingFixture(version);
    const claim = automationClaimFixture(version, binding);
    const automationService = {
      list: vi.fn(async () => ({
        generatedAt: '2026-06-05T09:00:00.000Z',
        versions: [version],
        bindings: [binding],
        recentClaims: [],
      })),
      claimRun: vi.fn(async () => ({ claim, version, binding, replayed: false })),
      markRunStarted: vi.fn(async (_claimId, workflowRunId) => ({
        ...claim,
        status: 'started',
        workflowRunId,
      })),
      markRunFailed: vi.fn(),
      markRunCompleted: vi.fn(),
      updateBinding: vi.fn(),
    };
    const workflowRunService = {
      getRun: vi.fn(async () => null),
      startRun: vi.fn(async () => ({
        id: 'run_1780664400000_started',
        workflowId: version.workflowId,
        workflowVersion: version.workflowVersion,
        status: 'running',
        context: {},
        startedAt: '2026-06-05T09:00:00.000Z',
        steps: [],
      })),
    };
    const service = new SchedulerService({
      stateFile: path.join(testRoot, 'scheduler-state.json'),
      deliverablesService,
      workflowService,
      workflowRunService: workflowRunService as never,
      queueMonitorService: emptyQueueMonitorService() as never,
      telemetryService: telemetry as never,
      automationService: automationService as never,
    });

    const result = await service.runItem(
      `automation:${binding.id}`,
      'manual-run',
      new Date('2026-06-05T09:00:00.000Z')
    );

    expect(automationService.claimRun).toHaveBeenCalledWith(
      binding.id,
      'manual-run',
      new Date('2026-06-05T09:00:00.000Z')
    );
    expect(workflowRunService.startRun).toHaveBeenCalledWith(
      version.workflowId,
      version.sourceTaskId,
      expect.objectContaining({ scheduler: expect.objectContaining({ trigger: 'manual-run' }) }),
      expect.objectContaining({ scope: 'run' }),
      expect.objectContaining({
        automationVersionId: version.id,
        bindingId: binding.id,
        claimId: claim.id,
        requestId: claim.requestId,
        standingScope: version.standingScope,
      })
    );
    expect(automationService.markRunStarted).toHaveBeenCalledWith(
      claim.id,
      'run_1780664400000_started'
    );
    expect(result.event).toMatchObject({
      status: 'started',
      sourceRunId: 'run_1780664400000_started',
    });
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

function automationVersionFixture(): AutomationVersion {
  return {
    schemaVersion: 'automation-version/v1',
    id: 'automation_version_aaaaaaaaaaaaaaaaaaaaaaaa',
    version: 1,
    draftId: 'automation_bbbbbbbbbbbbbbbbbbbbbbbb',
    draftRevision: 1,
    draftDigest: `scrypt:${'c'.repeat(64)}`,
    requestRevision: `sha256:${'d'.repeat(64)}`,
    workspaceId: 'workspace-1',
    sourceTaskId: 'task-source',
    objective: 'Review support queue.',
    workflowId: 'support-triage',
    workflowVersion: 3,
    provider: 'openclaw',
    schedule: {
      expression: '0 9 * * 1-5',
      timezone: 'UTC',
      expiresAt: '2026-12-31T23:59:59.000Z',
      overlapPolicy: 'forbid',
      retry: { maxAttempts: 2, backoffMinutes: 15 },
      nextRunAt: '2026-06-05T09:00:00.000Z',
    },
    output: { destination: 'work-products/triage', expectedDeliverables: ['Triage report'] },
    standingScope: {
      reads: ['support-queue'],
      writes: ['work-products/triage'],
      sends: [],
      externalTargets: [],
      artifactDestinations: ['work-products/triage'],
      integrationIds: [],
      toolIds: ['support-read'],
      credentialDefinitionIds: [],
      approvalRequiredActions: [],
    },
    perRunBudget: { maxRuns: 1, maxTokens: 100_000, maxDurationMinutes: 30 },
    aggregateBudget: { maxRuns: 20, maxTokens: 2_000_000, maxDurationMinutes: 600 },
    stopConditions: ['expiry reached'],
    evidence: {
      sourceTarget: {
        kind: 'workflow',
        id: 'support-triage',
        version: 3,
        digest: `sha256:${'e'.repeat(64)}`,
      },
      workflowId: 'support-triage',
      workflowVersion: 3,
      workflowDigest: `sha256:${'e'.repeat(64)}`,
      provider: 'openclaw',
      providerEvidenceDigest: `sha256:${'f'.repeat(64)}`,
      toolCatalogDigest: `sha256:${'1'.repeat(64)}`,
      integrationEvidenceDigest: `sha256:${'2'.repeat(64)}`,
      policyDigest: `sha256:${'3'.repeat(64)}`,
      enforceable: true,
      blockers: [],
    },
    approval: {
      id: 'runapproval_Automation123456',
      revision: 2,
      actionHash: '4'.repeat(64),
      approvedBy: 'operator-1',
      approvedAt: '2026-06-05T08:55:00.000Z',
    },
    activatedAt: '2026-06-05T08:56:00.000Z',
    digest: `sha256:${'5'.repeat(64)}`,
  };
}

function automationBindingFixture(version: AutomationVersion): AutomationBinding {
  return {
    schemaVersion: 'automation-binding/v1',
    id: 'automation_binding_aaaaaaaaaaaaaaaaaaaaaaaa',
    revision: 1,
    automationVersionId: version.id,
    automationVersion: version.version,
    status: 'active',
    nextRunAt: version.schedule.nextRunAt,
    acceptedRuns: 0,
    failedRuns: 0,
    aggregateUsage: { runs: 0, costUsd: 0, tokens: 0, durationMinutes: 0 },
    statusReason: 'Active.',
    createdAt: '2026-06-05T08:56:00.000Z',
    updatedAt: '2026-06-05T08:56:00.000Z',
  };
}

function automationClaimFixture(
  version: AutomationVersion,
  binding: AutomationBinding
): AutomationRunClaim {
  return {
    schemaVersion: 'automation-run-claim/v1',
    id: 'automation_claim_aaaaaaaaaaaaaaaaaaaaaaaa',
    requestId: `automation:${version.id}:manual-run:2026-06-05T09:00:00.000Z`,
    automationVersionId: version.id,
    bindingId: binding.id,
    dueWindow: '2026-06-05T09:00:00.000Z',
    trigger: 'manual-run',
    status: 'accepted',
    createdAt: '2026-06-05T09:00:00.000Z',
    updatedAt: '2026-06-05T09:00:00.000Z',
  };
}
