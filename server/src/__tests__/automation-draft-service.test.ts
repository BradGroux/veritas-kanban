import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AutomationDraftCompileInput,
  AutomationDraftStandingScope,
} from '@veritas-kanban/shared';
import { AutomationDraftService } from '../services/automation-draft-service.js';
import { FileSchedulerStateRepository } from '../storage/scheduler-state-repository.js';

describe('AutomationDraftService', () => {
  let root: string;
  let repository: FileSchedulerStateRepository;
  let service: AutomationDraftService;
  const fixedNow = new Date('2026-03-07T20:00:00.000Z');

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-automation-draft-'));
    repository = new FileSchedulerStateRepository(path.join(root, 'scheduler-state.json'));
    service = new AutomationDraftService({
      stateRepository: repository,
      now: () => fixedNow,
      workflowExists: async (id) => id === 'support-triage',
      taskExists: async (id) => id === 'task-source',
      templateExists: async (id) => id === 'known-template',
      integrationReady: async (id) => id === 'teams-reviewed',
      providerSupported: (id) => id === 'codex-app-server',
      listSchedulerItems: async () => [],
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('normalizes natural time deterministically and preserves local time across DST', async () => {
    const draft = await service.preview(completeInput());

    expect(draft.status).toBe('inactive');
    expect(draft.validation.valid).toBe(true);
    expect(draft.schedule.expression).toMatchObject({
      value: '0 9 * * 1-5',
      origin: 'inferred',
      confidence: 'medium',
      status: 'resolved',
    });
    expect(draft.schedule.timezone.value).toBe('America/Chicago');
    expect(draft.schedule.nextRunExamples).toHaveLength(3);
    expect(
      draft.schedule.nextRunExamples.map((value) =>
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Chicago',
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(new Date(value))
      )
    ).toEqual(['09', '09', '09']);
    await expect(repository.read()).resolves.toMatchObject({ drafts: {}, items: {}, events: [] });
  });

  it('keeps ambiguity, unavailable dependencies, unsupported providers, and invalid bounds explicit', async () => {
    const input = completeInput();
    input.intent = 'Run a support triage every day.';
    input.hints = {
      ...input.hints,
      workflowId: 'missing-workflow',
      provider: 'ollama-local',
      timezone: 'Mars/Olympus',
      expiresAt: '2025-01-01T00:00:00.000Z',
      standingScope: {
        ...standingScope(input),
        integrationIds: ['missing-integration'],
      },
      aggregateBudget: { maxRuns: 1, maxTokens: 0 },
    };

    const draft = await service.preview(input);
    const codes = draft.validation.issues.map((issue) => issue.code);

    expect(draft.validation.valid).toBe(false);
    expect(draft.schedule.expression.status).toBe('ambiguous');
    expect(codes).toEqual(
      expect.arrayContaining([
        'field-ambiguous',
        'timezone-invalid',
        'workflow-unavailable',
        'provider-unsupported',
        'integration-unavailable',
        'budget-bound-invalid',
        'invalid-expiry',
      ])
    );
  });

  it('stores immutable revisions and clones without mutating scheduler execution state', async () => {
    const created = await service.save(completeInput());
    const replayed = await service.save(completeInput());
    const revisedInput = completeInput('request-revise');
    revisedInput.hints = { ...revisedInput.hints, outputDestination: 'work-products/triage-v2' };
    const revised = await service.revise(created.id, revisedInput);
    const cloned = await service.clone(created.id, {
      requestId: 'request-clone',
      requestedBy: 'operator-2',
    });

    expect(revised).toMatchObject({ id: created.id, revision: 2, status: 'inactive' });
    expect(replayed).toEqual(created);
    expect((await service.get(created.id, 1)).output.destination.value).toBe(
      'work-products/triage'
    );
    expect(cloned.id).not.toBe(created.id);
    expect(cloned.status).toBe('inactive');
    const state = await repository.read();
    expect(state.items).toEqual({});
    expect(state.events).toEqual([]);
    expect(state.drafts[created.id]).toHaveLength(2);

    await expect(service.delete(created.id)).resolves.toEqual({
      deleted: true,
      revisionsDeleted: 2,
    });
    await expect(service.get(created.id)).rejects.toThrow(/not found/i);
  });

  it('rejects request ID reuse with changed input', async () => {
    await service.save(completeInput('stable-request'));
    const changed = completeInput('stable-request');
    changed.hints = { ...changed.hints, outputDestination: 'work-products/changed' };

    await expect(service.save(changed)).rejects.toThrow(/reused with different input/i);
  });

  it('redacts secrets and URL credentials from export-safe drafts', async () => {
    const input = completeInput();
    input.intent =
      'Every weekday at 9 AM use token=raw-secret and report to https://user:pass@example.com/hook?token=secret#private';
    input.hints = {
      ...input.hints,
      standingScope: {
        ...standingScope(input),
        externalTargets: ['https://user:pass@example.com/hook?token=secret#private'],
      },
    };

    const draft = await service.preview(input);
    const serialized = JSON.stringify(draft);

    expect(draft.redaction.safeToExport).toBe(true);
    expect(draft.redaction.removedFields).toEqual(
      expect.arrayContaining(['intent', 'hints.standingScope.externalTargets'])
    );
    expect(serialized).not.toContain('raw-secret');
    expect(serialized).not.toContain('user:pass');
    expect(serialized).not.toContain('?token=secret');
  });

  it('reports duplicate inactive definitions instead of silently saving overlapping authority', async () => {
    await service.save(completeInput('first-request'));
    const overlap = await service.preview(completeInput('second-request'));

    expect(overlap.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'draft-overlap', severity: 'blocker' }),
      ])
    );
  });

  it('bounds examples to the active window and requires one execution per run', async () => {
    const input = completeInput();
    input.hints = {
      ...input.hints,
      startAt: '2026-03-10T00:00:00.000Z',
      expiresAt: '2026-03-11T12:00:00.000Z',
      perRunBudget: {
        maxRuns: 2,
        maxCostUsd: 5,
        maxTokens: 100_000,
        maxDurationMinutes: 30,
      },
    };

    const draft = await service.preview(input);

    expect(draft.schedule.nextRunExamples).toEqual(['2026-03-10T14:00:00.000Z']);
    expect(draft.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'cron-no-future-runs' }),
        expect.objectContaining({ code: 'per-run-count-invalid' }),
      ])
    );
  });
});

