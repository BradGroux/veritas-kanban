import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import { TaskConflictAlert } from '@/components/task/TaskConflictAlert';
import { Toaster } from '@/components/ui/toaster';
import { useDebouncedSave } from '@/hooks/useDebouncedSave';
import {
  registerOpenTaskConflictSurface,
  resetTaskConflicts,
  resolveTaskConflict,
} from '@/hooks/useTaskConflicts';
import { useAddComment, useUpdateTask } from '@/hooks/useTasks';
import { createMockTask, createTestQueryClient, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  addComment: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    tasks: {
      update: mocks.update,
      addComment: mocks.addComment,
    },
  },
}));

vi.mock('@/hooks/useFeatureSettings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/useFeatureSettings')>();
  return {
    ...original,
    useFeatureSetting: () => 0,
  };
});

function conflictFor(current: Task) {
  return Object.assign(new Error('stale revision'), {
    code: 'CONFLICT',
    details: { current },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function ConflictBurstProbe() {
  const update = useUpdateTask();
  const addComment = useAddComment();
  return (
    <>
      <button onClick={() => update.mutate({ id: 'task-1', input: { title: 'Local' } })}>
        Update Alpha
      </button>
      <button onClick={() => addComment.mutate({ taskId: 'task-1', author: 'Brad', text: 'One' })}>
        Comment Alpha
      </button>
      <button onClick={() => addComment.mutate({ taskId: 'task-2', author: 'Brad', text: 'Two' })}>
        Comment Beta
      </button>
    </>
  );
}

function ConflictEditor({ initialTask }: { initialTask: Task }) {
  const taskQuery = useQuery({
    queryKey: ['tasks', initialTask.id],
    queryFn: async () => initialTask,
    initialData: initialTask,
    enabled: false,
  });
  const save = useDebouncedSave(taskQuery.data);

  useEffect(() => registerOpenTaskConflictSurface(initialTask.id), [initialTask.id]);

  if (!save.localTask) return null;

  return (
    <>
      <input
        aria-label="Task title"
        value={save.localTask.title}
        onChange={(event) => save.updateField('title', event.currentTarget.value)}
      />
      <span data-testid="dirty-state">{String(save.isDirty)}</span>
      {save.conflict ? (
        <TaskConflictAlert
          conflict={save.conflict}
          taskTitle={save.localTask.title}
          onRetry={save.retryConflict}
          onDiscard={save.discardConflict}
          onDismiss={() => resolveTaskConflict(save.localTask?.id ?? initialTask.id)}
        />
      ) : null}
    </>
  );
}

describe('task conflict recovery feature', () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.addComment.mockReset();
    resetTaskConflicts();
    notifications.clean();
  });

  afterEach(() => {
    cleanup();
    resetTaskConflicts();
    notifications.clean();
  });

  it('deduplicates one task revision while keeping different tasks actionable', async () => {
    const alpha = createMockTask({ id: 'task-1', title: 'Alpha', revision: 1 });
    const beta = createMockTask({ id: 'task-2', title: 'Beta', revision: 3 });
    const currentAlpha = { ...alpha, revision: 2 };
    const currentBeta = { ...beta, revision: 4 };
    mocks.update.mockRejectedValue(conflictFor(currentAlpha));
    mocks.addComment.mockImplementation((taskId: string) =>
      Promise.reject(conflictFor(taskId === alpha.id ? currentAlpha : currentBeta))
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['tasks'], [alpha, beta]);

    renderWithProviders(
      <>
        <Toaster />
        <ConflictBurstProbe />
      </>,
      { queryClient }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Update Alpha' }));
    await screen.findByRole('button', { name: 'Review conflict for Alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'Comment Alpha' }));

    await waitFor(() => {
      expect(screen.getAllByText('Task updated before your change')).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Comment Beta' }));
    await waitFor(() => {
      expect(screen.getAllByText('Task updated before your change')).toHaveLength(2);
    });
    expect(screen.queryByText(/elsewhere/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Review conflict for Beta' })).toBeDefined();

    const opened = vi.fn();
    window.addEventListener('open-task', opened, { once: true });
    fireEvent.click(screen.getByRole('button', { name: 'Review conflict for Alpha' }));
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ detail: { taskId: 'task-1' } }));
  });

  it('preserves local edits and retries them against the latest revision', async () => {
    const task = createMockTask({ id: 'task-1', title: 'Original', revision: 1 });
    const current = { ...task, title: 'Server title', revision: 2 };
    const saved = { ...current, title: 'Local title', revision: 3 };
    mocks.update.mockRejectedValueOnce(conflictFor(current)).mockResolvedValueOnce(saved);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['tasks'], [task]);

    renderWithProviders(<ConflictEditor initialTask={task} />, { queryClient });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Local title' } });

    expect(await screen.findByText(/Your unsaved title change is still available/)).toBeDefined();
    expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('Local title');
    expect(screen.queryByText('Task updated before your change')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry preserved edits for Local title' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1]).toEqual(['task-1', { title: 'Local title' }, 2]);
    await waitFor(() => expect(screen.queryByText('Update needs review')).toBeNull());
    expect(screen.getByTestId('dirty-state').textContent).toBe('false');
  });

  it('discards preserved edits in favor of the authoritative task', async () => {
    const task = createMockTask({ id: 'task-1', title: 'Original', revision: 1 });
    const current = { ...task, title: 'Server title', revision: 2 };
    mocks.update.mockRejectedValueOnce(conflictFor(current));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['tasks'], [task]);

    renderWithProviders(<ConflictEditor initialTask={task} />, { queryClient });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Local title' } });
    await screen.findByText(/Your unsaved title change is still available/);

    fireEvent.click(
      screen.getByRole('button', { name: 'Discard preserved edits for Local title' })
    );
    await waitFor(() => expect(screen.queryByText('Update needs review')).toBeNull());
    expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe('Server title');
    expect(screen.getByTestId('dirty-state').textContent).toBe('false');
  });

  it('serializes rapid edits and sends the newest value with the updated revision', async () => {
    const task = createMockTask({ id: 'task-1', title: 'Original', revision: 1 });
    const firstSave = deferred<Task>();
    mocks.update
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce({ ...task, title: 'Second edit', revision: 3 });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['tasks'], [task]);

    renderWithProviders(<ConflictEditor initialTask={task} />, { queryClient });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'First edit' } });
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Second edit' } });
    expect(mocks.update).toHaveBeenCalledTimes(1);

    act(() => {
      firstSave.resolve({ ...task, title: 'First edit', revision: 2 });
    });
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1]).toEqual(['task-1', { title: 'Second edit' }, 2]);
  });
});
