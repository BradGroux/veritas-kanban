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
  identity: {
    authContext: null as unknown,
    hasPermission: vi.fn((_permission: string) => true),
  },
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
    isPending: false,
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

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => mocks.identity,
}));

vi.mock('@/components/dashboard/ExportDialog', () => ({
  ExportDialog: ({ open }: { open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Export task metrics">
        Export task metrics
      </div>
    ) : null,
}));

vi.mock('@/components/task/RunSessionSharesSection', () => ({
  RunSessionSharesSection: () => <div>Run session shares</div>,
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
    mocks.identity.authContext = null;
    mocks.identity.hasPermission.mockImplementation(() => true);
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

  it('hides agent start controls for mobile device sessions without agent write permission', () => {
    mocks.identity.authContext = {
      authMethod: 'device-session',
      clientMode: 'mobile-pwa',
      isLocalhost: false,
      permissions: ['workspace:read', 'task:read', 'agent:read'],
      role: 'read-only',
    };
    mocks.identity.hasPermission.mockImplementation(
      (permission: string) => permission !== 'agent:write'
    );
    const task = createMockTask({
      id: 'task-agent-mobile',
      title: 'Review mobile run',
      description: 'Review the run history from a paired mobile client.',
      type: 'code',
      git: { repo: 'veritas', branch: 'feature/mobile', baseBranch: 'main', worktreePath: '/tmp' },
    });

    renderWithProviders(<AgentPanel task={task} />);

    expect(screen.getByText('Agent controls unavailable for this client')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Agent' })).toBeNull();
  });

  it('keeps running-agent message send and stop confirmation wired through Mantine modal', async () => {
    const user = userEvent.setup();
    mocks.useAgentStatus.mockReturnValue({
      data: {
        running: true,
        attemptId: 'attempt-1',
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
            {
              action: 'message',
              capabilityId: 'run.steer',
              state: 'advisory',
              available: true,
              advisory: true,
              reason: 'Steering is advisory.',
            },
          ],
        },
      },
    });
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

    await user.click(screen.getByRole('button', { name: 'Stop agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stop the agent?' });
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop Agent' }));

    expect(mocks.sendMessageMutate).toHaveBeenCalledWith({
      taskId: 'task-agent-running',
      attemptId: 'attempt-1',
      message: 'continue with tests',
    });
    expect(mocks.stopAgentMutate).toHaveBeenCalledWith({
      taskId: 'task-agent-running',
      attemptId: 'attempt-1',
    });
    expect(dialog).toBeDefined();
  });

  it('disables unsupported run controls with accessible capability reasons', () => {
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
              reason: 'This provider cannot stop task sessions.',
            },
            {
              action: 'message',
              capabilityId: 'run.steer',
              state: 'unknown',
              available: false,
              advisory: false,
              reason: 'Steering has not been verified.',
            },
          ],
        },
      },
    });
    mocks.useAgentStream.mockReturnValue({
      outputs: [],
      isConnected: true,
      isRunning: true,
      clearOutputs: mocks.clearOutputs,
    });

    renderWithProviders(
      <AgentPanel
        task={createMockTask({
          id: 'task-agent-limited',
          git: { repo: 'veritas', branch: 'limited', baseBranch: 'main', worktreePath: '/tmp' },
        })}
      />
    );

    expect(
      screen
        .getByRole('button', {
          name: 'Stop agent unavailable: This provider cannot stop task sessions.',
        })
        .getAttribute('disabled')
    ).not.toBeNull();
    expect(screen.getByText('Message: Steering has not been verified.')).toBeDefined();
  });

  it('uses terminal status over a stale running WebSocket flag', () => {
    mocks.useAgentStatus.mockReturnValue({
      data: { running: false },
      error: null,
      isFetching: false,
    });
    mocks.useAgentStream.mockReturnValue({
      outputs: [],
      isConnected: true,
      isRunning: true,
      clearOutputs: mocks.clearOutputs,
    });

    renderWithProviders(
      <AgentPanel
        task={createMockTask({
          id: 'task-agent-stopped',
          git: { repo: 'veritas', branch: 'stopped', baseBranch: 'main', worktreePath: '/tmp' },
        })}
      />
    );

    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop agent' })).toBeNull();
    expect(screen.getByText('Agent output will appear here')).toBeDefined();
  });

  it('preserves a realtime start signal while idle status is refreshing', () => {
    mocks.useAgentStatus.mockReturnValue({
      data: { running: false },
      error: null,
      isFetching: true,
    });
    mocks.useAgentStream.mockReturnValue({
      outputs: [],
      isConnected: true,
      isRunning: true,
      clearOutputs: mocks.clearOutputs,
    });

    renderWithProviders(
      <AgentPanel
        task={createMockTask({
          id: 'task-agent-starting-externally',
          git: { repo: 'veritas', branch: 'external', baseBranch: 'main', worktreePath: '/tmp' },
        })}
      />
    );

    expect(screen.getByText('Running')).toBeDefined();
  });

  it('disables an open stop confirmation when refreshed capability evidence fails', async () => {
    const user = userEvent.setup();
    const supportedStatus = {
      running: true,
      attemptId: 'attempt-1',
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
    };
    mocks.useAgentStatus.mockReturnValue({ data: supportedStatus, error: null });
    mocks.useAgentStream.mockReturnValue({
      outputs: [],
      isConnected: true,
      isRunning: true,
      clearOutputs: mocks.clearOutputs,
    });
    const task = createMockTask({
      id: 'task-agent-stop-race',
      git: { repo: 'veritas', branch: 'stop-race', baseBranch: 'main', worktreePath: '/tmp' },
    });
    const { rerender } = renderWithProviders(<AgentPanel task={task} />);

    await user.click(screen.getByRole('button', { name: 'Stop agent' }));
    mocks.useAgentStatus.mockReturnValue({
      data: supportedStatus,
      error: new Error('Runtime manifest status refresh failed.'),
    });
    rerender(<AgentPanel task={task} />);

    const confirm = screen.getByRole('button', { name: 'Stop Agent' });
    expect(confirm.getAttribute('disabled')).not.toBeNull();
    expect(
      screen.getByText('Stop unavailable: Runtime manifest status refresh failed.')
    ).toBeDefined();
    expect(mocks.stopAgentMutate).not.toHaveBeenCalled();
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