function completeInput(requestId = 'request-preview'): AutomationDraftCompileInput {
  return {
    intent: 'Every weekday at 9 AM review the support queue and produce a triage report.',
    requestId,
    requestedBy: 'operator-1',
    hints: {
      workspaceId: 'workspace-1',
      sourceTaskId: 'task-source',
      workflowId: 'support-triage',
      provider: 'codex-app-server',
      timezone: 'America/Chicago',
      expiresAt: '2026-12-31T23:59:59.000Z',
      overlapPolicy: 'forbid',
      retry: { maxAttempts: 2, backoffMinutes: 15 },
      outputDestination: 'work-products/triage',
      expectedDeliverables: ['Triage report', 'Escalation checklist'],
      standingScope: {
        reads: ['support-queue'],
        writes: ['work-products/triage'],
        sends: [],
        externalTargets: [],
        artifactDestinations: ['work-products/triage'],
        integrationIds: ['teams-reviewed'],
        toolIds: ['support-read', 'work-product-write'],
        credentialDefinitionIds: ['teams-definition'],
        approvalRequiredActions: ['write work product'],
      },
      perRunBudget: {
        maxRuns: 1,
        maxCostUsd: 5,
        maxTokens: 100_000,
        maxDurationMinutes: 30,
      },
      aggregateBudget: {
        maxRuns: 20,
        maxCostUsd: 100,
        maxTokens: 2_000_000,
        maxDurationMinutes: 600,
      },
      stopConditions: [
        'expiry reached',
        'aggregate budget exhausted',
        'three consecutive failures',
      ],
    },
  };
}

function standingScope(input: AutomationDraftCompileInput): AutomationDraftStandingScope {
  const scope = input.hints?.standingScope;
  if (!scope) throw new Error('Complete test input requires standing scope.');
  return scope;
}
