import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, AgentOutput } from '@/lib/api';
import { apiFetch, API_BASE } from '@/lib/api/helpers';
import { useWebSocket, type WebSocketMessage } from './useWebSocket';
import type {
  AgentBudgetPolicy,
  AgentHealthClassificationResponse,
  AgentHostPreviewRequest,
  AgentType,
  ProviderRuntimeCapabilityId,
} from '@veritas-kanban/shared';

export interface StartAgentInput {
  taskId: string;
  agent?: AgentType;
  profileId?: string;
  overrideReason?: string;
  sandboxPresetId?: string;
  budget?: AgentBudgetPolicy;
  requiredRuntimeCapabilities?: ProviderRuntimeCapabilityId[];
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

export const AGENT_STATUS_ACTIVE_REFETCH_MS = 2_000;
export const AGENT_STATUS_IDLE_REFETCH_MS = 10_000;

export function agentStatusRefetchInterval(running: boolean | undefined): number {
  return running ? AGENT_STATUS_ACTIVE_REFETCH_MS : AGENT_STATUS_IDLE_REFETCH_MS;
}

function requiredQueryParam(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function useAgentStatus(taskId: string | undefined) {
  return useQuery({
    queryKey: ['agent', 'status', taskId],
    queryFn: () => api.agent.status(requiredQueryParam(taskId, 'taskId')),
    enabled: !!taskId,
    refetchInterval: (query) => agentStatusRefetchInterval(query.state.data?.running),
    refetchIntervalInBackground: true,
  });
}

export function useStartAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      agent,
      profileId,
      overrideReason,
      sandboxPresetId,
      budget,
      requiredRuntimeCapabilities,
    }: StartAgentInput) =>
      api.agent.start(taskId, {
        agent,
        profileId,
        overrideReason,
        sandboxPresetId,
        budget,
        requiredRuntimeCapabilities,
      }),
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: ({
      taskId,
      attemptId,
      message,
    }: {
      taskId: string;
      attemptId: string;
      message: string;
    }) => api.agent.sendMessage(taskId, attemptId, message),
  });
}

export function useStopAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, attemptId }: { taskId: string; attemptId: string }) =>
      api.agent.stop(taskId, attemptId),
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useAgentAttempts(taskId: string | undefined) {
  return useQuery({
    queryKey: ['agent', 'attempts', taskId],
    queryFn: () => api.agent.listAttempts(requiredQueryParam(taskId, 'taskId')),
    enabled: !!taskId,
  });
}

export function useAgentLog(taskId: string | undefined, attemptId: string | undefined) {
  return useQuery({
    queryKey: ['agent', 'log', taskId, attemptId],
    queryFn: () =>
      api.agent.getLog(
        requiredQueryParam(taskId, 'taskId'),
        requiredQueryParam(attemptId, 'attemptId')
      ),
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

export function useAgentHealthClassifications() {
  return useQuery({
    queryKey: ['agent', 'health-classifications'],
    queryFn: () =>
      apiFetch<AgentHealthClassificationResponse>(`${API_BASE}/agents/register/health`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useAgentHosts() {
  return useQuery({
    queryKey: ['agent', 'hosts'],
    queryFn: api.agentHosts.getHealth,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useAgentHostPreview(request: AgentHostPreviewRequest, enabled = true) {
  return useQuery({
    queryKey: ['agent', 'hosts', 'preview', request],
    queryFn: () => api.agentHosts.preview(request),
    enabled,
    staleTime: 15_000,
  });
}

// WebSocket hook for real-time agent output
export function useAgentStream(taskId: string | undefined, attemptId?: string) {
  const [outputs, setOutputs] = useState<AgentOutput[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const activeAttemptRef = useRef<string | undefined>(undefined);
  const queryClient = useQueryClient();

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (message.type === 'subscribed') {
        const running = message.running as boolean;
        setIsRunning(running);
        if (running) {
          queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
        }
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
    activeAttemptRef.current = undefined;
  }, [taskId]);

  useEffect(() => {
    if (!attemptId) return;
    if (activeAttemptRef.current && activeAttemptRef.current !== attemptId) {
      setOutputs([]);
    }
    activeAttemptRef.current = attemptId;
  }, [attemptId]);

  const { isConnected, send } = useWebSocket({
    autoConnect: !!taskId,
    onOpen: taskId ? { type: 'subscribe', taskId } : undefined,
    onMessage: handleMessage,
    autoReconnect: false, // Don't auto-reconnect for agent streams
  });

  // A client can subscribe while the task is idle and then observe a run that
  // was started by CLI/MCP. Once idle discovery returns the new attempt, renew
  // the task subscription so the server attaches to that attempt's emitter.
  useEffect(() => {
    if (isConnected && taskId && attemptId) {
      send({ type: 'subscribe', taskId });
    }
  }, [attemptId, isConnected, send, taskId]);

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
