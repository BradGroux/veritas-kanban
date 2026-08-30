import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AutomationDraftCompileInput,
  RunApprovalRequest,
  TaskTemplate,
  WorkflowDefinition,
} from '@veritas-kanban/shared';
import { AutomationActivationService } from '../services/automation-activation-service.js';
import { AutomationDraftService } from '../services/automation-draft-service.js';
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
