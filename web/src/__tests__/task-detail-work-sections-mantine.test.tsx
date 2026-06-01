import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DeliverablesSection } from '@/components/task/DeliverablesSection';
import { LessonsLearnedSection } from '@/components/task/LessonsLearnedSection';
import { SubtasksSection } from '@/components/task/SubtasksSection';
import { createMockTask, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  addSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
  toggleCriteria: vi.fn(),
  addDeliverable: vi.fn(),
  updateDeliverable: vi.fn(),
  deleteDeliverable: vi.fn(),
}));

vi.mock('@/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTasks')>('@/hooks/useTasks');
  return {
    ...actual,
    useAddSubtask: () => ({ mutateAsync: mocks.addSubtask }),
    useUpdateSubtask: () => ({ mutateAsync: mocks.updateSubtask }),
    useDeleteSubtask: () => ({ mutateAsync: mocks.deleteSubtask }),
    useToggleSubtaskCriteria: () => ({ mutateAsync: mocks.toggleCriteria }),
  };
});

vi.mock('@/hooks/useDeliverables', () => ({
  useAddDeliverable: () => ({ mutateAsync: mocks.addDeliverable, isPending: false }),
  useUpdateDeliverable: () => ({ mutateAsync: mocks.updateDeliverable, isPending: false }),
  useDeleteDeliverable: () => ({ mutateAsync: mocks.deleteDeliverable, isPending: false }),
}));

describe('task detail work sections Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.addSubtask.mockResolvedValue(undefined);
    mocks.updateSubtask.mockResolvedValue(undefined);
    mocks.deleteSubtask.mockResolvedValue(undefined);
    mocks.toggleCriteria.mockResolvedValue(undefined);
    mocks.addDeliverable.mockResolvedValue(undefined);
    mocks.updateDeliverable.mockResolvedValue(undefined);
    mocks.deleteDeliverable.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders subtasks through direct Mantine controls and keeps mutations wired', async () => {
    const user = userEvent.setup();
    const onAutoCompleteChange = vi.fn();
    const task = createMockTask({
      autoCompleteOnSubtasks: true,
      subtasks: [
        {
          id: 'sub-1',
          title: 'Write unit tests',
          completed: false,
          created: '2026-06-01T09:00:00Z',
          acceptanceCriteria: ['Covers add path'],
          criteriaChecked: [false],
        },
        {
          id: 'sub-2',
          title: 'Run smoke',
          completed: true,
          created: '2026-06-01T09:05:00Z',
        },
      ],
    });

    const { baseElement, container } = renderWithProviders(
      <SubtasksSection task={task} onAutoCompleteChange={onAutoCompleteChange} />
    );

    expect(container.querySelector('.mantine-Checkbox-root')).toBeDefined();
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(container.querySelector('.mantine-Switch-root')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="checkbox"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Mark subtask Write unit tests' }));
    await user.click(screen.getByRole('button', { name: 'Expand criteria for Write unit tests' }));
    await user.click(screen.getByRole('checkbox', { name: 'Mark criterion Covers add path' }));
    await user.type(screen.getByRole('textbox', { name: 'New subtask' }), 'Document rollout');
    await user.click(screen.getByRole('button', { name: /add acceptance criteria/i }));
    await user.type(screen.getByRole('textbox', { name: 'Criterion 1' }), 'Reviewer approved');
    await user.click(screen.getByRole('button', { name: 'Add subtask' }));
    await user.click(
      screen.getByRole('switch', { name: 'Auto-complete task when all subtasks done' })
    );

    expect(mocks.updateSubtask).toHaveBeenCalledWith({
      taskId: task.id,
      subtaskId: 'sub-1',
      updates: { completed: true },
    });
    expect(mocks.toggleCriteria).toHaveBeenCalledWith({
      taskId: task.id,
      subtaskId: 'sub-1',
      criteriaIndex: 0,
    });
    expect(mocks.addSubtask).toHaveBeenCalledWith({
      taskId: task.id,
      title: 'Document rollout',
      acceptanceCriteria: ['Reviewer approved'],
    });
    expect(onAutoCompleteChange).toHaveBeenCalledWith(false);
  });

  it('renders deliverable add and edit forms through direct Mantine primitives', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-deliverables',
      deliverables: [
        {
          id: 'del-1',
          title: 'Release notes',
          type: 'document',
          status: 'pending',
          path: 'https://example.com/release-notes',
          description: 'Draft notes',
          created: '2026-06-01T09:00:00Z',
        },
      ],
    });

    const { baseElement, container } = renderWithProviders(<DeliverablesSection task={task} />);

    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit deliverable' }));
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Textarea-root')).toBeDefined();

    fireEvent.change(screen.getByRole('textbox', { name: 'Deliverable title' }), {
      target: { value: 'Final release notes' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.updateDeliverable).toHaveBeenCalledWith({
      taskId: task.id,
      deliverableId: 'del-1',
      title: 'Final release notes',
      type: 'document',
      path: 'https://example.com/release-notes',
      status: 'pending',
      description: 'Draft notes',
    });
  });

  it('uses direct Mantine add controls and delete modal for deliverables', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-deliverable-actions',
      deliverables: [
        {
          id: 'del-2',
          title: 'QA checklist',
          type: 'report',
          status: 'reviewed',
          created: '2026-06-01T09:00:00Z',
        },
      ],
    });

    const { baseElement, container } = renderWithProviders(<DeliverablesSection task={task} />);

    await user.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New deliverable title' }), {
      target: { value: 'Build artifact' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'New deliverable path or URL' }), {
      target: { value: '/tmp/build.zip' },
    });
    await user.click(screen.getByRole('button', { name: 'Add Deliverable' }));

    expect(mocks.addDeliverable).toHaveBeenCalledWith({
      taskId: task.id,
      title: 'Build artifact',
      type: 'document',
      path: '/tmp/build.zip',
      description: undefined,
    });

    await user.click(screen.getByRole('button', { name: 'Delete deliverable' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete deliverable?' });
    expect(container.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mocks.deleteDeliverable).toHaveBeenCalledWith({
      taskId: task.id,
      deliverableId: 'del-2',
    });
  });

  it('renders lessons learned through direct Mantine controls and keeps updates wired', () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    const task = createMockTask({
      status: 'done',
      lessonsLearned: 'Initial note',
      lessonTags: ['release'],
    });

    const { baseElement, container } = renderWithProviders(
      <LessonsLearnedSection task={task} onUpdate={onUpdate} />
    );

    expect(container.querySelector('.mantine-Textarea-root')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();

    fireEvent.change(
      screen.getByPlaceholderText(
        'What did you learn from this task? What would you do differently next time?'
      ),
      { target: { value: 'Document the deployment checklist' } }
    );
    vi.advanceTimersByTime(500);

    fireEvent.change(screen.getByRole('textbox', { name: 'New lesson tag' }), {
      target: { value: 'deployment' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add lesson tag' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove release tag' }));

    expect(onUpdate).toHaveBeenCalledWith('lessonsLearned', 'Document the deployment checklist');
    expect(onUpdate).toHaveBeenCalledWith('lessonTags', ['release', 'deployment']);
    expect(onUpdate).toHaveBeenCalledWith('lessonTags', []);
  });
});
