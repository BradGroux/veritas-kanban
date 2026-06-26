import type { WebSocketServer } from 'ws';
import type {
  AnyTelemetryEvent,
  RunSessionEvent,
  SquadMention,
  SquadMessage,
  SquadUnreadState,
} from '@veritas-kanban/shared';
import type { AuthenticatedWebSocket } from '../middleware/auth.js';
import {
  notifyTaskChange,
  notifyChatMessage,
  type TaskContext,
} from './clawdbot-webhook-service.js';
import {
  canReceiveWebSocketEvent,
  sendWebSocketEvent,
  type WebSocketDeliveryOptions,
} from './websocket-permissions.js';

/**
 * Simple broadcast service that sends task change events to all connected WebSocket clients.
 * Initialized with the WebSocketServer instance from index.ts.
 */
let wssRef: WebSocketServer | null = null;

// Performance: batch size for WebSocket broadcasts
const BROADCAST_BATCH_SIZE = 50;
const WORKFLOW_STATUS_COALESCE_MS = 100;
const DEFAULT_WORKSPACE_ID = 'local';
let websocketEventSequence = 0;
let workflowStatusFlushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWorkflowStatusEvents = new Map<string, WorkflowStatusEvent>();

export interface RevokedWebSocketCredential {
  apiTokenId?: string;
  deviceSessionId?: string;
}

export function initBroadcast(wss: WebSocketServer): void {
  wssRef = wss;
}

export function nextWebSocketEventSequence(): number {
  websocketEventSequence =
    websocketEventSequence >= Number.MAX_SAFE_INTEGER ? 1 : websocketEventSequence + 1;
  return websocketEventSequence;
}

export function closeWebSocketClientsForRevokedCredential(
  credential: RevokedWebSocketCredential
): number {
  if (!wssRef) return 0;
  if (!credential.apiTokenId && !credential.deviceSessionId) return 0;

  let closed = 0;
  for (const client of wssRef.clients) {
    const auth = (client as AuthenticatedWebSocket).auth;
    if (!auth) continue;
    const matchesApiToken =
      credential.apiTokenId !== undefined && auth.apiTokenId === credential.apiTokenId;
    const matchesDeviceSession =
      credential.deviceSessionId !== undefined &&
      auth.deviceSessionId === credential.deviceSessionId;
    if (matchesApiToken || matchesDeviceSession) {
      client.close(4001, 'Credential revoked');
      closed++;
    }
  }

  return closed;
}

function normalizeWorkspaceId(workspaceId?: string): string {
  return workspaceId && workspaceId.trim() ? workspaceId : DEFAULT_WORKSPACE_ID;
}

/**
 * Broadcast a payload to all connected clients in batches.
 * Uses setImmediate() between batches to yield to the event loop,
 * preventing main thread blocking with many clients.
 *
 * @param payload - Pre-serialized JSON string
 */
function broadcastToClients(payload: string, options: WebSocketDeliveryOptions = {}): void {
  if (!wssRef) return;

  const clients = Array.from(wssRef.clients);
  const openClients = clients.filter(
    (client) => client.readyState === 1 && canReceiveWebSocketEvent(client, options)
  );

  // For small client counts, send synchronously
  if (openClients.length <= BROADCAST_BATCH_SIZE) {
    for (const client of openClients) {
      sendWebSocketEvent(client, payload, options);
    }
    return;
  }

  // For larger counts, batch with setImmediate to yield event loop
  let index = 0;
  const sendBatch = (): void => {
    const end = Math.min(index + BROADCAST_BATCH_SIZE, openClients.length);
    for (let i = index; i < end; i++) {
      sendWebSocketEvent(openClients[i], payload, options);
    }
    index = end;
    if (index < openClients.length) {
      setImmediate(sendBatch);
    }
  };
  sendBatch();
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
  sequence: number;
  workspaceId: string;
}

export interface TelemetryBroadcastEvent {
  type: 'telemetry:event';
  event: AnyTelemetryEvent;
  timestamp: string;
  sequence: number;
  workspaceId: string;
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
  taskContext?: TaskContext,
  options: { workspaceId?: string } = {}
): void {
  if (!wssRef) return;
  const workspaceId = normalizeWorkspaceId(options.workspaceId);

  const message: TaskChangeEvent = {
    type: 'task:changed',
    changeType,
    taskId,
    timestamp: new Date().toISOString(),
    sequence: nextWebSocketEventSequence(),
    workspaceId,
  };

  const payload = JSON.stringify(message);

  broadcastToClients(payload, { permissions: ['task:read'], workspaceId, channel: 'tasks' });

  // Also notify via webhook (fire-and-forget)
  notifyTaskChange(changeType, taskId, taskContext);
}

export interface ChatBroadcastEvent {
  type: 'chat:delta' | 'chat:message' | 'chat:error';
  sessionId: string;
  text?: string;
  message?: unknown;
  error?: string;
  timestamp?: string;
  sequence?: number;
  workspaceId?: string;
}

/**
 * Broadcast a chat message/event to all connected WebSocket clients.
 */
export function broadcastChatMessage(
  sessionId: string,
  event: ChatBroadcastEvent,
  options: { workspaceId?: string } = {}
): void {
  if (!wssRef) return;
  const workspaceId = normalizeWorkspaceId(options.workspaceId);

  const payload = JSON.stringify({
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
    sequence: event.sequence ?? nextWebSocketEventSequence(),
    workspaceId: event.workspaceId ?? workspaceId,
  });

  broadcastToClients(payload, {
    permissions: ['task:read'],
    workspaceId,
    channel: 'chat',
    chatSessionId: sessionId,
  });

  // Also notify via webhook (fire-and-forget)
  notifyChatMessage(
    sessionId,
    event.type as 'chat:message' | 'chat:delta' | 'chat:error',
    typeof event.text === 'string' ? event.text : undefined
  );
}

