import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OperationsDigestPage } from '@/components/digest/OperationsDigestPage';
import { renderWithProviders } from './test-utils';
import type { AgentOperationsDigest, ScheduledDeliverable } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  useProjects: vi.fn(),
  useOperationsDigest: vi.fn(),
  useOperationsDigestMarkdown: vi.fn(),
  useOperationsDigestSchedule: vi.fn(),
  useCreateOperationsDigestSchedule: vi.fn(),
  useRecordOperationsDigestSnapshot: vi.fn(),
  digestRefetch: vi.fn(),
  markdownRefetch: vi.fn(),
  scheduleRefetch: vi.fn(),
  createSchedule: vi.fn(),
  recordSnapshot: vi.fn(),
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: mocks.useProjects,
}));

vi.mock('@/hooks/useOperationsDigest', () => ({
  normalizeOperationsDigestFilters: (filters: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)),
  useOperationsDigest: mocks.useOperationsDigest,
  useOperationsDigestMarkdown: mocks.useOperationsDigestMarkdown,
  useOperationsDigestSchedule: mocks.useOperationsDigestSchedule,
  useCreateOperationsDigestSchedule: mocks.useCreateOperationsDigestSchedule,
  useRecordOperationsDigestSnapshot: mocks.useRecordOperationsDigestSnapshot,
}));

vi.mock('@/components/ui/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

const digest: AgentOperationsDigest = {
  period: {
    start: '2026-06-04T00:00:00.000Z',
    end: '2026-06-05T00:00:00.000Z',
    windowHours: 24,
  },
  generatedAt: '2026-06-05T00:01:00.000Z',
  hasActivity: true,
  totals: {
    active: 1,
    blocked: 1,
    stuck: 0,
    completed: 2,
    failed: 1,
    runs: 3,
    tokenCost: 0.045,
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    wallTimeMs: 3_600_000,
    activeTimeMs: 600_000,
    openApprovals: 1,
    groups: 1,
  },
  groups: [
    {
      key: 'platform::veritas-kanban::/worktrees/platform',
      project: 'platform',
      repo: 'veritas-kanban',
      cwd: '/worktrees/platform',
      totals: {
        active: 1,
        blocked: 1,
        stuck: 0,
        completed: 2,
        failed: 1,
        runs: 3,
        tokenCost: 0.045,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        wallTimeMs: 3_600_000,
        activeTimeMs: 600_000,
      },
      sourceLinks: {
        activeTasks: [
          {
            kind: 'task',
            id: 'task_active',
            label: 'Active task',
            taskId: 'task_active',
            timestamp: '2026-06-04T12:00:00.000Z',
          },
        ],
        blockedTasks: [
          {
            kind: 'task',
            id: 'task_blocked',
            label: 'Blocked task',
            taskId: 'task_blocked',
            timestamp: '2026-06-04T12:30:00.000Z',
          },
        ],
        stuckTasks: [],
        completedTasks: [
          {
            kind: 'task',
            id: 'task_done',
            label: 'Completed task',
            taskId: 'task_done',
            timestamp: '2026-06-04T13:00:00.000Z',
          },
        ],
        failedRuns: [
          {
            kind: 'run',
            id: 'attempt_failed',
            label: 'Failed run',
            taskId: 'task_active',
            timestamp: '2026-06-04T13:30:00.000Z',
          },
        ],
        tokenEvents: [
          {
            kind: 'telemetry',
            id: 'tokens_1',
            label: 'Token usage',
            taskId: 'task_active',
            timestamp: '2026-06-04T13:45:00.000Z',
          },
        ],
      },
      topPlanCompletions: [
        {
          kind: 'task',
          id: 'task_done',
          label: 'Completed task',
          taskId: 'task_done',
          timestamp: '2026-06-04T13:00:00.000Z',
        },
      ],
      notableFailures: [
        {
          kind: 'run',
          id: 'attempt_failed',
          label: 'Failed run',
          taskId: 'task_active',
          timestamp: '2026-06-04T13:30:00.000Z',
          agent: 'codex',
          error: 'Tests failed',
        },
      ],
      openApprovals: [
        {
          kind: 'approval',
          id: 'approval_1',
          label: 'codex approval',
          taskId: 'task_blocked',
          timestamp: '2026-06-04T14:00:00.000Z',
          agent: 'codex',
          action: 'push_branch',
        },
      ],
    },
  ],
  refresh: {
    manual: true,
    schedule: 'daily-ready',
    narrative: 'deterministic-only',
  },
};

const scheduledDeliverable: ScheduledDeliverable = {
  id: 'del_ops',
  name: 'Operations Digest',
  description: 'Daily digest',
  schedule: 'daily',
  scheduleDescription: 'Every day',
  enabled: true,
  agent: 'veritas',
  outputPath: 'operations/digests',
  tags: ['operations-digest'],
  createdAt: '2026-06-01T00:00:00.000Z',
  lastRunAt: '2026-06-04T09:00:00.000Z',
  nextRunAt: '2026-06-05T09:00:00.000Z',
  totalRuns: 4,
};

describe('OperationsDigestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.digestRefetch.mockResolvedValue({});
    mocks.markdownRefetch.mockResolvedValue({});
    mocks.scheduleRefetch.mockResolvedValue({});
    mocks.createSchedule.mockResolvedValue(scheduledDeliverable);
    mocks.recordSnapshot.mockResolvedValue({});
    mocks.useProjects.mockReturnValue({
      data: [{ id: 'platform', label: 'Platform', order: 1 }],
    });
    mocks.useOperationsDigest.mockReturnValue({
      data: digest,
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: mocks.digestRefetch,
    });
    mocks.useOperationsDigestMarkdown.mockReturnValue({
      data: { isEmpty: false, markdown: '# Agent Operations Digest\n\n- Counts: 1 active' },
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: mocks.markdownRefetch,
    });
    mocks.useOperationsDigestSchedule.mockReturnValue({
      data: [scheduledDeliverable],
      refetch: mocks.scheduleRefetch,
    });
    mocks.useCreateOperationsDigestSchedule.mockReturnValue({
      mutateAsync: mocks.createSchedule,
      isPending: false,
    });
    mocks.useRecordOperationsDigestSnapshot.mockReturnValue({
      mutateAsync: mocks.recordSnapshot,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders deterministic digest groups, markdown, and scheduled delivery controls', async () => {
    const user = userEvent.setup();
    const onTaskClick = vi.fn();
    const { container } = renderWithProviders(
      <OperationsDigestPage onBack={vi.fn()} onTaskClick={onTaskClick} />
    );

    expect(screen.getByRole('heading', { name: 'Operations Digest' })).toBeDefined();
    expect(screen.getByText('platform / veritas-kanban / /worktrees/platform')).toBeDefined();
    expect(screen.getByText('Daily Delivery')).toBeDefined();
    expect(screen.getByText('Configured')).toBeDefined();
    expect(screen.getByTestId('markdown').textContent).toContain('Agent Operations Digest');
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThan(4);
    expect(container.querySelector('[data-slot="button"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Active: 1/i }));

    expect(onTaskClick).toHaveBeenCalledWith('task_active');
  });

  it('passes repo and cwd filters into digest queries', async () => {
    renderWithProviders(<OperationsDigestPage onBack={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Repository'), {
      target: { value: 'veritas-kanban' },
    });
    fireEvent.change(screen.getByLabelText('CWD / worktree'), {
      target: { value: '/worktrees/platform' },
    });

    await waitFor(() =>
      expect(mocks.useOperationsDigest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          repo: 'veritas-kanban',
          cwd: '/worktrees/platform',
        })
      )
    );
  });
});
