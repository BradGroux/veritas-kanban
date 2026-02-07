import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { chatApi } from '@/lib/api/chat';
import { chatEventTarget } from '@/hooks/useTaskSync';
import type {
  ChatMessage,
  ChatSendInput,
  SquadMessage,
  SquadMessageInput,
} from '@veritas-kanban/shared';

/**
 * List all chat sessions
 */
export function useChatSessions() {
  return useQuery({
    queryKey: ['chat', 'sessions'],
    queryFn: chatApi.listSessions,
    staleTime: 30_000,
  });
}

/**
 * Get a single chat session with messages
 */
export function useChatSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['chat', 'sessions', sessionId],
    queryFn: () => chatApi.getSession(sessionId!),
    enabled: !!sessionId,
    staleTime: 10_000,
  });
}

/**
 * Send a chat message
 */
export function useSendChatMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ChatSendInput) => chatApi.sendMessage(input),
    onSuccess: (response) => {
      // Invalidate sessions list and the specific session to refetch
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
      if (response.sessionId) {
        queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', response.sessionId] });
      }
    },
  });
}

/**
 * Delete a chat session
 */
export function useDeleteChatSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => chatApi.deleteSession(sessionId),
    onSuccess: (_data, sessionId) => {
      // Remove the specific session from cache entirely — invalidate alone
      // keeps stale data when the refetch 404s (file deleted)
      queryClient.removeQueries({ queryKey: ['chat', 'sessions', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] });
    },
  });
}

/**
 * Listen for streaming chat messages via WebSocket
 */
export function useChatStream(sessionId: string | undefined) {
  const [streamingMessage, setStreamingMessage] = useState<Partial<ChatMessage> | null>(null);
  const [, setStreamingText] = useState('');
  const queryClient = useQueryClient();

  // Listen for chat events from the shared WebSocket (via useTaskSync)
  useEffect(() => {
    if (!sessionId) return;

    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      const msgSessionId = msg.sessionId as string;
      if (msgSessionId !== sessionId) return;

      if (msg.type === 'chat:delta') {
        const text = msg.text as string;
        setStreamingText((prev) => {
          const newText = prev + text;
          setStreamingMessage({
            id: 'streaming',
            role: 'assistant',
            content: newText,
            timestamp: new Date().toISOString(),
          });
          return newText;
        });
      }

      if (msg.type === 'chat:message') {
        setStreamingMessage(null);
        setStreamingText('');
        queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', sessionId] });
      }

      if (msg.type === 'chat:error') {
        setStreamingMessage(null);
        setStreamingText('');
        queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', sessionId] });
      }
    };

    chatEventTarget.addEventListener('chat', handler);
    return () => {
      chatEventTarget.removeEventListener('chat', handler);
      setStreamingMessage(null);
      setStreamingText('');
    };
  }, [sessionId, queryClient]);

  return { streamingMessage };
}

/**
 * ============================================================
 * SQUAD CHAT HOOKS
 * ============================================================
 */

/**
 * Get squad messages with optional filters
 */
export function useSquadMessages(options?: {
  since?: string;
  agent?: string;
  limit?: number;
  includeSystem?: boolean;
}) {
  return useQuery({
    queryKey: ['chat', 'squad', options],
    queryFn: () => chatApi.getSquadMessages(options),
    staleTime: 10_000,
  });
}

/**
 * Send a squad message
 */
export function useSendSquadMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SquadMessageInput) => chatApi.sendSquadMessage(input),
    onSuccess: (newMessage) => {
      // Optimistically update all matching query cache entries
      queryClient.setQueriesData(
        { queryKey: ['chat', 'squad'] },
        (old: SquadMessage[] | undefined) => {
          if (!old) return [newMessage];
          // Add new message if not already present
          const exists = old.some((m) => m.id === newMessage.id);
          return exists ? old : [...old, newMessage];
        }
      );

      // No invalidation needed — optimistic update + staleTime: 10_000 handles eventual consistency
    },
  });
}

/**
 * Listen for squad messages via WebSocket
 */
export function useSquadStream() {
  const [newMessage, setNewMessage] = useState<SquadMessage | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;

      if (msg.type === 'squad:message') {
        const incomingMessage = msg.message as SquadMessage;
        setNewMessage(incomingMessage);

        // Optimistically add the message to cache immediately
        queryClient.setQueriesData(
          { queryKey: ['chat', 'squad'] },
          (old: SquadMessage[] | undefined) => {
            if (!old) return [incomingMessage];
            // Add message if not already present
            const exists = old.some((m) => m.id === incomingMessage.id);
            return exists ? old : [...old, incomingMessage];
          }
        );

        // No invalidation needed — optimistic update + staleTime: 10_000 handles eventual consistency

        // Clear the new message notification after a short delay
        setTimeout(() => setNewMessage(null), 3000);
      }
    };

    chatEventTarget.addEventListener('squad', handler);
    return () => {
      chatEventTarget.removeEventListener('squad', handler);
      setNewMessage(null);
    };
  }, [queryClient]);

  return { newMessage };
}
