/**
 * Transition Hooks Service
 *
 * Quality gates and actions for task status transitions.
 * - Pre-transition gates: Must pass before status change is allowed
 * - Post-transition actions: Fire after status change succeeds
 *
 * Extends the basic hook-service with sophisticated quality gate logic.
 */

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../lib/logger.js';
import type { Task, TaskStatus } from '@veritas-kanban/shared';
import type {
  TransitionHooksConfig,
  TransitionRule,
  TransitionGate,
  TransitionAction,
  GateCheckResult,
  TransitionValidationResult,
  GateType,
  ActionType,
} from '@veritas-kanban/shared';
import { DEFAULT_TRANSITION_HOOKS_CONFIG } from '@veritas-kanban/shared';

const log = createLogger('transition-hooks');

// ---------------------------------------------------------------------------
// Configuration Storage
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, '.veritas-kanban', 'transition-hooks.json');

let cachedConfig: TransitionHooksConfig | null = null;

/**
 * Load transition hooks configuration from disk.
 */
export async function loadTransitionHooksConfig(): Promise<TransitionHooksConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(content) as TransitionHooksConfig;
    log.info(
      { enabled: cachedConfig.enabled, ruleCount: cachedConfig.rules.length },
      'Loaded transition hooks config'
    );
    return cachedConfig;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist, use defaults
      cachedConfig = { ...DEFAULT_TRANSITION_HOOKS_CONFIG };
      log.info('Using default transition hooks config');
      return cachedConfig;
    }
    throw err;
  }
}

/**
 * Save transition hooks configuration to disk.
 */
