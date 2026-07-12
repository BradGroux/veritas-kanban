import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DecisionDetail } from '@/components/decisions/DecisionDetail';
import { DecisionExplorer } from '@/components/decisions/DecisionExplorer';
import { DriftMonitor } from '@/components/drift/DriftMonitor';
import { FeedbackPanel } from '@/components/feedback/FeedbackPanel';
import { PolicyManager } from '@/components/policies/PolicyManager';
import { ScoringProfiles } from '@/components/scoring/ScoringProfiles';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  acknowledgeDriftAlert: vi.fn(),
  analyzeDrift: vi.fn(),
  createFeedback: vi.fn(),
  createPolicy: vi.fn(),
  createScoringProfile: vi.fn(),
  deleteFeedback: vi.fn(),
  deletePolicy: vi.fn(),
  deleteScoringProfile: vi.fn(),
  evaluatePolicies: vi.fn(),
  resolveFeedback: vi.fn(),
  resetDriftBaselines: vi.fn(),
  runEvaluation: vi.fn(),
  updateDecisionAssumption: vi.fn(),
  updatePolicy: vi.fn(),
  updateScoringProfile: vi.fn(),
  useDecision: vi.fn(),
  useDecisions: vi.fn(),
  useGovernanceTrace: vi.fn(),
  useGovernanceTraces: vi.fn(),
  useDriftAlerts: vi.fn(),
  useDriftBaselines: vi.fn(),
  useFeedbackAnalytics: vi.fn(),
  useFeedbackList: vi.fn(),
  usePolicies: vi.fn(),
  useScoringHistory: vi.fn(),
  useScoringProfiles: vi.fn(),
  useUnresolvedFeedback: vi.fn(),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/usePolicies', () => ({
  usePolicies: mocks.usePolicies,
  useCreatePolicy: () => ({ mutateAsync: mocks.createPolicy, isPending: false }),
  useUpdatePolicy: () => ({ mutateAsync: mocks.updatePolicy, isPending: false }),
  useDeletePolicy: () => ({ mutateAsync: mocks.deletePolicy, isPending: false }),
  useEvaluatePolicies: () => ({
    data: {
      decision: 'warn',
      matches: [
        {
          policyId: 'risk-prod',
          policyName: 'Production risk gate',
          policyType: 'risk-threshold',
          responseAction: 'warn',
          message: 'Risk exceeds warning threshold.',
        },
      ],
      warnings: [],
      blockedBy: [],
      approvalRequiredBy: [],
    },
    mutateAsync: mocks.evaluatePolicies,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useDrift', () => ({
  useAcknowledgeDriftAlert: () => ({
    mutate: mocks.acknowledgeDriftAlert,
    variables: undefined,
    isPending: false,
  }),
  useAnalyzeDrift: () => ({ mutate: mocks.analyzeDrift, isPending: false }),
  useDriftAlerts: mocks.useDriftAlerts,
  useDriftBaselines: mocks.useDriftBaselines,
  useResetDriftBaselines: () => ({ mutate: mocks.resetDriftBaselines, isPending: false }),
}));

vi.mock('@/hooks/useScoring', () => ({
  useCreateScoringProfile: () => ({ mutateAsync: mocks.createScoringProfile, isPending: false }),
  useDeleteScoringProfile: () => ({ mutateAsync: mocks.deleteScoringProfile, isPending: false }),
  useRunEvaluation: () => ({
    data: {
      id: 'eval-1',
      profileId: 'quality',
      profileName: 'Quality',
      output: 'Verified result',
      scores: [
        {
          scorerId: 'keyword',
          scorerName: 'Keyword check',
          scorerType: 'KeywordContains',
          weight: 1,
          score: 0.9,
          matched: true,
          explanation: 'Matched verified.',
        },
      ],
      compositeScore: 0.9,
      created: '2026-06-01T12:00:00.000Z',
    },
    mutateAsync: mocks.runEvaluation,
    isPending: false,
  }),
  useScoringHistory: mocks.useScoringHistory,
  useScoringProfiles: mocks.useScoringProfiles,
  useUpdateScoringProfile: () => ({ mutateAsync: mocks.updateScoringProfile, isPending: false }),
}));

