// WebSocket Message Types

import type { AttemptStatus } from './task.types.js';
import type { ChatMessage } from './chat.types.js';
import type { RunEventEnvelope } from './run-event.types.js';

export type WSMessageType =
  | 'agent:output'
  | 'agent:event'
  | 'agent:status'
  | 'agent:complete'
  | 'task:updated'
  | 'chat:message'
  | 'chat:subscribed'
  | 'error';

export interface WSMessage {
  type: WSMessageType;
  taskId?: string;
  attemptId?: string;
  data: unknown;
  timestamp: string;
}

export interface AgentOutputMessage extends Omit<WSMessage, 'data'> {
  type: 'agent:output';
  taskId: string;
  attemptId: string;
  outputType: 'stdout' | 'stderr' | 'stdin' | 'system';
  content: string;
  sequence: number;
}

export interface AgentRunEventMessage extends WSMessage {
  type: 'agent:event';
  taskId: string;
  attemptId: string;
  data: RunEventEnvelope;
}

export interface AgentStatusMessage extends WSMessage {
  type: 'agent:status';
  data: {
    status: AttemptStatus;
    exitCode?: number;
  };
}

export interface ChatMessageEvent extends WSMessage {
  type: 'chat:message';
  data: {
    sessionId: string;
    message: ChatMessage;
  };
}
