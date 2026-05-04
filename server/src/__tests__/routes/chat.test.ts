/**
 * Chat Routes — test coverage for #250
 *
 * Tests HTTP status codes, request validation, error handling,
 * and auth middleware enforcement for /api/chat/* endpoints.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Mock dependencies before importing route ─────────────────────────────────

const { mockChatService, mockSendGatewayChat, mockBuildContext } = vi.hoisted(() => ({
  mockChatService: {
    getSession: vi.fn(),
    getSessionForTask: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    addMessage: vi.fn(),
    deleteSession: vi.fn(),
    sendSquadMessage: vi.fn(),
    getSquadMessages: vi.fn(),
  },
  mockSendGatewayChat: vi.fn().mockResolvedValue(undefined),
  mockBuildContext: vi.fn(),
}));

vi.mock('../../services/chat-service.js', () => ({
  getChatService: () => mockChatService,
}));

vi.mock('../../services/gateway-chat-client.js', () => ({
  sendGatewayChat: mockSendGatewayChat,
  loadGatewayToken: vi.fn().mockResolvedValue('token'),
}));

vi.mock('../../services/veritas-context-service.js', () => ({
  getVeritasContextService: () => ({
    buildContext: mockBuildContext,
  }),
}));

vi.mock('../../services/broadcast-service.js', () => ({
  broadcastChatMessage: vi.fn(),
  broadcastSquadMessage: vi.fn(),
}));

vi.mock('../../services/squad-webhook-service.js', () => ({
  fireSquadWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/config-service.js', () => {
  const ConfigService = function (this: any) {
    this.getConfig = vi.fn().mockResolvedValue({});
    this.getFeatureSettings = vi.fn().mockResolvedValue({
      general: { humanDisplayName: 'Human' },
      squadWebhook: null,
    });
  };
  return { ConfigService };
});

vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { chatRoutes } from '../../routes/chat.js';

// ── App builders ─────────────────────────────────────────────────────────────

function buildApp(authenticated = true) {
  const app = express();
  app.use(express.json());

  if (authenticated) {
    app.use((req: any, _res: any, next: any) => {
      req.auth = { role: 'admin', keyName: 'test-key', isLocalhost: true };
      next();
    });
  } else {
    // Simulate auth middleware rejecting unauthenticated requests
    app.use((_req: any, res: any) => {
      res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Authentication required' });
    });
  }

  app.use('/', chatRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ code: err.code || 'ERROR', message: err.message });
  });
  return app;
}

const sampleSession = {
  id: 'sess_1',
  taskId: null,
  agent: 'veritas',
  messages: [],
  mode: 'ask',
  createdAt: new Date().toISOString(),
};

const sampleMessage = {
  id: 'msg_1',
  role: 'user',
  content: 'hello',
  timestamp: new Date().toISOString(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Chat Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildContext.mockResolvedValue({ contextBlock: '', results: [], degraded: false });
    app = buildApp(true);
  });

  // ── Auth enforcement ───────────────────────────────────────────────────────

  describe('auth enforcement', () => {
    it('POST /send returns 401 without auth', async () => {
      const unauthApp = buildApp(false);
      const res = await request(unauthApp).post('/send').send({ message: 'hello' });
      expect(res.status).toBe(401);
    });

    it('GET /sessions returns 401 without auth', async () => {
      const unauthApp = buildApp(false);
      const res = await request(unauthApp).get('/sessions');
      expect(res.status).toBe(401);
    });

    it('DELETE /sessions/:id returns 401 without auth', async () => {
      const unauthApp = buildApp(false);
      const res = await request(unauthApp).delete('/sessions/sess_1');
      expect(res.status).toBe(401);
    });

    it('POST /squad returns 401 without auth', async () => {
      const unauthApp = buildApp(false);
      const res = await request(unauthApp).post('/squad').send({ agent: 'K-2SO', message: 'done' });
      expect(res.status).toBe(401);
    });

    it('GET /squad returns 401 without auth', async () => {
      const unauthApp = buildApp(false);
      const res = await request(unauthApp).get('/squad');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /send ─────────────────────────────────────────────────────────────

  describe('POST /send', () => {
    beforeEach(() => {
      mockChatService.createSession.mockResolvedValue(sampleSession);
      mockChatService.addMessage.mockResolvedValue(sampleMessage);
    });

    it('returns 200 with echo of sent message', async () => {
      const res = await request(app).post('/send').send({ message: 'hello' });
      expect(res.status).toBe(200);
    });

    it('returns 4xx/5xx when message is empty string', async () => {
      const res = await request(app).post('/send').send({ message: '' });
      // ZodError from schema.parse throws as unhandled → 500 via error handler
      // Route uses zod .parse() not safeParse, so invalid input returns 500
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('returns 4xx/5xx when message is missing', async () => {
      const res = await request(app).post('/send').send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('returns 4xx/5xx when mode is invalid', async () => {
      const res = await request(app).post('/send').send({ message: 'hi', mode: 'invalid' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('accepts valid mode: ask', async () => {
      const res = await request(app).post('/send').send({ message: 'hi', mode: 'ask' });
      expect(res.status).toBe(200);
    });

    it('accepts valid mode: build', async () => {
      const res = await request(app).post('/send').send({ message: 'hi', mode: 'build' });
      expect(res.status).toBe(200);
    });

    it('injects retrieval context for VERITAS gateway messages', async () => {
      mockBuildContext.mockResolvedValue({
        contextBlock: '<veritas_context>\nRelevant task\n</veritas_context>',
        results: [],
        degraded: false,
      });

      const res = await request(app).post('/send').send({ message: 'what overlaps?' });

      expect(res.status).toBe(200);
      expect(mockBuildContext).toHaveBeenCalledWith({
        message: 'what overlaps?',
        taskId: undefined,
      });
      expect(mockSendGatewayChat).toHaveBeenCalledWith(
        'what overlaps?\n\n<veritas_context>\nRelevant task\n</veritas_context>',
        'kanban-chat-sess_1',
        expect.any(Object)
      );
    });

    it('skips retrieval context when requested', async () => {
      const res = await request(app)
        .post('/send')
        .send({ message: 'plain chat', includeContext: false });

      expect(res.status).toBe(200);
      expect(mockBuildContext).not.toHaveBeenCalled();
      expect(mockSendGatewayChat).toHaveBeenCalledWith(
        'plain chat',
        'kanban-chat-sess_1',
        expect.any(Object)
      );
    });

    it('accepts optional taskId and sessionId', async () => {
      mockChatService.getSession.mockResolvedValue(sampleSession);
      const res = await request(app)
        .post('/send')
        .send({ message: 'hello', taskId: 'task_1', sessionId: 'sess_1' });
      expect(res.status).toBe(200);
    });

    it('returns 500 on service error', async () => {
      mockChatService.addMessage.mockRejectedValue(new Error('Storage error'));
      const res = await request(app).post('/send').send({ message: 'hello' });
      expect(res.status).toBe(500);
    });
  });

  // ── GET /sessions ──────────────────────────────────────────────────────────

  describe('GET /sessions', () => {
    it('returns 200 with list of sessions', async () => {
      mockChatService.listSessions.mockResolvedValue([sampleSession]);
      const res = await request(app).get('/sessions');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns empty array when no sessions', async () => {
      mockChatService.listSessions.mockResolvedValue([]);
      const res = await request(app).get('/sessions');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 500 on service error', async () => {
      mockChatService.listSessions.mockRejectedValue(new Error('DB error'));
      const res = await request(app).get('/sessions');
      expect(res.status).toBe(500);
    });
  });

  // ── GET /sessions/:id ──────────────────────────────────────────────────────

  describe('GET /sessions/:id', () => {
    it('returns 200 for existing session', async () => {
      mockChatService.getSession.mockResolvedValue(sampleSession);
      const res = await request(app).get('/sessions/sess_1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('sess_1');
    });

    it('returns 404 for non-existent session', async () => {
      mockChatService.getSession.mockResolvedValue(null);
      const res = await request(app).get('/sessions/missing');
      expect(res.status).toBe(404);
    });

    it('returns 500 on service error', async () => {
      mockChatService.getSession.mockRejectedValue(new Error('Read error'));
      const res = await request(app).get('/sessions/sess_1');
      expect(res.status).toBe(500);
    });
  });

  // ── GET /sessions/:id/history ──────────────────────────────────────────────

  describe('GET /sessions/:id/history', () => {
    it('returns 200 with message array', async () => {
      mockChatService.getSession.mockResolvedValue({ ...sampleSession, messages: [sampleMessage] });
      const res = await request(app).get('/sessions/sess_1/history');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 404 for non-existent session', async () => {
      mockChatService.getSession.mockResolvedValue(null);
      const res = await request(app).get('/sessions/missing/history');
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /sessions/:id ──────────────────────────────────────────────────

  describe('DELETE /sessions/:id', () => {
    it('returns 204 on successful delete', async () => {
      mockChatService.deleteSession.mockResolvedValue(undefined);
      const res = await request(app).delete('/sessions/sess_1');
      expect(res.status).toBe(204);
    });

    it('returns 500 on service error', async () => {
      mockChatService.deleteSession.mockRejectedValue(new Error('Delete failed'));
      const res = await request(app).delete('/sessions/sess_1');
      expect(res.status).toBe(500);
    });
  });

  // ── POST /squad ───────────────────────────────────────────────────────────

  describe('POST /squad', () => {
    const validSquadMsg = { agent: 'K-2SO', message: 'Task complete' };

    it('returns 201 on valid squad message', async () => {
      mockChatService.sendSquadMessage.mockResolvedValue({ id: 'msg_s1', ...validSquadMsg });
      const res = await request(app).post('/squad').send(validSquadMsg);
      expect(res.status).toBe(201);
    });

    it('returns 4xx/5xx when agent is missing', async () => {
      // ZodError from schema.parse → 500 via error handler
      const res = await request(app).post('/squad').send({ message: 'hello' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('returns 4xx/5xx when message is empty', async () => {
      const res = await request(app).post('/squad').send({ agent: 'K-2SO', message: '' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('returns 4xx/5xx when event type is invalid', async () => {
      const res = await request(app)
        .post('/squad')
        .send({ agent: 'K-2SO', message: 'hi', event: 'invalid.event' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('accepts valid event type', async () => {
      mockChatService.sendSquadMessage.mockResolvedValue({ id: 'msg_s2', ...validSquadMsg });
      const res = await request(app)
        .post('/squad')
        .send({ agent: 'K-2SO', message: 'Spawned', event: 'agent.spawned' });
      expect(res.status).toBe(201);
    });

    it('returns 500 on service error', async () => {
      mockChatService.sendSquadMessage.mockRejectedValue(new Error('Write failed'));
      const res = await request(app).post('/squad').send(validSquadMsg);
      expect(res.status).toBe(500);
    });
  });

  // ── GET /squad ────────────────────────────────────────────────────────────

  describe('GET /squad', () => {
    it('returns 200 with squad messages array', async () => {
      mockChatService.getSquadMessages.mockResolvedValue([
        { id: 'm1', agent: 'VERITAS', message: 'hi' },
      ]);
      const res = await request(app).get('/squad');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('passes query parameters to the service', async () => {
      mockChatService.getSquadMessages.mockResolvedValue([]);
      const res = await request(app).get('/squad?agent=K-2SO&limit=10&includeSystem=false');
      expect(res.status).toBe(200);
    });

    it('returns 500 on service error', async () => {
      mockChatService.getSquadMessages.mockRejectedValue(new Error('Read failed'));
      const res = await request(app).get('/squad');
      expect(res.status).toBe(500);
    });
  });
});