vi.mock('@/hooks/useDecisions', () => ({
  useDecision: mocks.useDecision,
  useDecisions: mocks.useDecisions,
  useUpdateDecisionAssumption: () => ({
    mutateAsync: mocks.updateDecisionAssumption,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useGovernanceTraces', () => ({
  useGovernanceTrace: mocks.useGovernanceTrace,
  useGovernanceTraces: mocks.useGovernanceTraces,
}));

vi.mock('@/hooks/useFeedback', () => ({
  useCreateFeedback: () => ({ mutateAsync: mocks.createFeedback, isPending: false }),
  useDeleteFeedback: () => ({ mutateAsync: mocks.deleteFeedback, isPending: false }),
  useFeedbackAnalytics: mocks.useFeedbackAnalytics,
  useFeedbackList: mocks.useFeedbackList,
  useResolveFeedback: () => ({ mutateAsync: mocks.resolveFeedback, isPending: false }),
  useUnresolvedFeedback: mocks.useUnresolvedFeedback,
}));

function expectNoLegacySlots(root: ParentNode) {
  expect(root.querySelector('[data-slot="input"]')).toBeNull();
  expect(root.querySelector('[data-slot="select-trigger"]')).toBeNull();
  expect(root.querySelector('[data-slot="tabs-list"]')).toBeNull();
  expect(root.querySelector('[data-slot="dialog-content"]')).toBeNull();
}

describe('governance surfaces Mantine migration', () => {
  const now = '2026-06-01T12:00:00.000Z';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPolicy.mockResolvedValue({});
    mocks.updatePolicy.mockResolvedValue({});
    mocks.deletePolicy.mockResolvedValue({});
    mocks.evaluatePolicies.mockResolvedValue({});
    mocks.createScoringProfile.mockResolvedValue({ id: 'quality' });
    mocks.updateScoringProfile.mockResolvedValue({ id: 'quality' });
    mocks.deleteScoringProfile.mockResolvedValue({});
    mocks.runEvaluation.mockResolvedValue({});
    mocks.createFeedback.mockResolvedValue({});
    mocks.deleteFeedback.mockResolvedValue({});
    mocks.resolveFeedback.mockResolvedValue({});
    mocks.updateDecisionAssumption.mockResolvedValue({});

    mocks.usePolicies.mockReturnValue({
      data: [
        {
          id: 'risk-prod',
          name: 'Production risk gate',
          type: 'risk-threshold',
          enabled: true,
          scope: { agents: ['codex'], projects: ['core'], actionTypes: ['git.push'] },
          responseAction: 'warn',
          config: { threshold: 70, comparator: 'gte' },
          description: 'Warns on elevated production risk.',
          preset: 'balanced',
          createdAt: now,
        },
      ],
      isLoading: false,
    });
    mocks.useDriftAlerts.mockReturnValue({
      data: [
        {
          id: 'drift-1',
          agentId: 'codex',
          metric: 'risk_score',
          currentValue: 82,
          baselineValue: 45,
          zScore: 3.2,
          severity: 'critical',
          timestamp: now,
          acknowledged: false,
        },
      ],
      isLoading: false,
    });
    mocks.useDriftBaselines.mockReturnValue({
      data: [
        {
          agentId: 'codex',
          metric: 'risk_score',
          mean: 45,
          stdDev: 8,
          sampleCount: 20,
          windowStart: '2026-05-01T00:00:00.000Z',
          windowEnd: now,
        },
      ],
      isLoading: false,
    });
    mocks.useScoringProfiles.mockReturnValue({
      data: [
        {
          id: 'quality',
          name: 'Quality',
          description: 'Checks verification language.',
          compositeMethod: 'weightedAvg',
          builtIn: false,
          created: now,
          updated: now,
          scorers: [
            {
              id: 'keyword',
              name: 'Keyword check',
              type: 'KeywordContains',
              keywords: ['verified'],
              weight: 1,
              target: 'output',
            },
          ],
        },
      ],
      isLoading: false,
    });
    mocks.useScoringHistory.mockReturnValue({
      data: [
        {
          id: 'eval-1',
          profileId: 'quality',
          profileName: 'Quality',
          output: 'Verified result',
          agent: 'codex',
          taskId: 'task-1',
          scores: [
            {
              scorerId: 'keyword',
              scorerName: 'Keyword check',
              scorerType: 'KeywordContains',
              weight: 1,
              score: 0.9,
              matched: true,
              explanation: 'Matched verified.',
            },
          ],
          compositeScore: 0.9,
          created: now,
        },
      ],
      isLoading: false,
    });
    mocks.useDecisions.mockReturnValue({
      data: [
        {
          id: 'decision-1',
          inputContext: 'Deploy request',
          outputAction: 'Review production deploy',
          assumptions: [{ text: 'Tests passed', status: 'pending' }],
          confidenceLevel: 88,
          riskScore: 76,
          agentId: 'codex',
          taskId: 'task-1',
          timestamp: now,
        },
      ],
      isLoading: false,
    });
    mocks.useDecision.mockReturnValue({
      data: {
        decision: {
          id: 'decision-1',
          inputContext: 'Deploy request',
          outputAction: 'Review production deploy',
          assumptions: [{ text: 'Tests passed', status: 'pending' }],
          confidenceLevel: 88,
          riskScore: 76,
          agentId: 'codex',
          taskId: 'task-1',
          timestamp: now,
        },
        chain: [
          {
            id: 'decision-1',
            inputContext: 'Deploy request',
            outputAction: 'Review production deploy',
            assumptions: [{ text: 'Tests passed', status: 'pending' }],
            confidenceLevel: 88,
            riskScore: 76,
            agentId: 'codex',
            taskId: 'task-1',
            timestamp: now,
          },
        ],
      },
      isLoading: false,
    });
    mocks.useGovernanceTraces.mockReturnValue({
      data: [
        {
          id: 'govtrace-1',
          kind: 'policy',
          outcome: 'blocked',
          title: 'Production policy block',
          summary: 'Production deploy requires approval.',
          remediation: 'Request approval from a lead agent.',
          subject: {
            agentId: 'codex',
            taskId: 'task-1',
            actionType: 'git.push',
          },
          evaluatedRules: [
            {
              id: 'policy:risk-prod',
              label: 'Production risk gate',
              type: 'policy',
              status: 'matched',
              outcome: 'blocked',
              message: 'Risk gate matched.',
            },
          ],
          matchedRules: [
            {
              id: 'policy:risk-prod',
              label: 'Production risk gate',
              type: 'policy',
              status: 'matched',
              outcome: 'blocked',
              message: 'Risk gate matched.',
            },
          ],
          steps: [
            {
              id: 'condition',
              label: 'Condition',
              status: 'matched',
              message: 'Action matched git.push.',
            },
          ],
          raw: { actionType: 'git.push' },
          redacted: true,
          createdAt: now,
        },
      ],
      isLoading: false,
    });
    mocks.useGovernanceTrace.mockReturnValue({
      data: {
        id: 'govtrace-1',
        kind: 'policy',
        outcome: 'blocked',
        title: 'Production policy block',
        summary: 'Production deploy requires approval.',
        remediation: 'Request approval from a lead agent.',
        subject: {
          agentId: 'codex',
          taskId: 'task-1',
          actionType: 'git.push',
        },
        evaluatedRules: [
          {
            id: 'policy:risk-prod',
            label: 'Production risk gate',
            type: 'policy',
            status: 'matched',
            outcome: 'blocked',
            message: 'Risk gate matched.',
          },
        ],
        matchedRules: [
          {
            id: 'policy:risk-prod',
            label: 'Production risk gate',
            type: 'policy',
            status: 'matched',
            outcome: 'blocked',
            message: 'Risk gate matched.',
          },
        ],
        steps: [
          {
            id: 'condition',
            label: 'Condition',
            status: 'matched',
            message: 'Action matched git.push.',
          },
        ],
        raw: { actionType: 'git.push' },
        redacted: true,
        createdAt: now,
      },
      isLoading: false,
    });
    mocks.useFeedbackList.mockReturnValue({
      data: [
        {
          id: 'feedback-1',
          taskId: 'task-1',
          agent: 'codex',
          rating: 5,
          comment: 'Helpful result.',
          categories: ['quality'],
          sentiment: 'positive',
          resolved: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      isLoading: false,
    });
    mocks.useFeedbackAnalytics.mockReturnValue({
      data: {
        totalFeedback: 1,
        averageRating: 5,
        ratingDistribution: [{ star: 5, count: 1, percentage: 100 }],
        satisfactionTrends: [{ date: '2026-06-01', averageRating: 5, count: 1 }],
        agentScores: [
          {
            agent: 'codex',
            averageRating: 5,
            totalFeedback: 1,
            sentimentBreakdown: { positive: 1, neutral: 0, negative: 0 },
          },
        ],
        sentimentBreakdown: { positive: 1, neutral: 0, negative: 0 },
        categoryBreakdown: { quality: 1, performance: 0, accuracy: 0, safety: 0, ux: 0 },
        unresolvedCount: 1,
      },
      isLoading: false,
    });
    mocks.useUnresolvedFeedback.mockReturnValue({
      data: [
        {
          id: 'feedback-1',
          taskId: 'task-1',
          rating: 5,
          categories: ['quality'],
          sentiment: 'positive',
          resolved: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders policy management with Mantine forms, badges, switches, and modal chrome', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderWithProviders(<PolicyManager onBack={vi.fn()} />);

    expect(screen.getByText('Agent Policies')).toBeDefined();
    expect(baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Switch-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Badge-root')).toBeDefined();

    await user.click(screen.getByRole('button', { name: /new policy/i }));

    expect((await screen.findAllByText('Create Policy')).length).toBeGreaterThanOrEqual(1);
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Select-root')).toBeDefined();
    expectNoLegacySlots(baseElement);
  });

  it('renders drift and decision audit surfaces with direct Mantine primitives', async () => {
    const user = userEvent.setup();
    const drift = renderWithProviders(<DriftMonitor onBack={vi.fn()} />);

    expect(screen.getByText('Behavioral Drift Monitor')).toBeDefined();
    expect(drift.baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(drift.baseElement.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(drift.baseElement.querySelector('.mantine-Button-root')).toBeDefined();
    expectNoLegacySlots(drift.baseElement);
    cleanup();

    const decisions = renderWithProviders(<DecisionExplorer onBack={vi.fn()} />);

    expect(screen.getByText('Decision Audit Trail')).toBeDefined();
    expect(decisions.baseElement.querySelectorAll('.mantine-Select-root').length).toBeGreaterThan(
      1
    );
    expect(decisions.baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(decisions.baseElement.querySelector('.mantine-SegmentedControl-root')).toBeDefined();
    await user.click(screen.getByText('Governance Traces'));
    expect(screen.getByText('Production policy block')).toBeDefined();
    await user.click(screen.getByText('Production policy block'));
    expect(screen.getByText('Evaluated Rules')).toBeDefined();
    expect(screen.getByText('Raw Detail')).toBeDefined();
    expectNoLegacySlots(decisions.baseElement);
    cleanup();

    const detail = renderWithProviders(<DecisionDetail decisionId="decision-1" onBack={vi.fn()} />);

    expect(screen.getByText('Assumptions')).toBeDefined();
    expect(detail.baseElement.querySelector('.mantine-Textarea-root')).toBeDefined();
    expect(detail.baseElement.querySelector('.mantine-Badge-root')).toBeDefined();
    expectNoLegacySlots(detail.baseElement);
  });

  it('renders scoring profiles and score explorer with Mantine tabs, selects, and scroll areas', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderWithProviders(<ScoringProfiles onBack={vi.fn()} />);

    expect(screen.getByText('Agent Output Scoring')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Tabs-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Textarea-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-ScrollArea-root')).toBeDefined();
    expect(screen.queryByText('Composite Score Trend')).toBeNull();

    await user.click(screen.getByRole('tab', { name: /score explorer/i }));

    expect(await screen.findByText('Composite Score Trend')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(2);
    expectNoLegacySlots(baseElement);
  });

  it('supports compact scoring list and detail flows with unsaved-change protection', async () => {
    const user = userEvent.setup();
    const confirmDiscard = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(<ScoringProfiles onBack={vi.fn()} />);

    const list = screen.getByTestId('scoring-profile-list');
    const detail = screen.getByTestId('scoring-profile-detail');
    expect(list.className).toContain('w-full');
    expect(list.className).toContain('md:w-[340px]');
    expect(detail.className).toContain('hidden');
    expect(detail.className).toContain('md:flex');
    expect(screen.getByTestId('scoring-save-action').className).toContain('hidden');
    expect(screen.getByTestId('scoring-mobile-back').className).toContain('md:hidden');

    await user.click(screen.getByRole('button', { name: /Quality/ }));
    expect(list.className).toContain('hidden');
    expect(detail.className).toContain('flex');
    expect(screen.getByTestId('scoring-save-action').className).toBe('contents');

    const name = screen.getByRole('textbox', { name: 'Profile name' });
    await user.clear(name);
    await user.type(name, 'Quality updated');
    await user.click(screen.getByRole('button', { name: 'Back to profiles' }));

    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(detail.className).toContain('flex');

    confirmDiscard.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Back to profiles' }));
    expect(list.className).not.toContain('hidden');
    expect(screen.getByRole('button', { name: /Quality/ }).getAttribute('aria-current')).toBe(
      'true'
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Quality/ }));

    await user.click(screen.getByRole('button', { name: 'New Profile' }));
    expect(screen.getByRole('heading', { name: 'New scoring profile' })).toBeDefined();
    await user.type(screen.getByRole('textbox', { name: 'Profile name' }), 'Phone profile');
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));
    expect(mocks.createScoringProfile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Phone profile' })
    );

    await user.click(screen.getByRole('button', { name: 'Back to profiles' }));
    await user.click(screen.getByRole('button', { name: /Quality/ }));
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect((screen.getByRole('textbox', { name: 'Profile name' }) as HTMLInputElement).value).toBe(
      'Quality Copy'
    );

    confirmDiscard.mockRestore();
  });

  it('renders feedback submission, browse, and analytics panels with Mantine controls', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderWithProviders(<FeedbackPanel />);

    expect(screen.getByText('User Feedback')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Tabs-root')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-TextInput-root').length).toBeGreaterThanOrEqual(
      2
    );
    expect(baseElement.querySelector('.mantine-Textarea-root')).toBeDefined();

    await user.click(screen.getByRole('tab', { name: /browse/i }));

    expect(screen.getByText('Helpful result.')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(3);
    expect(baseElement.querySelector('.mantine-ScrollArea-root')).toBeDefined();

    await user.click(screen.getByRole('tab', { name: /analytics/i }));

    expect(screen.getByText('Total Feedback')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Badge-root')).toBeDefined();
    expectNoLegacySlots(baseElement);
  });
});
