/**
 * Tests for hooks/useWebSocket.ts — WebSocket connection, reconnection, and messaging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { createMockWebSocket } from './test-utils';

// ── Setup ────────────────────────────────────────────────────

let ws: ReturnType<typeof createMockWebSocket>;

beforeEach(() => {
  vi.useFakeTimers();
  ws = createMockWebSocket();
  vi.stubGlobal('WebSocket', ws.MockWebSocket);
  // Stub window.location for getDefaultWsUrl()
  Object.defineProperty(window, 'location', {
    value: { protocol: 'http:', host: 'localhost:5173', port: '5173' },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'onLine', {
    value: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────

describe('useWebSocket', () => {
  it('starts disconnected when autoConnect is false', () => {
    const { result } = renderHook(() => useWebSocket({ autoConnect: false }));
    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.isConnected).toBe(false);
  });

  it('connects automatically by default', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test/ws' }));
    // Should be in connecting state (WebSocket created but not yet open)
    expect(result.current.connectionState).toBe('connecting');
    expect(ws.instances).toHaveLength(1);
  });

  it('transitions to connected when WebSocket opens', () => {
    const onConnected = vi.fn();
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test/ws', onConnected }));

    act(() => {
      ws.latest.simulateOpen();
    });

    expect(result.current.connectionState).toBe('connected');
    expect(result.current.isConnected).toBe(true);
    expect(onConnected).toHaveBeenCalledOnce();
  });

  it('sends onOpen message when connection opens', () => {
    const onOpenMsg = { type: 'subscribe', channel: 'tasks' };
    renderHook(() => useWebSocket({ url: 'ws://test/ws', onOpen: onOpenMsg }));

    act(() => {
      ws.latest.simulateOpen();
    });

    expect(ws.latest.sent).toHaveLength(1);
    expect(JSON.parse(ws.latest.sent[0])).toEqual(onOpenMsg);
  });

  it('receives and parses messages', () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test/ws', onMessage }));

    act(() => {
      ws.latest.simulateOpen();
    });

    act(() => {
      ws.latest.simulateMessage({ type: 'task_updated', taskId: '123' });
    });

    expect(onMessage).toHaveBeenCalledWith({ type: 'task_updated', taskId: '123' });
    expect(result.current.lastMessage).toEqual({ type: 'task_updated', taskId: '123' });
  });

  it('send() sends JSON to the WebSocket', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test/ws' }));

    act(() => {
      ws.latest.simulateOpen();
    });

    act(() => {
      result.current.send({ type: 'ping' });
    });

    // onOpen message + manual send
    const sentMessages = ws.latest.sent;
    expect(sentMessages).toContain(JSON.stringify({ type: 'ping' }));
  });

  it('disconnect() closes the connection and stops auto-reconnect', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test/ws', autoReconnect: true }));

    act(() => {
      ws.latest.simulateOpen();
    });

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.isConnected).toBe(false);
  });

  it('fires onDisconnected callback when connection closes', () => {
    const onDisconnected = vi.fn();
    renderHook(() => useWebSocket({ url: 'ws://test/ws', onDisconnected }));

    act(() => {
      ws.latest.simulateOpen();
    });

    act(() => {
      ws.latest.simulateClose(1000, 'Normal closure');
    });

    expect(onDisconnected).toHaveBeenCalledOnce();
  });

  it('fires onError callback on error', () => {
    const onError = vi.fn();
    renderHook(() => useWebSocket({ url: 'ws://test/ws', onError }));

    act(() => {
      ws.latest.simulateError();
    });

    expect(onError).toHaveBeenCalledOnce();
  });

  it('attempts reconnection with exponential backoff', () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test/ws',
        autoReconnect: true,
        maxReconnectAttempts: 5,
      })
    );

    act(() => {
      ws.latest.simulateOpen();
    });

    // Force close → triggers reconnect
    act(() => {
      ws.latest.simulateClose(1006, 'Abnormal closure');
    });

    expect(result.current.connectionState).toBe('reconnecting');
    expect(result.current.reconnectAttempt).toBe(1);

    // Advance past first backoff (base = 1000ms + jitter)
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    // A new WebSocket should be created
    expect(ws.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('gives up after maxReconnectAttempts', () => {
    // Suppress console.warn from the hook
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test/ws',
        autoReconnect: true,
        maxReconnectAttempts: 2,
      })
    );

    act(() => {
      ws.latest.simulateOpen();
    });

    // First close → reconnect attempt 1
    act(() => {
      ws.latest.simulateClose(1006);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    // Second close → reconnect attempt 2
    act(() => {
      ws.latest.simulateClose(1006);
    });
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    // Third close → should give up (maxReconnectAttempts = 2)
    act(() => {
      ws.latest.simulateClose(1006);
    });

    expect(result.current.connectionState).toBe('disconnected');
  });

  it('reconnects on browser resume after reconnect attempts are exhausted', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test/ws',
        autoReconnect: true,
        maxReconnectAttempts: 1,
      })
    );

    act(() => {
      ws.latest.simulateOpen();
    });

    act(() => {
      ws.latest.simulateClose(1006);
    });

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(ws.instances).toHaveLength(2);

    act(() => {
      ws.latest.simulateClose(1006);
    });

    expect(result.current.connectionState).toBe('disconnected');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(ws.instances).toHaveLength(3);
    expect(result.current.connectionState).toBe('connecting');
    expect(result.current.reconnectAttempt).toBe(0);
  });

  it('does not reconnect on browser resume after an intentional disconnect', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test/ws', autoReconnect: true }));

    act(() => {
      ws.latest.simulateOpen();
    });

    act(() => {
      result.current.disconnect();
    });

    const connectionCount = ws.instances.length;

    act(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(ws.instances).toHaveLength(connectionCount);
    expect(result.current.connectionState).toBe('disconnected');
  });

  it('connect() allows manual connection', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test/ws', autoConnect: false }));

    expect(result.current.connectionState).toBe('disconnected');

    act(() => {
      result.current.connect();
    });

    expect(ws.instances).toHaveLength(1);
    expect(result.current.connectionState).toBe('connecting');
  });
});
