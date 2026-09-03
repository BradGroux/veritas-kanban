import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationDraft } from '@veritas-kanban/shared';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  toast: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  previewActivation: vi.fn(),
  applyActivation: vi.fn(),
  drafts: [] as AutomationDraft[],
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/hooks/useScheduler', () => ({
  useScheduler: () => ({
    isLoading: false,
    data: {
      summary: { total: 0, enabled: 0, paused: 0, due: 0, failed: 0, blocked: 0 },
      items: [],
      recentEvents: [],
    },
    refetch: vi.fn(),
  }),
  useAutomationDrafts: () => ({ data: { drafts: mocks.drafts } }),
  useAutomationDraftPreview: () => ({ mutateAsync: mocks.preview, isPending: false }),
  useAutomationDraftSave: () => ({ mutateAsync: mocks.save, isPending: false }),
  useAutomationActivationPreview: () => ({
    mutateAsync: mocks.previewActivation,
    isPending: false,
  }),
  useAutomationActivationApply: () => ({
    mutateAsync: mocks.applyActivation,
    isPending: false,
  }),
  useSchedulerRunDue: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSchedulerRunItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSchedulerPause: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSchedulerResume: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSchedulerValidate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SchedulerTab } from '@/components/settings/tabs/SchedulerTab';

describe('Scheduler automation draft authoring', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
    mocks.preview.mockResolvedValue(draftFixture());
    mocks.save.mockResolvedValue(draftFixture());
    mocks.drafts.splice(0);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows exact preview blockers without activating scheduler work', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<SchedulerTab />);

    expect(screen.getByRole('heading', { name: 'Scheduler' })).toBeDefined();
    expect(container.querySelectorAll('[data-settings-section]')).toHaveLength(1);
    await user.type(
      screen.getByRole('textbox', { name: 'Recurring objective' }),
      'Every weekday at 9 AM create a report'
    );
    const hints = screen.getByRole('textbox', { name: 'Structured hints (JSON)' });
    fireEvent.change(hints, { target: { value: '{"timezone":"America/Chicago"}' } });
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(mocks.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'Every weekday at 9 AM create a report',
        hints: { timezone: 'America/Chicago' },
      })
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(await screen.findByText(/execution\.workflowId: Select a workflow/)).toBeDefined();
    expect(screen.getAllByText(/inactive/).length).toBeGreaterThanOrEqual(2);
  });

  it('reviews standing Run Access before requesting exact approval', async () => {
    const draft = activatableDraftFixture();
    mocks.drafts.push(draft);
    mocks.previewActivation.mockResolvedValue(activationPreviewFixture(draft));
    mocks.applyActivation.mockResolvedValue({
      preview: activationPreviewFixture(draft),
      approvalId: 'runapproval_Automation123456',
      approvalStatus: 'pending',
    });
    const user = userEvent.setup();
    renderWithProviders(<SchedulerTab />);

    await user.click(screen.getByRole('button', { name: 'Review Activation' }));
    expect(mocks.previewActivation).toHaveBeenCalledWith({
      draftId: draft.id,
      revision: draft.revision,
      requestId: `activation-ui-${draft.id}-${draft.revision}`,
    });
    expect(await screen.findByText(/Run Access ceiling: 2 tools/)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Request Exact Approval' }));
    expect(mocks.applyActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: draft.id,
        expectedRequestRevision: `sha256:${'c'.repeat(64)}`,
      })
    );
    expect(await screen.findByText(/Approve runapproval_Automation123456/)).toBeDefined();
  });
});

function draftFixture(): AutomationDraft {
  return {
    schemaVersion: 'automation-draft/v1',
    id: 'automation_preview',
    revision: 1,
    status: 'inactive',
    objective: resolved('Every weekday at 9 AM create a report'),
    source: {
      workspaceId: resolved('local'),
      taskId: missing('Source task is optional.'),
      proposingRunId: missing('Proposing run is optional.'),
    },
    execution: {
      workflowId: missing('Select a workflow or task template.'),
      taskTemplateId: missing('Select a task template or workflow.'),
      provider: missing('Provider is required.'),
    },
    schedule: {
      expression: resolved('0 9 * * 1-5'),
      timezone: resolved('America/Chicago'),
      startAt: missing('Start is optional.'),
      expiresAt: missing('Expiry is required.'),
      overlapPolicy: missing('Overlap policy is required.'),
      retry: missing('Retry is required.'),
      nextRunExamples: ['2026-09-01T14:00:00.000Z'],
    },
    output: {
      destination: missing('Output is required.'),
      expectedDeliverables: missing('Deliverables are required.'),
    },
    standingScope: missing('Scope is required.'),
    perRunBudget: missing('Budget is required.'),
    aggregateBudget: missing('Budget is required.'),
    stopConditions: missing('Stop conditions are required.'),
    validation: {
      valid: false,
      issues: [
        {
          severity: 'blocker',
          code: 'field-missing',
          path: 'execution.workflowId',
          message: 'Select a workflow or task template.',
          remediation: 'Resolve this field before activation.',
        },
      ],
    },
    redaction: { safeToExport: true, removedFields: [] },
    requestedBy: 'operator',
    requestId: 'request-1',
    inputDigest: `scrypt:${'b'.repeat(64)}`,
    createdAt: '2026-09-01T00:00:00.000Z',
    digest: `scrypt:${'a'.repeat(64)}`,
  };
}

