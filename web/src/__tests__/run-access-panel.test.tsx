import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunAccessSummary } from '@veritas-kanban/shared';
import { createMockTask, renderWithProviders } from './test-utils';

const { mockApplyMutate, mockPreviewMutate, mockUseAgentAccess } = vi.hoisted(() => ({
  mockApplyMutate: vi.fn(),
  mockPreviewMutate: vi.fn(),
  mockUseAgentAccess: vi.fn(),
}));

vi.mock('@/hooks/useAgent', () => ({
  useAgentAccess: mockUseAgentAccess,
  useApplyRunAccessChange: () => ({ mutate: mockApplyMutate, isPending: false, error: null }),
  usePreviewRunAccessChange: () => ({ mutate: mockPreviewMutate, isPending: false, error: null }),
}));

import { RunAccessPanel } from '@/components/task/RunAccessPanel';
import { RunAccessSection } from '@/components/task/RunAccessSection';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('RunAccessPanel', () => {
  it('keeps access reachable before an attempt creates evidence', () => {
    renderWithProviders(<RunAccessSection task={createMockTask({ attempt: undefined })} />);

    expect(
      screen.getByText('Access evidence becomes available after an execution attempt starts.')
    ).toBeDefined();
    expect(mockUseAgentAccess).not.toHaveBeenCalled();
  });

  it('renders the shared current contract with blockers and source evidence', async () => {
    const user = userEvent.setup();
    const current = summaryFixture({
      status: 'incomplete',
      blockers: [{ code: 'missing-tool-catalog', message: 'Required catalog is unavailable.' }],
    });
    mockUseAgentAccess.mockReturnValue({
      data: { current, history: [] },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<RunAccessPanel taskId="task-access" attemptId="attempt-access" live />);

    const panel = screen.getByLabelText('Run Access');
    expect(within(panel).getByText('Access: incomplete')).toBeDefined();
    expect(within(panel).getByText('Phase: plan')).toBeDefined();
    expect(within(panel).getByText('workspace-write · 1 scope')).toBeDefined();
    expect(within(panel).getByText('disabled · supported')).toBeDefined();
    expect(within(panel).getByLabelText('Run access blockers').textContent).toContain(
      'missing-tool-catalog'
    );
    expect(mockUseAgentAccess).toHaveBeenCalledWith('task-access', 'attempt-access', true);

    await user.click(within(panel).getByRole('button', { name: 'Diagnostics: evidence sources' }));
    expect(within(panel).getByText(/run-launch-manifest/)).toBeDefined();
    expect(within(panel).getByText('verified')).toBeDefined();
  });

  it('lets operators inspect a prior immutable phase version', async () => {
    const user = userEvent.setup();
    const current = summaryFixture({ sequence: 1, networkPolicy: 'allowlist' });
    const prior = summaryFixture({ sequence: 0, networkPolicy: 'disabled' });
    mockUseAgentAccess.mockReturnValue({
      data: { current, history: [prior] },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<RunAccessPanel taskId="task-access" attemptId="attempt-access" />);

    expect(screen.getByText('allowlist · supported')).toBeDefined();
    await user.click(screen.getByRole('combobox', { name: 'Access version' }));
    await user.click(screen.getByRole('option', { name: 'Prior · #0' }));
    expect(screen.getByText('disabled · supported')).toBeDefined();
    expect(screen.getByText(/sequence 0/)).toBeDefined();
  });

  it('previews and applies the exact reviewed access revision', async () => {
    const user = userEvent.setup();
    const current = summaryFixture();
    const preview = {
      schemaVersion: 'run-access-change-preview/v1' as const,
      requestRevision: `sha256:${'a'.repeat(64)}`,
      taskId: 'task-access',
      attemptId: 'attempt-access',
      requestId: 'access-change-1',
      operation: 'transition-phase' as const,
      targetPhase: 'verify' as const,
      reason: 'Verify the active run.',
      expectedAccessSummaryDigest: current.digest,
      expectedSequence: 0,
      expectedPhaseEvidenceDigest: current.identity.phaseEvidenceDigest as string,
      expectedManifestDigest: current.identity.launchManifestDigest as string,
      targetEvidence: {} as never,
      authorityDelta: {
        classification: 'narrowing' as const,
        entries: [
          { dimension: 'credential.access' as const, addedScopes: [], removedScopes: ['*'] },
        ],
      },
      affectedTools: [],
      affectedIntegrations: [],
      budgetImpact: {
        classification: 'unchanged' as const,
        before: current.budgets,
        after: current.budgets,
      },
      approval: { required: false, class: 'none' as const },
      enforcement: {
        state: 'ready' as const,
        provider: 'acp-stdio',
        safeBoundary: 'active-run' as const,
        requiresRelaunch: false,
        blockers: [],
      },
    };
    mockUseAgentAccess.mockReturnValue({
      data: { current, history: [] },
      isLoading: false,
      error: null,
    });
    mockPreviewMutate.mockImplementation((_variables, callbacks) => callbacks.onSuccess(preview));

    renderWithProviders(<RunAccessPanel taskId="task-access" attemptId="attempt-access" live />);

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Verify the active run.');
    await user.click(screen.getByRole('button', { name: 'Preview change' }));
    expect(mockPreviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-access',
        request: expect.objectContaining({
          attemptId: 'attempt-access',
          operation: 'transition-phase',
          targetPhase: 'verify',
          expectedAccessSummaryDigest: current.digest,
          expectedSequence: 0,
        }),
      }),
      expect.any(Object)
    );
    expect(screen.getByText('Reviewed narrowing change')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Apply reviewed change' }));
    expect(mockApplyMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ requestRevision: preview.requestRevision }),
      }),
      expect.any(Object)
    );
  });
});

