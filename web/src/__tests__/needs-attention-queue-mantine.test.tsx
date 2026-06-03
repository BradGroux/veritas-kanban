import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  buildNeedsAttentionItems,
  NeedsAttentionQueue,
} from '@/components/dashboard/NeedsAttentionQueue';
import { createMockTask, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  acknowledgeDriftMutate: vi.fn(),
  markNotificationDeliveredMutate: vi.fn(),
  useAcknowledgeDriftAlert: vi.fn(),
  useActiveRuns: vi.fn(),
  useDriftAlerts: vi.fn(),
  useFailedRuns: vi.fn(),
  useMarkNotificationDelivered: vi.fn(),
  usePendingAgentApprovals: vi.fn(),
  useRecentRuns: vi.fn(),
  useTaskCost: vi.fn(),
  useTasks: vi.fn(),
  useUndeliveredNotifications: vi.fn(),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: mocks.useTasks,
}));

vi.mock('@/hooks/useMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useMetrics')>('@/hooks/useMetrics');
  return {
    ...actual,
    useFailedRuns: mocks.useFailedRuns,
    useTaskCost: mocks.useTaskCost,
  };
});

vi.mock('@/hooks/useWorkflowStats', () => ({
  useActiveRuns: mocks.useActiveRuns,
  useRecentRuns: mocks.useRecentRuns,
}));

vi.mock('@/hooks/useDrift', () => ({
  useAcknowledgeDriftAlert: mocks.useAcknowledgeDriftAlert,
  useDriftAlerts: mocks.useDriftAlerts,
}));

vi.mock('@/hooks/useAgent', () => ({
  usePendingAgentApprovals: mocks.usePendingAgentApprovals,
}));

vi.mock('@/hooks/useNotifications', () => ({
  useMarkNotificationDelivered: mocks.useMarkNotificationDelivered,
  useUndeliveredNotifications: mocks.useUndeliveredNotifications,
}));

const tasks = [
  createMockTask({
    id: 'task-blocked',
    title: 'Blocked queue task',
    type: 'feature',
    status: 'blocked',
    priority: 'high',
    project: 'platform',
    agent: 'claude-code',
    updated: '2026-05-30T10:00:00Z',
    blockedReason: { category: 'technical-snag', note: 'Smoke test is failing' },
  }),
  createMockTask({
    id: 'task-stale',
    title: 'Stale running task',
    type: 'bug',
    status: 'in-progress',
    priority: 'medium',
    project: 'platform',
    agent: 'amp',
    updated: '2026-05-20T10:00:00Z',
    git: {
      repo: 'veritas-kanban',
      branch: 'stale-task',
      baseBranch: 'main',
      worktreePath: '/tmp/stale-task',
    },
  }),
  createMockTask({
    id: 'task-review',
    title: 'Review generated PR',
    type: 'feature',
    status: 'in-progress',
    priority: 'medium',
    project: 'platform',
    agent: 'codex-cloud',
    updated: '2026-06-01T10:00:00Z',
    git: {
      repo: 'veritas-kanban',
      branch: 'review-generated-pr',
      baseBranch: 'main',
      prUrl: 'https://github.com/BradGroux/veritas-kanban/pull/999',
    },
  }),
  createMockTask({
    id: 'task-other-project',
    title: 'Other project blocked task',
    status: 'blocked',
    project: 'desktop',
    updated: '2026-05-30T10:00:00Z',
  }),
];

const failedRuns = [
  {
    timestamp: '2026-06-01T08:00:00Z',
    taskId: 'task-blocked',
    project: 'platform',
    agent: 'claude-code',
    success: false,
    errorMessage: 'Unit test failed',
  },
];

const taskCost = {
  period: '7d' as const,
  totalCost: 4,
  avgCostPerTask: 1,
  tasks: [
    {
      taskId: 'task-stale',
      taskTitle: 'Stale running task',
      inputTokens: 1000,
      outputTokens: 2000,
      totalTokens: 3000,
      estimatedCost: 3,
      runs: 2,
      avgCostPerRun: 1.5,
    },
  ],
};

const activeRuns = [
  {
    id: 'run-stuck',
    workflowId: 'wf-release',
    workflowVersion: 1,
    taskId: 'task-stale',
    status: 'running' as const,
    currentStep: 'smoke',
    startedAt: '2026-06-01T06:00:00Z',
    steps: [],
  },
];

const driftAlerts = [
  {
    id: 'drift-1',
    agentId: 'codex-cloud',
    metric: 'success_rate' as const,
    currentValue: 0.5,
    baselineValue: 0.9,
    zScore: 4.2,
    severity: 'critical' as const,
    timestamp: '2026-06-01T07:00:00Z',
    acknowledged: false,
  },
];

const approvals = [
  {
    id: 'approval-1',
    agentId: 'amp',
    action: 'push_branch',
    taskId: 'task-blocked',
    details: 'Needs approval to push branch',
    status: 'pending' as const,
    createdAt: '2026-06-01T09:00:00Z',
  },
];

