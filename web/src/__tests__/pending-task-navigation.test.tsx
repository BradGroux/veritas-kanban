import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@veritas-kanban/shared';
import { ViewProvider, useView } from '@/contexts/ViewContext';
import { usePendingTaskNavigation } from '@/hooks/usePendingTaskNavigation';
import { createMockTask, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { tasks: { get: mocks.get } } }));
vi.mock('@/hooks/useToast', () => ({ toast: mocks.toast }));
const alpha = createMockTask({ id: 'task-alpha' });
const beta = createMockTask({ id: 'task-beta' });
const empty: Task[] = [];
function Consumer({ tasks }: { tasks: Task[] }) {
  usePendingTaskNavigation(tasks, mocks.open);
  return null;
}
function Harness({ tasks = empty, mounted = true }: { tasks?: Task[]; mounted?: boolean }) {
  const { navigateToTask, pendingTaskId } = useView();
  return (
    <>
      {mounted && <Consumer tasks={tasks} />}
      <button onClick={() => navigateToTask(alpha.id, { tab: 'work-products' })}>Alpha link</button>
      <button
        onClick={() =>
          navigateToTask(beta.id, { tab: 'timeline', timelineAttemptId: 'attempt-beta' })
        }
      >
        Beta link
      </button>
      <output data-testid="pending">{pendingTaskId ?? 'none'}</output>
    </>
  );
}
function content(tasks = empty, mounted = true) {
  return (
    <ViewProvider>
      <Harness tasks={tasks} mounted={mounted} />
    </ViewProvider>
  );
}
function deferred() {
  let resolve!: (task: Task) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Task>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mocks.get.mockReset();
  mocks.open.mockReset();
  mocks.toast.mockReset();
  window.history.replaceState({}, '', '/');
});
afterEach(() => cleanup());
describe('current task navigation ownership', () => {
  it('uses the cached task and exact section without a duplicate lookup', async () => {
    renderWithProviders(content([alpha]));
    fireEvent.click(screen.getByRole('button', { name: 'Alpha link' }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(alpha, { tab: 'work-products' }));
    expect(mocks.get).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending').textContent).toBe('none');
  });
  it('opens an uncached task only after the matching task read', async () => {
    mocks.get.mockResolvedValueOnce(beta);
    renderWithProviders(content());
    fireEvent.click(screen.getByRole('button', { name: 'Beta link' }));
    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith(beta, {
        tab: 'timeline',
        timelineAttemptId: 'attempt-beta',
      })
    );
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(beta.id);
  });
  it.each(['missing', 'wrong-identity'] as const)(
    'reports %s tasks and clears the pending link',
    async (outcome) => {
      if (outcome === 'missing') mocks.get.mockRejectedValueOnce(new Error('Fixture unavailable'));
      else mocks.get.mockResolvedValueOnce(beta);
      renderWithProviders(content());
      fireEvent.click(screen.getByRole('button', { name: 'Alpha link' }));
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Task unavailable', variant: 'destructive' })
        )
      );
      expect(mocks.open).not.toHaveBeenCalled();
      expect(screen.getByTestId('pending').textContent).toBe('none');
    }
  );
  it.each(['success', 'error'] as const)(
    'ignores a late Alpha %s after a newer Beta link',
    async (outcome) => {
      const first = deferred();
      const second = deferred();
      mocks.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      renderWithProviders(content());
      fireEvent.click(screen.getByRole('button', { name: 'Alpha link' }));
      await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(alpha.id));
      fireEvent.click(screen.getByRole('button', { name: 'Beta link' }));
      await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(beta.id));
      await act(async () => {
        if (outcome === 'success') first.resolve(alpha);
        else first.reject(new Error('Old lookup failed'));
      });
      expect(mocks.open).not.toHaveBeenCalled();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(screen.getByTestId('pending').textContent).toBe(beta.id);
      await act(async () => {
        second.resolve(beta);
      });
      expect(mocks.open).toHaveBeenCalledExactlyOnceWith(beta, {
        tab: 'timeline',
        timelineAttemptId: 'attempt-beta',
      });
    }
  );
  it('ignores a lookup after the board navigation consumer unmounts', async () => {
    const pending = deferred();
    mocks.get.mockReturnValueOnce(pending.promise);
    const view = renderWithProviders(content());
    fireEvent.click(screen.getByRole('button', { name: 'Alpha link' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    view.rerender(content(empty, false));
    await act(async () => {
      pending.resolve(alpha);
    });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
