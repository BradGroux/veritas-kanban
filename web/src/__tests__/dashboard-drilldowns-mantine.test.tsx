import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Stack } from '@mantine/core';

import { DashboardFilterBar } from '@/components/dashboard/DashboardFilterBar';
import { DrillDownPanel } from '@/components/dashboard/DrillDownPanel';
import { DurationDrillDown } from '@/components/dashboard/DurationDrillDown';
import { ErrorsDrillDown } from '@/components/dashboard/ErrorsDrillDown';
import { ExportDialog } from '@/components/dashboard/ExportDialog';
import { TasksDrillDown } from '@/components/dashboard/TasksDrillDown';
import { TokensDrillDown } from '@/components/dashboard/TokensDrillDown';
import { createMockProject, createMockTask, renderWithProviders } from './test-utils';
import * as apiHelpers from '@/lib/api/helpers';

const mocks = vi.hoisted(() => ({
  useTasks: vi.fn(),
  useProjects: vi.fn(),
  useFailedRuns: vi.fn(),
  useTokenMetrics: vi.fn(),
  useDurationMetrics: vi.fn(),
}));

vi.mock('@/hooks/useTasks', () => ({
  useTasks: mocks.useTasks,
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: mocks.useProjects,
}));

vi.mock('@/hooks/useMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useMetrics')>('@/hooks/useMetrics');
  return {
    ...actual,
    useFailedRuns: mocks.useFailedRuns,
    useTokenMetrics: mocks.useTokenMetrics,
    useDurationMetrics: mocks.useDurationMetrics,
  };
});

const projects = [
  createMockProject({ id: 'proj-1', label: 'Platform' }),
  createMockProject({ id: 'proj-2', label: 'Desktop' }),
];

