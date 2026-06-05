import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TimeBreakdownFilters, TimeBreakdownResponse } from '@/lib/api';
import { TimeBreakdownPage } from '@/components/time/TimeBreakdownPage';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  useProjects: vi.fn(),
  useTimeBreakdown: vi.fn(),
  refetch: vi.fn(),
  filters: [] as TimeBreakdownFilters[],
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: mocks.useProjects,
}));

vi.mock('@/hooks/useTimeBreakdowns', () => ({
  normalizeTimeBreakdownFilters: (filters: TimeBreakdownFilters) =>
    Object.fromEntries(
      Object.entries(filters).filter(
        ([, value]) => value !== undefined && value !== '' && value !== 'all'
      )
    ),
  useTimeBreakdown: mocks.useTimeBreakdown,
}));

const breakdown: TimeBreakdownResponse = {
  generatedAt: '2026-06-04T12:00:00.000Z',
  period: {
    preset: 'weekly',
    from: '2026-06-01T00:00:00.000Z',
    to: '2026-06-05T00:00:00.000Z',
  },
  filters: { preset: 'weekly', includeInferred: true, limit: 200 },
  totals: {
    explicitSeconds: 1800,
    inferredSeconds: 600,
    totalSeconds: 2400,
    ambiguousCount: 1,
    blocks: 3,
  },
  groups: [],
  clientSummary: 'Time breakdown for this week.',
  markdown: '# Time Breakdown',
  csv: 'date,kind',
  blocks: [
    {
      id: 'time-breakdown:time:task_a:entry_1',
      kind: 'explicit',
      date: '2026-06-04',
      timestamp: '2026-06-04T09:30:00.000Z',
      durationSeconds: 1800,
      label: 'Implementation',
      taskId: 'task_a',
      taskTitle: 'Time exports',
      project: 'platform',
      repo: 'veritas-kanban',
      cwd: '/worktrees/platform',
      actor: 'brad',
      confidence: 'high',
      confidenceReason: 'Explicit tracked time entry.',
      sources: [
        {
          eventId: 'time:task_a:entry_1',
          label: 'Time tracked',
          timestamp: '2026-06-04T09:30:00.000Z',
          source: 'task',
          sourceLink: { label: 'Open task', target: 'task', taskId: 'task_a' },
        },
      ],
    },
    {
      id: 'time-breakdown:telemetry:run_1',
      kind: 'inferred',
      date: '2026-06-04',
      timestamp: '2026-06-04T10:00:00.000Z',
      durationSeconds: 600,
      label: 'Agent run completed by codex',
      taskId: 'task_a',
      taskTitle: 'Time exports',
      project: 'platform',
      repo: 'veritas-kanban',
      cwd: '/worktrees/platform',
      agent: 'codex',
      confidence: 'high',
      confidenceReason: 'Agent run telemetry reported duration.',
      sources: [
        {
          eventId: 'telemetry:run_1',
          label: 'Agent run completed by codex',
          timestamp: '2026-06-04T10:00:00.000Z',
          source: 'telemetry',
          sourceLink: { label: 'Open run timeline', target: 'timeline', taskId: 'task_a' },
        },
      ],
    },
    {
      id: 'time-breakdown:comment:task_a:comment_1',
      kind: 'ambiguous',
      date: '2026-06-04',
      timestamp: '2026-06-04T10:30:00.000Z',
      durationSeconds: 0,
      label: 'Comment added',
      taskId: 'task_a',
      taskTitle: 'Time exports',
      project: 'platform',
      repo: 'veritas-kanban',
      cwd: '/worktrees/platform',
      actor: 'brad',
      confidence: 'low',
      confidenceReason: 'Source evidence indicates work activity but has no duration.',
      sources: [
        {
          eventId: 'comment:task_a:comment_1',
          label: 'Comment added',
          timestamp: '2026-06-04T10:30:00.000Z',
          source: 'task',
          sourceLink: { label: 'Open comments', target: 'task', taskId: 'task_a' },
        },
      ],
    },
  ],
};

describe('TimeBreakdownPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filters.length = 0;
    mocks.refetch.mockResolvedValue({});
    mocks.useProjects.mockReturnValue({
      data: [{ id: 'platform', label: 'Platform', order: 1 }],
    });
    mocks.useTimeBreakdown.mockImplementation((filters: TimeBreakdownFilters) => {
      mocks.filters.push(filters);
      return {
        data: breakdown,
        error: null,
        isLoading: false,
        isFetching: false,
        refetch: mocks.refetch,
      };
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:time-breakdown'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders editable explicit, inferred, and ambiguous blocks', async () => {
    const user = userEvent.setup();
    const onTaskClick = vi.fn();

    renderWithProviders(<TimeBreakdownPage onBack={vi.fn()} onTaskClick={onTaskClick} />);

    expect(screen.getByRole('heading', { name: 'Time Breakdowns' })).toBeDefined();
    expect(screen.getAllByText('Explicit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inferred').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ambiguous').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Label for Implementation'), {
      target: { value: 'Edited implementation' },
    });
    fireEvent.change(screen.getByLabelText('Duration for Implementation'), {
      target: { value: '2h' },
    });

    const [sourceButton] = screen.getAllByRole('button', { name: /Source/i });
    if (!sourceButton) throw new Error('Expected a source button');
    await user.click(sourceButton);
    expect(onTaskClick).toHaveBeenCalledWith('task_a');

    await user.click(screen.getByRole('button', { name: 'CSV' }));
    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain('Edited implementation');
    expect(csv).toContain('7200');
  });

  it('passes text filters and generate action into the query hook', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TimeBreakdownPage onBack={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Repository'), {
      target: { value: 'veritas-kanban' },
    });
    fireEvent.change(screen.getByLabelText('CWD / worktree'), {
      target: { value: '/worktrees/platform' },
    });
    fireEvent.change(screen.getByLabelText('Assignee / agent'), {
      target: { value: 'codex' },
    });

    await waitFor(() => {
      expect(mocks.filters.at(-1)).toMatchObject({
        repo: 'veritas-kanban',
        cwd: '/worktrees/platform',
        actor: 'codex',
        includeInferred: true,
        limit: 200,
      });
    });

    await user.click(screen.getByRole('button', { name: /Generate/i }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});
