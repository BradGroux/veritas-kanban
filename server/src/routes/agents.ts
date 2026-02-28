import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { ClawdbotAgentService, clawdbotAgentService } from '../services/clawdbot-agent-service.js';
import { getTelemetryService } from '../services/telemetry-service.js';
import { getTaskService } from '../services/task-service.js';
import type { AgentType, TokenTelemetryEvent } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();

// Validation schemas
const AgentTypeSchema = z.string().min(1).max(50);

const startAgentSchema = z.object({
  agent: AgentTypeSchema.optional(),
});

const completeAgentSchema = z.object({
  success: z.boolean(),
  summary: z.string().optional(),
  error: z.string().optional(),
});

const reportTokensSchema = z.object({
  attemptId: z.string().optional(),
  inputTokens: z.number({ message: 'inputTokens is required' }).int().nonnegative(),
  outputTokens: z.number({ message: 'outputTokens is required' }).int().nonnegative(),
  totalTokens: z.number().int().nonnegative().optional(),
  model: z.string().optional(),
  agent: AgentTypeSchema.optional(),
});

// POST /api/agents/:taskId/start - Start agent on task (delegates to Clawdbot)
router.post(
  '/:taskId/start',
  asyncHandler(async (req, res) => {
    let agent: AgentType | undefined;
    try {
      ({ agent } = startAgentSchema.parse(req.body) as { agent?: AgentType });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const status = await clawdbotAgentService.startAgent(req.params.taskId as string, agent);
    res.status(201).json(status);
  })
);

// POST /api/agents/:taskId/complete - Callback from Clawdbot when agent finishes
router.post(
  '/:taskId/complete',
  asyncHandler(async (req, res) => {
    let success: boolean;
    let summary: string | undefined;
    let error: string | undefined;
    try {
      ({ success, summary, error } = completeAgentSchema.parse(req.body));
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Validation failed', err.issues);
      }
      throw err;
    }

    await clawdbotAgentService.completeAgent(req.params.taskId as string, {
      success,
      summary,
      error,
    });
    res.json({ received: true });
  })
);

// POST /api/agents/:taskId/stop - Stop running agent
router.post(
  '/:taskId/stop',
  asyncHandler(async (req, res) => {
    await clawdbotAgentService.stopAgent(req.params.taskId as string);
    res.json({ stopped: true });
  })
);

// GET /api/agents/:taskId/status - Get agent status
router.get(
  '/:taskId/status',
  asyncHandler(async (req, res) => {
    const status = clawdbotAgentService.getAgentStatus(req.params.taskId as string);
    if (!status) {
      return res.json({ running: false });
    }
    res.json({ running: true, ...status });
  })
);

// GET /api/agents/pending - List pending agent requests (for Veritas to poll)
router.get(
  '/pending',
  asyncHandler(async (_req, res) => {
    const requests = await clawdbotAgentService.listPendingRequests();
    res.json(requests);
  })
);

// GET /api/agents/:taskId/attempts - List attempts for task
router.get(
  '/:taskId/attempts',
  asyncHandler(async (req, res) => {
    const attempts = await clawdbotAgentService.listAttempts(req.params.taskId as string);
    res.json(attempts);
  })
);

// GET /api/agents/:taskId/attempts/:attemptId/log - Get attempt log
router.get(
  '/:taskId/attempts/:attemptId/log',
  asyncHandler(async (req, res) => {
    const log = await clawdbotAgentService.getAttemptLog(
      req.params.taskId as string,
      req.params.attemptId as string
    );
    res.type('text/markdown').send(log);
  })
);

// POST /api/agents/:taskId/tokens - Report token usage for a run
router.post(
  '/:taskId/tokens',
  asyncHandler(async (req, res) => {
    let attemptId: string | undefined;
    let inputTokens: number;
    let outputTokens: number;
    let totalTokens: number | undefined;
    let model: string | undefined;
    let agent: AgentType | undefined;
    try {
      const parsed = reportTokensSchema.parse(req.body);
      attemptId = parsed.attemptId;
      inputTokens = parsed.inputTokens;
      outputTokens = parsed.outputTokens;
      totalTokens = parsed.totalTokens;
      model = parsed.model;
      agent = parsed.agent as AgentType | undefined;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    const taskId = req.params.taskId as string;

    // Get task to find project and current attempt
    const taskService = getTaskService();
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Use provided attemptId or current attempt
    const resolvedAttemptId = attemptId || task.attempt?.id || 'unknown';
    const resolvedAgent = agent || task.attempt?.agent || 'claude-code';

    // Emit telemetry event
    const telemetry = getTelemetryService();
    const event = await telemetry.emit<TokenTelemetryEvent>({
      type: 'run.tokens',
      taskId,
      attemptId: resolvedAttemptId,
      agent: resolvedAgent,
      project: task.project,
      inputTokens,
      outputTokens,
      totalTokens: totalTokens ?? inputTokens + outputTokens,
      model,
    });

    res.status(201).json({
      recorded: true,
      eventId: event.id,
      totalTokens: event.totalTokens,
    });
  })
);

// Export service for WebSocket use
export { router as agentRoutes, clawdbotAgentService as agentService };
