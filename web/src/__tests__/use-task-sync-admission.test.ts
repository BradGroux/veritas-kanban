import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskSync } from '@/hooks/useTaskSync';
import type { UseWebSocketOptions } from '@/hooks/useWebSocket';

const socketMocks = vi.hoisted(() => ({
  options: null as UseWebSocketOptions | null,
  useWebSocket: vi.fn(),
}));

vi.mock('@/hooks/useWebSocket', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/useWebSocket')>();
  return {
    ...original,
    useWebSocket: socketMocks.useWebSocket,
  };
});

describe('admission queue realtime invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketMocks.options = null;
    socketMocks.useWebSocket.mockImplementation((options: UseWebSocketOptions) => {
      socketMocks.options = options;
      return {
        isConnected: true,
        connectionState: 'connected',
        reconnectAttempt: 0,
        connect: vi.fn(),
      };
    });
  });

  it.each(['task:changed', 'telemetry:event', 'workflow:status'])(
    'invalidates the queue from the existing socket on %s',
    (type) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

      renderHook(() => useTaskSync(), { wrapper });
      act(() => socketMocks.options?.onMessage?.({ type }));

      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admission-queue'] });
    }
  );
});
