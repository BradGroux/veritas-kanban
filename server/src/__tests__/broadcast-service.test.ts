/**
 * BroadcastService Tests
 * Tests WebSocket broadcast functions for task changes and telemetry.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initBroadcast,
  broadcastTaskChange,
  broadcastTelemetryEvent,
} from '../services/broadcast-service.js';

// Minimal mock WebSocket server
function createMockWss() {
  const sentMessages: string[] = [];
  const clients = new Set<{ readyState: number; send: (data: string) => void }>();

  return {
    clients,
    addClient(readyState = 1) {
      const client = {
        readyState,
        send: (data: string) => sentMessages.push(data),
      };
      clients.add(client);
      return client;
    },
    sentMessages,
  };
}

describe('BroadcastService', () => {
  describe('broadcastTaskChange()', () => {
    it('should broadcast to all connected clients', () => {
      const wss = createMockWss();
      wss.addClient(1); // OPEN
      wss.addClient(1); // OPEN
      initBroadcast(wss as any);

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
      initBroadcast(wss as any);

      broadcastTaskChange('updated', 'task_456');

      expect(wss.sentMessages).toHaveLength(1);
    });

    it('should handle no connected clients gracefully', () => {
      const wss = createMockWss();
      initBroadcast(wss as any);

      // Should not throw
      broadcastTaskChange('deleted');
      expect(wss.sentMessages).toHaveLength(0);
    });

    it('should support all change types', () => {
      const wss = createMockWss();
      wss.addClient(1);
      initBroadcast(wss as any);

      const types = ['created', 'updated', 'deleted', 'archived', 'restored', 'reordered'] as const;
      for (const type of types) {
        broadcastTaskChange(type);
      }

      expect(wss.sentMessages).toHaveLength(6);
    });
  });

  describe('broadcastTelemetryEvent()', () => {
    it('should broadcast telemetry events to all connected clients', () => {
      const wss = createMockWss();
      wss.addClient(1);
      initBroadcast(wss as any);

      const event = {
        type: 'run.started',
        taskId: 'task_789',
        agent: 'claude-code',
        timestamp: '2024-01-01T00:00:00Z',
      } as any;

      broadcastTelemetryEvent(event);

      expect(wss.sentMessages).toHaveLength(1);
      const msg = JSON.parse(wss.sentMessages[0]);
      expect(msg.type).toBe('telemetry:event');
      expect(msg.event.taskId).toBe('task_789');
    });

    it('should do nothing when wss is not initialized', () => {
      initBroadcast(null as any);
      // Should not throw
      broadcastTelemetryEvent({ type: 'run.started' } as any);
    });
  });

  describe('initBroadcast()', () => {
    it('should accept a WebSocket server', () => {
      const wss = createMockWss();
      expect(() => initBroadcast(wss as any)).not.toThrow();
    });
  });
});
