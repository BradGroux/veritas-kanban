import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Stack } from '@mantine/core';

import { ActivityClock } from '@/components/dashboard/ActivityClock';
import { AgentComparison } from '@/components/dashboard/AgentComparison';
import { BudgetCard } from '@/components/dashboard/BudgetCard';
import { StatusTimeline } from '@/components/dashboard/StatusTimeline';
import { TrendsCharts } from '@/components/dashboard/TrendsCharts';
import { WallTimeToggle } from '@/components/dashboard/WallTimeToggle';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  useDailySummary: vi.fn(),
  useTrends: vi.fn(),
  useBudgetMetrics: vi.fn(),
}));

vi.mock('@/lib/api/helpers', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('@/hooks/useStatusHistory', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useStatusHistory')>(
    '@/hooks/useStatusHistory'
  );
  return {
    ...actual,
    useDailySummary: mocks.useDailySummary,
  };
});

vi.mock('@/hooks/useTrends', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTrends')>('@/hooks/useTrends');
  return {
    ...actual,
    useTrends: mocks.useTrends,
  };
});

vi.mock('@/hooks/useBudgetMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useBudgetMetrics')>(
    '@/hooks/useBudgetMetrics'
  );
  return {
    ...actual,
    useBudgetMetrics: mocks.useBudgetMetrics,
  };
});

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: {
      budget: {
        enabled: true,
        monthlyTokenLimit: 100000,
        monthlyCostLimit: 100,
        warningThreshold: 80,
      },
    },
  }),
}));

const trendDaily = [
  {
    date: '2026-06-01',
    runs: 4,
    successes: 3,
    failures: 1,
    errors: 1,
    successRate: 75,
    totalTokens: 24000,
    inputTokens: 15000,
    outputTokens: 9000,
    avgDurationMs: 90000,
    tasksCreated: 2,
    statusChanges: 6,
    tasksArchived: 1,
  },
  {
    date: '2026-06-02',
    runs: 2,
    successes: 2,
    failures: 0,
    errors: 0,
    successRate: 100,
    totalTokens: 16000,
    inputTokens: 10000,
    outputTokens: 6000,
    avgDurationMs: 60000,
    tasksCreated: 1,
    statusChanges: 4,
    tasksArchived: 0,
  },
];

describe('dashboard widget Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDailySummary.mockReturnValue({
      data: {
        date: '2026-06-01',
        activeMs: 7200000,
        idleMs: 1800000,
        errorMs: 0,
        transitions: 8,
      },
      isLoading: false,
    });
    mocks.useTrends.mockReturnValue({
      data: { period: '7d', daily: trendDaily },
      isLoading: false,
      error: null,
    });
    mocks.useBudgetMetrics.mockReturnValue({
      data: {
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        daysInMonth: 30,
        daysElapsed: 1,
        daysRemaining: 29,
        totalTokens: 24000,
        inputTokens: 15000,
        outputTokens: 9000,
        estimatedCost: 12,
        tokensPerDay: 24000,
        costPerDay: 12,
        projectedMonthlyTokens: 720000,
        projectedMonthlyCost: 360,
        tokenBudget: 1000000,
        costBudget: 500,
        tokenBudgetUsed: 24,
        costBudgetUsed: 2.4,
        projectedTokenOverage: 72,
        projectedCostOverage: 72,
        status: 'ok',
      },
      isLoading: false,
      error: null,
    });
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/metrics/agents/comparison')) {
        return {
          period: '7d',
          minRuns: 1,
          agents: [
            {
              agent: 'codex',
              runs: 4,
              successes: 4,
              failures: 0,
              successRate: 100,
              avgDurationMs: 60000,
              avgTokensPerRun: 4000,
              totalTokens: 16000,
              avgCostPerRun: 0.5,
              totalCost: 2,
            },
          ],
          recommendations: [
            {
              category: 'reliability',
              agent: 'codex',
              value: '100%',
              reason: 'Best success rate',
            },
          ],
          totalAgents: 1,
          qualifyingAgents: 1,
        };
      }
      if (url.startsWith('/api/status-history')) {
        return [
          {
            timestamp: '2026-06-01T10:00:00Z',
            previousStatus: 'idle',
            newStatus: 'working',
          },
          {
            timestamp: '2026-06-01T11:00:00Z',
            previousStatus: 'working',
            newStatus: 'idle',
          },
        ];
      }
      if (url.startsWith('/api/metrics/task-cost')) {
        return {
          tasks: [
            {
              taskId: 'task-1',
              totalDurationMs: 120000,
              runs: 2,
            },
          ],
        };
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders dashboard widgets through direct Mantine primitives', async () => {
    const user = userEvent.setup();
    const { baseElement, container } = renderWithProviders(
      <Stack>
        <StatusTimeline />
        <AgentComparison />
        <TrendsCharts />
        <ActivityClock period="7d" />
        <WallTimeToggle period="7d" />
        <BudgetCard />
      </Stack>
    );

    expect(screen.getByText('Daily Activity (2026-06-01)')).toBeDefined();
    expect(await screen.findByText('Agent Comparison')).toBeDefined();
    expect(await screen.findByText('Most Reliable')).toBeDefined();
    expect(screen.getByText('Historical Trends')).toBeDefined();
    expect(await screen.findByText('Activity Clock')).toBeDefined();
    expect(await screen.findByText('Total Agent Time')).toBeDefined();
    expect(screen.getByText('Monthly Budget')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Paper-root').length).toBeGreaterThanOrEqual(8);
    expect(container.querySelectorAll('.mantine-ActionIcon-root').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Total' }));

    expect(screen.getByText('Avg Run Duration')).toBeDefined();
  });

  it('uses Mantine skeletons for dashboard widget loading states', () => {
    mocks.useDailySummary.mockReturnValueOnce({ data: undefined, isLoading: true });
    mocks.useTrends.mockReturnValueOnce({ data: undefined, isLoading: true, error: null });
    mocks.useBudgetMetrics.mockReturnValueOnce({ data: undefined, isLoading: true, error: null });

    const { baseElement, container } = renderWithProviders(
      <Stack>
        <StatusTimeline />
        <TrendsCharts />
        <BudgetCard />
      </Stack>
    );

    expect(container.querySelectorAll('.mantine-Skeleton-root').length).toBeGreaterThanOrEqual(10);
    expect(baseElement.querySelector('[data-slot="skeleton"]')).toBeNull();
  });
});
