import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkflowsPage } from '@/components/workflows/WorkflowsPage';
import { WorkflowDashboard } from '@/components/workflows/WorkflowDashboard';
import { WorkflowRunView } from '@/components/workflows/WorkflowRunView';
import { ActiveRunsList } from '@/components/workflows/dashboard/ActiveRunsList';
import { renderWithProviders } from './test-utils';
import type { UseWebSocketOptions, WebSocketMessage } from '@/hooks/useWebSocket';

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
  context: {
    pipeline: {
      mode: 'orchestrated',
      parentAgent: 'orchestrator',
      completion: 'all-required',
      roles: [
        {
          id: 'builder',
          label: 'Builder',
          agent: 'codex',
          scope: 'Build the release artifact.',
          taskBrief: 'Build the artifact.',
          deliverable: 'Release artifact',
          verification: ['Artifact exists.'],
          dependsOn: [],
          required: true,
          status: 'completed',
          telemetry: { durationSeconds: 120 },
        },
        {
          id: 'smoke',
          label: 'Smoke Tester',
          agent: 'codex',
          scope: 'Run smoke coverage.',
          taskBrief: 'Smoke the artifact.',
          deliverable: 'Smoke report',
          verification: ['Smoke test passes.'],
          dependsOn: ['builder'],
          required: true,
          status: 'running',
          telemetry: {},
        },
      ],
      totals: { roles: 2, required: 2, completed: 1, blocked: 0, failed: 0 },
    },
  },
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

let webSocketOptions: UseWebSocketOptions[] = [];

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
    webSocketOptions = [];
    mocks.hasPermission.mockReturnValue(true);
    mocks.useWebSocket.mockImplementation((options: UseWebSocketOptions = {}) => {
      webSocketOptions.push(options);
      return undefined;
    });
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
      if (url.endsWith('/workflows/recipes') && !init?.method) {
        return jsonResponse([]);
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

  it('builds a recipe through structured inputs and saves the materialized workflow', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/workflows') && !init?.method) {
        return jsonResponse([]);
      }
      if (url.endsWith('/workflows/recipes') && !init?.method) {
        return jsonResponse([
          {
            id: 'task-implementation',
            name: 'Task Implementation',
            description: 'Plan, implement, review, and package a task.',
            tags: ['task', 'implementation'],
            inputs: [
              {
                id: 'workflowName',
                label: 'Workflow name',
                type: 'text',
                required: true,
                defaultValue: 'Task Implementation Workflow',
              },
              {
                id: 'taskId',
                label: 'Task ID',
                type: 'text',
                required: false,
                defaultValue: 'task_123',
              },
            ],
            defaultOutputTargets: [{ type: 'task-update', label: 'Task update' }],
          },
        ]);
      }
      if (url.endsWith('/workflows/recipes/task-implementation/materialize')) {
        return jsonResponse({
          recipe: { id: 'task-implementation', name: 'Task Implementation' },
          workflow: {
            id: 'task-implementation-workflow',
            name: 'Task Implementation Workflow',
            version: 1,
            description: 'Plan and ship a task.',
            outputTargets: [
              { type: 'task-update', label: 'Task update' },
              { type: 'work-product', label: 'Work product', path: 'work-products/task.md' },
            ],
            schedule: { mode: 'manual', enabled: false },
            agents: [{ id: 'worker', name: 'Worker', role: 'developer', description: 'Work' }],
            steps: [{ id: 'work', name: 'Do work', type: 'agent', agent: 'worker' }],
          },
          yaml: 'id: task-implementation-workflow\noutputTargets: []\n',
          missingInputs: [],
          lint: { ok: true, messages: [], summary: { errors: 0, warnings: 0, info: 0 } },
          preview: {
            pipeline: {
              mode: 'orchestrated',
              parentAgent: 'orchestrator',
              completion: 'all-required',
              roles: [
                {
                  id: 'builder',
                  label: 'Builder',
                  agent: 'worker',
                  scope: 'Build the task.',
                  taskBrief: 'Implement the task.',
                  deliverable: 'Implementation summary',
                  verification: ['Tests pass.'],
                  dependsOn: [],
                  required: true,
                  status: 'pending',
                  telemetry: {},
                },
              ],
              totals: { roles: 1, required: 1, completed: 0, blocked: 0, failed: 0 },
            },
            steps: [{ id: 'work', name: 'Do work', type: 'agent', agent: 'worker' }],
            outputTargets: [
              { type: 'task-update', label: 'Task update' },
              { type: 'work-product', label: 'Work product', path: 'work-products/task.md' },
            ],
            schedule: { mode: 'manual', enabled: false },
          },
        });
      }
      if (url.endsWith('/workflows') && init?.method === 'POST') {
        return jsonResponse({ success: true, workflowId: 'task-implementation-workflow' });
      }
      return jsonResponse(null, false);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(<WorkflowsPage onBack={vi.fn()} />);

    await user.click(await screen.findByRole('tab', { name: 'Author' }));
    expect((await screen.findAllByText('Task Implementation')).length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: 'Build Recipe' }));

    expect((await screen.findAllByText('Task update')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Orchestration Pipeline')).toBeDefined();
    expect(screen.getByText(/Implementation summary/)).toBeDefined();
    expect(screen.getByText('No lint messages.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Save Workflow' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workflows',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"outputTargets"'),
      })
    );
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
    expect(screen.getByText('Orchestration Pipeline')).toBeDefined();
    expect(screen.getByText(/Smoke report/)).toBeDefined();
    expect(screen.queryByText('artifact ready')).toBeNull();
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Paper-root').length).toBeGreaterThanOrEqual(3);
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="skeleton"]')).toBeNull();

    await user.click(screen.getByText('Build artifact'));

    await waitFor(() => expect(screen.getByText('artifact ready')).toBeDefined());
  });

  it('applies workflow run WebSocket payload updates without a full reload', async () => {
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
          steps: [{ id: 'smoke', name: 'Smoke test', agent: 'codex' }],
        });
      }
      return jsonResponse(null, false);
    }) as typeof fetch;

    renderWithProviders(<WorkflowRunView runId="run-1" onBack={vi.fn()} />);

    expect(await screen.findByText('Release workflow')).toBeDefined();
    expect(webSocketOptions.at(-1)?.onOpen).toEqual({ type: 'workflow:subscribe', runId: 'run-1' });

    act(() => {
      webSocketOptions.at(-1)?.onMessage?.({
        type: 'workflow:status',
        payload: {
          ...workflowRun,
          status: 'completed',
          completedAt: '2026-06-01T10:05:00Z',
          steps: workflowRun.steps.map((step) => ({ ...step, status: 'completed' })),
        },
      } as WebSocketMessage);
    });

    await waitFor(() => expect(screen.getByText('Completed')).toBeDefined());
  });
});
