import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TaskDetailPanel } from '@/components/task/TaskDetailPanel';
import { MarkdownEditor } from '@/components/ui/MarkdownEditor';
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

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: false,
    connectionState: 'disconnected',
    reconnectAttempt: 0,
    send: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    lastMessage: null,
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
  WorkflowSection: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Run Workflow" /> : null,
}));

vi.mock('@/components/evidence/EvidenceTimelinePanel', () => ({
  EvidenceTimelinePanel: () => (
    <div data-testid="long-evidence-content">
      Long evidence timeline content remains inside the task detail scroll region
    </div>
  ),
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
    expect(container.querySelector('.mantine-Drawer-overlay')?.className).toContain(
      'veritas-overlay'
    );
    expect(screen.getByTestId('task-detail-panel').className).toContain('veritas-overlay-surface');
    expect(screen.getByTestId('task-detail-panel').className).toContain('min-h-0');
    const scrollRegion = screen.getByTestId('task-detail-scroll-region');
    expect(scrollRegion.className).toContain('min-h-0');
    expect(scrollRegion.className).toContain('overflow-y-scroll');
    expect(scrollRegion.className).toContain('overscroll-contain');
    expect(scrollRegion.getAttribute('tabindex')).toBe('0');
    expect(scrollRegion.contains(screen.getByLabelText('Task title'))).toBe(false);
    const taskDescription = within(scrollRegion).getByLabelText('Task description');
    expect(taskDescription.className).toContain('min-h-[180px]');
    expect(taskDescription.className).toContain('resize-y');
    expect((taskDescription as HTMLTextAreaElement).style.resize).toBe('vertical');
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

  it('keeps Details and Evidence in the same desktop viewport scroll region', async () => {
    const user = userEvent.setup();
    renderTaskDetail();

    const scrollRegion = screen.getByTestId('task-detail-scroll-region');
    expect(within(scrollRegion).getByLabelText('Task description')).toBeDefined();

    await user.click(screen.getByRole('tab', { name: 'Evidence' }));

    expect(await within(scrollRegion).findByTestId('long-evidence-content')).toBeDefined();
    expect(screen.getByTestId('task-detail-scroll-region')).toBe(scrollRegion);
  });

  it('applies description height and vertical resizing to the textarea input', () => {
    renderWithProviders(
      <MarkdownEditor
        value={'Long task description\n'.repeat(20)}
        onChange={vi.fn()}
        minHeight={180}
        ariaLabel="Resizable task description"
      />
    );

    const textarea = screen.getByLabelText('Resizable task description');
    expect(textarea.className).toContain('resize-y');
    expect((textarea as HTMLTextAreaElement).style.minHeight).toBe('180px');
    expect((textarea as HTMLTextAreaElement).style.resize).toBe('vertical');
  });

  it('keeps the task drawer open when Escape belongs to a nested Workflow dialog', async () => {
    const user = userEvent.setup();
    renderTaskDetail();

    await user.click(screen.getByRole('button', { name: 'Workflow' }));
    expect(screen.getByRole('dialog', { name: 'Run Workflow' })).toBeDefined();

    fireEvent.keyDown(screen.getByTestId('task-detail-panel'), { key: 'Escape' });

    expect(mocks.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('task-detail-panel')).toBeDefined();
  });

  it('keeps title editing and progress tab behavior wired after the migration', async () => {
    const { baseElement } = renderTaskDetail();
    const detailsTab = screen.getByRole('tab', { name: 'Details' });
    const progressTab = screen.getByRole('tab', { name: 'Progress' });

    await waitFor(() => expect(detailsTab.getAttribute('aria-selected')).toBe('true'));

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Renamed task' } });
    fireEvent.click(progressTab);

    expect(mocks.updateField).toHaveBeenCalledWith('title', 'Renamed task');
    await waitFor(() => expect(progressTab.getAttribute('aria-selected')).toBe('true'));
    expect(await screen.findByText('Progress Notes', {}, { timeout: 5000 })).toBeDefined();
    expect(
      await screen.findByText('Mantine task detail renders', {}, { timeout: 5000 })
    ).toBeDefined();
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
