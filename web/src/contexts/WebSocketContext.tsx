import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ConnectionState } from '@/hooks/useWebSocket';

interface WebSocketStatus {
  /** Whether the WebSocket is currently connected */
  isConnected: boolean;
  /** Detailed connection state */
  connectionState: ConnectionState;
  /** Current reconnect attempt (0 when connected or idle) */
  reconnectAttempt: number;
  /** Manually retry the WebSocket connection after a disconnected state */
  reconnect?: () => void;
}

const WebSocketStatusContext = createContext<WebSocketStatus>({
  isConnected: false,
  connectionState: 'disconnected',
  reconnectAttempt: 0,
});

export function WebSocketStatusProvider({
  children,
  isConnected,
  connectionState,
  reconnectAttempt,
  reconnect,
}: {
  children: ReactNode;
  isConnected: boolean;
  connectionState: ConnectionState;
  reconnectAttempt: number;
  reconnect?: () => void;
}) {
  const value = useMemo(
    () => ({ isConnected, connectionState, reconnectAttempt, reconnect }),
    [isConnected, connectionState, reconnectAttempt, reconnect]
  );

  return (
    <WebSocketStatusContext.Provider value={value}>{children}</WebSocketStatusContext.Provider>
  );
}

/**
 * Returns the current WebSocket connection status.
 * Used by data-fetching hooks to adjust polling intervals:
 * - Connected: reduce polling (WS handles real-time updates)
 * - Disconnected: increase polling as fallback
 */
export function useWebSocketStatus(): WebSocketStatus {
  return useContext(WebSocketStatusContext);
}