export async function saveTransitionHooksConfig(config: TransitionHooksConfig): Promise<void> {
  const dir = path.dirname(CONFIG_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = config;
  log.info(
    { enabled: config.enabled, ruleCount: config.rules.length },
    'Saved transition hooks config'
  );
}

/**
 * Get the current configuration (from cache or disk).
 */
export async function getTransitionHooksConfig(): Promise<TransitionHooksConfig> {
  return loadTransitionHooksConfig();
}

/**
 * Update the configuration and persist to disk.
 */
export async function updateTransitionHooksConfig(
  config: TransitionHooksConfig
): Promise<TransitionHooksConfig> {
  await saveTransitionHooksConfig(config);
  return config;
}

/**
 * Clear the cached configuration (for testing).
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

// ---------------------------------------------------------------------------
// Rule Matching
// ---------------------------------------------------------------------------

/**
 * Check if a status matches a rule's from/to specification.
 */
function statusMatches(
  spec: TaskStatus | TaskStatus[] | '*',
  status: TaskStatus | undefined
): boolean {
  if (spec === '*') return true;
  if (Array.isArray(spec)) return status !== undefined && spec.includes(status);
  return spec === status;
}

/**
 * Check if a task matches project/taskType filters.
 */
function taskMatchesFilters(
  task: Pick<Task, 'project' | 'type'>,
  projects?: string[],
  taskTypes?: string[]
): boolean {
  if (projects && projects.length > 0) {
    if (!task.project || !projects.includes(task.project)) {
      return false;
    }
  }
  if (taskTypes && taskTypes.length > 0) {
    if (!task.type || !taskTypes.includes(task.type)) {
      return false;
    }
  }
  return true;
}

/**
 * Find all rules that apply to a specific transition.
 */
export async function findApplicableRules(
  fromStatus: TaskStatus | undefined,
  toStatus: TaskStatus,
  task: Pick<Task, 'project' | 'type'>
): Promise<TransitionRule[]> {
  const config = await getTransitionHooksConfig();

  if (!config.enabled) {
    return [];
  }

  return config.rules.filter((rule: TransitionRule) => {
    if (!rule.enabled) return false;
    if (!statusMatches(rule.from, fromStatus)) return false;
    if (!statusMatches(rule.to, toStatus)) return false;
    if (!taskMatchesFilters(task, rule.projects, rule.taskTypes)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Gate Checks
// ---------------------------------------------------------------------------

/**
 * Check a single gate against a task.
 */
function checkGate(gate: TransitionGate, task: Task): GateCheckResult {
  if (!gate.enabled) {
    return { gate, passed: true, message: 'Gate disabled' };
  }

  // Check project/taskType filters
  if (!taskMatchesFilters(task, gate.projects, gate.taskTypes)) {
    return { gate, passed: true, message: 'Gate does not apply to this task' };
  }

  let passed = false;
  let message = gate.errorMessage || `Gate "${gate.name}" failed`;

  switch (gate.type) {
    case 'require-agent':
      passed = !!task.agent && task.agent.trim().length > 0;
      if (!passed) message = gate.errorMessage || 'Task must have an agent assigned';
      break;

    case 'require-plan':
      // Check for a ## Plan or ## plan section in description
      passed = /##\s*plan/i.test(task.description || '');
      if (!passed) message = gate.errorMessage || 'Task description must contain a Plan section';
      break;

    case 'require-verification-complete':
      if (!task.verificationSteps || task.verificationSteps.length === 0) {
        passed = true; // No verification steps = nothing to check
      } else {
        passed = task.verificationSteps.every((step) => step.checked);
        if (!passed) message = gate.errorMessage || 'All verification steps must be checked';
      }
      break;

    case 'require-time-tracked':
      passed =
        !!task.timeTracking && task.timeTracking.entries && task.timeTracking.entries.length > 0;
      if (!passed) message = gate.errorMessage || 'Time must be tracked on this task';
      break;

    case 'require-closing-comment':
      passed = !!task.comments && task.comments.length > 0;
      if (!passed) message = gate.errorMessage || 'Task must have at least one comment';
      break;

    case 'require-subtasks-complete':
      if (!task.subtasks || task.subtasks.length === 0) {
        passed = true; // No subtasks = nothing to check
      } else {
        passed = task.subtasks.every((st) => st.completed);
        if (!passed) message = gate.errorMessage || 'All subtasks must be completed';
      }
      break;

    case 'require-blocker-reason':
      passed = !!task.blockedReason && !!task.blockedReason.category;
      if (!passed) message = gate.errorMessage || 'A blocker reason must be provided';
      break;

    default:
      log.warn({ gateType: gate.type }, 'Unknown gate type');
      passed = true;
  }

  return { gate, passed, message: passed ? undefined : message };
}

/**
 * Validate all gates for a transition.
 * Returns whether the transition is allowed and details about each gate.
 */
export async function validateTransition(
  task: Task,
  fromStatus: TaskStatus | undefined,
  toStatus: TaskStatus
): Promise<TransitionValidationResult> {
  const config = await getTransitionHooksConfig();

  // If hooks are disabled, allow everything
  if (!config.enabled) {
    return {
      allowed: true,
      gateResults: [],
      failedGates: [],
    };
  }

  // Find applicable rules
  const rules = await findApplicableRules(fromStatus, toStatus, task);

  // Collect all gates from applicable rules
  const allGates: TransitionGate[] = [];

  // Add default gates first (if any)
  if (config.defaultGates) {
    allGates.push(...config.defaultGates.filter((g: TransitionGate) => g.enabled));
  }

  // Add gates from each applicable rule
  for (const rule of rules) {
    allGates.push(...rule.gates.filter((g: TransitionGate) => g.enabled));
  }

  // Check all gates
  const gateResults: GateCheckResult[] = allGates.map((gate) => checkGate(gate, task));
  const failedGates = gateResults.filter((r) => !r.passed);

  const allowed = failedGates.length === 0;
  const errorMessage = allowed
    ? undefined
    : `Transition blocked: ${failedGates.map((f) => f.message).join('; ')}`;

  return {
    allowed,
    gateResults,
    failedGates,
    errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Post-Transition Actions
// ---------------------------------------------------------------------------

/**
 * Execute a single post-transition action.
 * Actions are fire-and-forget (errors are logged but don't propagate).
 */
async function executeAction(
  action: TransitionAction,
  task: Task,
  fromStatus: TaskStatus | undefined,
  toStatus: TaskStatus,
  callbacks: TransitionActionCallbacks
): Promise<void> {
  if (!action.enabled) return;

  // Check project/taskType filters
  if (!taskMatchesFilters(task, action.projects, action.taskTypes)) {
    return;
  }

  try {
    switch (action.type) {
      case 'auto-start-timer':
        if (callbacks.onAutoStartTimer) {
          await callbacks.onAutoStartTimer(task);
        }
        log.debug({ taskId: task.id }, 'Auto-started timer');
        break;

      case 'auto-stop-timer':
        if (callbacks.onAutoStopTimer) {
          await callbacks.onAutoStopTimer(task);
        }
        log.debug({ taskId: task.id }, 'Auto-stopped timer');
        break;

      case 'send-webhook':
        if (action.webhookUrl) {
          await sendWebhook(action.webhookUrl, task, fromStatus, toStatus);
        }
        break;

      case 'send-notification':
        if (callbacks.onSendNotification && action.notificationChannel) {
          await callbacks.onSendNotification(task, action.notificationChannel);
        }
        break;

      case 'prompt-lessons-learned':
        if (callbacks.onPromptLessonsLearned) {
          await callbacks.onPromptLessonsLearned(task);
        }
        log.debug({ taskId: task.id }, 'Prompted for lessons learned');
        break;

      case 'log-activity':
        if (callbacks.onLogActivity) {
          await callbacks.onLogActivity(task, fromStatus, toStatus);
        }
        break;

      default:
        log.warn({ actionType: action.type }, 'Unknown action type');
    }
  } catch (err) {
    log.error(
      { actionId: action.id, taskId: task.id, error: (err as Error).message },
      'Action execution failed'
    );
  }
}

/**
 * Send a webhook for a transition.
 */
async function sendWebhook(
  url: string,
  task: Task,
  fromStatus: TaskStatus | undefined,
  toStatus: TaskStatus
): Promise<void> {
  const payload = {
    event: 'status_transition',
    taskId: task.id,
    taskTitle: task.title,
    fromStatus,
    toStatus,
    project: task.project,
    sprint: task.sprint,
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-VK-Event': 'status_transition',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
  }

  log.debug({ taskId: task.id, url }, 'Transition webhook delivered');
}

/**
 * Callbacks for post-transition actions.
 * These are injected by the task service to avoid circular dependencies.
 */
export interface TransitionActionCallbacks {
  onAutoStartTimer?: (task: Task) => Promise<void>;
  onAutoStopTimer?: (task: Task) => Promise<void>;
  onSendNotification?: (task: Task, channel: string) => Promise<void>;
  onPromptLessonsLearned?: (task: Task) => Promise<void>;
  onLogActivity?: (
    task: Task,
    fromStatus: TaskStatus | undefined,
    toStatus: TaskStatus
  ) => Promise<void>;
}

/**
 * Execute all post-transition actions for a status change.
 * Actions are fire-and-forget (errors are logged but don't block).
 */
export async function executePostTransitionActions(
  task: Task,
  fromStatus: TaskStatus | undefined,
  toStatus: TaskStatus,
  callbacks: TransitionActionCallbacks = {}
): Promise<void> {
  const config = await getTransitionHooksConfig();

  if (!config.enabled) {
    return;
  }

  // Find applicable rules
  const rules = await findApplicableRules(fromStatus, toStatus, task);

  // Collect all actions from applicable rules
  const allActions: TransitionAction[] = [];

  // Add default actions first (if any)
  if (config.defaultActions) {
    allActions.push(...config.defaultActions.filter((a: TransitionAction) => a.enabled));
  }

  // Add actions from each applicable rule
  for (const rule of rules) {
    allActions.push(...rule.actions.filter((a: TransitionAction) => a.enabled));
  }

  // Execute all actions (fire-and-forget)
  for (const action of allActions) {
    executeAction(action, task, fromStatus, toStatus, callbacks).catch((err) => {
      log.error({ actionId: action.id, error: (err as Error).message }, 'Failed to execute action');
    });
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the transition hooks service.
 * Loads configuration from disk.
 */
export async function initTransitionHooks(): Promise<void> {
  await loadTransitionHooksConfig();
  log.info('Transition hooks service initialized');
}
