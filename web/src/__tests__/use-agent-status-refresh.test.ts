import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_STATUS_ACTIVE_REFETCH_MS,
  AGENT_STATUS_IDLE_REFETCH_MS,
  agentStatusRefetchInterval,
  useAgentStream,
} from '@/hooks/useAgent';

const socketMocks = vi.hoisted(() => ({
  options: null as null | { onMessage?: (message: Record<string, unknown>) => void },
  send: vi.fn(),
  useWebSocket: vi.fn(),
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: socketMocks.useWebSocket,
}));

beforeEach(() => {
  vi.clearAllMocks();
  socketMocks.options = null;
  socketMocks.useWebSocket.mockImplementation((options) => {
    socketMocks.options = options;
    return {
      isConnected: true,
      send: socketMocks.send,
    };
  });
});

describe('agent status refresh cadence', () => {
  it('keeps low-frequency discovery active while idle', () => {
    expect(agentStatusRefetchInterval(false)).toBe(AGENT_STATUS_IDLE_REFETCH_MS);
    expect(agentStatusRefetchInterval(undefined)).toBe(AGENT_STATUS_IDLE_REFETCH_MS);
  });

  it('uses the faster cadence while a run is active', () => {
    expect(agentStatusRefetchInterval(true)).toBe(AGENT_STATUS_ACTIVE_REFETCH_MS);
  });

  it('clears prior output when a replacement attempt is discovered', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result, rerender } = renderHook(
      ({ attemptId }: { attemptId: string }) => useAgentStream('task-runtime', attemptId),
      {
        initialProps: { attemptId: 'attempt-1' },
        wrapper,
      }
    );

    act(() => {
      socketMocks.options?.onMessage?.({
        type: 'agent:output',
        outputType: 'stdout',
        content: 'prior attempt output',
        timestamp: '2026-07-16T08:00:00.000Z',
      });
    });
    expect(result.current.outputs).toHaveLength(1);

    rerender({ attemptId: 'attempt-2' });

    expect(result.current.outputs).toEqual([]);
  });
});
