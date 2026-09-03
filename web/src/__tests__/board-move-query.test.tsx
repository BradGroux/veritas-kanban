import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoveTaskResult, Task } from '@veritas-kanban/shared';
import { useMoveTask, useTasks } from '@/hooks/useTasks';
import { useTaskSync } from '@/hooks/useTaskSync';
import type { UseWebSocketOptions } from '@/hooks/useWebSocket';
import { createMockTask } from './test-utils';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  move: vi.fn(),
  socketOptions: null as UseWebSocketOptions | null,
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { tasks: { list: mocks.list, move: mocks.move } },
}));

vi.mock('@/hooks/useToast', () => ({ toast: mocks.toast }));

vi.mock('@/hooks/useWebSocket', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/useWebSocket')>();
  return {
    ...original,
    useWebSocket: (options: UseWebSocketOptions) => {
      mocks.socketOptions = options;
      return {
        isConnected: true,
        connectionState: 'connected' as const,
        reconnectAttempt: 0,
        connect: vi.fn(),
      };
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('board move QueryClient and WebSocket convergence', () => {
  let queryClient: QueryClient;
  let original: Task;
  let moved: Task;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    original = createMockTask({ id: 'move-1', status: 'todo', position: 0, revision: 3 });
    moved = { ...original, status: 'blocked', position: 0.5, revision: 4 };
    queryClient.setQueryData(['tasks'], [original]);
    mocks.list.mockResolvedValue([moved]);
    mocks.socketOptions = null;
  });

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  it('keeps the old cache stable while pending, then converges with an echoed move event', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const response = deferred<MoveTaskResult>();
    mocks.move.mockReturnValue(response.promise);
    const { result } = renderHook(
      () => {
        const tasks = useTasks();
        const move = useMoveTask();
        useTaskSync();
        return { tasks, move };
      },
      { wrapper }
    );

    act(() => {
      result.current.move.mutate({
        id: original.id,
        input: {
          operationId: '00000000-0000-4000-8000-000000000012',
          sourceStatus: 'todo',
          sourcePosition: 0,
          destinationStatus: 'blocked',
          destinationIndex: 1,
        },
      });
    });

    await waitFor(() => expect(result.current.move.isPending).toBe(true));
    expect(queryClient.getQueryData<Task[]>(['tasks'])?.[0]).toEqual(original);

    act(() => {
      mocks.socketOptions?.onMessage?.({
        type: 'task:changed',
        changeType: 'moved',
        taskId: original.id,
        operationId: '00000000-0000-4000-8000-000000000012',
      });
    });
    await waitFor(() => expect(result.current.tasks.data?.[0]).toEqual(moved));

    act(() => {
      response.resolve({
        task: moved,
        operationId: '00000000-0000-4000-8000-000000000012',
        orderedTaskIds: [moved.id],
        replayed: false,
      });
    });
    await waitFor(() => expect(result.current.move.isSuccess).toBe(true));

    expect(queryClient.getQueryData<Task[]>(['tasks'])?.[0]).toEqual(moved);
    expect(queryClient.getQueryData<Task>(['tasks', moved.id])).toEqual(moved);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['activity'] });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('invalidates the remote-client board sidebar when a move event arrives', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useTaskSync(), { wrapper });

    act(() => {
      mocks.socketOptions?.onMessage?.({
        type: 'task:changed',
        changeType: 'moved',
        taskId: original.id,
        operationId: '00000000-0000-4000-8000-000000000013',
      });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['activity'] });
  });

  it('retries a dropped response with the same operation identity', async () => {
    const response: MoveTaskResult = {
      task: moved,
      operationId: '00000000-0000-4000-8000-000000000014',
      orderedTaskIds: [moved.id],
      replayed: true,
    };
    mocks.move
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response);
    const { result } = renderHook(() => useMoveTask(), { wrapper });
    const input = {
      operationId: response.operationId,
      sourceStatus: 'todo' as const,
      sourcePosition: 0,
      destinationStatus: 'blocked' as const,
      destinationIndex: 0,
    };

    await act(async () => {
      await result.current.mutateAsync({ id: original.id, input });
    });

    expect(mocks.move).toHaveBeenCalledTimes(2);
    expect(mocks.move.mock.calls[0]).toEqual(mocks.move.mock.calls[1]);
    expect(queryClient.getQueryData<Task[]>(['tasks'])?.[0]).toEqual(moved);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('uses the newest revision when an inactive detail cache trails the board', async () => {
    const movedAgain: Task = {
      ...moved,
      status: 'todo',
      position: 1,
      revision: 5,
    };
    queryClient.setQueryData(['tasks'], [moved]);
    queryClient.setQueryData(['tasks', original.id], original);
    mocks.move.mockResolvedValue({
      task: movedAgain,
      operationId: '00000000-0000-4000-8000-000000000018',
      orderedTaskIds: [movedAgain.id],
      replayed: false,
    });
    const { result } = renderHook(() => useMoveTask(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: original.id,
        input: {
          operationId: '00000000-0000-4000-8000-000000000018',
          sourceStatus: 'blocked',
          sourcePosition: 0.5,
          destinationStatus: 'todo',
          destinationIndex: 0,
        },
      });
    });

    expect(mocks.move).toHaveBeenCalledOnce();
    expect(mocks.move.mock.calls[0]?.[2]).toBe(4);
    expect(queryClient.getQueryData<Task[]>(['tasks'])?.[0]).toEqual(movedAgain);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('loads the authoritative task and reports one task-specific stale-move message', async () => {
    const current = { ...original, title: 'Edited elsewhere', revision: 4 };
    const conflict = Object.assign(new Error('stale revision'), {
      code: 'CONFLICT',
      details: { current },
    });
    mocks.move.mockRejectedValue(conflict);
    const { result } = renderHook(() => useMoveTask(), { wrapper });

    act(() => {
      result.current.mutate({
        id: original.id,
        input: {
          operationId: '00000000-0000-4000-8000-000000000015',
          sourceStatus: 'todo',
          sourcePosition: 0,
          destinationStatus: 'blocked',
          destinationIndex: 0,
        },
      });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData<Task[]>(['tasks'])?.[0]).toEqual(current);
    expect(mocks.move).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Move not saved',
        description: expect.stringContaining('Edited elsewhere'),
      })
    );
  });

  it('does not retry a read-only write denial', async () => {
    const denied = Object.assign(new Error('read only'), { code: 'WRITE_FORBIDDEN' });
    mocks.move.mockRejectedValue(denied);
    const { result } = renderHook(() => useMoveTask(), { wrapper });

    await expect(
      act(() =>
        result.current.mutateAsync({
          id: original.id,
          input: {
            operationId: '00000000-0000-4000-8000-000000000016',
            sourceStatus: 'todo',
            sourcePosition: 0,
            destinationStatus: 'blocked',
            destinationIndex: 0,
          },
        })
      )
    ).rejects.toThrow('read only');

    expect(mocks.move).toHaveBeenCalledOnce();
  });
});
