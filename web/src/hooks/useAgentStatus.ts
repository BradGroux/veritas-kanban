import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useWebSocket, WebSocketMessage } from './useWebSocket';
import { api, GlobalAgentStatus } from '@/lib/api';

/** How often to poll when WebSocket is disconnected (ms) */
const POLL_INTERVAL_MS = 10_000;

/** How long before status is considered stale (ms) - 5 minutes */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** How often to check for staleness (ms) */
const STALE_CHECK_INTERVAL_MS = 30_000;

export type AgentStatusState = 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';

export interface SubAgent {
  id: string;
  label?: string;
  status: AgentStatusState;
  task?: string;
}

export interface AgentStatusData {
  /** Current agent status */
  status: AgentStatusState;
  /** Active task ID if working */
  activeTask?: string;
  /** Active task title if working */
  activeTaskTitle?: string;
  /** Number of sub-agents */
  subAgentCount: number;
  /** List of sub-agents (if available) */
  subAgents: SubAgent[];
  /** When status was last updated (ISO string) */
  lastUpdated: string;
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Whether status is stale (no update in 5+ min) */
  isStale: boolean;
  /** Error message if status is 'error' */
  error?: string;
}

interface AgentStatusWebSocketMessage extends WebSocketMessage {
  type: 'agent:status';
  status: AgentStatusState;
  subAgentCount: number;
  activeTask?: string;
  activeTaskTitle?: string;
  subAgents?: SubAgent[];
  timestamp: string;
  error?: string;
}

function isAgentStatusMessage(msg: WebSocketMessage): msg is AgentStatusWebSocketMessage {
  return msg.type === 'agent:status';
}

/**
 * Hook to subscribe to real-time global agent status updates.
 * 
 * Uses WebSocket as primary transport with automatic fallback to polling
 * when WebSocket is disconnected. Detects stale status (no update in 5+ min).
 * 
 * Note: For per-task agent status, use `useAgentStatus(taskId)` from `useAgent.ts`.
 * 
 * @example
 * ```tsx
 * const { status, activeTask, subAgents, lastUpdated, isStale } = useRealtimeAgentStatus();
 * 
 * if (isStale) {
 *   return <span>Agent idle</span>;
 * }
 * 
 * return <span>{status}</span>;
 * ```
 */
export function useRealtimeAgentStatus(): AgentStatusData {
  const [statusData, setStatusData] = useState<Omit<AgentStatusData, 'isConnected' | 'isStale'>>({
    status: 'idle',
    subAgentCount: 0,
    subAgents: [],
    lastUpdated: new Date().toISOString(),
  });
  
  const [isStale, setIsStale] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const staleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((message: WebSocketMessage) => {
    if (!mountedRef.current) return;
    
    if (isAgentStatusMessage(message)) {
      setStatusData({
        status: message.status,
        activeTask: message.activeTask,
        activeTaskTitle: message.activeTaskTitle,
        subAgentCount: message.subAgentCount,
        subAgents: message.subAgents || [],
        lastUpdated: message.timestamp,
        error: message.error,
      });
      setIsStale(false);
    }
  }, []);

  // Fetch status via REST API (polling fallback)
  const fetchStatus = useCallback(async () => {
    if (!mountedRef.current) return;
    
    try {
      const data: GlobalAgentStatus = await api.agent.globalStatus();
      if (!mountedRef.current) return;
      
      setStatusData({
        status: data.status,
        activeTask: data.activeTask,
        activeTaskTitle: data.activeTaskTitle,
        subAgentCount: data.subAgentCount,
        subAgents: [], // REST API doesn't return sub-agent details currently
        lastUpdated: data.lastUpdated,
        error: data.error,
      });
      setIsStale(false);
    } catch (error) {
      console.error('Failed to fetch agent status:', error);
      // Don't update state on error - keep last known good state
    }
  }, []);

  // Start polling when WebSocket disconnects
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    
    // Fetch immediately
    fetchStatus();
    
    // Then poll at interval
    pollIntervalRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
  }, [fetchStatus]);

  // Stop polling when WebSocket connects
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Check for stale status
  const checkStale = useCallback(() => {
    if (!mountedRef.current) return;
    
    const lastUpdated = new Date(statusData.lastUpdated).getTime();
    const now = Date.now();
    const isNowStale = now - lastUpdated > STALE_THRESHOLD_MS;
    
    setIsStale(isNowStale);
  }, [statusData.lastUpdated]);

  // WebSocket connection
  const { isConnected } = useWebSocket({
    autoConnect: true,
    onOpen: { type: 'subscribe', channel: 'agent:status' },
    onMessage: handleMessage,
    onConnected: () => {
      stopPolling();
      // Fetch initial status when connected
      fetchStatus();
    },
    onDisconnected: () => {
      startPolling();
    },
    reconnectDelay: 3000,
  });

  // Setup stale check interval
  useEffect(() => {
    mountedRef.current = true;
    
    // Initial stale check
    checkStale();
    
    // Periodic stale checks
    staleCheckRef.current = setInterval(checkStale, STALE_CHECK_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      stopPolling();
      if (staleCheckRef.current) {
        clearInterval(staleCheckRef.current);
        staleCheckRef.current = null;
      }
    };
  }, [checkStale, stopPolling]);

  // Fetch initial status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Memoize the return value to prevent unnecessary re-renders
  const result = useMemo<AgentStatusData>(() => ({
    ...statusData,
    isConnected,
    isStale: isStale || statusData.status === 'idle',
  }), [statusData, isConnected, isStale]);

  return result;
}

// Alias for backwards compatibility with the task requirements
export { useRealtimeAgentStatus as useGlobalAgentStatusRT };
