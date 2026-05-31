/**
 * BroadcastService Tests
 * Tests WebSocket broadcast functions for task changes and telemetry.
 */
import { describe, it, expect } from 'vitest';
import type { AnyTelemetryEvent } from '@veritas-kanban/shared';
import type { WebSocketServer } from 'ws';
import {
  initBroadcast,
  broadcastTaskChange,
  broadcastTelemetryEvent,
} from '../services/broadcast-service.js';

// Minimal mock WebSocket server
function createMockWss() {
  const sentMessages: string[] = [];
  const clients = new Set<{
    readyState: number;
    auth?: { role: 'admin' | 'agent' | 'read-only'; isLocalhost: boolean; workspaceId?: string };
    send: (data: string) => void;
  }>();

  return {
    clients,
    addClient(
      readyState = 1,
      auth = { role: 'admin' as const, isLocalhost: false, workspaceId: 'local' }
    ) {
      const client = {
        readyState,
        auth,
        send: (data: string) => sentMessages.push(data),
      };
      clients.add(client);
      return client;
    },
    sentMessages,
  };
}

function asWebSocketServer(wss: ReturnType<typeof createMockWss>): WebSocketServer {
  return wss as unknown as WebSocketServer;
}

function telemetryEvent(): AnyTelemetryEvent {
  return {
    type: 'run.started',
    taskId: 'task_789',
    agent: 'claude-code',
    timestamp: '2024-01-01T00:00:00Z',
  } as unknown as AnyTelemetryEvent;
}

describe('BroadcastService', () => {
  describe('broadcastTaskChange()', () => {
    it('should broadcast to all connected clients', () => {
      const wss = createMockWss();
      wss.addClient(1); // OPEN
      wss.addClient(1); // OPEN
      initBroadcast(asWebSocketServer(wss));

      broadcastTaskChange('created', 'task_123');

      expect(wss.sentMessages).toHaveLength(2);
      const msg = JSON.parse(wss.sentMessages[0]);
      expect(msg.type).toBe('task:changed');
      expect(msg.changeType).toBe('created');
      expect(msg.taskId).toBe('task_123');
      expect(msg.timestamp).toBeDefined();
    });

    it('should skip clients that are not in OPEN state', () => {
      const wss = createMockWss();
      wss.addClient(1); // OPEN
      wss.addClient(0); // CONNECTING
      wss.addClient(3); // CLOSED
      initBroadcast(asWebSocketServer(wss));

      broadcastTaskChange('updated', 'task_456');

      expect(wss.sentMessages).toHaveLength(1);
    });

    it('should handle no connected clients gracefully', () => {
      const wss = createMockWss();
      initBroadcast(asWebSocketServer(wss));

      // Should not throw
      broadcastTaskChange('deleted');
      expect(wss.sentMessages).toHaveLength(0);
    });

    it('should support all change types', () => {
      const wss = createMockWss();
      wss.addClient(1);
      initBroadcast(asWebSocketServer(wss));

      const types = ['created', 'updated', 'deleted', 'archived', 'restored', 'reordered'] as const;
      for (const type of types) {
        broadcastTaskChange(type);
      }

      expect(wss.sentMessages).toHaveLength(6);
    });

    it('should filter task events by client workspace', () => {
      const wss = createMockWss();
      wss.addClient(1, { role: 'read-only', isLocalhost: false, workspaceId: 'local' });
      wss.addClient(1, { role: 'read-only', isLocalhost: false, workspaceId: 'other' });
      initBroadcast(asWebSocketServer(wss));

      broadcastTaskChange('updated', 'task_456');

      expect(wss.sentMessages).toHaveLength(1);
    });
  });

  describe('broadcastTelemetryEvent()', () => {
    it('should broadcast telemetry events to all connected clients', () => {
      const wss = createMockWss();
      wss.addClient(1);
      initBroadcast(asWebSocketServer(wss));

      broadcastTelemetryEvent(telemetryEvent());

      expect(wss.sentMessages).toHaveLength(1);
      const msg = JSON.parse(wss.sentMessages[0]);
      expect(msg.type).toBe('telemetry:event');
      expect(msg.event.taskId).toBe('task_789');
    });

    it('should filter telemetry events by read permission', () => {
      const wss = createMockWss();
      wss.addClient(1, { role: 'read-only', isLocalhost: false, workspaceId: 'local' });
      wss.addClient(1, { role: 'agent', isLocalhost: false, workspaceId: 'local' });
      initBroadcast(asWebSocketServer(wss));

      broadcastTelemetryEvent(telemetryEvent());

      expect(wss.sentMessages).toHaveLength(1);
    });

    it('should do nothing when wss is not initialized', () => {
      initBroadcast(null as unknown as WebSocketServer);
      // Should not throw
      broadcastTelemetryEvent(telemetryEvent());
    });
  });

  describe('initBroadcast()', () => {
    it('should accept a WebSocket server', () => {
      const wss = createMockWss();
      expect(() => initBroadcast(asWebSocketServer(wss))).not.toThrow();
    });
  });
});
