import type { WebSocketServer, WebSocket } from 'ws';
import type { AnyTelemetryEvent, SquadMessage } from '@veritas-kanban/shared';
import {
  notifyTaskChange,
  notifyChatMessage,
  type TaskContext,
} from './clawdbot-webhook-service.js';

/**
 * Simple broadcast service that sends task change events to all connected WebSocket clients.
 * Initialized with the WebSocketServer instance from index.ts.
 */
let wssRef: WebSocketServer | null = null;

export function initBroadcast(wss: WebSocketServer): void {
  wssRef = wss;
}

export type TaskChangeType =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'archived'
  | 'restored'
  | 'reordered';

export interface TaskChangeEvent {
  type: 'task:changed';
  changeType: TaskChangeType;
  taskId?: string;
  timestamp: string;
}

export interface TelemetryBroadcastEvent {
  type: 'telemetry:event';
  event: AnyTelemetryEvent;
}

/**
 * Broadcast a task change to all connected WebSocket clients.
 * Clients can listen for 'task:changed' messages and invalidate their query caches.
 *
 * @param taskContext - Optional enriched context for the webhook payload (title, status, etc.)
 */
export function broadcastTaskChange(
  changeType: TaskChangeType,
  taskId?: string,
  taskContext?: TaskContext
): void {
  if (!wssRef) return;

  const message: TaskChangeEvent = {
    type: 'task:changed',
    changeType,
    taskId,
    timestamp: new Date().toISOString(),
  };

  const payload = JSON.stringify(message);

  wssRef.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN = 1
      client.send(payload);
    }
  });

  // Also notify via webhook (fire-and-forget)
  notifyTaskChange(changeType, taskId, taskContext);
}

export interface ChatBroadcastEvent {
  type: 'chat:delta' | 'chat:message' | 'chat:error';
  sessionId: string;
  text?: string;
  message?: unknown;
  error?: string;
}

/**
 * Broadcast a chat message/event to all connected WebSocket clients.
 */
export function broadcastChatMessage(sessionId: string, event: ChatBroadcastEvent): void {
  if (!wssRef) return;

  const payload = JSON.stringify(event);

  wssRef.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });

  // Also notify via webhook (fire-and-forget)
  notifyChatMessage(
    sessionId,
    event.type as 'chat:message' | 'chat:delta' | 'chat:error',
    typeof event.text === 'string' ? event.text : undefined
  );
}

export interface SquadBroadcastEvent {
  type: 'squad:message';
  message: SquadMessage;
}

/**
 * Broadcast a squad message to all connected WebSocket clients.
 */
export function broadcastSquadMessage(message: SquadMessage): void {
  if (!wssRef) return;

  const event: SquadBroadcastEvent = {
    type: 'squad:message',
    message,
  };

  const payload = JSON.stringify(event);

  wssRef.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

/**
 * Broadcast a telemetry event to all connected WebSocket clients.
 * Clients can listen for 'telemetry:event' messages for real-time telemetry updates.
 */
export function broadcastTelemetryEvent(event: AnyTelemetryEvent): void {
  if (!wssRef) return;

  const message: TelemetryBroadcastEvent = {
    type: 'telemetry:event',
    event,
  };

  const payload = JSON.stringify(message);

  wssRef.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN = 1
      client.send(payload);
    }
  });
}

export interface BroadcastMessageEvent {
  type: 'broadcast:new';
  broadcast: {
    id: string;
    message: string;
    priority: string;
    from?: string;
    tags?: string[];
    createdAt: string;
    readBy: Array<{ agent: string; readAt: string }>;
  };
}

/**
 * Broadcast a new broadcast message to all connected WebSocket clients.
 * Clients can listen for 'broadcast:new' messages to receive real-time notifications.
 */
export function broadcastNewMessage(broadcast: BroadcastMessageEvent['broadcast']): void {
  if (!wssRef) return;

  const message: BroadcastMessageEvent = {
    type: 'broadcast:new',
    broadcast,
  };

  const payload = JSON.stringify(message);

  wssRef.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN = 1
      client.send(payload);
    }
  });
}

export interface WorkflowStatusEvent {
  type: 'workflow:status';
  payload: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    taskId?: string;
    status: string;
    currentStep?: string;
    startedAt: string;
    completedAt?: string;
    error?: string;
    steps: Array<{
      stepId: string;
      status: string;
      agent?: string;
      sessionKey?: string;
      startedAt?: string;
      completedAt?: string;
      duration?: number;
      retries: number;
      output?: string;
      error?: string;
    }>;
  };
}

/**
 * Broadcast workflow run status updates to all connected WebSocket clients.
 * Sends full run state to avoid extra HTTP fetches.
 */
export function broadcastWorkflowStatus(run: {
  id: string;
  workflowId: string;
  workflowVersion: number;
  taskId?: string;
  status: string;
  currentStep?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  steps: Array<{
    stepId: string;
    status: string;
    agent?: string;
    sessionKey?: string;
    startedAt?: string;
    completedAt?: string;
    duration?: number;
    retries: number;
    output?: string;
    error?: string;
  }>;
}): void {
  if (!wssRef) return;

  const message: WorkflowStatusEvent = {
    type: 'workflow:status',
    payload: {
      id: run.id,
      workflowId: run.workflowId,
      workflowVersion: run.workflowVersion,
      taskId: run.taskId,
      status: run.status,
      currentStep: run.currentStep,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
      steps: run.steps.map((s) => ({
        stepId: s.stepId,
        status: s.status,
        agent: s.agent,
        sessionKey: s.sessionKey,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        duration: s.duration,
        retries: s.retries,
        output: s.output,
        error: s.error,
      })),
    },
  };

  const payload = JSON.stringify(message);

  wssRef.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN = 1
      client.send(payload);
    }
  });
}
