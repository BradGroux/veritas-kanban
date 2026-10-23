import { type ReactNode } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SquadMessage } from '@veritas-kanban/shared';
import { chatApi } from '@/lib/api/chat';
import { chatEventTarget } from '@/hooks/useTaskSync';
import { useSquadMessages, useSendSquadMessage, useSquadStream } from '@/hooks/useChat';

type Options = NonNullable<Parameters<typeof useSquadMessages>[0]>;
const boundary = '2026-01-01T00:00:02.000Z';
const clients: QueryClient[] = [];
let rows: SquadMessage[];
function message(id: string, seconds: number, agent = 'Human', system = false): SquadMessage {
  return { id, agent, system, message: id, timestamp: `2026-01-01T00:00:0${seconds}.000Z` };
}
// Fixture models the existing server's inclusive since bound, exact agent and latest-N ordering.
function fresh(options: Options = {}): SquadMessage[] {
  const matching = rows
    .filter(
      (row) =>
        (options.includeSystem !== false || !row.system) &&
        (!options.agent || row.agent === options.agent) &&
        (!options.since || row.timestamp >= options.since)
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return options.limit ? matching.slice(-options.limit) : matching;
}
beforeEach(() => {
  vi.useFakeTimers();
  rows = [
    message('human-old', 1),
    message('agent-old', 2, 'TARS'),
    message('system-old', 3, 'TARS', true),
  ];
  vi.spyOn(chatApi, 'getSquadMessages').mockImplementation(async (options) =>
    structuredClone(fresh(options))
  );
  vi.spyOn(chatApi, 'sendSquadMessage').mockImplementation(async (input) => {
    const saved: SquadMessage = {
      ...message('sent', 5, input.agent),
      message: input.message,
      system: input.system ?? false,
    };
    rows.push(saved);
    return saved;
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
function emit(row: SquadMessage) {
  act(() => {
    chatEventTarget.dispatchEvent(
      new CustomEvent('squad', { detail: { type: 'squad:message', message: row } })
    );
  });
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const searchKey = ['chat', 'squad', 'search', { query: 'fixture' }];
  const unreadKey = ['chat', 'squad', 'unread', 'Human'];
  const threadKey = ['chat', 'squad', 'thread', 'parent'];
  const search = { query: 'fixture', results: [{ message: rows[0] }] };
  const unread = { actor: 'Human', unreadCount: 3 };
  client.setQueryData(searchKey, search);
  client.setQueryData(unreadKey, unread);
  client.setQueryData(threadKey, [rows[0]]);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const hook = renderHook(
    ({ filter }: { filter: Options }) => {
      useSquadStream();
      return {
        all: useSquadMessages(),
        nonSystem: useSquadMessages({ includeSystem: false, limit: 1 }),
        agent: useSquadMessages({ agent: 'TARS', limit: 2 }),
        since: useSquadMessages({ since: boundary, includeSystem: false }),
        bounded: useSquadMessages({ limit: 2 }),
        toggled: useSquadMessages(filter),
        send: useSendSquadMessage(),
      };
    },
    {
      initialProps: { filter: { agent: 'Human', includeSystem: false } as Options },
      wrapper: Wrapper,
    }
  );
  function verifyOtherShapes() {
    expect(client.getQueryData(searchKey)).toEqual(search);
    expect(client.getQueryData(unreadKey)).toEqual(unread);
    expect(client.getQueryData(threadKey)).toEqual([rows[0]]);
    for (const key of [searchKey, unreadKey, threadKey])
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  }
  return { ...hook, client, verifyOtherShapes };
}

it('incoming events refresh each filtered bounded list to the authoritative response', async () => {
  const { result, verifyOtherShapes } = setup();
  await flush();
  const incoming = message('new-system', 4, 'TARS', true);
  rows.push(incoming);
  emit(incoming);
  await flush();
  expect(result.current.all.data).toEqual(fresh());
  expect(result.current.nonSystem.data).toEqual([rows[1]]);
  expect(result.current.agent.data).toEqual(fresh({ agent: 'TARS', limit: 2 }));
  expect(result.current.since.data).toEqual([rows[1]]);
  expect(result.current.bounded.data).toEqual([rows[2], incoming]);
  expect(result.current.toggled.data).toEqual([rows[0]]);
  verifyOtherShapes();
  emit(incoming);
  await flush();
  expect(result.current.all.data).toHaveLength(4);
  expect(result.current.bounded.data).toHaveLength(2);
});

it('send response and echoed stream event do not bypass filters or duplicate history', async () => {
  const { result, rerender, verifyOtherShapes } = setup();
  await flush();
  await act(async () => {
    await result.current.send.mutateAsync({ agent: 'Human', message: 'new human' });
  });
  await flush();
  expect(result.current.nonSystem.data).toEqual(fresh({ includeSystem: false, limit: 1 }));
  expect(result.current.agent.data).toEqual(fresh({ agent: 'TARS', limit: 2 }));
  expect(result.current.since.data).toEqual(fresh({ since: boundary, includeSystem: false }));
  const sent = rows[rows.length - 1];
  emit(sent);
  await flush();
  expect(result.current.all.data?.filter((row) => row.id === 'sent')).toHaveLength(1);
  rerender({ filter: { includeSystem: true, agent: 'TARS', limit: 1 } });
  await flush();
  expect(result.current.toggled.data).toEqual(
    fresh({ includeSystem: true, agent: 'TARS', limit: 1 })
  );
  verifyOtherShapes();
});

it('an out-of-order event cannot append older history past the newest bounded window', async () => {
  const { result } = setup();
  await flush();
  const old = message('delayed', 0);
  rows.push(old);
  emit(old);
  await flush();
  expect(result.current.bounded.data?.map((row) => row.id)).toEqual(['agent-old', 'system-old']);
  expect(result.current.all.data?.[0].id).toBe('delayed');
});

it('failed authoritative reads retain the last valid filtered cache and unmount removes the listener', async () => {
  const { result, unmount, verifyOtherShapes } = setup();
  await flush();
  const before = result.current.nonSystem.data;
  vi.mocked(chatApi.getSquadMessages).mockRejectedValue(new Error('Synthetic HTTP failure'));
  emit(message('unread-system', 4, 'TARS', true));
  await flush();
  expect(result.current.nonSystem.data).toEqual(before);
  verifyOtherShapes();
  const calls = vi.mocked(chatApi.getSquadMessages).mock.calls.length;
  unmount();
  emit(message('after-close', 5));
  await flush();
  expect(chatApi.getSquadMessages).toHaveBeenCalledTimes(calls);
});