export interface SquadBroadcastEvent {
  type: 'squad:message' | 'squad:mention' | 'squad:read' | 'squad:pin' | 'squad:reaction';
  message?: SquadMessage;
  mentions?: SquadMention[];
  actor?: string;
  readState?: SquadUnreadState;
  reaction?: string;
  timestamp: string;
  sequence: number;
  workspaceId: string;
}

/**
 * Broadcast a squad message to all connected WebSocket clients.
 */
export function broadcastSquadMessage(
  message: SquadMessage,
  options: { workspaceId?: string } = {}
): void {
  broadcastSquadEvent({ type: 'squad:message', message }, options);
}

export function broadcastSquadEvent(
  event: Omit<SquadBroadcastEvent, 'timestamp' | 'sequence' | 'workspaceId'>,
  options: { workspaceId?: string } = {}
): void {
  if (!wssRef) return;
  const workspaceId = normalizeWorkspaceId(options.workspaceId);

  const payloadEvent: SquadBroadcastEvent = {
    ...event,
    timestamp: new Date().toISOString(),
    sequence: nextWebSocketEventSequence(),
    workspaceId,
  };

  const payload = JSON.stringify(payloadEvent);

  broadcastToClients(payload, { permissions: ['agent:read'], workspaceId, channel: 'squad' });
}

/**
 * Broadcast a telemetry event to all connected WebSocket clients.
 * Clients can listen for 'telemetry:event' messages for real-time telemetry updates.
 */
export function broadcastTelemetryEvent(
  event: AnyTelemetryEvent,
  options: { workspaceId?: string } = {}
): void {
  if (!wssRef) return;
  const workspaceId = normalizeWorkspaceId(options.workspaceId);

  const message: TelemetryBroadcastEvent = {
    type: 'telemetry:event',
    event,
    timestamp: new Date().toISOString(),
    sequence: nextWebSocketEventSequence(),
    workspaceId,
  };

  const payload = JSON.stringify(message);

  broadcastToClients(payload, {
    permissions: ['telemetry:read'],
    workspaceId,
    channel: 'telemetry',
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
  timestamp: string;
  sequence: number;
  workspaceId: string;
}

export interface RunSessionBroadcastEvent {
  type: 'run-session:event';
  event: RunSessionEvent;
  timestamp: string;
  sequence: number;
  workspaceId: string;
}

export function broadcastRunSessionEvent(
  event: RunSessionEvent,
  options: { workspaceId?: string } = {}
): void {
  if (!wssRef) return;
  const workspaceId = normalizeWorkspaceId(options.workspaceId);

  const message: RunSessionBroadcastEvent = {
    type: 'run-session:event',
    event,
    timestamp: new Date().toISOString(),
    sequence: nextWebSocketEventSequence(),
    workspaceId,
  };

  broadcastToClients(JSON.stringify(message), {
    permissions: ['task:read'],
    workspaceId,
    channel: 'run-sessions',
  });
}

/**
 * Broadcast a new broadcast message to all connected WebSocket clients.
 * Clients can listen for 'broadcast:new' messages to receive real-time notifications.
 */
export function broadcastNewMessage(
  broadcast: BroadcastMessageEvent['broadcast'],
  options: { workspaceId?: string } = {}
): void {
  if (!wssRef) return;
  const workspaceId = normalizeWorkspaceId(options.workspaceId);

  const message: BroadcastMessageEvent = {
    type: 'broadcast:new',
    broadcast,
    timestamp: new Date().toISOString(),
    sequence: nextWebSocketEventSequence(),
    workspaceId,
  };

  const payload = JSON.stringify(message);

  broadcastToClients(payload, { permissions: ['agent:read'], workspaceId, channel: 'broadcasts' });
}

export interface WorkflowStatusEvent {
  type: 'workflow:status';
  timestamp: string;
  sequence: number;
  workspaceId: string;
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

function flushWorkflowStatusEvents(): void {
  workflowStatusFlushTimer = null;
  const events = Array.from(pendingWorkflowStatusEvents.values());
  pendingWorkflowStatusEvents.clear();

  for (const event of events) {
    broadcastToClients(JSON.stringify(event), {
      permissions: ['workflow:read'],
      workspaceId: event.workspaceId,
      channel: 'workflows',
    });
  }
}

/**
 * Broadcast workflow run status updates to all connected WebSocket clients.
 * Sends full run state to avoid extra HTTP fetches.
 */
export function broadcastWorkflowStatus(
  run: {
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
  },
  options: { workspaceId?: string } = {}
): void {
  if (!wssRef) return;
  const workspaceId = normalizeWorkspaceId(options.workspaceId);

  const message: WorkflowStatusEvent = {
    type: 'workflow:status',
    timestamp: new Date().toISOString(),
    sequence: nextWebSocketEventSequence(),
    workspaceId,
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

  pendingWorkflowStatusEvents.set(run.id, message);

  if (!workflowStatusFlushTimer) {
    workflowStatusFlushTimer = setTimeout(flushWorkflowStatusEvents, WORKFLOW_STATUS_COALESCE_MS);
  }
}
