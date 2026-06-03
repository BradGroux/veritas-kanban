import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, AgentOutput } from '@/lib/api';
import { apiFetch, API_BASE } from '@/lib/api/helpers';
import { useWebSocket, type WebSocketMessage } from './useWebSocket';
import type { AgentType } from '@veritas-kanban/shared';

export interface StartAgentInput {
  taskId: string;
  agent?: AgentType;
  overrideReason?: string;
}

export interface AgentApprovalRequest {
  id: string;
  agentId: string;
  action: string;
  taskId?: string;
  details?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export function useAgentStatus(taskId: string | undefined) {
  return useQuery({
    queryKey: ['agent', 'status', taskId],
    queryFn: () => api.agent.status(taskId!),
    enabled: !!taskId,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });
}

export function useStartAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, agent, overrideReason }: StartAgentInput) =>
      api.agent.start(taskId, { agent, overrideReason }),
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

export function usePendingAgentApprovals(agentId?: string) {
  return useQuery({
    queryKey: ['agent', 'permissions', 'approvals', agentId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (agentId) params.set('agentId', agentId);
      const query = params.toString();
      return apiFetch<AgentApprovalRequest[]>(
        `${API_BASE}/agents/permissions/approvals${query ? `?${query}` : ''}`
      );
    },
    staleTime: 30_000,
  });
}

// WebSocket hook for real-time agent output
export function useAgentStream(taskId: string | undefined) {
  const [outputs, setOutputs] = useState<AgentOutput[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const queryClient = useQueryClient();

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (message.type === 'subscribed') {
        setIsRunning(message.running as boolean);
      } else if (message.type === 'agent:output') {
        setOutputs((prev) => [
          ...prev,
          {
            type: message.outputType as AgentOutput['type'],
            content: message.content as string,
            timestamp: message.timestamp as string,
          },
        ]);
      } else if (message.type === 'agent:complete') {
        setIsRunning(false);
        queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      } else if (message.type === 'agent:error') {
        setIsRunning(false);
        queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
      }
    },
    [taskId, queryClient]
  );

  // Clear outputs when taskId changes
  useEffect(() => {
    setOutputs([]);
  }, [taskId]);

  const { isConnected } = useWebSocket({
    autoConnect: !!taskId,
    onOpen: taskId ? { type: 'subscribe', taskId } : undefined,
    onMessage: handleMessage,
    autoReconnect: false, // Don't auto-reconnect for agent streams
  });

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
