import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkflowsPage } from '@/components/workflows/WorkflowsPage';
import { WorkflowDashboard } from '@/components/workflows/WorkflowDashboard';
import { WorkflowRunView } from '@/components/workflows/WorkflowRunView';
import { ActiveRunsList } from '@/components/workflows/dashboard/ActiveRunsList';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  useWorkflowStats: vi.fn(),
  useActiveRuns: vi.fn(),
  useRecentRuns: vi.fn(),
  useWebSocket: vi.fn(),
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({
    hasPermission: mocks.hasPermission,
  }),
}));

vi.mock('@/hooks/useWorkflowStats', () => ({
  useWorkflowStats: mocks.useWorkflowStats,
  useActiveRuns: mocks.useActiveRuns,
  useRecentRuns: mocks.useRecentRuns,
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: mocks.useWebSocket,
}));

const workflowRun = {
  id: 'run-1',
  workflowId: 'wf-release',
  workflowVersion: 3,
  status: 'running' as const,
  currentStep: 'build',
  startedAt: '2026-06-01T10:00:00Z',
  steps: [
    {
      stepId: 'build',
      status: 'completed',
      agent: 'codex',
      startedAt: '2026-06-01T10:00:00Z',
      completedAt: '2026-06-01T10:02:00Z',
      duration: 120,
      retries: 1,
      output: 'artifact ready',
    },
    {
      stepId: 'smoke',
      status: 'running',
      agent: 'codex',
      startedAt: '2026-06-01T10:03:00Z',
      retries: 0,
    },
  ],
};

const workflowStats = {
  period: '7d',
  totalWorkflows: 4,
  activeRuns: 1,
  completedRuns: 8,
  failedRuns: 1,
  avgDuration: 120000,
  successRate: 0.89,
  perWorkflow: [
    {
      workflowId: 'wf-release',
      workflowName: 'Release workflow',
      runs: 9,
      completed: 8,
      failed: 1,
      successRate: 0.89,
      avgDuration: 120000,
    },
  ],
};

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data }),
  } as Response;
}

describe('workflow surfaces Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockReturnValue(true);
    mocks.useWebSocket.mockReturnValue(undefined);
    mocks.useWorkflowStats.mockReturnValue({ data: workflowStats, isLoading: false, error: null });
    mocks.useActiveRuns.mockReturnValue({
      data: [workflowRun],
      isLoading: false,
      error: null,
    });
    mocks.useRecentRuns.mockReturnValue({
      data: [{ ...workflowRun, status: 'completed' }],
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders workflow browse controls through direct Mantine primitives and preserves start run', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/workflows') && !init?.method) {
        return jsonResponse([
          {
            id: 'wf-release',
            name: 'Release workflow',
            version: 3,
            description: 'Build and smoke the release',
            agents: [{ id: 'codex', name: 'Codex', role: 'builder' }],
            steps: [{ id: 'build', name: 'Build' }],
            activeRunCount: 1,
          },
        ]);
      }
      if (url.endsWith('/workflows/wf-release/runs') && init?.method === 'POST') {
        return jsonResponse({ id: 'run-1' });
      }
      return jsonResponse(null, false);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { baseElement, container } = renderWithProviders(<WorkflowsPage onBack={vi.fn()} />);

    expect(await screen.findByText('Release workflow')).toBeDefined();
    expect(screen.getByPlaceholderText('Search workflows...')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Start Run' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workflows/wf-release/runs',
      expect.objectContaining({ method: 'POST' })
    );
    expect(await screen.findByText('Workflow Runs')).toBeDefined();
  });

  it('renders workflow dashboard lists and filters through direct Mantine primitives', () => {
    const { baseElement, container } = renderWithProviders(<WorkflowDashboard onBack={vi.fn()} />);

    expect(screen.getByText('Workflow Dashboard')).toBeDefined();
    expect(screen.getAllByText('Active Runs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Recent Runs')).toBeDefined();
    expect(screen.getByText('Workflow Health')).toBeDefined();
    expect(screen.getByText('Release workflow')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Select-root')).toHaveLength(2);
    expect(container.querySelectorAll('.mantine-Paper-root').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it('keeps active run card selection wired after the Mantine card migration', async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();
    const { baseElement, container } = renderWithProviders(
      <ActiveRunsList runs={[workflowRun]} onSelectRun={onSelectRun} />
    );

    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: /run-1/i }));

    expect(onSelectRun).toHaveBeenCalledWith('run-1');
  });

  it('renders workflow run detail through direct Mantine primitives and preserves step expansion', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/workflows/runs/run-1')) {
        return jsonResponse(workflowRun);
      }
      if (url.endsWith('/workflows/wf-release')) {
        return jsonResponse({
          id: 'wf-release',
          name: 'Release workflow',
          version: 3,
          steps: [
            { id: 'build', name: 'Build artifact', agent: 'codex' },
            { id: 'smoke', name: 'Smoke test', agent: 'codex' },
          ],
        });
      }
      return jsonResponse(null, false);
    }) as typeof fetch;

    const { baseElement, container } = renderWithProviders(
      <WorkflowRunView runId="run-1" onBack={vi.fn()} />
    );

    expect(await screen.findByText('Release workflow')).toBeDefined();
    expect(screen.getByText('Overall Progress')).toBeDefined();
    expect(screen.queryByText('artifact ready')).toBeNull();
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Paper-root').length).toBeGreaterThanOrEqual(3);
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="skeleton"]')).toBeNull();

    await user.click(screen.getByText('Build artifact'));

    await waitFor(() => expect(screen.getByText('artifact ready')).toBeDefined());
  });
});
