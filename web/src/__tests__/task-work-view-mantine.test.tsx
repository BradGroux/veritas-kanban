import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  getTaskReadinessChecks,
  shouldDefaultTaskDetailToWork,
  TaskWorkView,
} from '@/components/task/TaskWorkView';
import { createMockTask, renderWithProviders } from './test-utils';
import type { WorkProductPreview } from '@veritas-kanban/shared';

const mocks = vi.hoisted(() => ({
  onOpenChat: vi.fn(),
  onOpenTab: vi.fn(),
  onOpenWorkflow: vi.fn(),
  stopAgentMutate: vi.fn(),
  useAgentStatus: vi.fn(),
  useAgentStream: vi.fn(),
  useActiveRuns: vi.fn(),
  useRecentRuns: vi.fn(),
  useTaskWorkProducts: vi.fn(),
  identity: {
    authContext: null as unknown,
    hasPermission: vi.fn((_permission: string) => true),
  },
}));

vi.mock('@/hooks/useAgent', () => ({
  useAgentStatus: mocks.useAgentStatus,
  useAgentStream: mocks.useAgentStream,
  useStopAgent: () => ({
    mutate: mocks.stopAgentMutate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useWorkProducts', () => ({
  useTaskWorkProducts: mocks.useTaskWorkProducts,
}));

vi.mock('@/hooks/useWorkflowStats', () => ({
  useActiveRuns: mocks.useActiveRuns,
  useRecentRuns: mocks.useRecentRuns,
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => mocks.identity,
}));

const product: WorkProductPreview = {
  id: 'wp-release',
  workspaceId: 'local',
  kind: 'report',
  title: 'Release readiness report',
  status: 'active',
  version: 3,
  taskId: 'task-work',
  sourceRunId: 'run-456',
  agent: 'veritas',
  model: 'gpt-5',
  sourceLinks: [{ label: 'Source run', href: '/runs/run-456', type: 'run' }],
  redacted: true,
  snippet: 'Release summary',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
};

function renderWorkView(task = createMockTask()) {
  return renderWithProviders(
    <TaskWorkView
      task={task}
      isCodeTask={task.type === 'code'}
      onOpenChat={mocks.onOpenChat}
      onOpenTab={mocks.onOpenTab}
      onOpenWorkflow={mocks.onOpenWorkflow}
    />
  );
}

describe('task work view Mantine surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAgentStatus.mockReturnValue({ data: { running: false } });
    mocks.useAgentStream.mockReturnValue({
      outputs: [],
      isConnected: true,
      isRunning: false,
    });
    mocks.useActiveRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.useRecentRuns.mockReturnValue({ data: [], isLoading: false });
    mocks.useTaskWorkProducts.mockReturnValue({ data: [], isLoading: false });
    mocks.identity.authContext = null;
    mocks.identity.hasPermission.mockImplementation(() => true);
  });

  afterEach(() => {
    cleanup();
  });

  it('surfaces blockers and missing readiness items in one task work view', () => {
    const task = createMockTask({
      id: 'task-blocked',
      title: 'Fix',
      description: 'Too short',
      type: 'code',
      status: 'blocked',
      blockedReason: {
        category: 'waiting-on-feedback',
        note: 'Waiting on security review',
      },
    });

    const { baseElement, container } = renderWorkView(task);

    expect(screen.getByText('Work View')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Resolve blocker' })).toBeDefined();
    expect(screen.getAllByText('Waiting on security review').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Readiness Gate')).toBeDefined();
    expect(screen.getByText('Clear objective')).toBeDefined();
    expect(screen.getByText('Add a concrete description of the expected outcome.')).toBeDefined();
    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
  });

  it('links live execution, code review, handoff, and work products from the Work view', async () => {
    const user = userEvent.setup();
    mocks.useTaskWorkProducts.mockReturnValue({ data: [product], isLoading: false });
    mocks.useAgentStatus.mockReturnValue({
      data: {
        running: true,
        attemptId: 'attempt-1',
        agent: 'veritas',
        status: 'running',
        controls: {
          controls: [
            {
              action: 'stop',
              capabilityId: 'run.stop',
              state: 'supported',
              available: true,
              advisory: false,
              reason: 'Stop is supported.',
            },
          ],
        },
      },
    });
    mocks.useAgentStream.mockReturnValue({
      outputs: [
        {
          type: 'system',
          content: 'Installing dependencies',
          timestamp: '2026-06-01T11:01:00.000Z',
        },
        {
          type: 'stdout',
          content: 'Running focused tests',
          timestamp: '2026-06-01T11:02:00.000Z',
        },
      ],
      isConnected: true,
      isRunning: true,
    });
    mocks.useActiveRuns.mockReturnValue({
      data: [
        {
          id: 'workflow-run-1',
          workflowId: 'release-flow',
          workflowVersion: 2,
          taskId: 'task-work',
          status: 'running',
          currentStep: 'build',
          startedAt: '2026-06-01T10:55:00.000Z',
          steps: [
            {
              stepId: 'plan',
              status: 'completed',
              startedAt: '2026-06-01T10:55:00.000Z',
              completedAt: '2026-06-01T10:59:00.000Z',
            },
            { stepId: 'build', status: 'running', startedAt: '2026-06-01T11:00:00.000Z' },
          ],
        },
      ],
      isLoading: false,
    });
    const task = createMockTask({
      id: 'task-work',
      title: 'Ship release candidate',
      description:
        'Ship the release candidate with an explicit report artifact and verification evidence.',
      type: 'code',
      status: 'in-progress',
      priority: 'high',
      agent: 'veritas',
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'v5-release-candidate',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-worktree',
      },
      attempt: {
        id: 'attempt-1',
        agent: 'veritas',
        status: 'running',
        model: 'gpt-5',
        provider: 'openai',
        started: '2026-06-01T11:00:00.000Z',
      },
      timeTracking: {
        entries: [],
        totalSeconds: 5400,
        isRunning: true,
      },
      actualCost: 0.037,
      verificationSteps: [
        { id: 'verify-1', description: 'Run tests', checked: true },
        { id: 'verify-2', description: 'Smoke desktop app', checked: false },
      ],
      subtasks: [
        {
          id: 'sub-1',
          title: 'Confirm release readiness',
          completed: false,
          created: '2026-06-01T11:15:00.000Z',
          acceptanceCriteria: ['Release report includes verification evidence'],
        },
      ],
      deliverables: [
        {
          id: 'del-1',
          title: 'Release report',
          type: 'report',
          status: 'pending',
          created: '2026-06-01T11:30:00.000Z',
        },
      ],
      review: {
        decision: 'approved',
        decidedAt: '2026-06-01T11:45:00.000Z',
      },
      qaGate: {
        required: true,
        passed: false,
      },
    });

    renderWorkView(task);

    expect(screen.getByText('Monitor active run')).toBeDefined();
    expect(screen.getByText('Attempt attempt-1')).toBeDefined();
    expect(screen.getByText('Activity Console')).toBeDefined();
    expect(screen.getByText('Current step: Running focused tests')).toBeDefined();
    expect(screen.getByText('Installing dependencies')).toBeDefined();
    expect(screen.getByText('1h 30m')).toBeDefined();
    expect(screen.getByText('$0.04')).toBeDefined();
    expect(screen.getByText('Workflow State')).toBeDefined();
    expect(screen.getByText('Workflow release-flow v2')).toBeDefined();
    expect(screen.getByText('workflow-run-1')).toBeDefined();
    expect(screen.getByText('build')).toBeDefined();
    expect(screen.getByText('Steps 1/2')).toBeDefined();
    expect(screen.getByText('Release readiness report')).toBeDefined();
    expect(screen.getByText('v3 | report | run run-456')).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Open origin for Release readiness report' })
        .getAttribute('href')
    ).toBe('/runs/run-456');

    await user.click(screen.getByRole('button', { name: 'Open Agent' }));
    await user.click(screen.getByRole('button', { name: 'Open Workflow' }));
    await user.click(screen.getByRole('button', { name: 'Work Products' }));
    await user.click(screen.getByRole('button', { name: 'Workflow' }));
    await user.click(screen.getByRole('button', { name: 'Stop active run' }));
    await user.click(screen.getByRole('button', { name: 'Stop Agent' }));

    expect(mocks.onOpenTab).toHaveBeenCalledWith('agent');
    expect(mocks.onOpenTab).toHaveBeenCalledWith('work-products');
    expect(mocks.onOpenWorkflow).toHaveBeenCalled();
    expect(mocks.stopAgentMutate).toHaveBeenCalledWith({
      taskId: 'task-work',
      attemptId: 'attempt-1',
    });
  });

  it('does not show a stopped run from stale task and WebSocket state', () => {
    mocks.useAgentStatus.mockReturnValue({
      data: { running: false },
      error: null,
      isFetching: false,
    });
    mocks.useAgentStream.mockReturnValue({
      outputs: [],
      isConnected: true,
      isRunning: true,
    });

    renderWorkView(
      createMockTask({
        id: 'task-work-stopped',
        status: 'in-progress',
        git: {
          repo: 'veritas',
          branch: 'stopped',
          baseBranch: 'main',
          worktreePath: '/tmp',
        },
        attempt: {
          id: 'attempt-stopped',
          agent: 'codex',
          status: 'running',
        },
      })
    );

    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop active run' })).toBeNull();
  });

  it('disables the Work view stop control when the persisted manifest cannot stop', () => {
    mocks.useAgentStatus.mockReturnValue({
      data: {
        running: true,
        controls: {
          controls: [
            {
              action: 'stop',
              capabilityId: 'run.stop',
              state: 'unsupported',
              available: false,
              advisory: false,
              reason: 'This provider cannot stop the active run.',
            },
          ],
        },
      },
    });
    const task = createMockTask({
      id: 'task-stop-unsupported',
      type: 'code',
      status: 'in-progress',
      attempt: {
        id: 'attempt-stop-unsupported',
        agent: 'openclaw',
        status: 'running',
        started: '2026-06-01T11:00:00.000Z',
      },
    });

    renderWorkView(task);

    expect(
      screen
        .getByRole('button', {
          name: 'Stop active run unavailable: This provider cannot stop the active run.',
        })
        .getAttribute('disabled')
    ).not.toBeNull();
  });

  it('does not reuse cached enabled controls after a stale status refetch error', () => {
    mocks.useAgentStatus.mockReturnValue({
      data: {
        running: true,
        controls: {
          controls: [
            {
              action: 'stop',
              capabilityId: 'run.stop',
              state: 'supported',
              available: true,
              advisory: false,
              reason: 'Cached stop evidence was supported.',
            },
          ],
        },
      },
      error: new Error('Provider runtime manifest is stale or invalid: digest mismatch'),
    });
    const task = createMockTask({
      id: 'task-stop-stale',
      type: 'code',
      status: 'in-progress',
      attempt: {
        id: 'attempt-stop-stale',
        agent: 'codex',
        status: 'running',
        started: '2026-06-01T11:00:00.000Z',
      },
    });

    renderWorkView(task);

    expect(
      screen
        .getByRole('button', {
          name: 'Stop active run unavailable: Provider runtime manifest is stale or invalid: digest mismatch',
        })
        .getAttribute('disabled')
    ).not.toBeNull();
  });

  it('skips unsafe work product source links in the Work view', () => {
    mocks.useTaskWorkProducts.mockReturnValue({
      data: [
        {
          ...product,
          sourceLinks: [
            {
              label: 'Unsafe source',
              href: 'data:text/html,<script>alert(1)</script>',
              type: 'url',
            },
            { label: 'Safe source', href: '/runs/safe-run', type: 'run' },
          ],
        },
      ],
      isLoading: false,
    });

    const { container } = renderWorkView();
    const sourceLink = screen.getByRole('link', {
      name: 'Open origin for Release readiness report',
    });

    expect(sourceLink.getAttribute('href')).toBe('/runs/safe-run');
    expect(
      Array.from(container.querySelectorAll('a')).some((anchor) =>
        /^(?:javascript|data|file):/i.test(anchor.getAttribute('href') ?? '')
      )
    ).toBe(false);
  });

  it('keeps readiness and default-tab decisions deterministic', () => {
    const task = createMockTask({
      title: 'Implement run timeline',
      description:
        'Implement a timeline artifact with report output, clear verification, and enough task context.',
      type: 'code',
      agent: 'veritas',
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'timeline',
        baseBranch: 'main',
      },
      subtasks: [
        {
          id: 'sub-1',
          title: 'Confirm timeline output',
          completed: false,
          created: '2026-06-01T11:00:00.000Z',
          acceptanceCriteria: ['Timeline artifact shows ordered run events'],
        },
      ],
      verificationSteps: [{ id: 'verify-1', description: 'Run timeline test', checked: false }],
    });

    const readiness = getTaskReadinessChecks(task, true);

    expect(readiness.map((check) => check.label)).toContain('Acceptance criteria');
    expect(readiness.map((check) => check.label)).toContain('Risk level');
    expect(readiness.every((check) => check.passed)).toBe(true);
    expect(shouldDefaultTaskDetailToWork(task)).toBe(true);
    expect(shouldDefaultTaskDetailToWork(createMockTask({ type: 'feature' }))).toBe(false);
  });

  it('routes mobile device sessions to review-safe actions instead of agent controls', async () => {
    const user = userEvent.setup();
    mocks.identity.authContext = {
      authMethod: 'device-session',
      clientMode: 'mobile-pwa',
      isLocalhost: false,
      permissions: ['workspace:read', 'task:read', 'comment:write', 'agent:read'],
      role: 'read-only',
    };
    mocks.identity.hasPermission.mockImplementation(
      (permission: string) => permission !== 'agent:write'
    );
    const task = createMockTask({
      id: 'task-mobile-work',
      title: 'Review from phone',
      description:
        'Review the task from a mobile client without exposing local agent execution controls and capture the evidence artifact.',
      type: 'code',
      status: 'todo',
      agent: 'veritas',
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'mobile-review',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-worktree',
      },
      attempt: {
        id: 'attempt-mobile',
        agent: 'veritas',
        status: 'running',
        model: 'gpt-5',
        provider: 'openai',
        started: '2026-06-01T11:00:00.000Z',
      },
      subtasks: [
        {
          id: 'sub-mobile',
          title: 'Confirm mobile review path',
          completed: false,
          created: '2026-06-01T11:00:00.000Z',
          acceptanceCriteria: ['Mobile path opens timeline instead of agent start'],
        },
      ],
      verificationSteps: [{ id: 'verify-mobile', description: 'Run mobile test', checked: false }],
    });

    renderWorkView(task);

    expect(screen.getByText(/Agent start, stop, and retry controls are hidden/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Open Agent' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Review timeline' }));

    expect(mocks.onOpenTab).toHaveBeenCalledWith('timeline');
  });
});