function activatableDraftFixture(): AutomationDraft {
  const draft = draftFixture();
  return {
    ...draft,
    id: 'automation_aaaaaaaaaaaaaaaaaaaaaaaa',
    execution: {
      workflowId: resolved('support-triage'),
      taskTemplateId: missing('No template.'),
      provider: resolved('openclaw'),
    },
    schedule: {
      ...draft.schedule,
      expiresAt: resolved('2026-12-31T23:59:59.000Z'),
      overlapPolicy: resolved('forbid' as const),
      retry: resolved({ maxAttempts: 2, backoffMinutes: 15 }),
    },
    output: {
      destination: resolved('work-products/triage'),
      expectedDeliverables: resolved(['Triage report']),
    },
    standingScope: resolved({
      reads: ['support-queue'],
      writes: ['work-products/triage'],
      sends: [],
      externalTargets: [],
      artifactDestinations: ['work-products/triage'],
      integrationIds: ['teams-reviewed'],
      toolIds: ['support-read', 'work-product-write'],
      credentialDefinitionIds: [],
      approvalRequiredActions: ['write work product'],
    }),
    perRunBudget: resolved({ maxRuns: 1, maxTokens: 100_000 }),
    aggregateBudget: resolved({ maxRuns: 20, maxTokens: 2_000_000 }),
    stopConditions: resolved(['expiry reached']),
    validation: { valid: true, issues: [] },
  };
}

function activationPreviewFixture(draft: AutomationDraft) {
  return {
    schemaVersion: 'automation-activation-preview/v1' as const,
    draftId: draft.id,
    draftRevision: draft.revision,
    draftDigest: draft.digest,
    requestId: `activation-ui-${draft.id}-${draft.revision}`,
    requestRevision: `sha256:${'c'.repeat(64)}`,
    workspaceId: 'local',
    objective: draft.objective.value ?? 'Triage',
    schedule: {
      expression: '0 9 * * 1-5',
      timezone: 'America/Chicago',
      expiresAt: '2026-12-31T23:59:59.000Z',
      overlapPolicy: 'forbid' as const,
      retry: { maxAttempts: 2, backoffMinutes: 15 },
    },
    output: { destination: 'work-products/triage', expectedDeliverables: ['Triage report'] },
    standingScope: requiredValue(draft.standingScope.value),
    perRunBudget: requiredValue(draft.perRunBudget.value),
    aggregateBudget: requiredValue(draft.aggregateBudget.value),
    stopConditions: requiredValue(draft.stopConditions.value),
    effectiveRunAccess: {
      reads: ['support-queue'],
      writes: ['work-products/triage'],
      sends: [],
      externalTargets: [],
      artifactDestinations: ['work-products/triage'],
      tools: ['support-read', 'work-product-write'],
      integrations: ['teams-reviewed'],
      approvalRequiredActions: ['write work product'],
    },
    evidence: {
      sourceTarget: {
        kind: 'workflow' as const,
        id: 'support-triage',
        version: 3,
        digest: `sha256:${'d'.repeat(64)}`,
      },
      workflowId: 'support-triage',
      workflowVersion: 3,
      workflowDigest: `sha256:${'d'.repeat(64)}`,
      provider: 'openclaw',
      providerEvidenceDigest: `sha256:${'e'.repeat(64)}`,
      toolCatalogDigest: `sha256:${'f'.repeat(64)}`,
      integrationEvidenceDigest: `sha256:${'1'.repeat(64)}`,
      policyDigest: `sha256:${'2'.repeat(64)}`,
      enforceable: true,
      blockers: [],
    },
    approval: { required: true as const, riskClass: 'critical' as const, expiresInMs: 900_000 },
  };
}

function resolved<T>(value: T) {
  return {
    value,
    origin: 'explicit' as const,
    status: 'resolved' as const,
    confidence: 'high' as const,
    explanation: 'Explicit.',
  };
}

function requiredValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected resolved fixture value.');
  return value;
}

function missing(explanation: string) {
  return {
    origin: 'unresolved' as const,
    status: 'missing' as const,
    confidence: 'none' as const,
    explanation,
  };
}
