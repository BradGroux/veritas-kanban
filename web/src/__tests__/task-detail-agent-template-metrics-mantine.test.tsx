import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgentPanel } from '@/components/task/AgentPanel';
import { ApplyTemplateDialog } from '@/components/task/ApplyTemplateDialog';
import { TaskMetricsPanel } from '@/components/task/TaskMetricsPanel';
import { BlueprintPreview } from '@/components/task/create/BlueprintPreview';
import { TemplateVariableInputs } from '@/components/task/create/TemplateVariableInputs';
import { api } from '@/lib/api';
import { createMockTask, renderWithProviders } from './test-utils';
import type { TaskTemplate } from '@/hooks/useTemplates';

const mocks = vi.hoisted(() => ({
  useConfig: vi.fn(),
  useAgentStatus: vi.fn(),
  useAgentStream: vi.fn(),
  useAgentAttempts: vi.fn(),
  useAgentLog: vi.fn(),
  useResolveAgent: vi.fn(),
  startAgentMutate: vi.fn(),
  stopAgentMutate: vi.fn(),
  sendMessageMutate: vi.fn(),
  clearOutputs: vi.fn(),
  refetchAttempts: vi.fn(),
  useTemplates: vi.fn(),
  updateTaskMutateAsync: vi.fn(),
  useTaskMetrics: vi.fn(),
  applyTemplateActivity: vi.fn(),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: mocks.useConfig,
}));

