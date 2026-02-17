import { useEffect, useRef, useState, useCallback } from 'react';

// ============================================
// WebSocket Connection States
// ============================================
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface UseWebSocketOptions {
  /** URL to connect to. Defaults to ws(s)://currenthost/ws */
  url?: string;
  /** Whether to automatically connect. Default true. */
  autoConnect?: boolean;
  /** Message to send on open (subscription). */
  onOpen?: WebSocketMessage;
  /** Whether to automatically reconnect on disconnect. Default true. */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts before giving up. 0 = unlimited. Default 20. */
  maxReconnectAttempts?: number;
  /** Callback when connection opens. */
  onConnected?: () => void;
  /** Callback when connection closes. */
  onDisconnected?: () => void;
  /** Message handler. */
  onMessage?: (message: WebSocketMessage) => void;
  /** Error handler. */
  onError?: (error: Event) => void;
}

export interface UseWebSocketReturn {
  /** Whether currently connected. */
  isConnected: boolean;
  /** Detailed connection state. */
  connectionState: ConnectionState;
  /** Current reconnect attempt (0 when connected or idle). */
  reconnectAttempt: number;
  /** Send a message. */
  send: (message: WebSocketMessage) => void;
  /** Manually connect. */
  connect: () => void;
  /** Manually disconnect (stops auto-reconnect). */
  disconnect: () => void;
  /** Last received message. */
  lastMessage: WebSocketMessage | null;
}

// ============================================
// Exponential Backoff Constants
// ============================================
/** Base delay for first reconnect attempt (ms). */
const BACKOFF_BASE_MS = 1000;
/** Maximum backoff delay (ms). */
const BACKOFF_MAX_MS = 30_000;
/** If no message received within this time, assume dead and reconnect (ms). */
const KEEPALIVE_TIMEOUT_MS = 45_000;
/** Default maximum number of reconnect attempts before giving up. */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 20;

function getDefaultWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = import.meta.env.BASE_URL || '/';
  return `${protocol}//${window.location.host}${base}ws`;
}

/**
 * Calculate exponential backoff delay: min(base * 2^attempt, max).
 * Adds ±10% jitter to prevent thundering-herd reconnects.
 */
function getBackoffDelay(attempt: number): number {
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
  const jitter = delay * 0.1 * (Math.random() * 2 - 1); // ±10%
  return Math.round(delay + jitter);
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    url,
    autoConnect = true,
    autoReconnect = true,
    onOpen,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
    onConnected,
    onDisconnected,
    onMessage,
    onError,
  } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepaliveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  /** True when user explicitly called disconnect() — suppresses auto-reconnect. */
  const intentionalDisconnectRef = useRef(false);

  // Store callbacks in refs to avoid reconnecting on callback changes
  const onConnectedRef = useRef(onConnected);
  const onDisconnectedRef = useRef(onDisconnected);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onConnectedRef.current = onConnected;
    onDisconnectedRef.current = onDisconnected;
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    onOpenRef.current = onOpen;
  }, [onConnected, onDisconnected, onMessage, onError, onOpen]);

  // ---- Timers ----

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearKeepaliveTimeout = useCallback(() => {
    if (keepaliveTimeoutRef.current) {
      clearTimeout(keepaliveTimeoutRef.current);
      keepaliveTimeoutRef.current = null;
    }
  }, []);

  /**
   * Reset the keepalive timer. Called on every incoming message (or open).
   * If no message arrives within KEEPALIVE_TIMEOUT_MS, force-close to trigger reconnect.
   */
  const resetKeepaliveTimeout = useCallback(() => {
    clearKeepaliveTimeout();
    keepaliveTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      // No data received for 45s — assume dead, force reconnect
      console.warn('[WebSocket] Keepalive timeout — no data in 45s, reconnecting');
      wsRef.current?.close(4000, 'Keepalive timeout');
    }, KEEPALIVE_TIMEOUT_MS);
  }, [clearKeepaliveTimeout]);

  // ---- Connect / Reconnect ----

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    )
      return;

    clearReconnectTimeout();
    intentionalDisconnectRef.current = false;

    const isReconnect = reconnectAttemptsRef.current > 0;
    setConnectionState(isReconnect ? 'reconnecting' : 'connecting');

    const wsUrl = url || getDefaultWsUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnectionState('connected');
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);
      onConnectedRef.current?.();
      resetKeepaliveTimeout();

      // Send subscription message if provided
      if (onOpenRef.current) {
        ws.send(JSON.stringify(onOpenRef.current));
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      // Reset keepalive on every received message
      resetKeepaliveTimeout();
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        setLastMessage(message);
        onMessageRef.current?.(message);
      } catch (e) {
        console.error('[WebSocket] Message parse error:', e);
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      clearKeepaliveTimeout();
      wsRef.current = null;
      onDisconnectedRef.current?.();

      // Don't reconnect if disabled or the user explicitly disconnected
      if (!autoReconnect || intentionalDisconnectRef.current) {
        setConnectionState('disconnected');
        return;
      }

      // Attempt reconnect with exponential backoff
      const attempt = reconnectAttemptsRef.current;
      if (maxReconnectAttempts > 0 && attempt >= maxReconnectAttempts) {
        // Exhausted all attempts — give up
        console.warn(
          `[WebSocket] Max reconnect attempts (${maxReconnectAttempts}) reached — giving up`
        );
        setConnectionState('disconnected');
        return;
      }

      reconnectAttemptsRef.current = attempt + 1;
      setReconnectAttempt(attempt + 1);
      setConnectionState('reconnecting');

      const delay = getBackoffDelay(attempt);
      console.info(
        `[WebSocket] Reconnecting in ${delay}ms (attempt ${attempt + 1}/${maxReconnectAttempts || '∞'})`
      );
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = (error) => {
      onErrorRef.current?.(error);
      // onclose will fire after onerror — reconnect logic lives there
    };
  }, [
    url,
    autoReconnect,
    maxReconnectAttempts,
    clearReconnectTimeout,
    clearKeepaliveTimeout,
    resetKeepaliveTimeout,
  ]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimeout();
    clearKeepaliveTimeout();
    reconnectAttemptsRef.current = 0;
    setReconnectAttempt(0);
    wsRef.current?.close(1000, 'Client disconnect');
    wsRef.current = null;
    setConnectionState('disconnected');
  }, [clearReconnectTimeout, clearKeepaliveTimeout]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Connect on mount if autoConnect
  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      clearReconnectTimeout();
      clearKeepaliveTimeout();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [autoConnect, connect, clearReconnectTimeout, clearKeepaliveTimeout]);

  return {
    isConnected: connectionState === 'connected',
    connectionState,
    reconnectAttempt,
    send,
    connect,
    disconnect,
    lastMessage,
  };
}