const notifications = [
  {
    id: 'notif-1',
    taskId: 'task-review',
    targetAgent: 'codex-cloud',
    fromAgent: 'veritas',
    content: 'Review needed before merge',
    type: 'review_needed',
    title: 'Review notification',
    taskTitle: 'Review generated PR',
    project: 'platform',
    delivered: false,
    createdAt: '2026-06-01T11:00:00Z',
  },
];

function ensureLocalStorage() {
  if (window.localStorage) return;

  const storage = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
}

function ensureBrowserShims() {
  ensureLocalStorage();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
}

function mockQueueData() {
  mocks.useTasks.mockReturnValue({ data: tasks, isLoading: false });
  mocks.useFailedRuns.mockReturnValue({ data: failedRuns, isLoading: false });
  mocks.useTaskCost.mockReturnValue({ data: taskCost, isLoading: false });
  mocks.useActiveRuns.mockReturnValue({ data: activeRuns, isLoading: false });
  mocks.useRecentRuns.mockReturnValue({ data: [], isLoading: false });
  mocks.useDriftAlerts.mockReturnValue({ data: driftAlerts, isLoading: false });
  mocks.usePendingAgentApprovals.mockReturnValue({ data: approvals, isLoading: false });
  mocks.useUndeliveredNotifications.mockReturnValue({ data: notifications, isLoading: false });
  mocks.useAcknowledgeDriftAlert.mockReturnValue({ mutate: mocks.acknowledgeDriftMutate });
  mocks.useMarkNotificationDelivered.mockReturnValue({
    mutate: mocks.markNotificationDeliveredMutate,
  });
}

describe('needs attention queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureBrowserShims();
    window.localStorage.clear();
    mockQueueData();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('builds prioritized action items with source, destination, and project filtering', () => {
    const items = buildNeedsAttentionItems(
      {
        activeRuns,
        approvals,
        driftAlerts,
        failedRuns,
        notifications,
        project: 'platform',
        recentRuns: [],
        taskCost,
        tasks,
      },
      new Date('2026-06-02T12:00:00Z')
    );

    expect(items.map((item) => item.source)).toEqual(
      expect.arrayContaining([
        'approval',
        'blocked-task',
        'expensive-run',
        'failed-run',
        'notification',
        'stale-task',
        'stale-worktree',
        'stuck-workflow',
        'unreviewed-diff',
      ])
    );
    expect(items.some((item) => item.project === 'desktop')).toBe(false);
    expect(items[0].severity).toBe('high');
    expect(items.find((item) => item.source === 'blocked-task')?.reason).toContain(
      'Smoke test is failing'
    );
  });

  it('renders queue items through Mantine controls and opens task targets', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();

    const { baseElement, container } = renderWithProviders(
      <NeedsAttentionQueue period="7d" project="platform" onOpenTask={onOpenTask} />
    );

    expect(screen.getByText('Needs Attention')).toBeDefined();
    expect(screen.getAllByText('Blocked queue task').length).toBeGreaterThan(0);
    expect(screen.getByText('Review notification')).toBeDefined();
    expect(screen.getAllByText('Stale running task').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.mantine-Select-root')).toHaveLength(5);
    expect(container.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThan(3);
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();

    await user.click(screen.getAllByRole('button', { name: /Open task: Blocked queue task/i })[0]);

    expect(onOpenTask).toHaveBeenCalledWith('task-blocked');
  });

  it('filters by source and marks notification items read when dismissed', async () => {
    const user = userEvent.setup();

    renderWithProviders(<NeedsAttentionQueue period="7d" project="platform" />);

    await user.click(screen.getAllByLabelText('Filter needs attention by source')[0]);
    await user.click(screen.getByRole('option', { name: 'Notification' }));

    expect(screen.getByText('Review notification')).toBeDefined();
    expect(screen.queryByText('Blocked queue task')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Mark read' }));

    expect(mocks.markNotificationDeliveredMutate).toHaveBeenCalledWith('notif-1');
    expect(screen.queryByText('Review notification')).toBeNull();
  });

  it('renders an empty state when no inputs need attention', () => {
    mocks.useTasks.mockReturnValue({ data: [], isLoading: false });
    mocks.useFailedRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.useTaskCost.mockReturnValue({
      data: { period: '7d', totalCost: 0, avgCostPerTask: 0, tasks: [] },
      isLoading: false,
    });
    mocks.useActiveRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.useRecentRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.useDriftAlerts.mockReturnValue({ data: [], isLoading: false });
    mocks.usePendingAgentApprovals.mockReturnValue({ data: [], isLoading: false });
    mocks.useUndeliveredNotifications.mockReturnValue({ data: [], isLoading: false });

    renderWithProviders(<NeedsAttentionQueue period="7d" project="platform" />);

    expect(screen.getByText('No matching action items.')).toBeDefined();
  });
});