vi.mock('@/hooks/useAgent', () => ({
  useAgentStatus: mocks.useAgentStatus,
  useAgentStream: mocks.useAgentStream,
  useAgentAttempts: mocks.useAgentAttempts,
  useAgentLog: mocks.useAgentLog,
  useStartAgent: () => ({
    mutate: mocks.startAgentMutate,
    isPending: false,
  }),
  useStopAgent: () => ({
    mutate: mocks.stopAgentMutate,
  }),
  useSendMessage: () => ({
    mutate: mocks.sendMessageMutate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useRouting', () => ({
  useResolveAgent: mocks.useResolveAgent,
}));

vi.mock('@/hooks/useTemplates', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useTemplates')>('@/hooks/useTemplates');
  return {
    ...actual,
    useTemplates: mocks.useTemplates,
  };
});

vi.mock('@/hooks/useTasks', () => ({
  useUpdateTask: () => ({
    mutateAsync: mocks.updateTaskMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useTaskMetrics', () => ({
  useTaskMetrics: mocks.useTaskMetrics,
}));

vi.mock('@/components/dashboard/ExportDialog', () => ({
  ExportDialog: ({ open }: { open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Export task metrics">
        Export task metrics
      </div>
    ) : null,
}));

vi.mock('@/lib/api', () => ({
  api: {
    tasks: {
      applyTemplate: mocks.applyTemplateActivity,
    },
  },
}));

const template: TaskTemplate = {
  id: 'template-bug',
  name: 'Bug Fix',
  description: 'Resolve defect',
  category: 'bug',
  version: 1,
  taskDefaults: {
    type: 'bug',
    priority: 'high',
    project: 'veritas',
    descriptionTemplate: 'Fix {{custom:bugId}} for {{project}}',
  },
  subtaskTemplates: [
    {
      title: 'Verify {{custom:bugId}}',
      order: 1,
      acceptanceCriteria: ['{{custom:bugId}} includes regression evidence'],
    },
  ],
  created: '2026-06-01T09:00:00Z',
  updated: '2026-06-01T09:00:00Z',
};

describe('task detail agent, template, and metrics Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.useConfig.mockReturnValue({
      data: {
        defaultAgent: 'codex',
        agents: [
          { type: 'codex', name: 'Codex', enabled: true },
          { type: 'claude', name: 'Claude', enabled: true },
        ],
      },
    });
    mocks.useAgentStatus.mockReturnValue({ data: { running: false } });
    mocks.useAgentStream.mockReturnValue({
      outputs: [],
      isConnected: true,
      isRunning: false,
      clearOutputs: mocks.clearOutputs,
    });
    mocks.useAgentAttempts.mockReturnValue({
      data: ['attempt-1'],
      refetch: mocks.refetchAttempts,
    });
    mocks.useAgentLog.mockReturnValue({ data: null, isLoading: false });
    mocks.useResolveAgent.mockReturnValue({
      data: { agent: 'codex', model: 'sonnet', reason: 'Best configured agent' },
    });
    mocks.useTemplates.mockReturnValue({ data: [template] });
    mocks.updateTaskMutateAsync.mockResolvedValue({});
    mocks.applyTemplateActivity.mockResolvedValue({});
    mocks.useTaskMetrics.mockReturnValue({
      data: {
        totalRuns: 2,
        successfulRuns: 1,
        failedRuns: 1,
        successRate: 0.5,
        totalDurationMs: 120000,
        avgDurationMs: 60000,
        totalInputTokens: 1200,
        totalOutputTokens: 800,
        totalCacheTokens: 300,
        totalCost: 0.18,
        lastRun: {
          agent: 'codex',
          model: 'sonnet',
          success: true,
          durationMs: 60000,
        },
        attempts: [
          {
            attemptId: 'attempt-1',
            agent: 'codex',
            model: 'sonnet',
            startTime: '2026-06-01T09:00:00Z',
            durationMs: 60000,
            totalTokens: 2000,
            inputTokens: 1200,
            outputTokens: 800,
            cacheTokens: 300,
            cost: 0.18,
            success: true,
          },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders agent controls through direct Mantine controls and keeps start wired', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-agent',
      title: 'Run agent readiness path',
      description:
        'Start the configured agent and produce an evidence artifact after focused verification.',
      type: 'code',
      priority: 'medium',
      git: { repo: 'veritas', branch: 'feature/agent', baseBranch: 'main', worktreePath: '/tmp' },
      subtasks: [
        {
          id: 'sub-ready',
          title: 'Confirm agent output',
          completed: false,
          created: '2026-06-01T09:00:00Z',
          acceptanceCriteria: ['Agent output includes verification evidence'],
        },
      ],
      verificationSteps: [
        { id: 'verify-ready', description: 'Run agent panel test', checked: false },
      ],
    });

    const { baseElement, container } = renderWithProviders(<AgentPanel task={task} />);

    expect(container.querySelectorAll('.mantine-Select-root')).toHaveLength(2);
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(mocks.clearOutputs).toHaveBeenCalled();
    expect(mocks.startAgentMutate).toHaveBeenCalledWith(
      { taskId: 'task-agent', agent: 'codex' },
      { onSuccess: expect.any(Function) }
    );
  });

  it('requires an override reason before starting an incomplete agent task', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-agent-incomplete',
      title: 'Fix',
      description: 'Too short',
      type: 'code',
      git: { repo: 'veritas', branch: 'feature/agent', baseBranch: 'main', worktreePath: '/tmp' },
    });

    renderWithProviders(<AgentPanel task={task} />);

    expect(screen.getByText('Task is not ready for agent execution')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(
      await screen.findByRole('dialog', { name: 'Start with readiness override?' })
    ).toBeDefined();
    expect(mocks.startAgentMutate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Override reason'), 'Maintainer approved urgent fix');
    await user.click(screen.getByRole('button', { name: 'Start Anyway' }));

    expect(mocks.clearOutputs).toHaveBeenCalled();
    expect(mocks.startAgentMutate).toHaveBeenCalledWith(
      {
        taskId: 'task-agent-incomplete',
        agent: 'codex',
        overrideReason: 'Maintainer approved urgent fix',
      },
      { onSuccess: expect.any(Function) }
    );
  });

  it('keeps running-agent message send and stop confirmation wired through Mantine modal', async () => {
    const user = userEvent.setup();
    mocks.useAgentStatus.mockReturnValue({ data: { running: true } });
    mocks.useAgentStream.mockReturnValue({
      outputs: [{ type: 'stdout', content: 'working' }],
      isConnected: true,
      isRunning: true,
      clearOutputs: mocks.clearOutputs,
    });
    const task = createMockTask({
      id: 'task-agent-running',
      git: { repo: 'veritas', branch: 'feature/agent', baseBranch: 'main', worktreePath: '/tmp' },
    });

    const { baseElement, container } = renderWithProviders(<AgentPanel task={task} />);

    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('Send a message to the agent...'), {
      target: { value: 'continue with tests' },
    });
    const messageForm = screen
      .getByPlaceholderText('Send a message to the agent...')
      .closest('form');
    expect(messageForm).not.toBeNull();
    fireEvent.submit(messageForm as HTMLFormElement);

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stop the agent?' });
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop Agent' }));

    expect(mocks.sendMessageMutate).toHaveBeenCalledWith({
      taskId: 'task-agent-running',
      message: 'continue with tests',
    });
    expect(mocks.stopAgentMutate).toHaveBeenCalledWith('task-agent-running');
    expect(dialog).toBeDefined();
  });

  it('applies a template through direct Mantine modal, tabs, select, switch, and inputs', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onApplied = vi.fn();
    const task = createMockTask({
      id: 'task-template',
      description: '',
      project: 'veritas',
      priority: undefined,
      subtasks: [],
    });

    const { baseElement, container } = renderWithProviders(
      <ApplyTemplateDialog task={task} open onOpenChange={onOpenChange} onApplied={onApplied} />
    );

    expect(container.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(container.querySelector('.mantine-Tabs-root')).toBeDefined();
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="tabs-list"]')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Template' }));
    await user.click(await screen.findByRole('option', { name: /Bug Fix - Resolve defect/ }));
    fireEvent.change(screen.getByLabelText('bugId'), { target: { value: 'BUG-42' } });
    await user.click(screen.getByRole('switch', { name: 'Force overwrite' }));
    await user.click(screen.getByRole('button', { name: 'Apply Template' }));

    await waitFor(() => {
      expect(mocks.updateTaskMutateAsync).toHaveBeenCalledWith({
        id: 'task-template',
        input: expect.objectContaining({
          description: 'Fix BUG-42 for veritas',
          priority: 'high',
          project: 'veritas',
          subtasks: expect.arrayContaining([
            expect.objectContaining({
              title: 'Verify BUG-42',
              completed: false,
              acceptanceCriteria: ['BUG-42 includes regression evidence'],
              criteriaChecked: [false],
            }),
          ]),
        }),
      });
    });
    expect(api.tasks.applyTemplate).toHaveBeenCalledWith(
      'task-template',
      'template-bug',
      'Bug Fix',
      expect.arrayContaining(['description', 'priority', 'project', 'subtasks'])
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApplied).toHaveBeenCalled();
  });

  it('renders task metrics and export controls through direct Mantine primitives', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-metrics',
      comments: [
        {
          id: 'comment-1',
          author: 'User',
          text: 'Looks good',
          timestamp: '2026-06-01T09:00:00Z',
        },
      ],
      subtasks: [{ id: 'subtask-1', title: 'Write tests', completed: true, created: '' }],
      attachments: [
        {
          id: 'attachment-1',
          filename: 'notes.txt',
          originalName: 'notes.txt',
          mimeType: 'text/plain',
          size: 12,
          uploaded: '2026-06-01T09:00:00Z',
        },
      ],
      timeTracking: { totalSeconds: 1800, entries: [], isRunning: false },
    });

    const { baseElement, container } = renderWithProviders(<TaskMetricsPanel task={task} />);

    expect(screen.getByText('Task Overview')).toBeDefined();
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="skeleton"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: /codex sonnet/i }));
    expect(screen.getByText('Input:')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('dialog', { name: 'Export task metrics' })).toBeDefined();
  });

  it('renders create-template helper surfaces through direct Mantine inputs and papers', () => {
    const onChange = vi.fn();
    const { baseElement, container, rerender } = renderWithProviders(
      <TemplateVariableInputs variables={['ticket']} values={{ ticket: '' }} onChange={onChange} />
    );

    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="label"]')).toBeNull();

    fireEvent.change(screen.getByLabelText('ticket'), { target: { value: 'VK-5' } });
    expect(onChange).toHaveBeenCalledWith('ticket', 'VK-5');

    rerender(
      <BlueprintPreview
        template={{
          ...template,
          blueprint: [
            {
              refId: 'task-a',
              title: 'Build foundation',
              taskDefaults: { type: 'feature' },
              subtaskTemplates: [{ title: 'Review', order: 1 }],
            },
          ],
        }}
      />
    );

    expect(screen.getByText('Blueprint: Multiple Tasks')).toBeDefined();
    expect(
      screen.getByText((_, node) => node?.textContent === '1. Build foundation')
    ).toBeDefined();
    expect(baseElement.querySelector('[data-slot="label"]')).toBeNull();
  });
});
