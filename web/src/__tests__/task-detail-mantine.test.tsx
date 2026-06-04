import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import { renderWithProviders, createMockTask } from './test-utils';

const mocks = vi.hoisted(() => ({
  archiveTask: vi.fn(),
  deleteTask: vi.fn(),
  updateField: vi.fn(),
  updateProgress: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock('@/hooks/useDebouncedSave', () => ({
  useDebouncedSave: (task: unknown) => ({
    localTask: task,
    updateField: mocks.updateField,
    isDirty: false,
  }),
}));

vi.mock('@/hooks/useTaskTypes', () => ({
  useTaskTypes: () => ({
    data: [
      { id: 'feature', label: 'Feature', icon: 'Code' },
      { id: 'code', label: 'Code', icon: 'Code' },
    ],
  }),
  getTypeIcon: () => undefined,
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: {
      tasks: {
        enableAttachments: true,
        enableComments: false,
        enableDependencies: false,
        enableTimeTracking: false,
      },
      agents: {
        enablePreview: true,
      },
      markdown: {
        enableMarkdown: false,
      },
    },
  }),
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [{ id: 'proj-1', label: 'Veritas' }],
  }),
}));

vi.mock('@/hooks/useSprints', () => ({
  useSprints: () => ({
    data: [{ id: 'sprint-1', label: 'Sprint 1' }],
  }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    data: {
      agents: [{ type: 'codex', name: 'Codex', enabled: true }],
    },
  }),
}));

vi.mock('@/hooks/useWorkProducts', () => ({
  useTaskWorkProducts: () => ({ data: [], isLoading: false }),
  useWorkProductVersions: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/useTasks', () => ({
  useAddObservation: () => ({ mutateAsync: vi.fn() }),
  useDeleteObservation: () => ({ mutateAsync: vi.fn() }),
  useDeleteTask: () => ({ mutateAsync: mocks.deleteTask }),
  useArchiveTask: () => ({ mutateAsync: mocks.archiveTask }),
}));

vi.mock('@/hooks/useTaskProgress', () => ({
  useTaskProgress: () => ({
    data: '## Learnings\n- Mantine task detail renders',
    isLoading: false,
  }),
  useUpdateProgress: () => ({ mutateAsync: mocks.updateProgress, isPending: false }),
}));

vi.mock('@/components/task/GitSection', () => ({
  GitSection: () => <div>Git section</div>,
}));

vi.mock('@/components/task/AgentPanel', () => ({
  AgentPanel: () => <div>Agent panel</div>,
}));

vi.mock('@/components/task/AgentRunTimelinePanel', () => ({
  AgentRunTimelinePanel: () => <div>Run timeline panel</div>,
}));

vi.mock('@/components/task/DiffViewer', () => ({
  DiffViewer: () => <div>Diff viewer</div>,
}));

vi.mock('@/components/task/ReviewPanel', () => ({
  ReviewPanel: () => <div>Review panel</div>,
}));

vi.mock('@/components/task/PreviewPanel', () => ({
  PreviewPanel: () => null,
}));

vi.mock('@/components/task/AttachmentsSection', () => ({
  AttachmentsSection: () => <div>Attachments section</div>,
}));

vi.mock('@/components/task/ObservationsSection', () => ({
  ObservationsSection: () => <div>Observations section</div>,
}));

vi.mock('@/components/chat/ChatPanel', () => ({
  ChatPanel: () => null,
}));

vi.mock('@/components/task/ApplyTemplateDialog', () => ({
  ApplyTemplateDialog: () => null,
}));

vi.mock('@/components/task/TaskMetricsPanel', () => ({
  TaskMetricsPanel: () => <div>Metrics panel</div>,
}));

vi.mock('@/components/task/WorkflowSection', () => ({
  WorkflowSection: () => null,
}));

vi.mock('@/components/task/SubtasksSection', () => ({
  SubtasksSection: () => <div>Subtasks section</div>,
}));

vi.mock('@/components/task/VerificationSection', () => ({
  VerificationSection: () => <div>Verification section</div>,
}));

vi.mock('@/components/task/DeliverablesSection', () => ({
  DeliverablesSection: () => <div>Deliverables section</div>,
}));

function renderTaskDetail() {
  const task = createMockTask({
    id: 'task-1',
    title: 'Ship Mantine task detail',
    description: 'Task detail migration',
    priority: 'high',
    project: 'proj-1',
    sprint: 'sprint-1',
    agent: 'codex',
  });

  return renderWithProviders(
    <TaskDetailPanel task={task} open onOpenChange={mocks.onOpenChange} />
  );
}

describe('task detail Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.archiveTask.mockResolvedValue(undefined);
    mocks.deleteTask.mockResolvedValue(undefined);
    mocks.updateProgress.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the task detail shell and metadata controls through direct Mantine primitives', () => {
    const { baseElement, container } = renderTaskDetail();

    expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe(
      'Ship Mantine task detail'
    );
    expect(screen.getByRole('tab', { name: 'Work' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Details' })).toBeDefined();
    expect(screen.queryByRole('tab', { name: 'Git' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Timeline' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Chat' })).toBeDefined();
    expect(container.querySelector('.mantine-Drawer-content')).toBeDefined();
    expect(container.querySelector('.mantine-Tabs-root')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="tabs-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
  });

  it('keeps title editing and progress tab behavior wired after the migration', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderTaskDetail();

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Renamed task' } });
    await user.click(screen.getByRole('tab', { name: 'Progress' }));

    expect(mocks.updateField).toHaveBeenCalledWith('title', 'Renamed task');
    expect(await screen.findByText('Progress Notes')).toBeDefined();
    expect(await screen.findByText('Mantine task detail renders')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();
  });

  it('uses a direct Mantine modal for destructive delete confirmation', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderTaskDetail();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete this task?' });
    expect(dialog).toBeDefined();
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mocks.deleteTask).toHaveBeenCalledWith('task-1'));
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('defaults code tasks with execution context to the Work tab', () => {
    const task = createMockTask({
      id: 'task-code-work',
      title: 'Ship task work view',
      description: 'Add a unified task work view with enough execution context.',
      type: 'code',
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'v5-task-work-view-readiness',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-worktree',
      },
      verificationSteps: [{ id: 'verify-1', description: 'Run focused test', checked: false }],
    });

    renderWithProviders(<TaskDetailPanel task={task} open onOpenChange={mocks.onOpenChange} />);

    expect(screen.getByRole('tab', { name: 'Work' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeDefined();
    expect(screen.getByText('Work View')).toBeDefined();
  });

  it('falls back when the active tab becomes unavailable for the task data', async () => {
    const user = userEvent.setup();
    const codeTask = createMockTask({
      id: 'task-tab-fallback',
      title: 'Investigate agent run',
      type: 'code',
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'tab-fallback',
        baseBranch: 'main',
      },
    });

    const { rerender } = renderWithProviders(
      <TaskDetailPanel task={codeTask} open onOpenChange={mocks.onOpenChange} />
    );

    await user.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe(
      'true'
    );

    const featureTask = {
      ...codeTask,
      type: 'feature',
      git: undefined,
    };
    rerender(<TaskDetailPanel task={featureTask} open onOpenChange={mocks.onOpenChange} />);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe(
        'true'
      )
    );
    expect(screen.queryByRole('tab', { name: 'Timeline' })).toBeNull();
  });
});
