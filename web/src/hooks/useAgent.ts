import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, AgentOutput } from '@/lib/api';
import type { AgentType } from '@veritas-kanban/shared';

export function useAgentStatus(taskId: string | undefined) {
  return useQuery({
    queryKey: ['agent', 'status', taskId],
    queryFn: () => api.agent.status(taskId!),
    enabled: !!taskId,
    refetchInterval: (query) => query.state.data?.running ? 2000 : false,
  });
}

export function useStartAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, agent }: { taskId: string; agent?: AgentType }) =>
      api.agent.start(taskId, agent),
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: ({ taskId, message }: { taskId: string; message: string }) =>
      api.agent.sendMessage(taskId, message),
  });
}

export function useStopAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => api.agent.stop(taskId),
    onSuccess: (_, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useAgentAttempts(taskId: string | undefined) {
  return useQuery({
    queryKey: ['agent', 'attempts', taskId],
    queryFn: () => api.agent.listAttempts(taskId!),
    enabled: !!taskId,
  });
}

export function useAgentLog(taskId: string | undefined, attemptId: string | undefined) {
  return useQuery({
    queryKey: ['agent', 'log', taskId, attemptId],
    queryFn: () => api.agent.getLog(taskId!, attemptId!),
    enabled: !!taskId && !!attemptId,
  });
}

// WebSocket hook for real-time agent output
export function useAgentStream(taskId: string | undefined) {
  const [outputs, setOutputs] = useState<AgentOutput[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!taskId) {
      setOutputs([]);
      return;
    }

    // Connect to WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:3001/ws`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Subscribe to task's agent output
      ws.send(JSON.stringify({ type: 'subscribe', taskId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'subscribed') {
          setIsRunning(data.running);
        } else if (data.type === 'agent:output') {
          setOutputs(prev => [...prev, {
            type: data.type === 'agent:output' ? data.type : data.type,
            content: data.content,
            timestamp: data.timestamp,
          } as AgentOutput]);
        } else if (data.type === 'agent:complete') {
          setIsRunning(false);
          queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
        } else if (data.type === 'agent:error') {
          setIsRunning(false);
          queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [taskId, queryClient]);

  const clearOutputs = useCallback(() => {
    setOutputs([]);
  }, []);

  return {
    outputs,
    isConnected,
    isRunning,
    clearOutputs,
  };
}
