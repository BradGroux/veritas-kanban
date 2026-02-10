import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import type { WebSocketServer, WebSocket } from 'ws';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from '../storage/fs-helpers.js';
import path from 'path';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import {
  statusHistoryService,
  type AgentStatusState as HistoryStatusState,
} from '../services/status-history-service.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('agent-status');

const router: RouterType = Router();

// Status states
export type AgentStatusState = 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';

export interface ActiveAgent {
  agent: string;
  status: AgentStatusState;
  taskId?: string;
  taskTitle?: string;
  startedAt: string;
}

export interface AgentStatus {
  status: AgentStatusState;
  activeTask?: {
    id: string;
    title?: string;
  };
  subAgentCount: number;
  activeAgents: ActiveAgent[];
  lastUpdated: string;
  errorMessage?: string;
}

// Persistence file path
const DATA_DIR = process.env.DATA_DIR || '.veritas-kanban';
const STATUS_FILE = path.join(DATA_DIR, 'agent-status.json');

/**
 * Load persisted agent status from disk (survives server restarts).
 * Falls back to idle if file doesn't exist or is corrupt.
 */
function loadPersistedStatus(): AgentStatus {
  try {
    if (existsSync(STATUS_FILE)) {
      const raw = readFileSync(STATUS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as AgentStatus;
      // Validate it has the expected shape
      if (parsed.status && typeof parsed.subAgentCount === 'number') {
        log.info(
          `[AgentStatus] Restored persisted status: ${parsed.status} (subAgents: ${parsed.subAgentCount})`
        );
        return { ...parsed, activeAgents: parsed.activeAgents || [] };
      }
    }
  } catch {
    log.warn('[AgentStatus] Could not load persisted status, starting fresh');
  }
  return {
    status: 'idle',
    subAgentCount: 0,
    activeAgents: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Persist current status to disk (async, fire-and-forget).
 */
function persistStatus(status: AgentStatus): void {
  try {
    const dir = path.dirname(STATUS_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
  } catch (err) {
    log.warn({ data: err }, '[AgentStatus] Failed to persist status');
  }
}

// In-memory state — initialized from disk
let currentStatus: AgentStatus = loadPersistedStatus();

// Timeout configuration (5 minutes default)
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
let idleTimeoutHandle: NodeJS.Timeout | null = null;

// WebSocket server reference for broadcasting
let wssRef: WebSocketServer | null = null;

/**
 * Initialize the agent status service with WebSocket server reference
 */
export function initAgentStatus(wss: WebSocketServer): void {
  wssRef = wss;
}

/**
 * Broadcast agent status change to all connected WebSocket clients
 */
function broadcastAgentStatusChange(): void {
  if (!wssRef) return;

  const message = {
    type: 'agent:status',
    ...currentStatus,
  };

  const payload = JSON.stringify(message);

  wssRef.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN = 1
      client.send(payload);
    }
  });
}

/**
 * Reset idle timeout - auto-resets to idle after 5 minutes of inactivity
 */
function resetIdleTimeout(): void {
  if (idleTimeoutHandle) {
    clearTimeout(idleTimeoutHandle);
    idleTimeoutHandle = null;
  }

  // Don't set timeout if already idle
  if (currentStatus.status === 'idle') return;

  idleTimeoutHandle = setTimeout(() => {
    currentStatus = {
      status: 'idle',
      subAgentCount: 0,
      activeAgents: [],
      lastUpdated: new Date().toISOString(),
    };
    persistStatus(currentStatus);
    broadcastAgentStatusChange();
    log.info('[AgentStatus] Auto-reset to idle after timeout');
  }, IDLE_TIMEOUT_MS);
}

/**
 * Update agent status programmatically (for internal use)
 */
export function updateAgentStatus(update: Partial<AgentStatus>): AgentStatus {
  const previousStatus = currentStatus.status;

  currentStatus = {
    ...currentStatus,
    ...update,
    lastUpdated: new Date().toISOString(),
  };

  // Log status change to history if status actually changed
  if (update.status !== undefined && update.status !== previousStatus) {
    // Derive task info: prefer activeTask, fallback to first activeAgent
    let taskId = update.activeTask?.id || currentStatus.activeTask?.id;
    let taskTitle = update.activeTask?.title || currentStatus.activeTask?.title;

    // If no activeTask but we have activeAgents, use the first one's task info
    if (!taskId && update.activeAgents && update.activeAgents.length > 0) {
      const firstAgent = update.activeAgents[0];
      taskId = firstAgent.taskId;
      taskTitle = firstAgent.taskTitle;
    } else if (!taskId && currentStatus.activeAgents && currentStatus.activeAgents.length > 0) {
      const firstAgent = currentStatus.activeAgents[0];
      taskId = firstAgent.taskId;
      taskTitle = firstAgent.taskTitle;
    }

    statusHistoryService
      .logStatusChange(
        previousStatus as HistoryStatusState,
        update.status as HistoryStatusState,
        taskId,
        taskTitle,
        update.subAgentCount ?? currentStatus.subAgentCount
      )
      .catch((err) => {
        log.error({ err: err }, '[AgentStatus] Failed to log status change');
      });
  }

  persistStatus(currentStatus);
  broadcastAgentStatusChange();
  resetIdleTimeout();

  return currentStatus;
}

/**
 * Get current agent status (for internal use)
 */
export function getAgentStatus(): AgentStatus {
  return { ...currentStatus };
}

// Validation schema for POST
const activeAgentSchema = z.object({
  agent: z.string(),
  status: z.enum(['idle', 'working', 'thinking', 'sub-agent', 'error']).default('working'),
  taskId: z.string().optional(),
  taskTitle: z.string().optional(),
  startedAt: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['idle', 'working', 'thinking', 'sub-agent', 'error']).optional(),
  activeTask: z
    .object({
      id: z.string(),
      title: z.string().optional(),
    })
    .optional()
    .nullable(),
  subAgentCount: z.number().int().min(0).optional(),
  activeAgents: z.array(activeAgentSchema).optional(),
  errorMessage: z.string().optional().nullable(),
});

