import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket, type WebSocketMessage, type ConnectionState } from './useWebSocket';

// Global event target for chat WebSocket events
// Chat hooks subscribe to this instead of opening their own WebSocket
export const chatEventTarget = new EventTarget();

/**
 * Connects to the Veritas Kanban WebSocket server and listens for
 * task:changed events. When received, invalidates the React Query
 * task cache so the board updates in real-time.
 *
 * Returns connection status so the caller can provide it to
 * `WebSocketStatusProvider`, allowing data-fetching hooks to
 * reduce polling when the WebSocket is healthy.
 */
export function useTaskSync(): {
  isConnected: boolean;
  connectionState: ConnectionState;
  reconnectAttempt: number;
} {
  const queryClient = useQueryClient();

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      // Forward chat events to the chat event target
      if (
        message.type === 'chat:delta' ||
        message.type === 'chat:message' ||
        message.type === 'chat:error'
      ) {
        chatEventTarget.dispatchEvent(new CustomEvent('chat', { detail: message }));
      }

      if (message.type === 'task:changed') {
        // Invalidate task queries to trigger a refetch
        queryClient.invalidateQueries({ queryKey: ['tasks'] });

        // Also invalidate specific task if we know which one
        if (message.taskId) {
          queryClient.invalidateQueries({ queryKey: ['tasks', message.taskId] });
        }

        // If it's an archive-related change, also invalidate archive queries
        if (message.changeType === 'archived' || message.changeType === 'restored') {
          queryClient.invalidateQueries({ queryKey: ['tasks', 'archived'] });
          queryClient.invalidateQueries({ queryKey: ['tasks', 'archive-suggestions'] });
        }

        // Invalidate activity feed so new events appear in real-time
        queryClient.invalidateQueries({ queryKey: ['activities'] });
        queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
      }
    },
    [queryClient]
  );

  const { isConnected, connectionState, reconnectAttempt } = useWebSocket({
    onOpen: { type: 'subscribe:tasks' },
    onMessage: handleMessage,
    maxReconnectAttempts: 20,
  });

  return { isConnected, connectionState, reconnectAttempt };
}
