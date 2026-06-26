/**
 * Chat API functions
 */
import { API_BASE, handleResponse } from './helpers';
import type { ChatSession, ChatSendInput } from '@veritas-kanban/shared';

/**
 * List all chat sessions
 */
export async function listSessions(): Promise<ChatSession[]> {
  const response = await fetch(`${API_BASE}/chat/sessions`, {
    credentials: 'include',
  });
  return handleResponse<ChatSession[]>(response);
}

/**
 * Get a single chat session with messages
 */
export async function getSession(sessionId: string): Promise<ChatSession> {
  const response = await fetch(`${API_BASE}/chat/sessions/${sessionId}`, {
    credentials: 'include',
  });
  return handleResponse<ChatSession>(response);
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
  const response = await fetch(`${API_BASE}/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handleResponse<ChatSendResponse>(response);
}

/**
 * Delete a chat session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/chat/sessions/${sessionId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return handleResponse<void>(response);
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
  const response = await fetch(`${API_BASE}/chat/squad`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handleResponse<SquadMessage>(response);
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

  const response = await fetch(`${API_BASE}/chat/squad?${params}`, {
    credentials: 'include',
  });
  return handleResponse<SquadMessage[]>(response);
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

  const response = await fetch(`${API_BASE}/chat/squad/search?${params}`, {
    credentials: 'include',
  });
  return handleResponse<SquadSearchResponse>(response);
}

export async function getSquadUnread(actor: string): Promise<SquadUnreadState> {
  const params = new URLSearchParams({ actor });
  const response = await fetch(`${API_BASE}/chat/squad/unread?${params}`, {
    credentials: 'include',
  });
  return handleResponse<SquadUnreadState>(response);
}

export async function markSquadRead(input: {
  actor: string;
  messageId?: string;
}): Promise<SquadUnreadState> {
  const response = await fetch(`${API_BASE}/chat/squad/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handleResponse<SquadUnreadState>(response);
}

export async function getSquadThread(messageId: string): Promise<SquadMessage[]> {
  const response = await fetch(`${API_BASE}/chat/squad/${encodeURIComponent(messageId)}/thread`, {
    credentials: 'include',
  });
  return handleResponse<SquadMessage[]>(response);
}

export async function updateSquadMessageState(
  messageId: string,
  input: { pinned?: boolean; decision?: boolean }
): Promise<SquadMessage> {
  const response = await fetch(`${API_BASE}/chat/squad/${encodeURIComponent(messageId)}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handleResponse<SquadMessage>(response);
}

export async function addSquadReaction(
  messageId: string,
  input: { actor: string; reaction: string }
): Promise<SquadMessage> {
  const response = await fetch(`${API_BASE}/chat/squad/${encodeURIComponent(messageId)}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return handleResponse<SquadMessage>(response);
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
