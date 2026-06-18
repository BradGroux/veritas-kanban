import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateRunSessionShareInput,
  ForkRunSessionInput,
  RunSessionApprovalResponseInput,
  RunSessionEvent,
  RunSessionShareListFilters,
  SendRunSessionMessageInput,
  UpdateRunSessionShareInput,
} from '@veritas-kanban/shared';
import { api } from '@/lib/api';
import { useWebSocket, type WebSocketMessage } from './useWebSocket';

function invalidateRunSessionQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId?: string,
  shareId?: string
) {
  queryClient.invalidateQueries({ queryKey: ['run-sessions'] });
  if (taskId) {
    queryClient.invalidateQueries({ queryKey: ['run-sessions', { taskId }] });
    queryClient.invalidateQueries({ queryKey: ['tasks', taskId] });
  }
  if (shareId) {
    queryClient.invalidateQueries({ queryKey: ['run-sessions', shareId] });
    queryClient.invalidateQueries({ queryKey: ['run-sessions', shareId, 'events'] });
  }
}

export function useRunSessions(filters: RunSessionShareListFilters = {}) {
  return useQuery({
    queryKey: ['run-sessions', filters],
    queryFn: () => api.runSessions.list(filters),
  });
}

export function useRunSession(shareId?: string) {
  return useQuery({
    queryKey: ['run-sessions', shareId],
    queryFn: () => api.runSessions.get(shareId || ''),
    enabled: Boolean(shareId),
  });
}

export function useRunSessionEvents(shareId?: string) {
  return useQuery({
    queryKey: ['run-sessions', shareId, 'events'],
    queryFn: () => api.runSessions.events(shareId || ''),
    enabled: Boolean(shareId),
  });
}

export function useCreateRunSessionShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRunSessionShareInput) => api.runSessions.create(input),
    onSuccess: (share) => invalidateRunSessionQueries(queryClient, share.taskId, share.id),
  });
}

export function useUpdateRunSessionShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, input }: { shareId: string; input: UpdateRunSessionShareInput }) =>
      api.runSessions.update(shareId, input),
    onSuccess: (share) => invalidateRunSessionQueries(queryClient, share.taskId, share.id),
  });
}

export function useRevokeRunSessionShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, reason }: { shareId: string; reason?: string }) =>
      api.runSessions.revoke(shareId, reason),
    onSuccess: (share) => invalidateRunSessionQueries(queryClient, share.taskId, share.id),
  });
}

export function useSendRunSessionMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, input }: { shareId: string; input: SendRunSessionMessageInput }) =>
      api.runSessions.sendMessage(shareId, input),
    onSuccess: (event) => invalidateRunSessionQueries(queryClient, event.taskId, event.shareId),
  });
}

export function useRunSessionApprovalResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, input }: { shareId: string; input: RunSessionApprovalResponseInput }) =>
      api.runSessions.respondToApproval(shareId, input),
    onSuccess: (event) => invalidateRunSessionQueries(queryClient, event.taskId, event.shareId),
  });
}

export function useForkRunSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, input }: { shareId: string; input: ForkRunSessionInput }) =>
      api.runSessions.fork(shareId, input),
    onSuccess: ({ fork }) => {
      invalidateRunSessionQueries(queryClient, fork.parentTaskId, fork.shareId);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

function isRunSessionEvent(message: WebSocketMessage): message is WebSocketMessage & {
  type: 'run-session:event';
  event: RunSessionEvent;
} {
  return message.type === 'run-session:event' && typeof message.event === 'object';
}

export function useRunSessionEventStream(taskId?: string) {
  const queryClient = useQueryClient();
  const onMessage = useCallback(
    (message: WebSocketMessage) => {
      if (!isRunSessionEvent(message)) return;
      const event = message.event;
      if (taskId && event.taskId !== taskId) return;
      invalidateRunSessionQueries(queryClient, event.taskId, event.shareId);
    },
    [queryClient, taskId]
  );

  useWebSocket({
    autoConnect: true,
    onOpen: { type: 'run-session:subscribe' },
    onMessage,
  });
}
