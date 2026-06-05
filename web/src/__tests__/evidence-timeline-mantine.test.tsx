import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvidenceTimelineFilters, EvidenceTimelineResponse } from '@/lib/api';
import { EvidenceTimelinePanel } from '@/components/evidence/EvidenceTimelinePanel';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  useProjects: vi.fn(),
  useEvidenceTimeline: vi.fn(),
  refetch: vi.fn(),
  filters: [] as EvidenceTimelineFilters[],
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: mocks.useProjects,
}));

vi.mock('@/hooks/useEvidenceTimeline', () => ({
  normalizeEvidenceTimelineFilters: (filters: EvidenceTimelineFilters) =>
    Object.fromEntries(
      Object.entries(filters).filter(
        ([, value]) => value !== undefined && value !== '' && value !== 'all'
      )
    ),
  useEvidenceTimeline: mocks.useEvidenceTimeline,
}));

const timeline: EvidenceTimelineResponse = {
  events: [
    {
      id: 'task:task_a:created',
      timestamp: '2026-06-04T08:00:00.000Z',
      type: 'task',
      source: 'task',
      title: 'Task created',
      detail: 'Evidence timeline',
      taskId: 'task_a',
      taskTitle: 'Evidence timeline',
      project: 'platform',
      repo: 'veritas-kanban',
      cwd: '/worktrees/platform',
      actor: 'brad',
      sourceLink: {
        label: 'Open task',
        target: 'task',
        taskId: 'task_a',
      },
    },
    {
      id: 'telemetry:run_1',
      timestamp: '2026-06-04T09:00:00.000Z',
      type: 'agent_run',
      source: 'telemetry',
      title: 'Agent run completed by codex',
      detail: '2m',
      taskId: 'task_a',
      taskTitle: 'Evidence timeline',
      project: 'platform',
      repo: 'veritas-kanban',
      cwd: '/worktrees/platform',
      agent: 'codex',
      sourceLink: {
        label: 'Open run timeline',
        target: 'timeline',
        taskId: 'task_a',
        runId: 'attempt_1',
      },
    },
  ],
  recap: {
    markdown: 'Evidence recap for task task_a: 2 deterministic events matched.',
    citations: [
      {
        eventId: 'telemetry:run_1',
        label: 'Agent run completed by codex',
        timestamp: '2026-06-04T09:00:00.000Z',
        source: 'telemetry',
      },
    ],
  },
  total: 2,
  page: 1,
  limit: 50,
  hasMore: false,
  generatedAt: '2026-06-04T10:00:00.000Z',
  filters: { taskId: 'task_a', page: 1, limit: 50 },
};

describe('EvidenceTimelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filters.length = 0;
    mocks.refetch.mockResolvedValue({});
    mocks.useProjects.mockReturnValue({
      data: [{ id: 'platform', label: 'Platform', order: 1 }],
    });
    mocks.useEvidenceTimeline.mockImplementation((filters: EvidenceTimelineFilters) => {
      mocks.filters.push(filters);
      return {
        data: timeline,
        error: null,
        isLoading: false,
        isFetching: false,
        refetch: mocks.refetch,
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders recap, source-linked events, and refresh control', async () => {
    const user = userEvent.setup();
    const onTaskClick = vi.fn();

    renderWithProviders(<EvidenceTimelinePanel taskId="task_a" onTaskClick={onTaskClick} />);

    expect(screen.getByText(/Evidence recap for task task_a/i)).toBeDefined();
    expect(screen.getByText('Task created')).toBeDefined();
    expect(screen.getByText('Agent run completed by codex')).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Open task/i }));
    expect(onTaskClick).toHaveBeenCalledWith('task_a');

    await user.click(screen.getByRole('button', { name: /Generate Recap/i }));
    expect(mocks.refetch).toHaveBeenCalled();
    expect(mocks.filters.at(-1)).toMatchObject({ taskId: 'task_a', page: 1, limit: 50 });
  });

  it('passes aggregate text filters into the evidence query', async () => {
    renderWithProviders(<EvidenceTimelinePanel showScopeFilters />);

    fireEvent.change(screen.getByLabelText('Repository'), {
      target: { value: 'veritas-kanban' },
    });
    fireEvent.change(screen.getByLabelText('CWD / worktree'), {
      target: { value: '/worktrees/platform' },
    });
    fireEvent.change(screen.getByLabelText('Actor or agent'), {
      target: { value: 'codex' },
    });

    await waitFor(() => {
      expect(mocks.filters.at(-1)).toMatchObject({
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        actor: 'codex',
        page: 1,
        limit: 50,
      });
    });
  });
});
