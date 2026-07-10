/**
 * Chat API functions
 */
import { API_BASE, apiFetch } from './helpers';
import type { ChatSession, ChatSendInput } from '@veritas-kanban/shared';

/**
 * List all chat sessions
 */
export async function listSessions(): Promise<ChatSession[]> {
  return apiFetch<ChatSession[]>(`${API_BASE}/chat/sessions`);
}

/**
 * Get a single chat session with messages
 */
export async function getSession(sessionId: string): Promise<ChatSession> {
  return apiFetch<ChatSession>(`${API_BASE}/chat/sessions/${sessionId}`);
}

/**
 * Chat send response from the API
 * (Not a full ChatSession — agent response streams via WebSocket)
 */
export interface ChatSendResponse {
  sessionId: string;
  messageId: string;
  message: string;
}

/**
 * Send a chat message
 */
export async function sendMessage(input: ChatSendInput): Promise<ChatSendResponse> {
  return apiFetch<ChatSendResponse>(`${API_BASE}/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/**
 * Delete a chat session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  return apiFetch<void>(`${API_BASE}/chat/sessions/${sessionId}`, {
    method: 'DELETE',
  });
}

/**
 * ============================================================
 * SQUAD CHAT API
 * ============================================================
 */

import type {
  SquadMessage,
  SquadMessageInput,
  SquadSearchResponse,
  SquadUnreadState,
} from '@veritas-kanban/shared';

/**
 * Send a message to the squad channel
 */
export async function sendSquadMessage(input: SquadMessageInput): Promise<SquadMessage> {
  return apiFetch<SquadMessage>(`${API_BASE}/chat/squad`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/**
 * Get squad messages with optional filters
 */
export async function getSquadMessages(options?: {
  since?: string;
  agent?: string;
  limit?: number;
  includeSystem?: boolean;
}): Promise<SquadMessage[]> {
  const params = new URLSearchParams();
  if (options?.since) params.set('since', options.since);
  if (options?.agent) params.set('agent', options.agent);
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.includeSystem !== undefined)
    params.set('includeSystem', options.includeSystem.toString());

  return apiFetch<SquadMessage[]>(`${API_BASE}/chat/squad?${params}`);
}

export async function searchSquadMessages(options: {
  query: string;
  limit?: number;
  agent?: string;
  includeSystem?: boolean;
}): Promise<SquadSearchResponse> {
  const params = new URLSearchParams();
  params.set('q', options.query);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.agent) params.set('agent', options.agent);
  if (options.includeSystem !== undefined)
    params.set('includeSystem', options.includeSystem.toString());

  return apiFetch<SquadSearchResponse>(`${API_BASE}/chat/squad/search?${params}`);
}

export async function getSquadUnread(actor: string): Promise<SquadUnreadState> {
  const params = new URLSearchParams({ actor });
  return apiFetch<SquadUnreadState>(`${API_BASE}/chat/squad/unread?${params}`);
}

export async function markSquadRead(input: {
  actor: string;
  messageId?: string;
}): Promise<SquadUnreadState> {
  return apiFetch<SquadUnreadState>(`${API_BASE}/chat/squad/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function getSquadThread(messageId: string): Promise<SquadMessage[]> {
  return apiFetch<SquadMessage[]>(`${API_BASE}/chat/squad/${encodeURIComponent(messageId)}/thread`);
}

export async function updateSquadMessageState(
  messageId: string,
  input: { pinned?: boolean; decision?: boolean }
): Promise<SquadMessage> {
  return apiFetch<SquadMessage>(`${API_BASE}/chat/squad/${encodeURIComponent(messageId)}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function addSquadReaction(
  messageId: string,
  input: { actor: string; reaction: string }
): Promise<SquadMessage> {
  return apiFetch<SquadMessage>(`${API_BASE}/chat/squad/${encodeURIComponent(messageId)}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export const chatApi = {
  listSessions,
  getSession,
  sendMessage,
  deleteSession,
  sendSquadMessage,
  getSquadMessages,
  searchSquadMessages,
  getSquadUnread,
  markSquadRead,
  getSquadThread,
  updateSquadMessageState,
  addSquadReaction,
};
