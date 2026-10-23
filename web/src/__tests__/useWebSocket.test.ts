/**
 * Tests for hooks/useWebSocket.ts — WebSocket connection, reconnection, and messaging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { resolveDefaultWsUrl, useWebSocket } from '@/hooks/useWebSocket';
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
  it('resolves same-origin WebSocket URLs from the current host and base path', () => {
    expect(
      resolveDefaultWsUrl('/api', { protocol: 'http:', host: 'localhost:5173' }, '/kanban/')
    ).toBe('ws://localhost:5173/kanban/ws');
  });

  it('resolves WebSocket URLs from an absolute API base', () => {
    expect(
      resolveDefaultWsUrl(
        'http://127.0.0.1:3101/api',
        { protocol: 'http:', host: 'localhost:5173' },
        '/'
      )
    ).toBe('ws://127.0.0.1:3101/ws');
    expect(
      resolveDefaultWsUrl(
        'https://example.com/kanban/api',
        { protocol: 'http:', host: 'localhost:5173' },
        '/'
      )
    ).toBe('wss://example.com/kanban/ws');
  });

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

function requiredHandler<T>(handler: T | null): T {
  if (!handler) throw new Error('Expected an installed socket callback');
  return handler;
}

describe('connection ownership', () => {
  it('leaves one live socket through root StrictMode replay', () => {
    const { result, unmount } = renderHook(() => useWebSocket({ url: 'ws://test/ws' }), {
      reactStrictMode: true,
    });
    expect(ws.instances).toHaveLength(2);
    const [old, current] = ws.instances;
    expect(old.readyState).toBe(WebSocket.CLOSED);
    expect(old.onclose).toBeNull();
    act(() => current.simulateOpen());
    act(() => {
      old.simulateClose(1006);
      vi.advanceTimersByTime(1200);
      result.current.send({ type: 'current-only' });
    });
    expect(ws.instances).toHaveLength(2);
    expect(result.current.connectionState).toBe('connected');
    expect(current.sent).toEqual([JSON.stringify({ type: 'current-only' })]);
    unmount();
    expect(current.readyState).toBe(WebSocket.CLOSED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores already queued old events after URL replacement', () => {
    const callbacks = {
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ url }) => useWebSocket({ url, ...callbacks, onOpen: { type: 'subscribe' } }),
      { initialProps: { url: 'ws://first/ws' } }
    );
    const old = ws.latest;
    const queued = {
      open: requiredHandler(old.onopen),
      message: requiredHandler(old.onmessage),
      error: requiredHandler(old.onerror),
      close: requiredHandler(old.onclose),
    };
    rerender({ url: 'ws://second/ws' });
    const current = ws.latest;
    act(() => current.simulateOpen());
    callbacks.onConnected.mockClear();
    act(() => {
      queued.open(new Event('open'));
      queued.message(new MessageEvent('message', { data: '{"type":"stale"}' }));
      queued.error(new Event('error'));
      queued.close(new CloseEvent('close'));
      vi.advanceTimersByTime(1200);
      result.current.send({ type: 'current' });
    });
    expect(ws.instances).toHaveLength(2);
    expect(current.url).toBe('ws://second/ws');
    expect(result.current.connectionState).toBe('connected');
    expect(result.current.lastMessage).toBeNull();
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
    expect(old.sent).toEqual([]);
    expect(current.sent).toEqual([
      JSON.stringify({ type: 'subscribe' }),
      JSON.stringify({ type: 'current' }),
    ]);
  });

  it('cancels pending reconnect on disabling autoConnect and ignores queued close', () => {
    const { result, rerender, unmount } = renderHook(
      ({ autoConnect }) => useWebSocket({ url: 'ws://test/ws', autoConnect }),
      { initialProps: { autoConnect: true } }
    );
    const close = requiredHandler(ws.latest.onclose);
    act(() => ws.latest.simulateClose(1006));
    expect(result.current.connectionState).toBe('reconnecting');
    rerender({ autoConnect: false });
    act(() => {
      close(new CloseEvent('close'));
      vi.advanceTimersByTime(60_000);
    });
    expect(ws.instances).toHaveLength(1);
    expect(result.current.connectionState).toBe('disconnected');
    expect(vi.getTimerCount()).toBe(0);
    rerender({ autoConnect: true });
    expect(ws.instances).toHaveLength(2);
    unmount();
    expect(ws.latest.readyState).toBe(WebSocket.CLOSED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('manual reconnect retires a closing socket and its queued callbacks', () => {
    const onDisconnected = vi.fn();
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test/ws', onDisconnected }));
    const old = ws.latest;
    const close = requiredHandler(old.onclose);
    old.readyState = WebSocket.CLOSING;
    act(() => result.current.connect());
    const current = ws.latest;
    act(() => {
      current.simulateOpen();
      close(new CloseEvent('close'));
      vi.advanceTimersByTime(1200);
    });
    expect(old.readyState).toBe(WebSocket.CLOSED);
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(result.current.connectionState).toBe('connected');
    expect(ws.instances).toHaveLength(2);
  });

  it('does not subscribe or restart timers after onConnected disconnects', () => {
    let disconnect = () => {};
    const onDisconnected = vi.fn();
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test/ws',
        onConnected: () => disconnect(),
        onDisconnected,
        onOpen: { type: 'subscribe' },
      })
    );
    disconnect = result.current.disconnect;
    const old = ws.latest;
    const close = requiredHandler(old.onclose);
    act(() => old.simulateOpen());
    act(() => {
      close(new CloseEvent('close'));
      vi.advanceTimersByTime(60_000);
    });
    expect(old.sent).toEqual([]);
    expect(result.current.connectionState).toBe('disconnected');
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(ws.instances).toHaveLength(1);
  });

  it('does not schedule an old reconnect when onDisconnected creates a replacement', () => {
    let connect = () => {};
    const { result } = renderHook(() =>
      useWebSocket({ url: 'ws://test/ws', onDisconnected: () => connect() })
    );
    connect = result.current.connect;
    act(() => ws.latest.simulateClose(1006));
    const current = ws.latest;
    act(() => {
      current.simulateOpen();
      vi.advanceTimersByTime(1200);
    });
    expect(ws.instances).toHaveLength(2);
    expect(result.current.connectionState).toBe('connected');
    expect(vi.getTimerCount()).toBe(1);
  });
});

it('ignores queued keepalive and reconnect timers from previous generations', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const { result, rerender, unmount } = renderHook(({ url }) => useWebSocket({ url }), {
    initialProps: { url: 'ws://first/ws' },
  });
  act(() => ws.latest.simulateOpen());
  const keepalive = timers.mock.calls.find((call) => call[1] === 45_000)?.[0];
  if (typeof keepalive !== 'function') throw new Error('Expected keepalive timer');
  act(() => ws.latest.simulateClose(1006));
  const reconnect = timers.mock.calls.find((call) => call[1] === 1000)?.[0];
  if (typeof reconnect !== 'function') throw new Error('Expected reconnect timer');
  rerender({ url: 'ws://second/ws' });
  const current = ws.latest;
  act(() => current.simulateOpen());
  act(() => {
    keepalive();
    reconnect();
  });
  expect(current.readyState).toBe(WebSocket.OPEN);
  expect(ws.instances).toHaveLength(2);
  expect(result.current.connectionState).toBe('connected');
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  act(() => {
    keepalive();
    reconnect();
  });
  expect(ws.instances).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});
