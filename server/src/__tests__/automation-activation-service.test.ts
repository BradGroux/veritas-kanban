import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AutomationDraftCompileInput,
  RunApprovalRequest,
  TaskTemplate,
  WorkflowDefinition,
} from '@veritas-kanban/shared';
import { AutomationActivationService } from '../services/automation-activation-service.js';
import { SchedulerService } from '../services/scheduler-service.js';
import {
  AutomationDraftService,
  nextAutomationRunAt,
} from '../services/automation-draft-service.js';
import { FileSchedulerStateRepository } from '../storage/scheduler-state-repository.js';

describe('AutomationActivationService', () => {
  let root: string;
  let repository: FileSchedulerStateRepository;
  let drafts: AutomationDraftService;
  let workflow: WorkflowDefinition;
  let approval: RunApprovalRequest;
  let now: Date;
  let savedWorkflow: WorkflowDefinition | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-automation-activation-'));
    repository = new FileSchedulerStateRepository(path.join(root, 'scheduler-state.json'));
    now = new Date('2026-08-30T15:00:00.000Z');
    workflow = workflowFixture();
    savedWorkflow = undefined;
    drafts = new AutomationDraftService({
      stateRepository: repository,
      now: () => now,
      workflowExists: async (id) => id === workflow.id,
      taskExists: async (id) => id === 'task-source',
      templateExists: async () => false,
      integrationReady: async (id) => id === 'teams-reviewed',
      providerSupported: (id) => id === 'openclaw',
      listSchedulerItems: async () => [],
    });
    approval = approvalFixture();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('requires exact approval before atomically persisting an immutable version and binding', async () => {
    const draft = await drafts.save(completeInput());
    const service = activationService();
    const preview = await service.preview(draft.id, 'activate-stable', draft.revision);

    expect(preview).toMatchObject({
      draftDigest: draft.digest,
      workspaceId: 'workspace-1',
      evidence: { workflowId: workflow.id, workflowVersion: 3, enforceable: true },
      approval: { required: true, riskClass: 'critical' },
    });
    expect(preview.effectiveRunAccess).toMatchObject({
      tools: ['support-read', 'work-product-write'],
      integrations: ['teams-reviewed'],
    });

    const pending = await service.apply({
      draftId: draft.id,
      revision: draft.revision,
      requestId: preview.requestId,
      expectedRequestRevision: preview.requestRevision,
    });
    expect(pending).toMatchObject({ approvalId: approval.id, approvalStatus: 'pending' });
    expect((await repository.read()).automationVersions).toEqual({});

    approval = {
      ...approval,
      status: 'approved',
      revision: 2,
      resolution: {
        decision: 'approved',
        actor: { id: 'operator-1', type: 'user', workspaceId: 'workspace-1' },
        decidedAt: '2026-08-30T15:01:00.000Z',
      },
    };
    const activated = await service.apply({
      draftId: draft.id,
      revision: draft.revision,
      requestId: preview.requestId,
      expectedRequestRevision: preview.requestRevision,
      approvalId: approval.id,
    });

    expect(activated.version).toMatchObject({
      draftDigest: draft.digest,
      workflowId: workflow.id,
      workflowVersion: 3,
      approval: { id: approval.id, revision: 2, approvedBy: 'operator-1' },
    });
    expect(activated.binding).toMatchObject({ status: 'active', acceptedRuns: 0, revision: 1 });

    const replay = await service.apply({
      draftId: draft.id,
      revision: draft.revision,
      requestId: preview.requestId,
      expectedRequestRevision: preview.requestRevision,
      approvalId: approval.id,
    });
    expect(replay.version?.id).toBe(activated.version?.id);
    expect((await service.list()).versions).toHaveLength(1);
  });

  it.each([
    {
      name: 'future start',
      current: '2026-08-30T15:00:00.000Z',
      startAt: '2026-09-15T00:00:00.000Z',
      expected: ['2026-09-15T14:00:00.000Z', '2026-09-16T14:00:00.000Z'],
    },
    {
      name: 'exact cron start retains the existing strictly-after calculation',
      current: '2026-08-30T15:00:00.000Z',
      startAt: '2026-09-15T14:00:00.000Z',
      expected: ['2026-09-16T14:00:00.000Z', '2026-09-17T14:00:00.000Z'],
    },
    {
      name: 'no start bound',
      current: '2026-08-30T15:00:00.000Z',
      startAt: undefined,
      expected: ['2026-08-31T14:00:00.000Z', '2026-09-01T14:00:00.000Z'],
    },
    {
      name: 'Chicago daylight saving transition',
      current: '2026-03-05T15:00:00.000Z',
      startAt: '2026-03-06T00:00:00.000Z',
      expected: ['2026-03-06T15:00:00.000Z', '2026-03-09T14:00:00.000Z'],
    },
  ])('aligns draft, preview, binding and subsequent run for $name', async (testCase) => {
    now = new Date(testCase.current);
    const input = completeInput();
    input.hints = { ...input.hints, startAt: testCase.startAt };
    const draft = await drafts.save(input);
    expect(draft.validation.valid).toBe(true);
    expect(draft.schedule.nextRunExamples.slice(0, 2)).toEqual(testCase.expected);
    const service = activationService();
    const preview = await service.preview(draft.id, 'bounded-start');
    expect(preview.schedule.nextRunAt).toBe(testCase.expected[0]);
    approval = {
      ...approval,
      status: 'approved',
      revision: 2,
      resolution: {
        decision: 'approved',
        actor: { id: 'operator-1', workspaceId: 'workspace-1' },
        decidedAt: now.toISOString(),
      },
    };
    const activated = await service.apply({
      draftId: draft.id,
      requestId: preview.requestId,
      expectedRequestRevision: preview.requestRevision,
      approvalId: approval.id,
    });
    if (!activated.binding) throw new Error('Expected binding');
    expect(activated.binding.nextRunAt).toBe(testCase.expected[0]);
    const firstRun = testCase.expected[0];
    if (!firstRun) throw new Error('Expected first run');
    const claimed = await service.claimRun(activated.binding.id, 'due-run', new Date(firstRun));
    expect(claimed.claim.status).toBe('accepted');
    expect(claimed.binding.nextRunAt).toBe(testCase.expected[1]);
  });

  it('keeps expiry exclusive in draft examples and next-run calculations', async () => {
    const input = completeInput();
    const expiry = '2026-09-02T14:00:00.000Z';
    input.hints = { ...input.hints, expiresAt: expiry };
    const draft = await drafts.save(input);
    expect(draft.schedule.nextRunExamples).toEqual([
      '2026-08-31T14:00:00.000Z',
      '2026-09-01T14:00:00.000Z',
    ]);
    expect(draft.validation.valid).toBe(false);
    expect(
      nextAutomationRunAt('0 9 * * 1-5', 'America/Chicago', new Date(expiry), expiry)
    ).toBeUndefined();
    expect(
      nextAutomationRunAt(
        '0 9 * * 1-5',
        'America/Chicago',
        new Date('2026-09-01T14:00:00.000Z'),
        expiry
      )
    ).toBeUndefined();
    await expect(activationService().preview(draft.id, 'expired-window')).rejects.toThrow();
  });

  it.each(['manual-run', 'due-run'] as const)(
    'rejects an early %s without disabling or consuming approved work',
    async (trigger) => {
      const input = completeInput();
      const startAt = '2026-09-15T14:00:30.000Z';
      input.hints = { ...input.hints, startAt };
      const draft = await drafts.save(input);
      const service = activationService();
      const preview = await service.preview(draft.id, 'early-start');
      approval = {
        ...approval,
        status: 'approved',
        revision: 2,
        resolution: {
          decision: 'approved',
          actor: { id: 'operator-1', workspaceId: 'workspace-1' },
          decidedAt: now.toISOString(),
        },
      };
      const activated = await service.apply({
        draftId: draft.id,
        requestId: preview.requestId,
        expectedRequestRevision: preview.requestRevision,
        approvalId: approval.id,
      });
      if (!activated.binding) throw new Error('Expected binding');
      const id = activated.binding.id;
      const earlyTime = new Date('2026-09-15T14:00:10.000Z');
      if (trigger === 'due-run')
        await repository.update((state) => {
          state.automationBindings[id].nextRunAt = earlyTime.toISOString();
          return state;
        });
      const early = await service.claimRun(id, trigger, earlyTime);
      expect(early.claim).toMatchObject({
        status: 'blocked',
        reason: 'Automation start time has not arrived.',
      });
      expect(early.binding).toMatchObject({
        status: 'active',
        acceptedRuns: 0,
        aggregateUsage: { runs: 0 },
        nextRunAt: '2026-09-16T14:00:00.000Z',
      });
      expect(early.binding.statusReason).toBe(activated.binding.statusReason);
      const restarted = activationService();
      const accepted = await restarted.claimRun(
        id,
        trigger,
        new Date(trigger === 'manual-run' ? startAt : '2026-09-16T14:00:00.000Z')
      );
      expect(accepted).toMatchObject({
        replayed: false,
        claim: { status: 'accepted' },
        binding: { status: 'active', acceptedRuns: 1, aggregateUsage: { runs: 1 } },
      });
    }
  );

  it('invalidates stale previews when workflow evidence changes', async () => {
    const draft = await drafts.save(completeInput());
    const service = activationService();
    const preview = await service.preview(draft.id, 'activate-stale');
    workflow = { ...workflow, version: 4 };

    await expect(
      service.apply({
        draftId: draft.id,
        requestId: preview.requestId,
        expectedRequestRevision: preview.requestRevision,
      })
    ).rejects.toThrow(/preview is stale/i);
  });

  it('rejects prototype property names before reading or writing automation maps', async () => {
    const service = activationService();

    await expect(service.getVersion('__proto__')).rejects.toThrow(/invalid automation version id/i);
    await expect(
      service.updateBinding('__proto__', 1, 'paused', 'Invalid target.')
    ).rejects.toThrow(/invalid automation binding id/i);
    await expect(service.claimRun('__proto__', 'manual-run', now)).rejects.toThrow(
      /invalid automation binding id/i
    );
  });

  it('claims each due window once and blocks future ownership after pause or budget exhaustion', async () => {
    const draft = await drafts.save(completeInput());
    const service = activationService();
    const preview = await service.preview(draft.id, 'activate-claims');
    approval = {
      ...approval,
      status: 'approved',
      revision: 2,
      resolution: {
        decision: 'approved',
        actor: { id: 'operator-1', workspaceId: 'workspace-1' },
        decidedAt: now.toISOString(),
      },
    };
    const activated = await service.apply({
      draftId: draft.id,
      requestId: preview.requestId,
      expectedRequestRevision: preview.requestRevision,
      approvalId: approval.id,
    });
    const binding = activated.binding;
    if (!binding) throw new Error('Expected binding');

    const first = await service.claimRun(binding.id, 'manual-run', now);
    const duplicate = await service.claimRun(binding.id, 'manual-run', now);
    expect(first).toMatchObject({ replayed: false, claim: { status: 'accepted' } });
    expect(duplicate).toMatchObject({ replayed: true, claim: { id: first.claim.id } });

    const paused = await service.updateBinding(
      binding.id,
      first.binding.revision,
      'paused',
      'Operator pause.'
    );
    now = new Date('2026-08-30T15:02:00.000Z');
    const blocked = await service.claimRun(paused.id, 'manual-run', now);
    expect(blocked.claim).toMatchObject({
      status: 'blocked',
      reason: 'Automation binding is paused.',
    });
    expect(blocked.binding.status).toBe('blocked');
  });

  it('records consecutive failures idempotently and resets them after a completed run', async () => {
    const draft = await drafts.save(completeInput());
    const service = activationService();
    const preview = await service.preview(draft.id, 'activate-retries');
    approval = {
      ...approval,
      status: 'approved',
      revision: 2,
      resolution: {
        decision: 'approved',
        actor: { id: 'operator-1', workspaceId: 'workspace-1' },
        decidedAt: now.toISOString(),
      },
    };
    const activated = await service.apply({
      draftId: draft.id,
      requestId: preview.requestId,
      expectedRequestRevision: preview.requestRevision,
      approvalId: approval.id,
    });
    if (!activated.binding) throw new Error('Expected binding');

    const failedClaim = await service.claimRun(activated.binding.id, 'manual-run', now);
    await service.markRunStarted(failedClaim.claim.id, 'run-failed');
    await service.markRunFailed(failedClaim.claim.id, 'Temporary provider failure.');
    await service.markRunFailed(failedClaim.claim.id, 'Temporary provider failure.');
    expect((await service.list()).bindings[0].failedRuns).toBe(1);

    now = new Date('2026-08-30T15:01:00.000Z');
    const completedClaim = await service.claimRun(activated.binding.id, 'manual-run', now);
    await service.markRunStarted(completedClaim.claim.id, 'run-completed');
    await service.markRunCompleted(completedClaim.claim.id, {
      costUsd: 0.1,
      tokens: 1_000,
      durationMinutes: 2,
    });
    expect((await service.list()).bindings[0]).toMatchObject({
      failedRuns: 0,
      aggregateUsage: { runs: 2, costUsd: 0.1, tokens: 1_000, durationMinutes: 2 },
    });
  });

  it('binds a task-template digest and persists its deterministic workflow only after approval', async () => {
    const template = taskTemplateFixture();
    const templateDrafts = new AutomationDraftService({
      stateRepository: repository,
      now: () => now,
      workflowExists: async () => false,
      taskExists: async (id) => id === 'task-source',
      templateExists: async (id) => id === template.id,
      integrationReady: async (id) => id === 'teams-reviewed',
      providerSupported: (id) => id === 'openclaw',
      listSchedulerItems: async () => [],
    });
    const input = completeInput();
    input.hints = {
      ...input.hints,
      workflowId: undefined,
      taskTemplateId: template.id,
    };
    const draft = await templateDrafts.save(input);
    const service = activationService(templateDrafts, template);
    const preview = await service.preview(draft.id, 'activate-template');
    expect(preview.evidence.sourceTarget).toMatchObject({
      kind: 'task-template',
      id: template.id,
      version: template.version,
    });
    expect(savedWorkflow).toBeUndefined();

    approval = {
      ...approval,
      status: 'approved',
      revision: 2,
      resolution: {
        decision: 'approved',
        actor: { id: 'operator-1', workspaceId: 'workspace-1' },
        decidedAt: now.toISOString(),
      },
    };
    const result = await service.apply({
      draftId: draft.id,
      requestId: preview.requestId,
      expectedRequestRevision: preview.requestRevision,
      approvalId: approval.id,
    });
    expect(savedWorkflow).toMatchObject({
      id: result.version?.workflowId,
      agents: [expect.objectContaining({ provider: 'openclaw' })],
    });
    expect(result.version?.evidence.sourceTarget.digest).toBe(preview.evidence.sourceTarget.digest);
  });

  async function activate(input = completeInput()) {
    const draft = await drafts.save(input);
    const service = activationService();
    const preview = await service.preview(draft.id, 'usage-activation');
    approval = {
      ...approval,
      status: 'approved',
      revision: 2,
      resolution: {
        decision: 'approved',
        actor: { id: 'operator-1', workspaceId: 'workspace-1' },
        decidedAt: now.toISOString(),
      },
    };
    const result = await service.apply({
      draftId: draft.id,
      requestId: preview.requestId,
      expectedRequestRevision: preview.requestRevision,
      approvalId: approval.id,
    });
    if (!result.binding) throw new Error('Expected fixture binding');
    return { service, binding: result.binding };
  }

  it('commits failed usage and its receipt once across concurrent services and restart', async () => {
    const { service, binding } = await activate();
    const { claim } = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(claim.id, 'measured-failure');
    const usage = { costUsd: 5, tokens: 5_000, durationMinutes: 10 };
    const other = activationService();
    await Promise.all([
      service.markRunFailed(claim.id, 'Measured failure', usage),
      other.markRunFailed(claim.id, 'Measured failure', usage),
    ]);
    repository = new FileSchedulerStateRepository(path.join(root, 'scheduler-state.json'));
    const restarted = activationService();
    await restarted.markRunFailed(claim.id, 'Repeated failure', usage);
    const state = await repository.read();
    expect(state.automationBindings[binding.id]).toMatchObject({
      failedRuns: 1,
      aggregateUsage: { runs: 1, ...usage },
    });
    expect(state.automationClaims[0]).toMatchObject({
      status: 'failed',
      usageReceipt: { ...usage, recordedAt: now.toISOString() },
    });
    expect(await restarted.listClaimsPendingReconciliation()).toEqual([]);
    await expect(restarted.markRunCompleted(claim.id, usage)).rejects.toThrow(/terminal state/i);
  });

  it.each([
    ['cost', { maxCostUsd: 5 }, { costUsd: 5, tokens: 1, durationMinutes: 1 }],
    ['token', { maxTokens: 2_000_000 }, { costUsd: 0, tokens: 2_000_000, durationMinutes: 1 }],
    ['duration', { maxDurationMinutes: 600 }, { costUsd: 0, tokens: 1, durationMinutes: 600 }],
  ] as const)(
    'blocks at the aggregate %s ceiling after failed work',
    async (kind, budget, usage) => {
      const input = completeInput();
      input.hints!.aggregateBudget = { ...input.hints!.aggregateBudget!, ...budget };
      const { service, binding } = await activate(input);
      const { claim } = await service.claimRun(binding.id, 'manual-run', now);
      await service.markRunStarted(claim.id, 'ceiling-failure');
      await service.markRunFailed(claim.id, 'Failure with consumption', usage);
      expect((await service.list()).bindings[0]).toMatchObject({
        status: 'blocked',
        statusReason: expect.stringContaining(kind),
        failedRuns: 1,
      });
      now = new Date('2026-08-30T15:01:00.000Z');
      expect((await service.claimRun(binding.id, 'manual-run', now)).claim.status).toBe('blocked');
    }
  );

  it('backfills retained historical failures without recounting failures or historical successes', async () => {
    const { service, binding } = await activate();
    const { claim } = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(claim.id, 'legacy-failed-workflow');
    await service.markRunFailed(claim.id, 'Historical failure');
    expect((await service.listClaimsPendingReconciliation()).map((entry) => entry.id)).toEqual([
      claim.id,
    ]);
    const usage = { costUsd: 3, tokens: 700, durationMinutes: 4 };
    await service.markRunFailed(claim.id, 'Reconciled historical failure', usage);
    expect((await service.list()).bindings[0]).toMatchObject({
      failedRuns: 1,
      aggregateUsage: { runs: 1, ...usage },
    });
    now = new Date('2026-08-30T15:01:00.000Z');
    const completed = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(completed.claim.id, 'legacy-completed-workflow');
    await service.markRunCompleted(completed.claim.id, usage);
    await repository.update((state) => {
      delete state.automationClaims.find((entry) => entry.id === completed.claim.id)!.usageReceipt;
      return state;
    });
    const before = (await repository.read()).automationBindings[binding.id];
    await activationService().markRunCompleted(completed.claim.id, usage);
    expect((await repository.read()).automationBindings[binding.id]).toEqual(before);
  });

  it('retains measured usage through mixed failures, successes and a zero-usage launch failure', async () => {
    const { service, binding } = await activate();
    for (const [index, failed] of [true, false, true].entries()) {
      now = new Date(`2026-08-30T15:0${index}:00.000Z`);
      const { claim } = await service.claimRun(binding.id, 'manual-run', now);
      await service.markRunStarted(claim.id, `mixed-workflow-${index}`);
      const usage = { costUsd: index + 1, tokens: (index + 1) * 100, durationMinutes: index + 1 };
      if (failed) await service.markRunFailed(claim.id, 'Measured failure', usage);
      else await service.markRunCompleted(claim.id, usage);
    }
    now = new Date('2026-08-30T15:03:00.000Z');
    const { claim } = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunFailed(claim.id, 'Launch failed');
    await service.markRunFailed(claim.id, 'Launch failed');
    const state = await repository.read();
    expect(state.automationBindings[binding.id]).toMatchObject({
      failedRuns: 2,
      aggregateUsage: { runs: 4, costUsd: 6, tokens: 600, durationMinutes: 6 },
    });
    expect(state.automationClaims[3].usageReceipt).toMatchObject({
      costUsd: 0,
      tokens: 0,
      durationMinutes: 0,
    });
  });

  it.each(['failed', 'completed'] as const)(
    'reconciles an older failed claim from a %s workflow once after restart',
    async (workflowStatus) => {
      const { service, binding } = await activate();
      const { claim } = await service.claimRun(binding.id, 'manual-run', now);
      await service.markRunStarted(claim.id, 'retained-failed-workflow');
      await service.markRunFailed(claim.id, 'Historical failure');
      await repository.update((state) => {
        for (let index = 1; index <= 100; index += 1)
          state.automationClaims.push({
            ...claim,
            id: `automation_claim_${index.toString(16).padStart(24, '0')}`,
            requestId: `blocked-window-${index}`,
            status: 'blocked',
            reason: 'Fixture blocked window',
          });
        return state;
      });
      expect((await service.list()).recentClaims.some((entry) => entry.id === claim.id)).toBe(
        false
      );
      const getRun = vi.fn(async () => ({
        id: 'retained-failed-workflow',
        status: workflowStatus,
        error: 'Measured provider failure',
        startedAt: '2026-08-30T15:00:00.000Z',
        completedAt: '2026-08-30T15:10:00.000Z',
        budget: { usage: { costUsd: 5, totalTokens: 5_000 } },
      }));
      const scheduler = (automationService: AutomationActivationService) =>
        new SchedulerService({
          stateRepository: repository,
          automationService,
          deliverablesService: { list: async () => [] } as never,
          workflowService: { listWorkflows: async () => [] } as never,
          workflowRunService: { getRun } as never,
          workflowAuthoringService: {} as never,
          queueMonitorService: { list: async () => ({ monitors: [] }) } as never,
          telemetryService: { emit: vi.fn() } as never,
        });
      await Promise.all([scheduler(service).list(now), scheduler(activationService()).list(now)]);
      repository = new FileSchedulerStateRepository(path.join(root, 'scheduler-state.json'));
      const snapshot = (await repository.read()).automationBindings[binding.id];
      expect(snapshot).toMatchObject({
        failedRuns: 1,
        aggregateUsage: { runs: 1, costUsd: 5, tokens: 5_000, durationMinutes: 10 },
      });
      await scheduler(activationService()).list(now);
      expect((await repository.read()).automationBindings[binding.id]).toEqual(snapshot);
    }
  );

  it.each(['failed', 'completed'] as const)(
    'reconciles measured %s workflows through the scheduler',
    async (status) => {
      const { service, binding } = await activate();
      const { claim } = await service.claimRun(binding.id, 'manual-run', now);
      await service.markRunStarted(claim.id, 'terminal-workflow');
      const scheduler = new SchedulerService({
        stateRepository: repository,
        automationService: service,
        deliverablesService: { list: async () => [] } as never,
        workflowService: { listWorkflows: async () => [] } as never,
        workflowRunService: {
          getRun: async () => ({
            id: 'terminal-workflow',
            status,
            startedAt: '2026-08-30T15:00:00.000Z',
            completedAt: '2026-08-30T15:10:00.000Z',
            budget: { usage: { costUsd: 5, totalTokens: 5_000 } },
          }),
        } as never,
        workflowAuthoringService: {} as never,
        queueMonitorService: { list: async () => ({ monitors: [] }) } as never,
        telemetryService: { emit: vi.fn() } as never,
      });
      await scheduler.list(now);
      await scheduler.list(now);
      const state = await repository.read();
      expect(state.automationBindings[binding.id]).toMatchObject({
        failedRuns: status === 'failed' ? 1 : 0,
        aggregateUsage: { runs: 1, costUsd: 5, tokens: 5_000, durationMinutes: 10 },
      });
      expect(state.automationClaims[0]).toMatchObject({
        status,
        usageReceipt: { costUsd: 5, tokens: 5_000, durationMinutes: 10 },
      });
    }
  );

  it.each(['skip', 'forbid', 'queue-one'] as const)(
    'enforces %s across accepted and workflow-owned claims without a source task',
    async (overlapPolicy) => {
      for (const priorStatus of ['accepted', 'started'] as const) {
        now = new Date('2026-08-30T15:00:00.000Z');
        approval = approvalFixture();
        // Each case owns an independent draft/binding and durable state file.
        repository = new FileSchedulerStateRepository(
          path.join(root, `${overlapPolicy}-${priorStatus}.json`)
        );
        drafts = new AutomationDraftService({
          stateRepository: repository,
          now: () => now,
          workflowExists: async () => true,
          taskExists: async () => true,
          templateExists: async () => false,
          integrationReady: async () => true,
          providerSupported: () => true,
          listSchedulerItems: async () => [],
        });
        const input = completeInput();
        input.hints = { ...input.hints, sourceTaskId: undefined, overlapPolicy };
        const { service, binding } = await activate(input);
        const firstWindow = binding.nextRunAt;
        if (!firstWindow) throw new Error('Expected scheduled window');
        now = new Date(firstWindow);
        const first = await service.claimRun(binding.id, 'due-run', now);
        expect(first.claim.status).toBe('accepted');
        expect(first.version.sourceTaskId).toBeUndefined();
        if (priorStatus === 'started')
          await service.markRunStarted(first.claim.id, 'workflow-queued-or-running');
        if (!first.binding.nextRunAt) throw new Error('Expected next window');
        now = new Date(first.binding.nextRunAt);
        const second = await activationService().claimRun(binding.id, 'due-run', now);
        expect(second.claim.status).toBe(
          overlapPolicy === 'skip' ? 'skipped' : overlapPolicy === 'forbid' ? 'blocked' : 'queued'
        );
        expect(second.binding).toMatchObject({
          status: overlapPolicy === 'forbid' ? 'blocked' : 'active',
          acceptedRuns: 1,
          aggregateUsage: { runs: 1 },
        });
        expect(
          (await repository.read()).automationClaims.find((claim) => claim.id === first.claim.id)
            ?.status
        ).toBe(priorStatus);
      }
    }
  );

  it('retains the first queued window across restart and promotes it once after terminal release', async () => {
    const input = completeInput();
    input.hints = { ...input.hints, overlapPolicy: 'queue-one', sourceTaskId: undefined };
    const { service, binding } = await activate(input);
    const first = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(first.claim.id, 'running-first');
    now = new Date('2026-08-30T15:01:00.000Z');
    const queued = await service.claimRun(binding.id, 'manual-run', now);
    expect(queued.claim.status).toBe('queued');
    expect(await service.claimRun(binding.id, 'manual-run', now)).toMatchObject({
      replayed: true,
      claim: { id: queued.claim.id, status: 'queued' },
    });
    now = new Date('2026-08-30T15:02:00.000Z');
    repository = new FileSchedulerStateRepository(path.join(root, 'scheduler-state.json'));
    const restarted = activationService();
    const skipped = await restarted.claimRun(binding.id, 'manual-run', now);
    expect(skipped.claim.status).toBe('skipped');
    expect(
      (await repository.read()).automationClaims
        .filter((claim) => claim.status === 'queued')
        .map((claim) => claim.id)
    ).toEqual([queued.claim.id]);
    await restarted.markRunCompleted(first.claim.id, {
      costUsd: 0,
      tokens: 10,
      durationMinutes: 1,
    });
    expect((await repository.read()).automationBindings[binding.id].nextRunAt).toBe(
      queued.claim.dueWindow
    );
    const promoted = await activationService().claimRun(binding.id, 'due-run', now);
    expect(promoted).toMatchObject({
      replayed: false,
      claim: {
        id: queued.claim.id,
        requestId: queued.claim.requestId,
        dueWindow: queued.claim.dueWindow,
        trigger: 'manual-run',
        status: 'accepted',
      },
      binding: { acceptedRuns: 2, aggregateUsage: { runs: 2 } },
    });
    const staleTick = await activationService().claimRun(binding.id, 'due-run', now);
    expect(staleTick.claim.status).toBe('blocked');
    expect(staleTick.binding.status).toBe('active');
    expect(staleTick.binding.acceptedRuns).toBe(2);
  });

  it('keeps forbid blocked after completion until explicit resume and then accepts new work', async () => {
    const { service, binding } = await activate();
    const first = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(first.claim.id, 'prior-run');
    now = new Date('2026-08-31T14:00:00.000Z');
    expect((await service.claimRun(binding.id, 'due-run', now)).binding.status).toBe('blocked');
    await service.markRunCompleted(first.claim.id, { costUsd: 0, tokens: 0, durationMinutes: 0 });
    const current = (await repository.read()).automationBindings[binding.id];
    expect(current.status).toBe('blocked');
    const resumed = await service.updateBinding(
      binding.id,
      current.revision,
      'active',
      'Operator resumed.'
    );
    if (!resumed.nextRunAt) throw new Error('Expected next run');
    now = new Date(resumed.nextRunAt);
    expect((await activationService().claimRun(binding.id, 'due-run', now)).claim.status).toBe(
      'accepted'
    );
  });

  it('revalidates queued authority instead of dispatching after workflow drift', async () => {
    const input = completeInput();
    input.hints = { ...input.hints, overlapPolicy: 'queue-one' };
    const { service, binding } = await activate(input);
    const first = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(first.claim.id, 'first');
    now = new Date('2026-08-30T15:01:00.000Z');
    const queued = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunCompleted(first.claim.id, { costUsd: 0, tokens: 0, durationMinutes: 0 });
    workflow = { ...workflow, version: workflow.version + 1 };
    const blocked = await activationService().claimRun(binding.id, 'due-run', now);
    expect(blocked).toMatchObject({
      claim: { id: queued.claim.id, status: 'blocked' },
      binding: { status: 'blocked', acceptedRuns: 1 },
    });
  });

  it('retains a ready queued window through pause and resumes it through normal admission', async () => {
    const input = completeInput();
    input.hints = { ...input.hints, overlapPolicy: 'queue-one' };
    const { service, binding } = await activate(input);
    const first = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(first.claim.id, 'first');
    now = new Date('2026-08-30T15:01:00.000Z');
    const queued = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunCompleted(first.claim.id, { costUsd: 0, tokens: 0, durationMinutes: 0 });
    let current = (await repository.read()).automationBindings[binding.id];
    await service.updateBinding(binding.id, current.revision, 'paused', 'Operator paused.');
    expect((await activationService().claimRun(binding.id, 'due-run', now)).claim.status).not.toBe(
      'accepted'
    );
    expect(
      (await repository.read()).automationClaims.find((claim) => claim.id === queued.claim.id)
        ?.status
    ).toBe('queued');
    current = (await repository.read()).automationBindings[binding.id];
    expect(current.status).toBe('blocked');
    await service.updateBinding(binding.id, current.revision, 'active', 'Operator resumed.');
    expect((await activationService().claimRun(binding.id, 'due-run', now)).claim).toMatchObject({
      id: queued.claim.id,
      status: 'accepted',
    });
  });

  it('rejects an expired queued window without accepting another run', async () => {
    const input = completeInput();
    input.hints = { ...input.hints, overlapPolicy: 'queue-one' };
    const { service, binding } = await activate(input);
    const first = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(first.claim.id, 'first');
    now = new Date('2026-08-30T15:01:00.000Z');
    const queued = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunCompleted(first.claim.id, { costUsd: 0, tokens: 0, durationMinutes: 0 });
    now = new Date('2027-01-01T00:00:00.000Z');
    expect(await activationService().claimRun(binding.id, 'due-run', now)).toMatchObject({
      claim: { id: queued.claim.id, status: 'blocked' },
      binding: { status: 'expired', acceptedRuns: 1 },
    });
  });

  it('serializes independent claimers without duplicate ownership', async () => {
    const { service, binding } = await activate();
    repository = new FileSchedulerStateRepository(path.join(root, 'scheduler-state.json'));
    const other = activationService();
    const results = await Promise.allSettled([
      service.claimRun(binding.id, 'manual-run', now),
      other.claimRun(binding.id, 'manual-run', now),
    ]);
    let newOwners = 0;
    for (const result of results) {
      if (result.status === 'rejected')
        expect(String(result.reason)).toContain('binding changed during run admission');
      else if (!result.value.replayed && result.value.claim.status === 'accepted') newOwners++;
    }
    expect(newOwners).toBe(1);
    expect((await repository.read()).automationClaims).toHaveLength(1);
  });

  it('revokes the waiting window and preserves revocation through terminal usage reconciliation', async () => {
    const input = completeInput();
    input.hints = {
      ...input.hints,
      overlapPolicy: 'queue-one',
      aggregateBudget: {
        ...input.hints?.aggregateBudget,
        maxRuns: 20,
        maxTokens: 100_000,
        maxDurationMinutes: 600,
      },
    };
    const { service, binding } = await activate(input);
    const first = await service.claimRun(binding.id, 'manual-run', now);
    await service.markRunStarted(first.claim.id, 'prior-active');
    now = new Date('2026-08-30T15:01:00.000Z');
    const queued = await service.claimRun(binding.id, 'manual-run', now);
    const current = (await repository.read()).automationBindings[binding.id];
    await service.updateBinding(binding.id, current.revision, 'revoked', 'Operator revoked.');
    expect(
      (await repository.read()).automationClaims.find((claim) => claim.id === queued.claim.id)
        ?.status
    ).toBe('blocked');
    await service.markRunCompleted(first.claim.id, {
      costUsd: 0,
      tokens: 100_000,
      durationMinutes: 1,
    });
    now = new Date('2026-08-31T14:00:00.000Z');
    expect((await activationService().claimRun(binding.id, 'due-run', now)).binding.status).toBe(
      'revoked'
    );
    const revoked = (await repository.read()).automationBindings[binding.id];
    await expect(
      service.updateBinding(binding.id, revoked.revision, 'active', 'Resume.')
    ).rejects.toThrow('Revoked automation bindings cannot be resumed');
  });

  it('retains active claims beyond terminal history limits so overlap cannot disappear', async () => {
    const input = completeInput();
    input.hints = { ...input.hints, overlapPolicy: 'queue-one' };
    const { service, binding } = await activate(input);
    const first = await service.claimRun(binding.id, 'manual-run', now);
    now = new Date('2026-08-30T15:01:00.000Z');
    const queued = await service.claimRun(binding.id, 'manual-run', now);
    const pendingFailure = {
      ...first.claim,
      id: `automation_claim_${'f'.repeat(24)}`,
      requestId: 'unreconciled-failure',
      status: 'failed' as const,
      workflowRunId: 'old-workflow',
    };
    await repository.update((state) => ({
      ...state,
      automationClaims: [
        first.claim,
        queued.claim,
        pendingFailure,
        ...Array.from({ length: 1001 }, (_, index) => ({
          ...first.claim,
          id: `automation_claim_${index.toString(16).padStart(24, '0')}`,
          requestId: `history-${index}`,
          status: 'completed' as const,
        })),
      ],
    }));
    repository = new FileSchedulerStateRepository(path.join(root, 'scheduler-state.json'));
    const retained = (await repository.read()).automationClaims;
    expect(retained.map((claim) => claim.id)).toEqual(
      expect.arrayContaining([first.claim.id, queued.claim.id, pendingFailure.id])
    );
    expect(retained).toHaveLength(1003);
    now = new Date('2026-08-30T15:02:00.000Z');
    expect((await activationService().claimRun(binding.id, 'manual-run', now)).claim.status).toBe(
      'skipped'
    );
  });

  function activationService(
    draftService: AutomationDraftService = drafts,
    template: TaskTemplate | null = null
  ): AutomationActivationService {
    return new AutomationActivationService({
      stateRepository: repository,
      drafts: draftService,
      workflows: {
        loadWorkflow: async (id) =>
          id === workflow.id ? workflow : savedWorkflow?.id === id ? savedWorkflow : null,
        saveWorkflow: async (candidate) => {
          savedWorkflow = candidate;
        },
      },
      templates: { getTemplate: async (id) => (template?.id === id ? template : null) },
      approvals: {
        request: async (input) => ({
          ...approval,
          workspaceId: input.workspaceId ?? 'local',
          taskId: input.taskId,
          attemptId: input.attemptId,
          provider: input.provider,
          providerRequestId: input.providerRequestId,
          evidenceRevision: input.evidenceRevision,
        }),
        get: async () => approval,
      },
      integrationEvidence: async (ids) => ids.map((id) => ({ id, ready: id === 'teams-reviewed' })),
      toolPolicyEvidence: async () => ({
        support: { allowed: ['support-read', 'work-product-write'], denied: [] },
      }),
      now: () => now,
    });
  }
});

