/**
 * BroadcastService Tests
 * Tests WebSocket broadcast functions for task changes and telemetry.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AnyTelemetryEvent } from '@veritas-kanban/shared';
import type { WebSocketServer } from 'ws';
import {
  initBroadcast,
  broadcastTaskChange,
  broadcastTelemetryEvent,
  broadcastWorkflowStatus,
} from '../services/broadcast-service.js';
import type { WebSocketEventChannel } from '../services/websocket-permissions.js';

type MockAuth = {
  role: 'admin' | 'agent' | 'read-only';
  isLocalhost: boolean;
  workspaceId?: string;
};

type MockClient = {
  readyState: number;
  auth?: MockAuth;
  bufferedAmount: number;
  subscribedChannels?: Set<WebSocketEventChannel>;
  sent: string[];
  send: (data: string) => void;
  close: ReturnType<typeof vi.fn>;
};

// Minimal mock WebSocket server
function createMockWss() {
  const sentMessages: string[] = [];
  const clients = new Set<MockClient>();

  return {
    clients,
    addClient(
      readyState = 1,
      auth: MockAuth = { role: 'admin', isLocalhost: false, workspaceId: 'local' },
      options: { bufferedAmount?: number; subscribedChannels?: Set<WebSocketEventChannel> } = {}
    ) {
      const sent: string[] = [];
      const client = {
        readyState,
        auth,
        bufferedAmount: options.bufferedAmount ?? 0,
        subscribedChannels: options.subscribedChannels,
        sent,
        send: (data: string) => {
          sent.push(data);
          sentMessages.push(data);
        },
        close: vi.fn(),
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

function workflowRun(status: string) {
  return {
    id: 'run_123',
    workflowId: 'workflow_456',
    workflowVersion: 2,
    taskId: 'task_789',
    status,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: status === 'completed' ? '2026-01-01T00:00:05Z' : undefined,
    steps: [
      {
        stepId: 'step_1',
        status,
        retries: 0,
      },
    ],
  };
}

afterEach(() => {
  vi.useRealTimers();
  initBroadcast(null as unknown as WebSocketServer);
});

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
      expect(msg.sequence).toEqual(expect.any(Number));
      expect(msg.workspaceId).toBe('local');
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

    it('should filter task events by channel subscription while preserving legacy clients', () => {
      const wss = createMockWss();
      const workflowOnly = wss.addClient(1, undefined, {
        subscribedChannels: new Set(['workflows']),
      });
      const taskSubscriber = wss.addClient(1, undefined, {
        subscribedChannels: new Set(['tasks']),
      });
      const legacySubscriber = wss.addClient(1);
      initBroadcast(asWebSocketServer(wss));

      broadcastTaskChange('updated', 'task_456');

      expect(workflowOnly.sent).toHaveLength(0);
      expect(taskSubscriber.sent).toHaveLength(1);
      expect(legacySubscriber.sent).toHaveLength(1);
      expect(wss.sentMessages).toHaveLength(2);
    });

    it('should close backpressured clients instead of sending task events', () => {
      const wss = createMockWss();
      const backpressuredClient = wss.addClient(1, undefined, {
        bufferedAmount: 1_000_001,
        subscribedChannels: new Set(['tasks']),
      });
      const healthyClient = wss.addClient(1, undefined, {
        subscribedChannels: new Set(['tasks']),
      });
      initBroadcast(asWebSocketServer(wss));

      broadcastTaskChange('updated', 'task_456');

      expect(backpressuredClient.sent).toHaveLength(0);
      expect(backpressuredClient.close).toHaveBeenCalledWith(1013, 'Client backpressure');
      expect(healthyClient.sent).toHaveLength(1);
      expect(wss.sentMessages).toHaveLength(1);
    });

    it('should batch task broadcasts across many clients', async () => {
      const wss = createMockWss();
      for (let index = 0; index < 75; index++) {
        wss.addClient(1, undefined, { subscribedChannels: new Set(['tasks']) });
      }
      initBroadcast(asWebSocketServer(wss));

      broadcastTaskChange('updated', 'task_456');

      expect(wss.sentMessages).toHaveLength(50);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(wss.sentMessages).toHaveLength(75);
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
      expect(msg.timestamp).toBeDefined();
      expect(msg.sequence).toEqual(expect.any(Number));
      expect(msg.workspaceId).toBe('local');
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

  describe('broadcastWorkflowStatus()', () => {
    it('should coalesce high-frequency status updates per workflow run', () => {
      vi.useFakeTimers();
      const wss = createMockWss();
      const workflowSubscriber = wss.addClient(1, undefined, {
        subscribedChannels: new Set(['workflows']),
      });
      initBroadcast(asWebSocketServer(wss));

      broadcastWorkflowStatus(workflowRun('running'));
      broadcastWorkflowStatus(workflowRun('completed'));

      expect(wss.sentMessages).toHaveLength(0);

      vi.advanceTimersByTime(100);

      expect(workflowSubscriber.sent).toHaveLength(1);
      expect(wss.sentMessages).toHaveLength(1);
      const msg = JSON.parse(workflowSubscriber.sent[0]);
      expect(msg.type).toBe('workflow:status');
      expect(msg.sequence).toEqual(expect.any(Number));
      expect(msg.workspaceId).toBe('local');
      expect(msg.payload.id).toBe('run_123');
      expect(msg.payload.status).toBe('completed');
      expect(msg.payload.completedAt).toBe('2026-01-01T00:00:05Z');
    });
  });

  describe('initBroadcast()', () => {
    it('should accept a WebSocket server', () => {
      const wss = createMockWss();
      expect(() => initBroadcast(asWebSocketServer(wss))).not.toThrow();
    });
  });
});
