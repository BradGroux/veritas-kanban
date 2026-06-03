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
  useTaskWorkProducts: vi.fn(),
}));

vi.mock('@/hooks/useWorkProducts', () => ({
  useTaskWorkProducts: mocks.useTaskWorkProducts,
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
    mocks.useTaskWorkProducts.mockReturnValue({ data: [], isLoading: false });
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
    expect(screen.getByText('Release readiness report')).toBeDefined();
    expect(screen.getByText('v3 | report | run run-456')).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Open origin for Release readiness report' })
        .getAttribute('href')
    ).toBe('/runs/run-456');

    await user.click(screen.getByRole('button', { name: 'Open Agent' }));
    await user.click(screen.getByRole('button', { name: 'Work Products' }));
    await user.click(screen.getByRole('button', { name: 'Workflow' }));

    expect(mocks.onOpenTab).toHaveBeenCalledWith('agent');
    expect(mocks.onOpenTab).toHaveBeenCalledWith('work-products');
    expect(mocks.onOpenWorkflow).toHaveBeenCalled();
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
});