describe('dashboard Mantine drilldown surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.useTasks.mockReturnValue({
      data: [
        createMockTask({
          id: 'task-1',
          title: 'Migrate dashboard drilldowns',
          status: 'in-progress',
          project: 'proj-1',
          updated: '2026-06-01T10:00:00Z',
        }),
        createMockTask({
          id: 'task-2',
          title: 'Fix export flow',
          status: 'blocked',
          project: 'proj-2',
          updated: '2026-06-01T09:00:00Z',
        }),
      ],
      isLoading: false,
    });
    mocks.useProjects.mockReturnValue({ data: projects });
    mocks.useFailedRuns.mockReturnValue({
      data: [
        {
          timestamp: '2026-06-01T10:00:00Z',
          taskId: 'task-2',
          project: 'proj-2',
          agent: 'codex',
          errorMessage: 'Smoke test failed',
          durationMs: 125000,
        },
      ],
      isLoading: false,
    });
    mocks.useTokenMetrics.mockReturnValue({
      data: {
        period: '7d',
        totalTokens: 24000,
        inputTokens: 15000,
        outputTokens: 8000,
        cacheTokens: 1000,
        runs: 4,
        perSuccessfulRun: { avg: 6000, p50: 5400, p95: 9000 },
        byAgent: [
          {
            agent: 'codex',
            totalTokens: 24000,
            inputTokens: 15000,
            outputTokens: 8000,
            cacheTokens: 1000,
            runs: 4,
          },
        ],
      },
      isLoading: false,
    });
    mocks.useDurationMetrics.mockReturnValue({
      data: {
        period: '7d',
        runs: 4,
        avgMs: 125000,
        p50Ms: 120000,
        p95Ms: 180000,
        byAgent: [
          {
            agent: 'codex',
            runs: 4,
            avgMs: 125000,
            p50Ms: 120000,
            p95Ms: 180000,
          },
        ],
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders dashboard filters through direct Mantine controls and preserves callbacks', async () => {
    const user = userEvent.setup();
    const onPeriodChange = vi.fn();
    const onProjectChange = vi.fn();
    const onExportClick = vi.fn();

    const { baseElement, container } = renderWithProviders(
      <DashboardFilterBar
        period="7d"
        onPeriodChange={onPeriodChange}
        project="proj-1"
        onProjectChange={onProjectChange}
        projects={projects}
        onExportClick={onExportClick}
      />
    );

    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(10);
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-TextInput-root')).toHaveLength(2);
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(onPeriodChange).toHaveBeenCalledWith('today');

    fireEvent.change(screen.getByLabelText('Custom date from'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.change(screen.getByLabelText('Custom date to'), {
      target: { value: '2026-06-03' },
    });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onPeriodChange).toHaveBeenLastCalledWith(
      'custom',
      expect.any(String),
      expect.any(String)
    );

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExportClick).toHaveBeenCalledTimes(1);
  });

  it('renders export and drilldown overlays through Mantine modal and drawer primitives', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onClose = vi.fn();

    const { baseElement } = renderWithProviders(
      <>
        <ExportDialog open onOpenChange={onOpenChange} project="proj-1" projects={projects} />
        <DrillDownPanel type="tokens" title="Token details" onClose={onClose}>
          <p>Panel body</p>
        </DrillDownPanel>
      </>
    );

    expect(screen.getByRole('dialog', { name: /export metrics/i })).toBeDefined();
    expect(screen.getByText('Token details')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Drawer-content')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(3);
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="sheet-content"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole('button', { name: 'Close drilldown' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('guards pending export dismissal and preserves filters after failure', async () => {
    let rejectRequest!: (error: Error) => void;
    const request = vi.spyOn(apiHelpers, 'apiResponse').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        })
    );
    const onOpenChange = vi.fn();
    renderWithProviders(<ExportDialog open onOpenChange={onOpenChange} taskId="task-export" />);
    const dialog = screen.getByRole('dialog', { name: 'Export Metrics' });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: 'Close dialog' })
      )
    );
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-09-01' } });
    const submit = within(dialog).getByRole('button', { name: 'Export' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect((within(dialog).getByLabelText('From') as HTMLInputElement).disabled).toBe(true);
    await act(async () => rejectRequest(new Error('Fixture export failed')));
    expect(within(dialog).getByRole('alert').textContent).toContain('Fixture export failed');
    expect(document.activeElement).toBe(within(dialog).getByRole('alert'));
    expect(within(dialog).getByRole('alert').scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'instant',
    });
    expect((within(dialog).getByLabelText('From') as HTMLInputElement).value).toBe('2026-09-01');
    expect(
      (within(dialog).getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled
    ).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(['2026-09-02', '2026-03-08', '2026-11-01'])(
    'exports the full UTC calendar day for %s regardless of host timezone',
    async (date) => {
      const request = vi
        .spyOn(apiHelpers, 'apiResponse')
        .mockRejectedValueOnce(new Error('Fixture export failed'));
      renderWithProviders(<ExportDialog open onOpenChange={vi.fn()} taskId="task-export" />);
      const dialog = screen.getByRole('dialog', { name: 'Export Metrics' });
      fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: date } });
      fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: date } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      const url = new URL(String(request.mock.calls[0][0]), 'http://fixture.local');
      expect(url.searchParams.get('from')).toBe(`${date}T00:00:00.000Z`);
      expect(url.searchParams.get('to')).toBe(`${date}T23:59:59.999Z`);
      await waitFor(() =>
        expect(within(dialog).getByRole('alert').textContent).toContain('Fixture export failed')
      );
    }
  );

  it('renders dashboard drilldown content through direct Mantine primitives and preserves selection', async () => {
    const user = userEvent.setup();
    const onTaskClick = vi.fn();

    const { baseElement, container } = renderWithProviders(
      <Stack>
        <TasksDrillDown onTaskClick={onTaskClick} />
        <ErrorsDrillDown period="7d" onTaskClick={onTaskClick} />
        <TokensDrillDown period="7d" />
        <DurationDrillDown period="7d" />
      </Stack>
    );

    expect(screen.getByText('Migrate dashboard drilldowns')).toBeDefined();
    expect(screen.getByText('Smoke test failed')).toBeDefined();
    expect(screen.getByText('Token Usage Summary (last 7 days)')).toBeDefined();
    expect(screen.getByText('Run Duration Summary (last 7 days)')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThanOrEqual(8);
    expect(container.querySelectorAll('.mantine-Paper-root').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="skeleton"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: /migrate dashboard drilldowns/i }));
    expect(onTaskClick).toHaveBeenCalledWith('task-1');

    await user.click(screen.getByRole('button', { name: /task-2/i }));
    expect(onTaskClick).toHaveBeenCalledWith('task-2');
  });

  it('uses Mantine skeletons for drilldown loading states', () => {
    mocks.useTasks.mockReturnValueOnce({ data: undefined, isLoading: true });

    const { baseElement, container } = renderWithProviders(<TasksDrillDown />);

    expect(container.querySelectorAll('.mantine-Skeleton-root')).toHaveLength(5);
    expect(baseElement.querySelector('[data-slot="skeleton"]')).toBeNull();
  });
});
