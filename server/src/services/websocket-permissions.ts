import type { WebSocket } from 'ws';
import {
  hasPermission,
  type AuthenticatedWebSocket,
  type AuthPermission,
} from '../middleware/auth.js';

const DEFAULT_WORKSPACE_ID = 'local';
const WEBSOCKET_OPEN = 1;
const WS_BACKPRESSURE_LIMIT_BYTES = 1_000_000;

export type WebSocketEventChannel =
  | 'agent-output'
  | 'agent-status'
  | 'broadcasts'
  | 'chat'
  | 'squad'
  | 'tasks'
  | 'telemetry'
  | 'workflows';

export interface WebSocketDeliveryOptions {
  workspaceId?: string;
  permissions?: AuthPermission[];
  channel?: WebSocketEventChannel;
}

export interface SubscribedWebSocket extends AuthenticatedWebSocket {
  subscribedChannels?: Set<WebSocketEventChannel>;
}

export function subscribeWebSocketChannel(client: WebSocket, channel: WebSocketEventChannel): void {
  const ws = client as SubscribedWebSocket;
  ws.subscribedChannels ??= new Set();
  ws.subscribedChannels.add(channel);
}

function hasChannelSubscription(client: WebSocket, channel?: WebSocketEventChannel): boolean {
  if (!channel) return true;
  const subscriptions = (client as SubscribedWebSocket).subscribedChannels;
  // Backward compatible: clients without explicit channel subscriptions still receive
  // events if workspace and permission checks allow them.
  if (!subscriptions || subscriptions.size === 0) return true;
  return subscriptions.has(channel);
}

export function isWebSocketBackpressured(client: WebSocket): boolean {
  return (
    typeof client.bufferedAmount === 'number' && client.bufferedAmount > WS_BACKPRESSURE_LIMIT_BYTES
  );
}

export function canReceiveWebSocketEvent(
  client: WebSocket,
  options: WebSocketDeliveryOptions = {}
): boolean {
  const auth = (client as AuthenticatedWebSocket).auth;
  if (!auth) return false;
  if (!hasChannelSubscription(client, options.channel)) return false;

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
  if (isWebSocketBackpressured(client)) {
    client.close(1013, 'Client backpressure');
    return false;
  }

  client.send(payload);
  return true;
}
