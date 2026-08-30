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
  useAutomationDrafts: () => ({ data: { drafts: [] } }),
  useAutomationDraftPreview: () => ({ mutateAsync: mocks.preview, isPending: false }),
  useAutomationDraftSave: () => ({ mutateAsync: mocks.save, isPending: false }),
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows exact preview blockers without activating scheduler work', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SchedulerTab />);

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

function resolved<T>(value: T) {
  return {
    value,
    origin: 'explicit' as const,
    status: 'resolved' as const,
    confidence: 'high' as const,
    explanation: 'Explicit.',
  };
}

function missing(explanation: string) {
  return {
    origin: 'unresolved' as const,
    status: 'missing' as const,
    confidence: 'none' as const,
    explanation,
  };
}