function workflowFixture(): WorkflowDefinition {
  return {
    id: 'support-triage',
    name: 'Support triage',
    version: 3,
    description: 'Review support queue.',
    agents: [
      {
        id: 'triage-agent',
        name: 'Triage agent',
        role: 'support',
        provider: 'openclaw',
        description: 'Reviews support queue.',
        tools: ['support-read', 'work-product-write'],
      },
    ],
    steps: [
      { id: 'triage', name: 'Triage', type: 'agent', agent: 'triage-agent', input: 'Review.' },
    ],
    variables: {},
  };
}

function taskTemplateFixture(): TaskTemplate {
  return {
    id: 'template_support_triage',
    name: 'Support triage',
    description: 'Produce a bounded support triage report.',
    version: 1,
    taskDefaults: { type: 'automation', priority: 'medium', project: 'support' },
    created: '2026-08-01T00:00:00.000Z',
    updated: '2026-08-01T00:00:00.000Z',
  };
}

function completeInput(): AutomationDraftCompileInput {
  return {
    intent: 'Every weekday at 9 AM review the support queue and produce a triage report.',
    requestId: 'draft-request',
    requestedBy: 'operator-1',
    hints: {
      workspaceId: 'workspace-1',
      sourceTaskId: 'task-source',
      workflowId: 'support-triage',
      provider: 'openclaw',
      timezone: 'America/Chicago',
      expiresAt: '2026-12-31T23:59:59.000Z',
      overlapPolicy: 'forbid',
      retry: { maxAttempts: 2, backoffMinutes: 15 },
      outputDestination: 'work-products/triage',
      expectedDeliverables: ['Triage report'],
      standingScope: {
        reads: ['support-queue'],
        writes: ['work-products/triage'],
        sends: [],
        externalTargets: [],
        artifactDestinations: ['work-products/triage'],
        integrationIds: ['teams-reviewed'],
        toolIds: ['support-read', 'work-product-write'],
        credentialDefinitionIds: [],
        approvalRequiredActions: ['write work product'],
      },
      perRunBudget: { maxRuns: 1, maxTokens: 100_000, maxDurationMinutes: 30 },
      aggregateBudget: { maxRuns: 20, maxTokens: 2_000_000, maxDurationMinutes: 600 },
      stopConditions: ['expiry reached', 'aggregate budget exhausted'],
    },
  };
}

function approvalFixture(): RunApprovalRequest {
  return {
    schemaVersion: 'run-approval/v1',
    id: 'runapproval_Automation123456',
    workspaceId: 'workspace-1',
    taskId: 'task-source',
    attemptId: 'activation-attempt',
    provider: 'openclaw',
    agentId: 'scheduler',
    requestKind: 'approval',
    actionClass: 'workflow',
    action: 'Activate automation',
    actionHash: 'a'.repeat(64),
    resourceScope: [],
    riskClass: 'critical',
    evidenceRevision: `sha256:${'b'.repeat(64)}`,
    providerRequestId: 'activate-stable',
    mobileSafe: false,
    status: 'pending',
    revision: 1,
    createdAt: '2026-08-30T15:00:00.000Z',
    updatedAt: '2026-08-30T15:00:00.000Z',
    expiresAt: '2026-08-30T15:15:00.000Z',
  };
}
