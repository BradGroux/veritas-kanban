/**
 * Chat Routes
 *
 * Built-in chat interface for conversing with agents.
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getChatService } from '../services/chat-service.js';
import { sendGatewayRun, loadGatewayToken } from '../services/gateway-chat-client.js';
import { broadcastSquadMessage } from '../services/broadcast-service.js';
import { fireSquadWebhook } from '../services/squad-webhook-service.js';
import { ConfigService } from '../services/config-service.js';
import { getVeritasContextService } from '../services/veritas-context-service.js';
import type { ChatSendInput } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../middleware/error-handler.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('chat');

// Load gateway token on startup
loadGatewayToken().catch(() => {});

const router: RouterType = Router();
const chatService = getChatService();
const configService = new ConfigService();

// Validation schemas
const chatSendSchema = z.object({
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  message: z.string().min(1, 'Message cannot be empty'),
  agent: z.string().optional(),
  model: z.string().optional(),
  mode: z.enum(['ask', 'build']).optional(),
  includeContext: z.boolean().optional(),
});

const squadMessageSchema = z.object({
  agent: z.string().min(1, 'Agent name required'),
  message: z.string().min(1, 'Message cannot be empty'),
  tags: z.array(z.string()).optional(),
  model: z.string().optional(),
  system: z.boolean().optional(),
  event: z.enum(['agent.spawned', 'agent.completed', 'agent.failed', 'agent.status']).optional(),
  taskTitle: z.string().optional(),
  duration: z.string().optional(),
  card: z.record(z.string(), z.unknown()).optional(), // Adaptive Card v1.5 JSON
});

/**
 * POST /api/chat/send
 * Send a message to the chat interface
 *
 * Returns the user message echo plus the Hermes run metadata immediately.
 * HermesAgent owns execution through the HTTP /v1/runs control-plane API.
 */
router.post(
  '/send',
  asyncHandler(async (req, res) => {
    // Validate input
    const validatedInput = chatSendSchema.parse(req.body);
    const input = validatedInput as ChatSendInput;

    let session;
    let sessionId: string;

    // Get or create session
    if (input.sessionId) {
      session = await chatService.getSession(input.sessionId);
      if (!session && input.taskId) {
        // Session was deleted — recreate for task-scoped chats
        log.info(
          { sessionId: input.sessionId, taskId: input.taskId },
          'Recreating deleted task chat session'
        );
        session = await chatService.createSession({
          taskId: input.taskId,
          agent: input.agent || 'veritas',
          mode: input.mode || 'ask',
        });
      } else if (!session) {
        throw new NotFoundError(`Session ${input.sessionId} not found`);
      }
      sessionId = input.sessionId;
    } else if (input.taskId) {
      // Task-scoped session
      session = await chatService.getSessionForTask(input.taskId);
      if (!session) {
        // Create new task-scoped session
        session = await chatService.createSession({
          taskId: input.taskId,
          agent: input.agent || 'veritas',
          mode: input.mode || 'ask',
        });
      }
      sessionId = session.id;
    } else {
      // Create new board-level session
      session = await chatService.createSession({
        agent: input.agent || 'veritas',
        mode: input.mode || 'ask',
      });
      sessionId = session.id;
    }

    // Add user message
    const userMessage = await chatService.addMessage(sessionId, {
      role: 'user',
      content: input.message,
    });

    log.info({ sessionId, messageId: userMessage.id, taskId: session.taskId }, 'Chat message sent');

    // Start an async Hermes API-server run. The live HermesAgent control-plane
    // exposes HTTP /v1/runs, not the retired root WebSocket chat protocol.
    const gatewaySessionKey = `kanban-chat-${sessionId}`;
    const agent = input.agent || session.agent || 'veritas';
    const shouldInjectContext =
      input.includeContext !== false && agent.toLowerCase().includes('veritas');
    let gatewayMessage = input.message;

    if (shouldInjectContext) {
      const context = await getVeritasContextService().buildContext({
        message: input.message,
        taskId: input.taskId || session.taskId || undefined,
      });
      if (context.contextBlock) {
        gatewayMessage = `${input.message}\n\n${context.contextBlock}`;
      }
    }

    const run = await sendGatewayRun(
      gatewayMessage,
      gatewaySessionKey,
      'You are HermesAgent responding to a Veritas Kanban chat message. Answer clearly and preserve Veritas board truth; do not mutate tasks unless explicitly requested.'
    );

    res.status(200).json({
      sessionId,
      messageId: userMessage.id,
      runId: run.runId,
      runStatus: run.status,
      message: 'Message sent — Hermes run started',
    });
  })
);

