import { type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toBoardTask } from '@veritas-kanban/shared';
import { api } from '@/lib/api';
import { useBoardTasks, useBoardSearch } from '@/hooks/useTasks';
import { useTaskSync } from '@/hooks/useTaskSync';
import { WebSocketStatusProvider } from '@/contexts/WebSocketContext';
import { createMockWebSocket } from './test-utils';

let ws: ReturnType<typeof createMockWebSocket>;
let title: string;
let matches: string[];
const clients: QueryClient[] = [];
function projection() {
  return [
    toBoardTask({
      id: 'task-one',
      title,
      description: 'summary',
      type: 'code',
      status: 'todo',
      priority: 'medium',
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
    }),
  ];
}
beforeEach(() => {
  vi.useFakeTimers();
  ws = createMockWebSocket();
  vi.stubGlobal('WebSocket', ws.MockWebSocket);
  title = 'Before external edit';
  matches = [];
  vi.spyOn(api.tasks, 'listBoard').mockImplementation(async () => projection());
  vi.spyOn(api.tasks, 'searchIds').mockImplementation(async () => [...matches]);
  vi.spyOn(api.tasks, 'list').mockRejectedValue(new Error('Full-task list must not be requested'));
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function setup(search = 'external') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: true, gcTime: Infinity },
    },
  });
  clients.push(client);
  function Sync({ children }: { children: ReactNode }) {
    const connection = useTaskSync();
    return <WebSocketStatusProvider {...connection}>{children}</WebSocketStatusProvider>;
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <Sync>{children}</Sync>
      </QueryClientProvider>
    );
  }
  return {
    client,
    ...renderHook(() => ({ board: useBoardTasks(), search: useBoardSearch(search) }), {
      wrapper: Wrapper,
      reactStrictMode: true,
    }),
  };
}

it('refreshes changed summary and search IDs within ten seconds while WebSocket cannot open', async () => {
  const { result } = setup();
  await advance();
  expect(result.current.board.data?.[0].title).toBe('Before external edit');
  title = 'After external edit';
  matches = ['task-one'];
  const initialBoard = vi.mocked(api.tasks.listBoard).mock.calls.length;
  const initialSearch = vi.mocked(api.tasks.searchIds).mock.calls.length;
  await advance(9999);
  expect(result.current.board.data?.[0].title).toBe('Before external edit');
  await advance(2);
  expect(result.current.board.data?.[0].title).toBe(title);
  expect(result.current.search.data).toEqual(matches);
  expect(api.tasks.listBoard).toHaveBeenCalledTimes(initialBoard + 1);
  expect(api.tasks.searchIds).toHaveBeenCalledTimes(initialSearch + 1);
  expect(result.current.board.data?.[0].boardSummary).toBeDefined();
  expect(api.tasks.list).not.toHaveBeenCalled();
  expect(ws.instances.filter((socket) => socket.readyState !== WebSocket.CLOSED)).toHaveLength(1);
});

it('invalidates once on reconnect and stops disconnected timers until another disconnect', async () => {
  const { result } = setup();
  await advance();
  const beforeBoard = vi.mocked(api.tasks.listBoard).mock.calls.length;
  const beforeSearch = vi.mocked(api.tasks.searchIds).mock.calls.length;
  title = 'Changed while disconnected';
  matches = ['task-one'];
  act(() => ws.latest.simulateOpen());
  await advance();
  expect(result.current.board.data?.[0].title).toBe(title);
  expect(result.current.search.data).toEqual(matches);
  expect(api.tasks.listBoard).toHaveBeenCalledTimes(beforeBoard + 1);
  expect(api.tasks.searchIds).toHaveBeenCalledTimes(beforeSearch + 1);
  await advance(20_000);
  expect(api.tasks.listBoard).toHaveBeenCalledTimes(beforeBoard + 1);
  expect(api.tasks.searchIds).toHaveBeenCalledTimes(beforeSearch + 1);
  act(() => ws.latest.simulateClose(1006));
  title = 'Changed after second disconnect';
  await advance(10_001);
  expect(result.current.board.data?.[0].title).toBe(title);
  expect(api.tasks.listBoard).toHaveBeenCalledTimes(beforeBoard + 2);
  expect(api.tasks.searchIds).toHaveBeenCalledTimes(beforeSearch + 2);
  act(() => ws.latest.simulateOpen());
  await advance();
  const settled = vi.mocked(api.tasks.listBoard).mock.calls.length;
  await advance(20_000);
  expect(api.tasks.listBoard).toHaveBeenCalledTimes(settled);
});

it('recovers an initial failed summary request on the next fallback without reload', async () => {
  vi.mocked(api.tasks.listBoard).mockRejectedValue(new Error('Temporary HTTP failure'));
  const { result } = setup('');
  await advance();
  expect(result.current.board.isError).toBe(true);
  vi.mocked(api.tasks.listBoard).mockImplementation(async () => projection());
  await advance(10_001);
  expect(result.current.board.isSuccess).toBe(true);
  expect(result.current.board.data?.[0].title).toBe(title);
  expect(api.tasks.searchIds).not.toHaveBeenCalled();
});

it('unmount stops fallback requests and aborts the owned in-flight summary and search', async () => {
  const { unmount } = setup();
  await advance();
  const signals: AbortSignal[] = [];
  vi.mocked(api.tasks.listBoard).mockImplementation((signal) => {
    if (signal) signals.push(signal);
    return new Promise(() => {});
  });
  vi.mocked(api.tasks.searchIds).mockImplementation((_search, signal) => {
    if (signal) signals.push(signal);
    return new Promise(() => {});
  });
  await advance(10_001);
  expect(signals).toHaveLength(2);
  unmount();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  const before = vi.mocked(api.tasks.listBoard).mock.calls.length;
  await advance(30_000);
  expect(api.tasks.listBoard).toHaveBeenCalledTimes(before);
  expect(ws.instances.every((socket) => socket.readyState === WebSocket.CLOSED)).toBe(true);
});