function summaryFixture(
  options: {
    status?: RunAccessSummary['status'];
    sequence?: number;
    networkPolicy?: RunAccessSummary['network']['policy'];
    blockers?: RunAccessSummary['blockers'];
  } = {}
): RunAccessSummary {
  const sequence = options.sequence ?? 0;
  const digest = `sha256:${String(sequence + 1).repeat(64)}`;
  const source = { kind: 'run-launch-manifest' as const, digest, field: '$' };
  return {
    schemaVersion: 'run-access-summary/v1',
    digest,
    status: options.status ?? 'complete',
    generatedAt: '2026-08-30T08:00:00.000Z',
    version: {
      kind: sequence === 0 ? 'launch' : 'transition',
      sequence,
      immutableEvidenceDigest: digest,
    },
    identity: {
      taskId: 'task-access',
      runId: 'attempt-access',
      attemptId: 'attempt-access',
      launchManifestDigest: digest,
      phaseEvidenceDigest: digest,
      transitionSequence: sequence,
      phase: {
        mode: 'profile',
        phase: sequence === 0 ? 'plan' : 'implement',
        profileId: 'built-in',
        profileVersion: 1,
      },
      provider: 'codex-cli',
      adapter: 'codex-cli',
      selectedHost: 'local-process',
      sources: [source],
    },
    filesystem: {
      sandboxMode: 'workspace-write',
      targets: [
        {
          label: 'Task workspace',
          access: 'write',
          scope: 'workspace',
          pathDigest: digest,
          enforceability: 'enforced',
          source,
        },
      ],
      artifactOutput: { allowed: true, label: 'Run artifacts', enforceability: 'enforced', source },
      source,
    },
    network: {
      enabled: options.networkPolicy !== 'disabled',
      policy: options.networkPolicy ?? 'disabled',
      externalTargets: [],
      approvalRequired: false,
      enforceability: 'supported',
      source,
    },
    tools: [
      {
        server: 'workspace',
        name: 'read_file',
        qualifiedName: 'workspace.read_file',
        decision: 'allow',
        availability: 'ready',
        requirement: 'required',
        enforceability: 'enforced',
        source,
      },
    ],
    integrations: [],
    approvals: { requiredDimensions: [], toolCount: 0, integrationCount: 0, source },
    budgets: {
      policy: null,
      usage: null,
      capacity: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 256 },
      concurrencyPolicies: [],
      reservationState: 'active',
      source,
    },
    support: { tier: 'configured', enforceable: true, degraded: false, blockers: [], source },
    sources: [
      {
        kind: 'run-launch-manifest',
        schemaVersion: 'run-launch-manifest/v1',
        recordId: 'attempt-access',
        digest,
        state: 'verified',
      },
    ],
    blockers: options.blockers ?? [],
  };
}
