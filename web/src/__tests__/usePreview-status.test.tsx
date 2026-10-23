import { type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  usePreviewStatus,
  useStartPreview,
  useStopPreview,
  type PreviewServer,
} from '@/hooks/usePreview';

let status: PreviewServer;
const clients: QueryClient[] = [];
function preview(next: PreviewServer['status']): PreviewServer {
  return {
    taskId: 'task-one',
    repoName: 'fixture',
    pid: 123,
    port: 4000,
    url: 'http://localhost:4000',
    status: next,
    startedAt: '2026-01-01T00:00:00Z',
    output: [],
    ...(next === 'error' ? { error: 'Synthetic preview failure' } : {}),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  status = preview('starting');
  vi.spyOn(api.preview, 'getStatus').mockImplementation(async () => structuredClone(status));
  vi.spyOn(api.preview, 'start').mockImplementation(async () => {
    status = preview('running');
    return structuredClone(status);
  });
  vi.spyOn(api.preview, 'stop').mockImplementation(async () => {
    status = preview('stopped');
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: Infinity } },
  });
  clients.push(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return {
    client,
    ...renderHook(
      ({ taskId }: { taskId: string | undefined }) => ({
        status: usePreviewStatus(taskId),
        start: useStartPreview(),
        stop: useStopPreview(),
      }),
      { initialProps: { taskId: 'task-one' as string | undefined }, wrapper: Wrapper }
    ),
  };
}

it('polls starting at one second, running at five seconds, then stops after process exit', async () => {
  const { result } = setup();
  await advance();
  expect(result.current.status.data?.status).toBe('starting');
  status = preview('running');
  await advance(999);
  expect(api.preview.getStatus).toHaveBeenCalledTimes(1);
  await advance(2);
  expect(result.current.status.data?.status).toBe('running');
  expect(api.preview.getStatus).toHaveBeenCalledTimes(2);
  status = preview('stopped');
  await advance(4998);
  expect(api.preview.getStatus).toHaveBeenCalledTimes(2);
  await advance(2);
  expect(result.current.status.data?.status).toBe('stopped');
  expect(api.preview.getStatus).toHaveBeenCalledTimes(3);
  await advance(20_000);
  expect(api.preview.getStatus).toHaveBeenCalledTimes(3);
});

for (const terminal of ['error', 'stopped'] as const)
  it(`observes starting to ${terminal} and does not keep polling`, async () => {
    const { result } = setup();
    await advance();
    status = preview(terminal);
    await advance(1001);
    expect(result.current.status.data?.status).toBe(terminal);
    expect(api.preview.getStatus).toHaveBeenCalledTimes(2);
    await advance(20_000);
    expect(api.preview.getStatus).toHaveBeenCalledTimes(2);
  });

it('disables polling when the panel closes and releases its timer on unmount', async () => {
  const { rerender, unmount } = setup();
  await advance();
  rerender({ taskId: undefined });
  await advance(10_000);
  expect(api.preview.getStatus).toHaveBeenCalledTimes(1);
  unmount();
  await advance(10_000);
  expect(api.preview.getStatus).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('start and stop mutations still invalidate the task preview and output cache', async () => {
  status = preview('stopped');
  const { result, client } = setup();
  const outputKey = ['preview', 'task-one', 'output', 50];
  client.setQueryData(outputKey, { output: ['before start'] });
  await advance();
  await act(async () => {
    await result.current.start.mutateAsync('task-one');
  });
  await advance();
  expect(api.preview.start).toHaveBeenCalledWith('task-one');
  expect(result.current.status.data?.status).toBe('running');
  expect(client.getQueryState(outputKey)?.isInvalidated).toBe(true);
  client.setQueryData(outputKey, { output: ['before stop'] });
  await act(async () => {
    await result.current.stop.mutateAsync('task-one');
  });
  await advance();
  expect(api.preview.stop).toHaveBeenCalledWith('task-one');
  expect(result.current.status.data?.status).toBe('stopped');
  expect(client.getQueryState(outputKey)?.isInvalidated).toBe(true);
  const before = vi.mocked(api.preview.getStatus).mock.calls.length;
  await advance(20_000);
  expect(api.preview.getStatus).toHaveBeenCalledTimes(before);
});
