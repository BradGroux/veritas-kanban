import type { WebSocketServer, WebSocket } from 'ws';
import type { AnyTelemetryEvent } from '@veritas-kanban/shared';

/**
 * Simple broadcast service that sends task change events to all connected WebSocket clients.
 * Initialized with the WebSocketServer instance from index.ts.
 */
let wssRef: WebSocketServer | null = null;

export function initBroadcast(wss: WebSocketServer): void {
  wssRef = wss;
}

export type TaskChangeType = 'created' | 'updated' | 'deleted' | 'archived' | 'restored' | 'reordered';

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
 */
export function broadcastTaskChange(changeType: TaskChangeType, taskId?: string): void {
  if (!wssRef) return;

  const message: TaskChangeEvent = {
    type: 'task:changed',
    changeType,
    taskId,
    timestamp: new Date().toISOString(),
  };

  const payload = JSON.stringify(message);

  wssRef.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) { // WebSocket.OPEN = 1
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
    if (client.readyState === 1) { // WebSocket.OPEN = 1
      client.send(payload);
    }
  });
}
