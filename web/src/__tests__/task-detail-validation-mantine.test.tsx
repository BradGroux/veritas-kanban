import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BlockedReasonSection } from '@/components/task/BlockedReasonSection';
import { DependenciesSection } from '@/components/task/DependenciesSection';
import { VerificationSection } from '@/components/task/VerificationSection';
import { createMockTask, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  addVerificationStep: vi.fn(),
  updateVerificationStep: vi.fn(),
  deleteVerificationStep: vi.fn(),
  useTasks: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTasks')>('@/hooks/useTasks');
  return {
    ...actual,
    useTasks: mocks.useTasks,
    useAddVerificationStep: () => ({ mutateAsync: mocks.addVerificationStep }),
    useUpdateVerificationStep: () => ({ mutateAsync: mocks.updateVerificationStep }),
    useDeleteVerificationStep: () => ({ mutateAsync: mocks.deleteVerificationStep }),
  };
});

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe('task detail validation Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.addVerificationStep.mockResolvedValue(undefined);
    mocks.updateVerificationStep.mockResolvedValue(undefined);
    mocks.deleteVerificationStep.mockResolvedValue(undefined);
    mocks.useTasks.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders blocked reason controls through direct Mantine select and textarea', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const task = createMockTask({
      status: 'blocked',
      blockedReason: {
        category: 'waiting-on-feedback',
        note: 'Waiting for product confirmation',
      },
    });

    const { baseElement, container } = renderWithProviders(
      <BlockedReasonSection task={task} onUpdate={onUpdate} />
    );

    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelector('.mantine-Textarea-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Blocked category' }));
    await user.click(await screen.findByText('Technical Snag'));
    fireEvent.change(
      screen.getByPlaceholderText("Add details about what's blocking this task..."),
      {
        target: { value: 'Blocked by API logs' },
      }
    );

    expect(onUpdate).toHaveBeenCalledWith({
      category: 'technical-snag',
      note: 'Waiting for product confirmation',
    });
    expect(onUpdate).toHaveBeenCalledWith({
      category: 'waiting-on-feedback',
      note: 'Blocked by API logs',
    });
  });

  it('renders verification steps through direct Mantine controls and keeps mutations wired', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      verificationSteps: [
        {
          id: 'step-1',
          description: 'Write tests',
          checked: false,
        },
        {
          id: 'step-2',
          description: 'Run smoke',
          checked: true,
          checkedAt: '2026-06-01T09:00:00Z',
        },
      ],
    });

    const { baseElement, container } = renderWithProviders(<VerificationSection task={task} />);

    expect(container.querySelector('.mantine-Checkbox-root')).toBeDefined();
    expect(container.querySelector('.mantine-Progress-root')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="checkbox"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Mark verification step Write tests' }));
    await user.type(screen.getByRole('textbox', { name: 'New verification step' }), 'Manual QA');
    await user.click(screen.getByRole('button', { name: 'Add verification step' }));
    await user.click(screen.getByRole('button', { name: 'Delete verification step: Run smoke' }));

    expect(mocks.updateVerificationStep).toHaveBeenCalledWith({
      taskId: task.id,
      stepId: 'step-1',
      updates: { checked: true },
    });
    expect(mocks.addVerificationStep).toHaveBeenCalledWith({
      taskId: task.id,
      description: 'Manual QA',
    });
    expect(mocks.deleteVerificationStep).toHaveBeenCalledWith({
      taskId: task.id,
      stepId: 'step-2',
    });
  });

  it('renders dependency summaries and add selectors through direct Mantine primitives', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-main',
      dependencies: {
        depends_on: ['task-dep'],
        blocks: ['task-blocked'],
      },
    });
    mocks.useTasks.mockReturnValue({
      data: [
        task,
        createMockTask({ id: 'task-dep', title: 'Foundation task', status: 'todo' }),
        createMockTask({ id: 'task-blocked', title: 'Blocked downstream task', status: 'todo' }),
        createMockTask({ id: 'task-available', title: 'Available task', status: 'todo' }),
      ],
    });

    const { baseElement, container } = renderWithProviders(
      <DependenciesSection task={task} onBlockedByChange={vi.fn()} />
    );

    expect(screen.getByText('Foundation task')).toBeDefined();
    expect(screen.getByText('Blocked downstream task')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.mantine-Paper-root').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(2);
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add Dependency' }));

    expect(screen.getByRole('combobox', { name: 'Select dependency task' })).toBeDefined();
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
  });
});
