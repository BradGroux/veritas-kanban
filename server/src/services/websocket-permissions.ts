import type { WebSocket } from 'ws';
import {
  hasPermission,
  type AuthenticatedWebSocket,
  type AuthPermission,
} from '../middleware/auth.js';

const DEFAULT_WORKSPACE_ID = 'local';
const WEBSOCKET_OPEN = 1;

export interface WebSocketDeliveryOptions {
  workspaceId?: string;
  permissions?: AuthPermission[];
}

export function canReceiveWebSocketEvent(
  client: WebSocket,
  options: WebSocketDeliveryOptions = {}
): boolean {
  const auth = (client as AuthenticatedWebSocket).auth;
  if (!auth) return false;

  const eventWorkspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  if (auth.role !== 'admin' && auth.workspaceId !== eventWorkspaceId) {
    return false;
  }

  const permissions = options.permissions ?? [];
  if (permissions.length === 0) return true;

  return permissions.some((permission) => hasPermission(auth, permission));
}

export function sendWebSocketEvent(
  client: WebSocket,
  payload: string,
  options: WebSocketDeliveryOptions = {}
): boolean {
  if (client.readyState !== WEBSOCKET_OPEN) return false;
  if (!canReceiveWebSocketEvent(client, options)) return false;

  client.send(payload);
  return true;
}
