import { StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { notifications } from '@mantine/notifications';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, UpdateTaskInput } from '@veritas-kanban/shared';
import { useDebouncedSave } from '@/hooks/useDebouncedSave';
import {
  getTaskConflict,
  registerOpenTaskConflictSurface,
  resetTaskConflicts,
} from '@/hooks/useTaskConflicts';
import { getTaskSaveWrites, resetTaskSaveWrites } from '@/lib/task-save-writes';
import { TaskConflictAlert } from '@/components/task/TaskConflictAlert';
import { dismissToast } from '@/hooks/useToast';
import { Toaster } from '@/components/ui/toaster';
import { createMockTask, createTestQueryClient, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { tasks: { update: mocks.update } } }));
vi.mock('@/hooks/useFeatureSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useFeatureSettings')>()),
  useFeatureSetting: () => 500,
}));

function Editor({ task, open = true }: { task: Task | null; open?: boolean }) {
  const save = useDebouncedSave(task, open);
  const taskId = task?.id;
  useEffect(
    () => (taskId && open ? registerOpenTaskConflictSurface(taskId) : undefined),
    [taskId, open]
  );
  return (
    <>
      <span data-testid="identity">{save.localTask?.id ?? 'none'}</span>
      <span data-testid="dirty">{String(save.isDirty)}</span>
      <span data-testid="saving">{String(save.isSaving)}</span>
      <span data-testid="seconds">{save.localTask?.timeTracking?.totalSeconds ?? 0}</span>
      {save.localTask && (
        <>
          <input
            aria-label="Title"
            value={save.localTask.title}
            onChange={(event) => save.updateField('title', event.currentTarget.value)}
          />
          <input
            aria-label="Description"
            value={save.localTask.description ?? ''}
            onChange={(event) => save.updateField('description', event.currentTarget.value)}
          />
          {save.conflict && (
            <TaskConflictAlert
              conflict={save.conflict}
              taskTitle={save.localTask.title}
              onRetry={save.retryConflict}
              onDiscard={save.discardConflict}
              onDismiss={() => {}}
            />
          )}
        </>
      )}
    </>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const clients: QueryClient[] = [];
let alpha: Task;
let beta: Task;
let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.update.mockReset();
  resetTaskConflicts();
  notifications.clean();
  alpha = createMockTask({
    id: 'task-alpha',
    title: 'Alpha',
    description: 'Alpha source',
    revision: 1,
  });
  beta = createMockTask({
    id: 'task-beta',
    title: 'Beta',
    description: 'Beta source',
    revision: 7,
  });
  client = createTestQueryClient();
  clients.push(client);
  client.setQueryData(['tasks'], [alpha, beta]);
  client.setQueryData(['tasks', alpha.id], alpha);
  client.setQueryData(['tasks', beta.id], beta);
  mocks.update.mockImplementation(async (id: string, input: UpdateTaskInput, revision: number) => ({
    ...(id === alpha.id ? alpha : beta),
    ...input,
    revision: revision + 1,
  }));
});
afterEach(() => {
  act(() => {
    for (const queryClient of clients.splice(0)) resetTaskSaveWrites(queryClient);
  });
  cleanup();
  resetTaskConflicts();
  notifications.clean();
  vi.useRealTimers();
});
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function edit(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function title() {
  return (screen.getByLabelText('Title') as HTMLInputElement).value;
}
function dirty() {
  return screen.getByTestId('dirty').textContent;
}

describe('task-owned session autosave', () => {
  it.each([true, false])('keeps A edits out of a cached=%s B navigation target', async (cached) => {
    const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
    edit('Title', 'Draft for Alpha');
    if (!cached) {
      client.removeQueries({ queryKey: ['tasks', beta.id] });
      view.rerender(<Editor task={null} />);
      await tick();
    }
    view.rerender(<Editor task={beta} />);
    await tick();
    expect(title()).toBe('Beta');
    expect(dirty()).toBe('false');
    expect(mocks.update.mock.calls[0]).toEqual([alpha.id, { title: 'Draft for Alpha' }, 1]);
    edit('Title', 'Draft for Beta');
    await tick(500);
    expect(mocks.update.mock.calls).toEqual([
      [alpha.id, { title: 'Draft for Alpha' }, 1],
      [beta.id, { title: 'Draft for Beta' }, 7],
    ]);
    expect(dirty()).toBe('false');
  });

  it('preserves dirty fields through a same-task background refresh', async () => {
    const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
    edit('Title', 'Local Alpha');
    const refreshed = {
      ...alpha,
      title: 'Background title',
      description: 'Background description',
      revision: 2,
    };
    client.setQueryData(['tasks', alpha.id], refreshed);
    mocks.update.mockResolvedValueOnce({ ...refreshed, title: 'Local Alpha', revision: 3 });
    view.rerender(<Editor task={refreshed} />);
    expect(title()).toBe('Local Alpha');
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe(
      'Background description'
    );
    await tick(500);
    expect(mocks.update.mock.calls[0]).toEqual([alpha.id, { title: 'Local Alpha' }, 2]);
  });

  it.each(['success', 'error', 'conflict'] as const)(
    'isolates a late A %s from B draft and save state',
    async (outcome) => {
      const first = deferred<Task>();
      mocks.update.mockReturnValueOnce(first.promise);
      const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
      edit('Title', 'Alpha pending');
      await tick(500);
      view.rerender(<Editor task={beta} />);
      edit('Title', 'Beta pending');
      await act(async () => {
        if (outcome === 'success') first.resolve({ ...alpha, title: 'Alpha pending', revision: 2 });
        else if (outcome === 'conflict')
          first.reject(
            Object.assign(new Error('Alpha conflict'), {
              code: 'CONFLICT',
              details: { current: { ...alpha, revision: 2 } },
            })
          );
        else first.reject(new Error('Alpha save failed'));
      });
      await tick();
      expect(title()).toBe('Beta pending');
      expect(dirty()).toBe('true');
      expect(screen.getByTestId('saving').textContent).toBe('false');
      await tick(500);
      expect(mocks.update.mock.calls[1]).toEqual([beta.id, { title: 'Beta pending' }, 7]);
    }
  );

  it.each(['closed', 'selection-cleared', 'unmounted'] as const)(
    'flushes pending edits when the editor is %s before the debounce',
    async (dismissal) => {
      const pending = deferred<Task>();
      mocks.update.mockReturnValueOnce(pending.promise);
      const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
      edit('Title', 'Dismissed Alpha');
      await tick(200);
      expect(mocks.update).not.toHaveBeenCalled();
      view.rerender(
        dismissal === 'closed' ? (
          <Editor task={alpha} open={false} />
        ) : dismissal === 'selection-cleared' ? (
          <Editor task={null} />
        ) : (
          <></>
        )
      );
      await tick();
      expect(mocks.update.mock.calls).toEqual([[alpha.id, { title: 'Dismissed Alpha' }, 1]]);
      view.rerender(<Editor task={alpha} />);
      expect(title()).toBe('Dismissed Alpha');
      expect(dirty()).toBe('true');
      await act(async () => pending.resolve({ ...alpha, title: 'Dismissed Alpha', revision: 2 }));
      await tick(1_000);
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(dirty()).toBe('false');
    }
  );

  it('finishes a newer edit after an earlier write settles while the editor is absent', async () => {
    const first = deferred<Task>();
    mocks.update.mockReturnValueOnce(first.promise);
    const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
    edit('Title', 'First Alpha edit');
    await tick(500);
    edit('Title', 'Second Alpha edit');
    edit('Description', 'Newest description');
    view.rerender(<></>);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ ...alpha, title: 'First Alpha edit', revision: 2 }));
    await tick();
    expect(mocks.update.mock.calls[1]).toEqual([
      alpha.id,
      { title: 'Second Alpha edit', description: 'Newest description' },
      2,
    ]);
    await tick(1_000);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(client.getQueryData<Task>(['tasks', alpha.id])).toMatchObject({
      title: 'Second Alpha edit',
      description: 'Newest description',
    });
  });

  it('retains a failed dismissed draft and retries it through the rendered action', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Fixture offline'));
    const content = (task: Task | null) => (
      <>
        <Editor task={task} />
        <Toaster />
      </>
    );
    const view = renderWithProviders(content(alpha), { queryClient: client });
    edit('Title', 'Recoverable Alpha');
    view.rerender(content(null));
    await tick();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const notificationId = screen
      .getByRole('button', { name: 'Retry task save' })
      .closest('[role="alert"]')?.id;
    if (!notificationId) throw new Error('Expected the save failure notification');
    act(() => dismissToast(notificationId));
    await tick(6_000);
    expect(screen.queryByRole('button', { name: 'Retry task save' })).toBeNull();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    view.rerender(content(alpha));
    expect(title()).toBe('Recoverable Alpha');
    expect(dirty()).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Retry task save' }));
    await tick();
    expect(mocks.update.mock.calls[1]).toEqual([alpha.id, { title: 'Recoverable Alpha' }, 1]);
    expect(dirty()).toBe('false');
  });

  it('reopens a conflicted dismissed draft and uses the latest revision for explicit retry', async () => {
    const latest = { ...alpha, title: 'Server Alpha', revision: 2 };
    mocks.update.mockRejectedValueOnce(
      Object.assign(new Error('Conflict'), { code: 'CONFLICT', details: { current: latest } })
    );
    const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
    edit('Title', 'Conflicted Alpha');
    view.rerender(<Editor task={null} />);
    await tick();
    view.rerender(<Editor task={latest} />);
    expect(title()).toBe('Conflicted Alpha');
    expect(screen.getByText(/unsaved title change is still available/)).toBeDefined();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry preserved edits for Conflicted Alpha' })
    );
    await tick();
    expect(mocks.update.mock.calls[1]).toEqual([alpha.id, { title: 'Conflicted Alpha' }, 2]);
    expect(dirty()).toBe('false');
  });

  it.each(['success', 'conflict'] as const)(
    'fences a late %s callback after the authenticated editing session ends',
    async (outcome) => {
      const first = deferred<Task>();
      mocks.update.mockReturnValueOnce(first.promise);
      const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
      edit('Title', 'Old session Alpha');
      await tick(500);
      const oldWriter = getTaskSaveWrites(client);
      act(() => resetTaskSaveWrites(client));
      view.rerender(<Editor task={beta} />);
      edit('Title', 'New session Beta');
      await act(async () => {
        if (outcome === 'success')
          first.resolve({ ...alpha, title: 'Old session Alpha', revision: 2 });
        else
          first.reject(
            Object.assign(new Error('Old session conflict'), {
              code: 'CONFLICT',
              details: { current: { ...alpha, revision: 2 } },
            })
          );
      });
      await tick();
      expect(oldWriter.isActive()).toBe(false);
      expect(getTaskConflict(alpha.id)).toBeNull();
      expect(client.getQueryData<Task>(['tasks', alpha.id])).toEqual(alpha);
      expect(title()).toBe('New session Beta');
      expect(dirty()).toBe('true');
      await tick(500);
      expect(mocks.update.mock.calls[1]).toEqual([beta.id, { title: 'New session Beta' }, 7]);
    }
  );

  it('preserves concurrently cached timer state when a task write returns older timing', async () => {
    const pending = deferred<Task>();
    mocks.update.mockReturnValueOnce(pending.promise);
    renderWithProviders(<Editor task={alpha} />, { queryClient: client });
    edit('Title', 'Alpha title');
    await tick(500);
    client.setQueryData(['tasks', alpha.id], {
      ...alpha,
      timeTracking: { totalSeconds: 42, isRunning: false, entries: [] },
    });
    await act(async () =>
      pending.resolve({
        ...alpha,
        title: 'Alpha title',
        revision: 2,
        timeTracking: { totalSeconds: 1, isRunning: false, entries: [] },
      })
    );
    await tick();
    expect(screen.getByTestId('seconds').textContent).toBe('42');
    expect(dirty()).toBe('false');
  });

  it('cancels pending dispatch when the authenticated session ends', async () => {
    const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
    edit('Title', 'Pending old session');
    act(() => resetTaskSaveWrites(client));
    view.rerender(<></>);
    await tick(1_000);
    expect(mocks.update).not.toHaveBeenCalled();
    view.rerender(<Editor task={alpha} />);
    expect(title()).toBe('Alpha');
    expect(dirty()).toBe('false');
  });

  it('checks the session again before a dismissed mutation begins dispatch', async () => {
    const view = renderWithProviders(<Editor task={alpha} />, { queryClient: client });
    edit('Title', 'Dismissed old session');
    view.rerender(<Editor task={null} />);
    act(() => resetTaskSaveWrites(client));
    await tick(1_000);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not duplicate a dismissal write under Strict Mode effect replay', async () => {
    const content = (task: Task | null) => (
      <StrictMode>
        <Editor task={task} />
      </StrictMode>
    );
    const view = renderWithProviders(content(alpha), { queryClient: client });
    edit('Title', 'Strict Alpha');
    view.rerender(content(null));
    await tick(1_000);
    expect(mocks.update.mock.calls).toEqual([[alpha.id, { title: 'Strict Alpha' }, 1]]);
  });
});