/**
 * GET /api/chat/sessions
 * List all board-level chat sessions
 */
router.get(
  '/sessions',
  asyncHandler(async (_req, res) => {
    const sessions = await chatService.listSessions();
    res.json(sessions);
  })
);

/**
 * GET /api/chat/sessions/:id
 * Get a specific chat session with messages
 */
router.get(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const session = await chatService.getSession(sessionId);

    if (!session) {
      throw new NotFoundError(`Session ${sessionId} not found`);
    }

    res.json(session);
  })
);

/**
 * GET /api/chat/sessions/:id/history
 * Get messages for a session (messages only, no metadata)
 */
router.get(
  '/sessions/:id/history',
  asyncHandler(async (req, res) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const session = await chatService.getSession(sessionId);

    if (!session) {
      throw new NotFoundError(`Session ${sessionId} not found`);
    }

    res.json(session.messages);
  })
);

/**
 * DELETE /api/chat/sessions/:id
 * Delete a chat session
 */
router.delete(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await chatService.deleteSession(sessionId);

    log.info({ sessionId }, 'Chat session deleted');

    res.status(204).send();
  })
);

/**
 * ============================================================
 * SQUAD CHAT ROUTES
 * Agent-to-agent communication channel (not task-scoped)
 * ============================================================
 */

/**
 * POST /api/chat/squad
 * Send a message to the squad channel
 */
router.post(
  '/squad',
  asyncHandler(async (req, res) => {
    const validatedInput = squadMessageSchema.parse(req.body);

    // Get displayName from settings if agent is Human
    const config = await configService.getFeatureSettings();
    const isHuman =
      validatedInput.agent === 'Human' || validatedInput.agent.toLowerCase() === 'human';
    const displayName = isHuman ? config.general.humanDisplayName : undefined;

    const message = await chatService.sendSquadMessage(
      {
        agent: validatedInput.agent,
        message: validatedInput.message,
        tags: validatedInput.tags,
        model: validatedInput.model,
        system: validatedInput.system,
        event: validatedInput.event,
        taskTitle: validatedInput.taskTitle,
        duration: validatedInput.duration,
        card: validatedInput.card,
      },
      displayName
    );

    log.info(
      { messageId: message.id, agent: message.agent, system: message.system },
      'Squad message sent'
    );

    // Broadcast to WebSocket clients
    broadcastSquadMessage(message);

    // Fire webhook if configured (async, don't block response)
    if (config.squadWebhook) {
      fireSquadWebhook(message, config.squadWebhook).catch((err) => {
        log.error({ err: err.message, messageId: message.id }, 'Squad webhook failed');
      });
    }

    res.status(201).json(message);
  })
);

/**
 * GET /api/chat/squad
 * Get squad messages with optional filters
 * Query params: since (ISO timestamp), agent (filter by agent), limit (max messages), includeSystem (true/false)
 */
router.get(
  '/squad',
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const agent = typeof req.query.agent === 'string' ? req.query.agent : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const includeSystem = req.query.includeSystem === 'false' ? false : true; // Default to true

    const messages = await chatService.getSquadMessages({
      since,
      agent,
      limit,
      includeSystem,
    });

    res.json(messages);
  })
);

export { router as chatRoutes };
