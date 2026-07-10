/**
 * Tests for hooks/useAgentStatus.ts — useRealtimeAgentStatus
 * Covers: initial render, WebSocket message handling, reconnect polling fallback,
 * and stale-state detection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { createMockWebSocket } from './test-utils';
import type { GlobalAgentStatus } from '@/lib/api';

// ── Mocks ─────────────────────────────────────────────────────────────────────

let ws: ReturnType<typeof createMockWebSocket>;

vi.mock('@/lib/api', () => ({
  api: {
    agent: {
      globalStatus: vi.fn(),
    },
  },
}));

vi.mock('@/lib/config', () => ({
  API_BASE: 'http://test-api',
  normalizeApiBase: (v: string) => v,
}));

beforeEach(() => {
  vi.useFakeTimers();
  ws = createMockWebSocket();
  vi.stubGlobal('WebSocket', ws.MockWebSocket);
  Object.defineProperty(window, 'location', {
    value: { protocol: 'http:', host: 'localhost:5173', port: '5173' },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Import after mocks
const { useRealtimeAgentStatus } = await import('@/hooks/useAgentStatus');
const { api } = await import('@/lib/api');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Flush all pending promises (microtasks). */
async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeStatusMsg(overrides: object = {}) {
  return {
    type: 'agent:status',
    status: 'idle',
    subAgentCount: 0,
    activeAgents: [],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

function makeGlobalStatus(overrides: Partial<GlobalAgentStatus> = {}): GlobalAgentStatus {
  return {
    status: 'idle',
    subAgentCount: 0,
    activeTask: undefined,
    activeTaskTitle: undefined,
    activeAgents: [],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useRealtimeAgentStatus', () => {
  it('returns idle state on initial render before any data arrives', () => {
    vi.mocked(api.agent.globalStatus).mockResolvedValue(makeGlobalStatus());

    const { result } = renderHook(() => useRealtimeAgentStatus());
    expect(result.current.status).toBe('idle');
    expect(result.current.subAgentCount).toBe(0);
  });

  it('reflects an initial snapshot fetched via REST on mount', async () => {
    const snapshot = makeGlobalStatus({
      status: 'working',
      activeTask: 'task-1',
      subAgentCount: 2,
    });
    vi.mocked(api.agent.globalStatus).mockResolvedValue(snapshot);

    const { result } = renderHook(() => useRealtimeAgentStatus());

    await flushPromises();

    expect(result.current.status).toBe('working');
    expect(result.current.subAgentCount).toBe(2);
    expect(result.current.activeTask).toBe('task-1');
  });

  it('updates status when a WebSocket agent:status message is received', async () => {
    vi.mocked(api.agent.globalStatus).mockResolvedValue(makeGlobalStatus());

    const { result } = renderHook(() => useRealtimeAgentStatus());

    // WebSocket opens → hook subscribes
    act(() => {
      ws.latest.simulateOpen();
    });

    await flushPromises();

    // Send a status update over the WebSocket
    act(() => {
      ws.latest.simulateMessage(
        makeStatusMsg({
          status: 'thinking',
          subAgentCount: 1,
          activeTask: { id: 'task-xyz', title: 'Do work' },
        })
      );
    });

    expect(result.current.status).toBe('thinking');
    expect(result.current.subAgentCount).toBe(1);
    expect(result.current.activeTask).toBe('task-xyz');
    expect(result.current.activeTaskTitle).toBe('Do work');
  });

  it('ignores unrecognised WebSocket message types', async () => {
    vi.mocked(api.agent.globalStatus).mockResolvedValue(makeGlobalStatus());

    const { result } = renderHook(() => useRealtimeAgentStatus());

    await flushPromises();
    const statusBefore = result.current.status;

    act(() => {
      ws.latest.simulateOpen();
      ws.latest.simulateMessage({ type: 'unknown:event', payload: {} });
    });

    expect(result.current.status).toBe(statusBefore);
  });

  it('falls back to REST polling when WebSocket disconnects', async () => {
    vi.mocked(api.agent.globalStatus).mockResolvedValue(
      makeGlobalStatus({ status: 'working', subAgentCount: 3 })
    );

    renderHook(() => useRealtimeAgentStatus());

    await flushPromises();
    const callsBefore = vi.mocked(api.agent.globalStatus).mock.calls.length;

    // Disconnect → startPolling() calls fetchStatus() immediately
    act(() => {
      ws.latest.simulateOpen();
      ws.latest.simulateClose();
    });

    await flushPromises();

    expect(vi.mocked(api.agent.globalStatus).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('stops polling when WebSocket reconnects, using WS messages instead', async () => {
    vi.mocked(api.agent.globalStatus).mockResolvedValue(makeGlobalStatus());

    renderHook(() => useRealtimeAgentStatus());

    // Disconnect → polling starts
    act(() => {
      ws.latest.simulateOpen();
      ws.latest.simulateClose();
    });
    await flushPromises();
    const callsAfterDisconnect = vi.mocked(api.agent.globalStatus).mock.calls.length;

    // Reconnect → polling stops
    act(() => {
      ws.latest.simulateOpen();
    });
    await flushPromises();
    const callsAfterReconnect = vi.mocked(api.agent.globalStatus).mock.calls.length;

    // After reconnect, advance the old polling interval — no additional REST calls
    await act(async () => {
      vi.advanceTimersByTime(130_000); // > POLL_INTERVAL_MS (120s)
      await Promise.resolve();
    });

    // Only one extra call for the onConnected snapshot fetch, then no more
    expect(vi.mocked(api.agent.globalStatus).mock.calls.length).toBeLessThanOrEqual(
      callsAfterReconnect + 1
    );
    expect(vi.mocked(api.agent.globalStatus).mock.calls.length).toBeLessThan(
      callsAfterDisconnect + 5 // sanity: polling didn't keep firing
    );
  });

  it('marks status as stale after 5 minutes without an update', async () => {
    vi.mocked(api.agent.globalStatus).mockResolvedValue(makeGlobalStatus({ status: 'working' }));

    const { result } = renderHook(() => useRealtimeAgentStatus());
    await flushPromises();
    expect(result.current.isStale).toBe(false);

    // Advance past 5-minute stale threshold + one stale-check interval (30s)
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 30_000 + 1000);
      await Promise.resolve();
    });

    expect(result.current.isStale).toBe(true);
  });

  it('clears stale flag when a fresh WebSocket message arrives', async () => {
    vi.mocked(api.agent.globalStatus).mockResolvedValue(makeGlobalStatus({ status: 'working' }));

    const { result } = renderHook(() => useRealtimeAgentStatus());
    await flushPromises();
    expect(result.current.isStale).toBe(false);

    // Make it stale
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 30_000 + 1000);
      await Promise.resolve();
    });

    expect(result.current.isStale).toBe(true);

    // A fresh WebSocket message with a non-idle status should clear the stale flag.
    // (idle status always shows isStale=true by design; working status does not.)
    act(() => {
      ws.latest.simulateMessage(
        makeStatusMsg({ status: 'working', lastUpdated: new Date().toISOString() })
      );
    });

    expect(result.current.isStale).toBe(false);
  });

  it('does not throw when hook unmounts during an in-flight fetch', async () => {
    // Make globalStatus a slow-resolving promise
    let resolveStatus: ((value: GlobalAgentStatus) => void) | undefined;
    vi.mocked(api.agent.globalStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      })
    );

    const { unmount } = renderHook(() => useRealtimeAgentStatus());

    // Unmount before the fetch resolves
    unmount();

    // Resolve after unmount — should not throw / cause state update warnings
    await act(async () => {
      if (!resolveStatus) {
        throw new Error('Expected resolveStatus to be assigned');
      }
      resolveStatus(makeGlobalStatus());
      await Promise.resolve();
    });
  });
});
