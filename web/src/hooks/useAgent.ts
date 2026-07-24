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
  RunApprovalDecisionInput,
  RunApprovalRequest,
  TaskCommitPolicy,
} from '@veritas-kanban/shared';

export interface StartAgentInput {
  taskId: string;
  agent?: AgentType;
  profileId?: string;
  overrideReason?: string;
  sandboxPresetId?: string;
  budget?: AgentBudgetPolicy;
  requiredRuntimeCapabilities?: ProviderRuntimeCapabilityId[];
  commitPolicy?: TaskCommitPolicy;
}

export type AgentApprovalRequest = RunApprovalRequest & {
  reviewedAt?: string;
};

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
      commitPolicy,
    }: StartAgentInput) =>
      api.agent.start(taskId, {
        agent,
        profileId,
        overrideReason,
        sandboxPresetId,
        budget,
        requiredRuntimeCapabilities,
        commitPolicy,
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

export function usePendingAgentApprovals(agentId?: string, taskId?: string, attemptId?: string) {
  return useQuery({
    queryKey: ['agent', 'permissions', 'approvals', agentId, taskId, attemptId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (agentId) params.set('agentId', agentId);
      if (taskId) params.set('taskId', taskId);
      if (attemptId) params.set('attemptId', attemptId);
      const query = params.toString();
      return apiFetch<RunApprovalRequest[]>(
        `${API_BASE}/run-approvals?status=pending${query ? `&${query}` : ''}`
      ).then((requests) =>
        requests.map((request) => ({
          ...request,
          reviewedAt: request.resolution?.decidedAt,
        }))
      );
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useDecideRunApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      approvalId,
      decision,
    }: {
      approvalId: string;
      decision: RunApprovalDecisionInput;
    }) =>
      apiFetch<RunApprovalRequest>(
        `${API_BASE}/run-approvals/${encodeURIComponent(approvalId)}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(decision),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'permissions', 'approvals'] });
    },
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
  const eventCursorRef = useRef(0);
  const queryClient = useQueryClient();

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      if (message.type === 'subscribed') {
        const running = message.running as boolean;
        const cursor = message.cursor;
        if (typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor >= 0) {
          eventCursorRef.current = Math.max(eventCursorRef.current, cursor);
        }
        setIsRunning(running);
        if (running) {
          queryClient.invalidateQueries({ queryKey: ['agent', 'status', taskId] });
        }
      } else if (message.type === 'agent:event') {
        const data = message.data;
        if (data && typeof data === 'object') {
          const sequence = (data as Record<string, unknown>).sequence;
          if (typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence > 0) {
            eventCursorRef.current = Math.max(eventCursorRef.current, sequence);
          }
        }
      } else if (message.type === 'agent:output') {
        const sequence = message.sequence;
        if (typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence > 0) {
          eventCursorRef.current = Math.max(eventCursorRef.current, sequence);
        }
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
    eventCursorRef.current = 0;
  }, [taskId]);

  useEffect(() => {
    if (!attemptId) return;
    if (activeAttemptRef.current && activeAttemptRef.current !== attemptId) {
      setOutputs([]);
      eventCursorRef.current = 0;
    }
    activeAttemptRef.current = attemptId;
  }, [attemptId]);

  const { isConnected, send } = useWebSocket({
    autoConnect: !!taskId,
    onOpen: taskId
      ? {
          type: 'subscribe',
          taskId,
          attemptId,
          afterSequence: eventCursorRef.current,
        }
      : undefined,
    onMessage: handleMessage,
    autoReconnect: true,
  });

  // A client can subscribe while the task is idle and then observe a run that
  // was started by CLI/MCP. Once idle discovery returns the new attempt, renew
  // the task subscription so the server attaches to that attempt's emitter.
  useEffect(() => {
    if (isConnected && taskId && attemptId) {
      send({
        type: 'subscribe',
        taskId,
        attemptId,
        afterSequence: eventCursorRef.current,
      });
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