// GET /api/agent/status - Get current agent status
// Flatten activeTask for frontend compatibility
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { activeTask, errorMessage, activeAgents, ...rest } = currentStatus;
    res.json({
      ...rest,
      activeTask: activeTask?.id,
      activeTaskTitle: activeTask?.title,
      activeAgents: activeAgents || [],
      error: errorMessage,
    });
  })
);

// POST /api/agent/status - Update agent status
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = updateStatusSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new ValidationError('Invalid status update', parsed.error.format());
    }

    const update = parsed.data;

    // Build the update object
    const newStatus: Partial<AgentStatus> = {};

    if (update.status !== undefined) {
      newStatus.status = update.status;
    }

    if (update.activeTask !== undefined) {
      newStatus.activeTask = update.activeTask ?? undefined;
    }

    if (update.subAgentCount !== undefined) {
      newStatus.subAgentCount = update.subAgentCount;
    }

    if (update.errorMessage !== undefined) {
      newStatus.errorMessage = update.errorMessage ?? undefined;
    }

    if (update.activeAgents !== undefined) {
      newStatus.activeAgents = update.activeAgents.map((a) => ({
        ...a,
        startedAt: a.startedAt || new Date().toISOString(),
      }));
    }

    // Clear everything when going idle
    if (update.status === 'idle') {
      newStatus.activeTask = undefined;
      newStatus.errorMessage = undefined;
      newStatus.activeAgents = [];
      newStatus.subAgentCount = 0;
    }

    const result = updateAgentStatus(newStatus);

    res.json(result);
  })
);

// Schema for delegation violation reports
const DelegationViolationSchema = z.object({
  agent: z.string().min(1),
  action: z.string().min(1), // e.g. "file_edit", "code_change", "multi_step_work"
  taskId: z.string().optional(),
  details: z.string().optional(), // Additional context about the violation
});

/**
 * POST /api/agent/delegation-violation
 * Report an orchestrator delegation violation.
 * When orchestratorDelegation enforcement is enabled, this logs a warning
 * and optionally posts to squad chat.
 */
router.post(
  '/delegation-violation',
  asyncHandler(async (req, res) => {
    const parsed = DelegationViolationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid delegation violation report', parsed.error.format());
    }

    const { agent, action, taskId, details } = parsed.data;

    // Import ConfigService dynamically to avoid circular deps
    const { ConfigService } = await import('../services/config-service.js');
    const configService = new ConfigService();
    const settings = await configService.getFeatureSettings();

    const enforcementEnabled = settings.enforcement?.orchestratorDelegation ?? false;

    if (!enforcementEnabled) {
      res.json({
        success: true,
        enforced: false,
        message: 'Delegation enforcement is disabled',
      });
      return;
    }

    // Log the violation
    log.warn(
      { agent, action, taskId, details },
      'Orchestrator delegation violation: %s performed %s directly',
      agent,
      action
    );

    // Post to squad chat if enabled
    const squadChatEnabled = settings.enforcement?.squadChat ?? false;
    if (squadChatEnabled) {
      try {
        // Import fireHook to post to squad chat
        const { fireHook } = await import('../services/hook-service.js');
        // Create a synthetic task for the squad chat message
        const violationMessage = `⚠️ Delegation Violation: ${agent} performed "${action}" directly instead of delegating to a sub-agent.${details ? ` Details: ${details}` : ''}${taskId ? ` (Task: ${taskId})` : ''}`;

        // Post directly to squad chat endpoint using native fetch
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        await fetch(`${baseUrl}/api/chat/squad`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: 'ENFORCEMENT',
            message: violationMessage,
            tags: ['delegation-violation', 'enforcement'],
          }),
        });
      } catch (err) {
        log.warn({ err }, 'Failed to post delegation violation to squad chat');
      }
    }

    res.json({
      success: true,
      enforced: true,
      message: `Delegation violation logged for ${agent}: ${action}`,
    });
  })
);

export { router as agentStatusRoutes };
