/**
 * ClawdbotAgentService - Delegates agent work to Clawdbot's sessions_spawn
 *
 * Instead of managing PTY processes directly, this service:
 * 1. Sends a task request to the main Veritas session
 * 2. Veritas spawns a sub-agent with proper PTY handling
 * 3. Sub-agent works in the task's worktree
 * 4. On completion, Veritas calls back to update the task
 *
 * This keeps agent management simple and leverages Clawdbot's existing infrastructure.
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import path from 'path';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { getTelemetryService } from './telemetry-service.js';
import { getAgentRoutingService } from './agent-routing-service.js';
import { getGovernanceTraceService } from './governance-trace-service.js';
import { getSandboxPolicyService } from './sandbox-policy-service.js';
import { getAgentBudgetService } from './agent-budget-service.js';
import {
  AgentHealthService,
  type AgentHealthChecker,
  type AgentHealthStatus,
} from './agent-health-service.js';
import { activityService } from './activity-service.js';
import { getTraceService } from './trace-service.js';
import { validatePathSegment, ensureWithinBase } from '../utils/sanitize.js';
import { buildSafeCodexEnv } from '../utils/codex-env.js';
import { getRuntimeDir, getLogsDir } from '../utils/paths.js';
import { buildSafeHermesEnv } from '../utils/hermes-env.js';
import { HttpOpenClawTaskAdapter } from './openclaw-workflow-adapter.js';
import type { ThreadEvent } from '@openai/codex-sdk';
import { evaluateTaskReadiness } from '@veritas-kanban/shared';
import type {
  Task,
  AgentType,
  AgentConfig,
  AgentRunTraceStepType,
  AgentRunTraceMetadata,
  TaskAttempt,
  AttemptStatus,
  Deliverable,
  RunStartedEvent,
  RunCompletedEvent,
  RunErrorEvent,
  TokenTelemetryEvent,
  TaskReadinessSummary,
  SandboxPolicyDryRunResult,
  AgentBudgetPolicy,
  AgentBudgetState,
  AgentBudgetUsage,
  AgentBudgetDecision,
  AgentProfileLaunchMetadata,
  ExecutableAgentProvider,
  ProviderRuntimeManifest,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { ConflictError } from '../middleware/error-handler.js';
import type { AgentBudgetThresholdEvent } from '@veritas-kanban/shared';
import { getAgentProfilePackageService } from './agent-profile-package-service.js';
import {
  ProviderRuntimeManifestService,
  type ProviderRuntimeProbeRequest,
} from './provider-runtime-manifest-service.js';
import { getProviderRuntimeAdapterDefinition } from './provider-runtime-adapter-registry.js';
import { getInstalledPackageVersion } from '../utils/package-version.js';
const log = createLogger('clawdbot-agent-service');

const TRACE_SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]'],
  [/\bghp_[A-Za-z0-9_]{12,}/g, 'ghp_[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{12,}/g, 'github_pat_[REDACTED]'],
  [
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi,
    '$1=[REDACTED]',
  ],
  [/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s"'`,}]+)/gi, '$1=[REDACTED]'],
];

export interface AgentProviderStartContext {
  task: Task;
  agentConfig?: AgentConfig;
  prompt: string;
  logPath: string;
  attemptId: string;
  startedAt: string;
  emitter: EventEmitter;
  attempt: TaskAttempt;
  sandboxPolicy?: SandboxPolicyDryRunResult;
}

export interface AgentProviderStopContext {
  taskId: string;
  pending: PendingAgent;
}

export interface AgentProviderProbeContext {
  agentConfig?: AgentConfig;
  health: AgentHealthStatus;
}

export interface AgentProviderAdapter {
  id: ExecutableAgentProvider;
  label: string;
  probe(context: AgentProviderProbeContext): Promise<ProviderRuntimeManifest>;
  start(context: AgentProviderStartContext): Promise<void> | void;
  stop(context: AgentProviderStopContext): Promise<void> | void;
}

export interface AgentStatus {
  taskId: string;
  attemptId: string;
  agent: AgentType;
  status: AttemptStatus;
  startedAt?: string;
  endedAt?: string;
}

export interface AgentOutput {
  type: 'stdout' | 'stderr' | 'stdin' | 'system';
  content: string;
  timestamp: string;
}

export interface AgentStartOptions {
  profileId?: string;
  overrideReason?: string;
  sandboxPresetId?: string;
  budget?: AgentBudgetPolicy;
}

export interface AgentMessageOptions {
  actor?: string;
  source?: string;
}

export interface AgentMessageDelivery {
  delivered: boolean;
  note: string;
}

export class AgentReadinessError extends Error {
  constructor(
    public readiness: TaskReadinessSummary,
    message = 'Task readiness override required'
  ) {
    super(message);
    this.name = 'AgentReadinessError';
  }
}

// Track pending agent requests
interface PendingAgent {
  taskId: string;
  attemptId: string;
  agent: AgentType;
  startedAt: string;
  emitter: EventEmitter;
  provider: ExecutableAgentProvider;
  model?: string;
  budget?: AgentBudgetState;
  budgetStopped?: boolean;
  agentProfile?: AgentProfileLaunchMetadata;
  providerRuntimeManifest: ProviderRuntimeManifest;
  threadId?: string;
  abortController?: AbortController;
  process?: ChildProcessWithoutNullStreams;
  /** Durable session key returned by OpenClaw sessions_spawn (openclaw provider only) */
  openclawSessionKey?: string;
  /** Hermes session identity captured from process output (hermes-cli provider only) */
  hermesSessionId?: string;
}

const pendingAgents = new Map<string, PendingAgent>();

export class ClawdbotAgentService {
  private configService: ConfigService;
  private taskService: TaskService;
  private agentHealth: AgentHealthChecker;
  private providerRuntimeManifests: ProviderRuntimeManifestService;
  private logsDir: string;

  constructor(
    agentHealth?: AgentHealthChecker,
    providerRuntimeManifests = new ProviderRuntimeManifestService()
  ) {
    this.configService = new ConfigService();
    this.taskService = new TaskService();
    this.agentHealth = agentHealth || new AgentHealthService();
    this.providerRuntimeManifests = providerRuntimeManifests;
    this.logsDir = getLogsDir();
    this.ensureLogsDir();
  }

  private async ensureLogsDir(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
  }

  /**
   * Reconcile persisted running attempts after a server restart.
   *
   * After an unexpected restart the in-memory `pendingAgents` map is empty,
   * but task files can still contain attempts with status `'running'`.
   * This method scans all tasks and marks those orphaned attempts as `'failed'`
   * so the UI and operators have a reliable, actionable state (issue #781).
   *
   * Safe to call multiple times; only tasks whose current attempt is `'running'`
   * and whose taskId is NOT in `pendingAgents` are touched.
   */
  async reconcileRunningAttempts(): Promise<void> {
    let tasks: Task[];
    try {
      tasks = await this.taskService.listTasks();
    } catch (err) {
      log.warn(
        { err },
        '[ClawdbotAgent] reconcileRunningAttempts: failed to list tasks — skipping'
      );
      return;
    }

    const now = new Date().toISOString();
    let reconciledCount = 0;

    for (const task of tasks) {
      if (!task.attempt || task.attempt.status !== 'running') continue;
      // If there is already a live in-memory entry, leave it alone.
      if (pendingAgents.has(task.id)) continue;

      try {
        const failedAttempt: TaskAttempt = {
          ...task.attempt,
          status: 'failed',
          ended: now,
        };
        await this.taskService.updateTask(task.id, {
          // Only revert task status if it is still 'in-progress' from this run.
          // Tasks in other states (blocked, done, todo, etc.) keep their status;
          // we only fix the orphaned attempt record.
          ...(task.status === 'in-progress' ? { status: 'todo' } : {}),
          attempt: failedAttempt,
          attempts: upsertAttemptHistory(task.attempts, failedAttempt),
        });
        log.info(
          { taskId: task.id, attemptId: task.attempt.id },
          '[ClawdbotAgent] Reconciled orphaned running attempt as failed after restart'
        );
        reconciledCount++;
      } catch (err) {
        log.warn(
          { err, taskId: task.id },
          '[ClawdbotAgent] reconcileRunningAttempts: failed to update task'
        );
      }
    }

    if (reconciledCount > 0) {
      log.info(
        { count: reconciledCount },
        '[ClawdbotAgent] Startup reconciliation complete: orphaned running attempts marked failed'
      );
    }
  }

  private expandPath(p: string): string {
    return p.replace(/^~/, process.env.HOME || '');
  }

  /**
   * Start an agent on a task by delegating to Clawdbot
   */
  async startAgent(
    taskId: string,
    agentType?: AgentType,
    options: AgentStartOptions = {}
  ): Promise<AgentStatus> {
    // Get task
    const task = await this.taskService.getTask(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found`);
    }

    if (task.type !== 'code') {
      throw new Error('Agents can only be started on code tasks');
    }

    if (!task.git?.worktreePath) {
      throw new Error('Task must have an active worktree to start an agent');
    }

    // Check if agent already running for this task
    if (pendingAgents.has(taskId)) {
      throw new Error('An agent is already running for this task');
    }

    // Get agent config — use routing engine when agent is "auto" or not specified
    const config = await this.configService.getConfig();
    const profileLaunch = options.profileId
      ? await getAgentProfilePackageService().resolveLaunch(options.profileId)
      : undefined;
    let agent: AgentType;

    if (profileLaunch) {
      agent = profileLaunch.agent;
      log.info(
        `[ClawdbotAgent] Profile ${profileLaunch.profile.id}@${profileLaunch.profile.version} selected ${agent} for task ${taskId}`
      );
    } else if (!agentType || agentType === 'auto') {
      const routing = getAgentRoutingService();
      const result = await routing.resolveAgent(task);
      agent = result.agent;
      const routingReason = result.reason;
      log.info(
        `[ClawdbotAgent] Routing resolved agent for task ${taskId}: ${agent} (${routingReason})`
      );
    } else {
      agent = agentType;
    }

    const agentConfig = profileLaunch?.agentConfig ?? this.resolveAgentConfig(config.agents, agent);
    const profileAgentConfig =
      profileLaunch && agentConfig
        ? {
            ...agentConfig,
            provider: profileLaunch.profile.runtime.provider ?? agentConfig.provider,
            model: profileLaunch.model ?? agentConfig.model,
          }
        : agentConfig;
    const agentHealth = await this.assertAgentAvailable(agent, profileAgentConfig);
    const provider = this.resolveAgentProvider(profileAgentConfig, agent);
    const adapter = this.resolveProviderAdapter(provider);
    const budgetService = getAgentBudgetService();
    const budgetPolicy = budgetService.resolve({
      workspaceBudget: config.features?.budget?.enabled
        ? config.features.budget.defaultRunBudget
        : undefined,
      agentBudget: profileAgentConfig?.budget,
      runBudget: options.budget ?? profileLaunch?.budget,
    });
    const budgetEvaluation = budgetService.evaluate(
      budgetPolicy,
      { fanOut: 1 },
      {
        taskId,
        agentId: agent,
        actionType: 'agent.start',
        project: task.project,
      }
    );
    const budgetTraceIds: string[] = [];
    if (budgetEvaluation.trace) {
      const trace = await getGovernanceTraceService().record(budgetEvaluation.trace);
      budgetTraceIds.push(trace.id);
    }
    if (this.isBlockingBudgetDecision(budgetEvaluation.decision)) {
      throw new ConflictError('Agent run budget requires operator action before launch', {
        decision: budgetEvaluation.decision,
        thresholdEvents: budgetEvaluation.thresholdEvents,
        traceId: budgetTraceIds[0],
      });
    }
    const launchAgentConfig =
      budgetEvaluation.modelOverride && profileAgentConfig
        ? { ...profileAgentConfig, model: budgetEvaluation.modelOverride }
        : profileAgentConfig;
    const providerRuntimeManifest = await adapter.probe({
      agentConfig: launchAgentConfig,
      health: agentHealth,
    });
    const sandboxPolicy = await getSandboxPolicyService().dryRunWithTrace({
      presetId:
        options.sandboxPresetId ??
        profileLaunch?.sandboxPresetId ??
        launchAgentConfig?.sandboxPresetId,
      provider,
      workspacePath: task.git.worktreePath,
    });
    const sandboxTrace = await getGovernanceTraceService().record(sandboxPolicy.trace);
    if (sandboxPolicy.result.decision === 'block') {
      throw new ConflictError('Sandbox preset cannot be enforced by the selected provider', {
        presetId: sandboxPolicy.result.preset.id,
        provider,
        traceId: sandboxTrace.id,
        unsupportedRules: sandboxPolicy.result.unsupportedRules.map((rule) => ({
          id: rule.id,
          capability: rule.capability,
          detail: rule.detail,
        })),
      });
    }
    const readiness = evaluateTaskReadiness(task, { isCodeTask: true, selectedAgent: agent });
    const overrideReason = options.overrideReason?.trim();

    if (!readiness.ready && !overrideReason) {
      throw new AgentReadinessError(readiness);
    }

    if (!readiness.ready && overrideReason && overrideReason.length < 8) {
      throw new AgentReadinessError(
        readiness,
        'Task readiness override reason must be at least 8 characters'
      );
    }

    if (!readiness.ready && overrideReason) {
      await activityService.logActivity(
        'agent_event',
        taskId,
        task.title,
        {
          event: 'readiness_override',
          overrideReason,
          readinessPercent: readiness.percent,
          missingChecks: readiness.missingRequired.map((check) => ({
            id: check.id,
            label: check.label,
            detail: check.detail,
          })),
        },
        agent
      );
    }

    // Create attempt
    const attemptId = `attempt_${nanoid(8)}`;
    const startedAt = new Date().toISOString();
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);

    // Create event emitter for status updates
    const emitter = new EventEmitter();

    // Store pending agent
    pendingAgents.set(taskId, {
      taskId,
      attemptId,
      agent,
      startedAt,
      emitter,
      provider,
      model: launchAgentConfig?.model,
      agentProfile: profileLaunch?.metadata,
      providerRuntimeManifest,
      budget: budgetPolicy
        ? {
            ...budgetService.initialState(budgetPolicy),
            usage: budgetEvaluation.usage,
            decision: budgetEvaluation.decision,
            thresholdEvents: budgetEvaluation.thresholdEvents,
            traceIds: budgetTraceIds,
            modelOverride: budgetEvaluation.modelOverride,
            overrideReason: options.overrideReason,
          }
        : undefined,
    });

    // Validate path segments for log file
    validatePathSegment(taskId);
    validatePathSegment(attemptId);

    // Build the task prompt for Clawdbot
    const worktreePath = this.expandPath(task.git.worktreePath);
    const taskPrompt = this.buildTaskPrompt(
      task,
      worktreePath,
      attemptId,
      profileLaunch?.instructions
    );

    // Initialize log file (ensure it stays within logs dir)
    ensureWithinBase(this.logsDir, logPath);
    await this.initLogFile(logPath, task, agent, taskPrompt, providerRuntimeManifest);

    // Update task with attempt info
    const attempt: TaskAttempt = {
      id: attemptId,
      agent,
      status: 'running',
      started: startedAt,
      provider,
      model: launchAgentConfig?.model,
      budget: pendingAgents.get(taskId)?.budget,
      agentProfile: profileLaunch?.metadata,
      providerRuntimeManifest,
    };

    await this.taskService.updateTask(taskId, {
      status: 'in-progress',
      attempt,
      attempts: task.attempt ? upsertAttemptHistory(task.attempts, task.attempt) : task.attempts,
    });

    if (profileLaunch) {
      await activityService.logActivity(
        'agent_event',
        taskId,
        task.title,
        {
          event: 'profile_launch',
          profile: profileLaunch.metadata,
          effectivePolicy: {
            sandboxPresetId: options.sandboxPresetId ?? profileLaunch.sandboxPresetId,
            budgetEnabled: pendingAgents.get(taskId)?.budget?.enabled ?? false,
            model: launchAgentConfig?.model,
            provider,
          },
        },
        agent
      );
    }

    const telemetry = getTelemetryService();
    await telemetry.emit<RunStartedEvent>({
      type: 'run.started',
      taskId,
      attemptId,
      agent,
      model: launchAgentConfig?.model,
      project: task.project,
    });

    try {
      await adapter.start({
        task,
        agentConfig: launchAgentConfig,
        prompt: taskPrompt,
        logPath,
        attemptId,
        startedAt,
        emitter,
        attempt,
        sandboxPolicy: sandboxPolicy.result,
      });
    } catch (error: any) {
      pendingAgents.delete(taskId);
      this.recordTraceStep(attemptId, 'error', {
        eventType: 'run.start_failed',
        error: this.redactTraceText(error.message || `Failed to start ${adapter.label}`),
        provider,
        agent,
        model: agentConfig?.model,
      });
      await getTraceService().completeTrace(attemptId, 'error');
      const failedAttempt: TaskAttempt = {
        ...attempt,
        status: 'failed',
        ended: new Date().toISOString(),
      };
      await this.taskService.updateTask(taskId, {
        status: 'todo',
        attempt: failedAttempt,
        attempts: upsertAttemptHistory(
          task.attempt ? upsertAttemptHistory(task.attempts, task.attempt) : task.attempts,
          failedAttempt
        ),
      });
      await telemetry.emit<RunErrorEvent>({
        type: 'run.error',
        taskId,
        attemptId,
        agent,
        project: task.project,
        error: error.message || `Failed to start ${adapter.label}`,
        stackTrace: error.stack,
      });
      throw new Error(`Failed to start agent via ${adapter.label}: ${error.message}`, {
        cause: error,
      });
    }

    return {
      taskId,
      attemptId,
      agent,
      status: 'running',
      startedAt,
    };
  }

  /**
   * Send task request to Clawdbot main session
   * Uses the webchat API endpoint
   */
  private async sendToClawdbot(prompt: string, taskId: string, attemptId: string): Promise<void> {
    // Validate path segments to prevent directory traversal
    validatePathSegment(taskId);
    validatePathSegment(attemptId);

    // Write the task request to a well-known location that Veritas monitors
    // This is simpler than trying to hit the WebSocket API
    const requestsDir = path.join(getRuntimeDir(), 'agent-requests');
    const requestFile = path.join(requestsDir, `${taskId}.json`);
    ensureWithinBase(requestsDir, requestFile);

    await fs.mkdir(path.dirname(requestFile), { recursive: true });

    await fs.writeFile(
      requestFile,
      JSON.stringify(
        {
          taskId,
          attemptId,
          prompt,
          requestedAt: new Date().toISOString(),
          callbackUrl: `http://localhost:3001/api/agents/${taskId}/complete`,
        },
        null,
        2
      )
    );

    log.info(`[ClawdbotAgent] Wrote agent request for task ${taskId} to ${requestFile}`);
    log.info(
      `[ClawdbotAgent] Veritas should pick this up on next heartbeat or you can trigger manually`
    );
  }

  /**
   * Handle completion callback from Clawdbot sub-agent
   */
  async completeAgent(
    taskId: string,
    result: { success: boolean; summary?: string; error?: string }
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      log.warn(`[ClawdbotAgent] Received completion for unknown task ${taskId}`);
      return;
    }

    const { attemptId, emitter } = pending;
    const endedAt = new Date().toISOString();
    const status: AttemptStatus = result.success ? 'complete' : 'failed';
    const durationMs = new Date(endedAt).getTime() - new Date(pending.startedAt).getTime();
    if (pending.budget?.enabled) {
      await this.evaluatePendingBudget(
        taskId,
        { runtimeSeconds: Math.ceil(durationMs / 1000) },
        'agent.complete',
        false
      );
    }

    const taskBeforeCompletion = await this.taskService.getTask(taskId);
    const completedAttempt: TaskAttempt = {
      id: attemptId,
      agent: pending.agent,
      status,
      started: pending.startedAt,
      ended: endedAt,
      provider: pending.provider,
      model: pending.model,
      threadId: pending.threadId,
      budget: pending.budget,
      agentProfile: pending.agentProfile,
      providerRuntimeManifest: pending.providerRuntimeManifest,
    };

    // Update task and preserve the exact launch manifest in attempt history.
    await this.taskService.updateTask(taskId, {
      status: result.success ? 'done' : 'in-progress',
      attempt: completedAttempt,
      attempts: upsertAttemptHistory(taskBeforeCompletion?.attempts, completedAttempt),
    });

    // Append to log
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const summary = result.summary || result.error || 'No summary provided';
    await fs.appendFile(logPath, `\n\n---\n\n## Result\n\n**Status:** ${status}\n\n${summary}\n`);

    // Emit completion
    emitter.emit('complete', { status, summary });

    const task = await this.taskService.getTask(taskId);
    const completionStepType = result.success ? 'complete' : 'error';
    this.recordTraceStep(attemptId, completionStepType, {
      eventType: result.success ? 'run.completed' : 'run.failed',
      summary: this.redactTraceText(summary),
      success: result.success,
      status,
      error: result.error ? this.redactTraceText(result.error) : undefined,
      durationMs,
      agent: pending.agent,
      provider: pending.provider,
      model: pending.model,
    });
    await getTelemetryService().emit<RunCompletedEvent>({
      type: 'run.completed',
      taskId,
      attemptId,
      agent: pending.agent,
      project: task?.project,
      durationMs,
      success: result.success,
      error: result.error,
    });
    await getTraceService().completeTrace(attemptId, result.success ? 'completed' : 'failed');
    await activityService.logActivity(
      'agent_completed',
      taskId,
      task?.title || taskId,
      {
        attemptId,
        provider: pending.provider,
        model: pending.model,
        success: result.success,
        summary,
      },
      pending.agent
    );

    // Clean up
    pendingAgents.delete(taskId);

    // Remove request file
    const requestFile = path.join(getRuntimeDir(), 'agent-requests', `${taskId}.json`);
    try {
      await fs.unlink(requestFile);
    } catch {
      // Ignore if already deleted
    }

    log.info(`[ClawdbotAgent] Task ${taskId} completed with status: ${status}`);
  }

  /**
   * Stop a running agent
   */
  async stopAgent(taskId: string): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      throw new Error('No agent running for this task');
    }

    await this.resolveProviderAdapter(pending.provider).stop({ taskId, pending });
    this.recordTraceStep(pending.attemptId, 'abort', {
      eventType: 'run.aborted',
      summary: 'Stopped by user',
      reason: 'Stopped by user',
      agent: pending.agent,
      provider: pending.provider,
      model: pending.model,
    });

    // Mark as failed/stopped
    await this.completeAgent(taskId, {
      success: false,
      error: 'Stopped by user',
    });
  }

  async sendMessage(
    taskId: string,
    message: string,
    options: AgentMessageOptions = {}
  ): Promise<AgentMessageDelivery> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      throw new Error('No agent running for this task');
    }

    const content = message.trim();
    if (!content) {
      throw new Error('Message cannot be empty');
    }

    const actor = options.actor?.trim() || 'operator';
    const timestamp = new Date().toISOString();
    const redacted = this.redactTraceText(content);
    const logPath = path.join(this.logsDir, `${taskId}_${pending.attemptId}.md`);

    await this.appendLog(
      logPath,
      `\n## Operator Message\n\n**Actor:** ${actor}\n**Source:** ${
        options.source || 'agent-panel'
      }\n\n${redacted}\n`
    );
    pending.emitter.emit('output', {
      type: 'stdin',
      content: `${actor}: ${redacted}`,
      timestamp,
    } satisfies AgentOutput);
    this.recordTraceStep(pending.attemptId, 'execute', {
      eventType: 'operator.message',
      actor,
      source: options.source,
      summary: redacted,
      agent: pending.agent,
      provider: pending.provider,
      model: pending.model,
    });

    if (pending.process?.stdin?.writable) {
      pending.process.stdin.write(`${content}\n`);
      return { delivered: true, note: 'Message written to provider stdin.' };
    }

    return {
      delivered: false,
      note: 'Provider does not expose interactive stdin; message was recorded and streamed.',
    };
  }

  async recordBudgetUsage(taskId: string, delta: Partial<AgentBudgetUsage>): Promise<void> {
    await this.evaluatePendingBudget(taskId, delta, 'agent.usage', true);
  }

  private isBlockingBudgetDecision(decision: AgentBudgetDecision): boolean {
    return decision === 'pause' || decision === 'require-approval' || decision === 'cancel';
  }

  private async evaluatePendingBudget(
    taskId: string,
    delta: Partial<AgentBudgetUsage>,
    actionType: string,
    enforce: boolean
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending?.budget?.enabled || !pending.budget.policy) return;

    const task = await this.taskService.getTask(taskId);
    const budgetService = getAgentBudgetService();
    pending.budget.usage = budgetService.mergeUsage(pending.budget.usage, delta);
    const evaluation = budgetService.evaluate(pending.budget.policy, pending.budget.usage, {
      taskId,
      agentId: pending.agent,
      actionType,
      project: task?.project,
    });

    pending.budget.decision = evaluation.decision;
    pending.budget.modelOverride ??= evaluation.modelOverride;
    pending.budget.thresholdEvents = mergeThresholdEvents(
      pending.budget.thresholdEvents,
      evaluation.thresholdEvents
    );

    if (evaluation.trace) {
      const trace = await getGovernanceTraceService().record(evaluation.trace);
      pending.budget.traceIds = [...new Set([...pending.budget.traceIds, trace.id])];
    }

    if (!enforce || pending.budgetStopped || !this.isBlockingBudgetDecision(evaluation.decision)) {
      return;
    }

    pending.budgetStopped = true;
    const logPath = path.join(this.logsDir, `${taskId}_${pending.attemptId}.md`);
    await this.appendLog(
      logPath,
      `\n## Budget Enforcement\n\nDecision: ${evaluation.decision}\n\n${evaluation.thresholdEvents
        .map((event) => `- ${event.message}`)
        .join('\n')}\n`
    );
    await this.resolveProviderAdapter(pending.provider).stop({ taskId, pending });
    await this.completeAgent(taskId, {
      success: false,
      error: `Budget ${evaluation.decision}: ${evaluation.thresholdEvents
        .map((event) => event.message)
        .join(' ')}`,
    });
  }

  private resolveAgentConfig(agents: AgentConfig[], agent: AgentType): AgentConfig | undefined {
    return agents.find((a) => a.type === agent);
  }

  async probeProviderRuntime(
    agentConfig: AgentConfig,
    agent: AgentType = agentConfig.type
  ): Promise<ProviderRuntimeManifest> {
    const health = await this.assertAgentAvailable(agent, agentConfig);
    const provider = this.resolveAgentProvider(agentConfig, agent);
    return this.resolveProviderAdapter(provider).probe({ agentConfig, health });
  }

  private async assertAgentAvailable(
    agent: AgentType,
    agentConfig: AgentConfig | undefined
  ): Promise<AgentHealthStatus> {
    if (!agentConfig) {
      throw new ConflictError(`Agent "${agent}" is not configured`, {
        agent,
        reason: 'Agent is not configured',
      });
    }

    if (!agentConfig.enabled) {
      throw new ConflictError(`Agent "${agent}" is disabled`, {
        agent,
        reason: 'Agent is disabled',
      });
    }

    const health = await this.agentHealth.checkAgent(agentConfig);
    if (!health.healthy) {
      throw new ConflictError(
        `Agent "${agent}" is unavailable: ${health.reason || 'Agent health check failed'}`,
        {
          agent,
          reason: health.reason || 'Agent health check failed',
          command: agentConfig.command,
          provider: agentConfig.provider,
        }
      );
    }
    return health;
  }

  private resolveAgentProvider(
    agentConfig: AgentConfig | undefined,
    agent: AgentType
  ): ExecutableAgentProvider {
    if (agentConfig?.provider) {
      if (
        agentConfig.provider === 'openclaw' ||
        agentConfig.provider === 'codex-sdk' ||
        agentConfig.provider === 'codex-cli' ||
        agentConfig.provider === 'hermes-cli'
      ) {
        return agentConfig.provider;
      }
      throw new ConflictError(
        `Provider "${agentConfig.provider}" is configured but has no execution adapter`,
        {
          agent,
          provider: agentConfig.provider,
          reason: 'No executable provider adapter is registered',
        }
      );
    }
    if (agent === 'codex') return 'codex-cli';
    if (agentConfig?.command === 'codex') return 'codex-cli';
    if (agentConfig?.command === 'hermes') return 'hermes-cli';
    return 'openclaw';
  }

  private resolveProviderAdapter(provider: ExecutableAgentProvider): AgentProviderAdapter {
    const definition = getProviderRuntimeAdapterDefinition(provider);
    const probe = (context: AgentProviderProbeContext) =>
      this.providerRuntimeManifests.probe(
        this.buildProviderRuntimeProbeRequest(provider, context, definition)
      );

    if (provider === 'codex-cli') {
      return {
        id: definition.id,
        label: definition.label,
        probe,
        start: ({
          task,
          agentConfig,
          prompt,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
        }) => {
          this.startCodexCli(
            task,
            agentConfig,
            prompt,
            logPath,
            attemptId,
            startedAt,
            emitter,
            sandboxPolicy
          );
        },
        stop: ({ pending }) => {
          if (pending.process && !pending.process.killed) pending.process.kill('SIGTERM');
        },
      };
    }

    if (provider === 'codex-sdk') {
      return {
        id: definition.id,
        label: definition.label,
        probe,
        start: ({
          task,
          agentConfig,
          prompt,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
        }) => {
          const abortController = new AbortController();
          const pending = pendingAgents.get(task.id);
          if (pending) pending.abortController = abortController;
          void this.startCodexSdk(
            task,
            agentConfig,
            prompt,
            logPath,
            attemptId,
            startedAt,
            emitter,
            abortController,
            sandboxPolicy
          ).catch(async (error: any) => {
            if (!pendingAgents.has(task.id)) return;
            await this.appendLog(
              logPath,
              `\n## Codex SDK Error\n\n${error.message || 'Codex SDK attempt failed'}\n`
            );
            await this.completeAgent(task.id, {
              success: false,
              error: error.message || 'Codex SDK attempt failed',
            });
          });
        },
        stop: ({ pending }) => {
          pending.abortController?.abort();
        },
      };
    }

    if (provider === 'hermes-cli') {
      return {
        id: definition.id,
        label: definition.label,
        probe,
        start: ({
          task,
          agentConfig,
          prompt,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
        }) => {
          this.startHermesCli(
            task,
            agentConfig,
            prompt,
            logPath,
            attemptId,
            startedAt,
            emitter,
            sandboxPolicy
          );
        },
        stop: ({ pending }) => {
          if (pending.process && !pending.process.killed) {
            pending.process.kill('SIGTERM');
            // Bounded forced-stop: send SIGKILL after 5 s if the process is still running
            const forcedStop = setTimeout(() => {
              if (pending.process && !pending.process.killed) {
                pending.process.kill('SIGKILL');
                log.warn(
                  { taskId: pending.taskId },
                  '[ClawdbotAgent] Hermes SIGKILL issued after graceful stop timeout'
                );
              }
            }, 5_000);
            pending.process.once('close', () => clearTimeout(forcedStop));
          }
        },
      };
    }

    return {
      id: definition.id,
      label: definition.label,
      probe,
      start: async ({ prompt, task, attemptId, agentConfig }) => {
        // Use the HTTP gateway adapter (sessions_spawn) instead of writing a request file.
        // The real spawn acknowledgement surfaces policy denial or gateway
        // unreachability, which the caller's error handler rolls back to 'todo'.
        const openclawAdapter = new HttpOpenClawTaskAdapter();
        const result = await openclawAdapter.spawnTask({
          taskId: task.id,
          attemptId,
          agentId: agentConfig?.type || 'openclaw',
          agentName: agentConfig?.name,
          model: agentConfig?.model,
          prompt,
          timeoutSeconds: 900,
        });
        await this.taskService.patchTaskAttempt(task.id, attemptId, {
          sessionKey: result.sessionKey,
        });
        void this.recordAgentStarted(
          task,
          attemptId,
          agentConfig?.type || 'openclaw',
          'openclaw',
          agentConfig
        );
        const pending = pendingAgents.get(task.id);
        if (pending) {
          pending.openclawSessionKey = result.sessionKey;
        }
        log.info(
          { taskId: task.id, attemptId, sessionKey: result.sessionKey },
          '[ClawdbotAgent] OpenClaw session spawned via gateway'
        );
      },
      stop: async ({ pending }) => {
        // OpenClaw does not expose a direct stop API for sub-sessions in v2026.6.11.
        // Completion is driven by the callback URL included in the task prompt.
        log.warn(
          { taskId: pending.taskId, sessionKey: pending.openclawSessionKey },
          '[ClawdbotAgent] OpenClaw stop requested; sub-session will complete via callback'
        );
      },
    };
  }

  private buildProviderRuntimeProbeRequest(
    provider: ExecutableAgentProvider,
    context: AgentProviderProbeContext,
    definition: ReturnType<typeof getProviderRuntimeAdapterDefinition>
  ): ProviderRuntimeProbeRequest {
    const sdkVersion =
      provider === 'codex-sdk' ? getInstalledPackageVersion('@openai/codex-sdk') : undefined;
    const configuredOpenClawVersion =
      provider === 'openclaw' ? process.env.OPENCLAW_GATEWAY_VERSION?.trim() : undefined;
    const providerVersion =
      sdkVersion ||
      configuredOpenClawVersion ||
      (provider === 'openclaw' ? undefined : context.health.providerVersion);
    const providerBuild =
      provider === 'codex-sdk' && context.health.providerVersion
        ? `codex-cli:${context.health.providerVersion}`
        : undefined;
    const diagnostics: string[] = [];

    if (!providerVersion) {
      diagnostics.push(
        provider === 'openclaw'
          ? 'OpenClaw runtime version was not registered; set OPENCLAW_GATEWAY_VERSION or register a host manifest.'
          : 'The provider version command did not return verifiable output.'
      );
    }

    return {
      provider,
      adapter: definition.id,
      protocolVersion: definition.protocolVersion,
      command:
        provider === 'openclaw'
          ? process.env.OPENCLAW_GATEWAY_URL ||
            process.env.CLAWDBOT_GATEWAY ||
            process.env.CLAWDBOT_GATEWAY_URL ||
            'openclaw'
          : context.agentConfig?.command,
      models: context.agentConfig?.model ? [context.agentConfig.model] : [],
      identity: {
        providerVersion,
        providerBuild,
        verified: provider === 'openclaw' ? false : Boolean(providerVersion),
        source:
          provider === 'codex-sdk'
            ? 'installed-package:@openai/codex-sdk'
            : configuredOpenClawVersion
              ? 'environment:OPENCLAW_GATEWAY_VERSION'
              : context.health.providerVersionSource || 'agent-health',
        authenticated: context.health.authenticated,
        executableFingerprint: context.health.executablePath,
        diagnostics,
      },
      capabilities: definition.capabilities,
    };
  }

  private startHermesCli(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter,
    sandboxPolicy: SandboxPolicyDryRunResult | undefined
  ): void {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Hermes CLI');
    }

    // Hermes v2026.7.7.2 one-shot scripted interface: hermes -z <prompt>
    // stdout = final response text, stderr = diagnostics, exit 0 = success.
    // AGENTS.md in the worktree root is loaded automatically by Hermes.
    const command = agentConfig?.command || 'hermes';
    const extraArgs = agentConfig?.args?.length ? [...agentConfig.args] : [];
    // -z = non-interactive one-shot mode (final response text only)
    const args = ['-z', ...extraArgs, prompt];

    const child = spawn(command, args, {
      cwd: worktreePath,
      env: buildSafeHermesEnv(process.env, sandboxPolicy?.effective.envPassthrough),
      shell: false,
    });

    const pending = pendingAgents.get(task.id);
    if (pending) {
      pending.process = child;
    }

    void this.appendLog(
      logPath,
      `\n## Hermes CLI\n\n**Command:** \`${command} -z <prompt>\`\n**PID:** ${child.pid ?? 'unknown'}\n**Worktree:** \`${worktreePath}\`\n\n`
    );
    void this.recordAgentStarted(
      task,
      attemptId,
      agentConfig?.type || 'hermes',
      'hermes-cli',
      agentConfig
    );

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const SESSION_ID_PATTERN = /hermes[_-]session[_-]id[:\s]+([a-zA-Z0-9_-]{8,})/i;

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      this.recordStreamChunk(task, attemptId, agentConfig, 'hermes-cli', 'stdout', chunk);
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      this.recordStreamChunk(task, attemptId, agentConfig, 'hermes-cli', 'stderr', chunk);
      void this.appendLog(logPath, `\n### stderr\n\n\`\`\`\n${chunk.trimEnd()}\n\`\`\`\n`);

      // Extract session identity from stderr output if Hermes emits it
      const sessionMatch = SESSION_ID_PATTERN.exec(chunk);
      if (sessionMatch) {
        const hermesSessionId = sessionMatch[1];
        const p = pendingAgents.get(task.id);
        if (p && !p.hermesSessionId) {
          p.hermesSessionId = hermesSessionId;
          log.debug(
            { taskId: task.id, hermesSessionId },
            '[ClawdbotAgent] Hermes session ID captured'
          );
        }
      }
    });

    child.on('error', (error) => {
      this.recordTraceStep(attemptId, 'error', {
        eventType: 'process.error',
        error: this.redactTraceText(error.message),
        provider: 'hermes-cli',
        agent: agentConfig?.type || 'hermes',
        model: agentConfig?.model,
      });
      void this.appendLog(logPath, `\n## Hermes Process Error\n\n${error.message}\n`);
      emitter.emit('error', error);
    });

    child.on('close', (code, signal) => {
      void (async () => {
        const finalOutput = stdoutBuffer.trim() || stderrBuffer.trim();
        const success = code === 0;

        await this.appendLog(
          logPath,
          `\n## Hermes Exit\n\n**Exit code:** ${code ?? 'none'}\n**Signal:** ${signal ?? 'none'}\n**Duration:** ${Date.now() - new Date(startedAt).getTime()}ms\n\n**Output:**\n\`\`\`\n${this.redactTraceText(finalOutput)}\n\`\`\`\n`
        );
        this.recordTraceStep(attemptId, 'finalize', {
          eventType: 'run.finalizing',
          exitCode: code,
          signal,
          success,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          provider: 'hermes-cli',
          agent: agentConfig?.type || 'hermes',
          model: agentConfig?.model,
        });

        await this.completeAgent(task.id, {
          success,
          summary: finalOutput || (success ? 'Hermes completed.' : undefined),
          error: success ? undefined : finalOutput || `Hermes exited with code ${code}`,
        });
      })().catch((error) => {
        log.error({ err: error, taskId: task.id }, 'Failed to finalize Hermes attempt');
      });
    });
  }

  private startCodexCli(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter,
    sandboxPolicy: SandboxPolicyDryRunResult | undefined
  ): void {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Codex CLI');
    }

    const command = agentConfig?.command || 'codex';
    const args = this.buildCodexArgs(agentConfig, prompt, logPath, attemptId, sandboxPolicy);
    const child = spawn(command, args, {
      cwd: worktreePath,
      env: buildSafeCodexEnv(process.env, sandboxPolicy?.effective.envPassthrough),
      shell: false,
    });

    const pending = pendingAgents.get(task.id);
    if (pending) {
      pending.process = child;
    }

    void this.appendLog(
      logPath,
      `\n## Codex CLI\n\n**Command:** \`${[command, ...args.map((a) => (a === prompt ? '<prompt>' : a))].join(' ')}\`\n**PID:** ${child.pid ?? 'unknown'}\n\n`
    );
    void this.recordAgentStarted(
      task,
      attemptId,
      agentConfig?.type || 'codex',
      'codex-cli',
      agentConfig
    );

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let finalSummary = '';
    let tokenUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens?: number;
          cost?: number;
          model?: string;
        }
      | undefined;

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      this.recordStreamChunk(task, attemptId, agentConfig, 'codex-cli', 'stdout', chunk);
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const parsed = this.handleCodexJsonLine(line, logPath, task, attemptId, agentConfig);
        if (parsed.summary) finalSummary = parsed.summary;
        if (parsed.usage) tokenUsage = parsed.usage;
      }
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      this.recordStreamChunk(task, attemptId, agentConfig, 'codex-cli', 'stderr', chunk);
      void this.appendLog(logPath, `\n### stderr\n\n\`\`\`\n${chunk.trimEnd()}\n\`\`\`\n`);
    });

    child.on('error', (error) => {
      this.recordTraceStep(attemptId, 'error', {
        eventType: 'process.error',
        error: this.redactTraceText(error.message),
        provider: 'codex-cli',
        agent: agentConfig?.type || 'codex',
        model: agentConfig?.model,
      });
      void this.appendLog(logPath, `\n## Codex Process Error\n\n${error.message}\n`);
      emitter.emit('error', error);
    });

    child.on('close', (code, signal) => {
      void (async () => {
        if (stdoutBuffer.trim()) {
          const parsed = this.handleCodexJsonLine(
            stdoutBuffer,
            logPath,
            task,
            attemptId,
            agentConfig
          );
          if (parsed.summary) finalSummary = parsed.summary;
          if (parsed.usage) tokenUsage = parsed.usage;
        }

        const finalPath = this.getCodexFinalPath(logPath, attemptId);
        finalSummary ||= await this.readOptionalFile(finalPath);
        finalSummary ||=
          code === 0 ? 'Codex completed without a final summary.' : stderrBuffer.trim();

        if (tokenUsage) {
          await getTelemetryService().emit<TokenTelemetryEvent>({
            type: 'run.tokens',
            taskId: task.id,
            attemptId,
            agent: agentConfig?.type || 'codex',
            project: task.project,
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.totalTokens,
            cost: tokenUsage.cost,
            model: tokenUsage.model || agentConfig?.model,
          });
          await this.evaluatePendingBudget(
            task.id,
            {
              inputTokens: tokenUsage.inputTokens,
              outputTokens: tokenUsage.outputTokens,
              totalTokens: tokenUsage.totalTokens,
              costUsd: tokenUsage.cost,
            },
            'agent.tokens',
            false
          );
        }

        await this.appendLog(
          logPath,
          `\n## Codex Exit\n\n**Exit code:** ${code ?? 'none'}\n**Signal:** ${signal ?? 'none'}\n**Duration:** ${Date.now() - new Date(startedAt).getTime()}ms\n`
        );
        this.recordTraceStep(attemptId, 'finalize', {
          eventType: 'run.finalizing',
          exitCode: code,
          signal,
          success: code === 0,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          provider: 'codex-cli',
          agent: agentConfig?.type || 'codex',
          model: agentConfig?.model,
        });

        await this.completeAgent(task.id, {
          success: code === 0,
          summary: finalSummary,
          error: code === 0 ? undefined : finalSummary || `Codex exited with code ${code}`,
        });
      })().catch((error) => {
        log.error({ err: error, taskId: task.id }, 'Failed to finalize Codex attempt');
      });
    });
  }

  private buildCodexArgs(
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    sandboxPolicy?: SandboxPolicyDryRunResult
  ): string[] {
    const configured = agentConfig?.args?.length ? [...agentConfig.args] : ['exec'];
    const args = configured.includes('exec') ? configured : ['exec', ...configured];
    const sandboxMode = sandboxPolicy?.effective.sandboxMode ?? 'workspace-write';
    const sandboxIndex = args.indexOf('--sandbox');
    if (sandboxIndex >= 0) {
      args[sandboxIndex + 1] = sandboxMode;
    } else {
      args.push('--sandbox', sandboxMode);
    }
    if (!args.includes('--json')) args.push('--json');
    if (!args.includes('--output-last-message')) {
      args.push('--output-last-message', this.getCodexFinalPath(logPath, attemptId));
    }
    args.push(prompt);
    return args;
  }

  private getCodexFinalPath(logPath: string, attemptId: string): string {
    return path.join(path.dirname(logPath), `${attemptId}.codex-final.md`);
  }

  private async startCodexSdk(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter,
    abortController: AbortController,
    sandboxPolicy: SandboxPolicyDryRunResult | undefined
  ): Promise<void> {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Codex SDK');
    }

    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({
      codexPathOverride:
        agentConfig?.command && agentConfig.command !== 'codex' ? agentConfig.command : undefined,
      env: buildSafeCodexEnv(process.env, sandboxPolicy?.effective.envPassthrough),
    });

    const thread = codex.startThread({
      workingDirectory: worktreePath,
      skipGitRepoCheck: true,
      sandboxMode: sandboxPolicy?.effective.sandboxMode ?? 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: sandboxPolicy?.effective.networkAccessEnabled ?? true,
      model: agentConfig?.model,
    });

    await this.appendLog(
      logPath,
      `\n## Codex SDK\n\n**Worktree:** \`${worktreePath}\`\n**Model:** ${agentConfig?.model || 'default'}\n\n`
    );
    await this.recordAgentStarted(
      task,
      attemptId,
      agentConfig?.type || 'codex-sdk',
      'codex-sdk',
      agentConfig
    );

    const streamed = await thread.runStreamed(prompt, { signal: abortController.signal });
    let finalSummary = '';
    let failureMessage = '';
    let tokenUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          totalTokens?: number;
          cost?: number;
          model?: string;
        }
      | undefined;

    for await (const event of streamed.events) {
      const parsed = this.handleCodexEvent(event, logPath, task, attemptId, agentConfig);
      if (parsed.summary) finalSummary = parsed.summary;
      if (parsed.usage) tokenUsage = parsed.usage;

      if (event.type === 'thread.started') {
        await this.recordCodexThread(task, attemptId, event.thread_id);
      }
      if (event.type === 'turn.failed') {
        failureMessage = event.error.message;
      }
      if (event.type === 'error') {
        failureMessage = event.message;
      }
    }

    if (tokenUsage) {
      await getTelemetryService().emit<TokenTelemetryEvent>({
        type: 'run.tokens',
        taskId: task.id,
        attemptId,
        agent: agentConfig?.type || 'codex-sdk',
        project: task.project,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        cost: tokenUsage.cost,
        model: tokenUsage.model || agentConfig?.model,
      });
      await this.evaluatePendingBudget(
        task.id,
        {
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          costUsd: tokenUsage.cost,
        },
        'agent.tokens',
        false
      );
    }

    await this.appendLog(
      logPath,
      `\n## Codex SDK Complete\n\n**Duration:** ${Date.now() - new Date(startedAt).getTime()}ms\n`
    );

    await this.completeAgent(task.id, {
      success: !failureMessage,
      summary: finalSummary || failureMessage || 'Codex SDK completed without a final summary.',
      error: failureMessage || undefined,
    });
    emitter.emit('sdk.complete', { taskId: task.id, attemptId });
  }

  private handleCodexJsonLine(
    line: string,
    logPath: string,
    task?: Task,
    attemptId?: string,
    agentConfig?: AgentConfig
  ): {
    summary?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens?: number;
      cost?: number;
      model?: string;
    };
  } {
    const trimmed = line.trim();
    if (!trimmed) return {};

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      return this.handleCodexEvent(event, logPath, task, attemptId, agentConfig);
    } catch {
      void this.appendLog(logPath, `\n### stdout\n\n\`\`\`\n${trimmed}\n\`\`\`\n`);
      return { summary: trimmed };
    }
  }

  private handleCodexEvent(
    event: ThreadEvent | Record<string, unknown>,
    logPath: string,
    task?: Task,
    attemptId?: string,
    agentConfig?: AgentConfig
  ): {
    summary?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens?: number;
      cost?: number;
      model?: string;
    };
  } {
    const record = event as Record<string, unknown>;
    const type = String(record.type || record.event || 'codex.event');
    const summary = this.extractCodexSummary(record);
    const usage = this.extractCodexUsage(record);
    void this.appendLog(
      logPath,
      `\n### ${type}\n\n${summary ? `${summary}\n\n` : ''}<details><summary>Raw event</summary>\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n\n</details>\n`
    );
    if (task && attemptId) {
      void this.recordCodexEvent(task, attemptId, agentConfig, type, record, summary).catch(
        (error) => {
          log.warn(
            {
              error: error instanceof Error ? error.message : String(error),
              taskId: task.id,
              attemptId,
            },
            'Failed to record Codex event'
          );
        }
      );
    }
    return { summary, usage };
  }

  private async recordAgentStarted(
    task: Task,
    attemptId: string,
    agent: string,
    provider: ExecutableAgentProvider,
    agentConfig?: AgentConfig
  ): Promise<void> {
    getTraceService().startTrace(
      attemptId,
      task.id,
      agent as AgentType,
      task.project,
      this.buildTraceMetadata(task, attemptId, provider, agentConfig)
    );
    getTraceService().startStep(attemptId, 'init', {
      provider,
      eventType: 'run.started',
      summary: 'Agent run initialized',
      agent,
      model: agentConfig?.model,
      worktreePath: task.git?.worktreePath,
    });
    getTraceService().endStep(attemptId, 'init');
    await activityService.logActivity(
      'agent_started',
      task.id,
      task.title,
      { attemptId, provider },
      agent
    );
  }

  private recordTraceStep(
    attemptId: string,
    stepType: AgentRunTraceStepType,
    metadata?: Record<string, unknown>
  ): void {
    const traceService = getTraceService();
    traceService.startStep(attemptId, stepType, metadata);
    traceService.endStep(attemptId, stepType);
  }

  private recordStreamChunk(
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig | undefined,
    provider: ExecutableAgentProvider,
    stream: 'stdout' | 'stderr',
    chunk: string
  ): void {
    const content = this.redactTraceText(chunk.trimEnd());
    if (!content.trim()) return;
    this.recordTraceStep(attemptId, 'stream', {
      eventType: `stream.${stream}`,
      stream,
      summary: content,
      content,
      chunkBytes: Buffer.byteLength(chunk, 'utf-8'),
      lineCount: chunk.split(/\r?\n/).filter((line) => line.trim()).length,
      provider,
      agent: agentConfig?.type || task.agent || 'codex',
      model: agentConfig?.model,
    });
  }

  private buildTraceMetadata(
    task: Task,
    attemptId: string,
    provider: ExecutableAgentProvider,
    agentConfig?: AgentConfig
  ): AgentRunTraceMetadata {
    const providerRuntimeManifest = pendingAgents.get(task.id)?.providerRuntimeManifest;
    return {
      clientSource: 'agent-service',
      mode: task.runMode ?? 'agent',
      capabilitySet: providerRuntimeManifest?.capabilities
        .filter((capability) => capability.state === 'supported')
        .map((capability) => capability.id),
      workspaceId: 'local',
      runKey: attemptId,
      policyProfile:
        provider === 'codex-sdk'
          ? 'codex-sdk:workspace-write:approval-never'
          : provider === 'codex-cli'
            ? 'codex-cli:workspace-write'
            : provider === 'hermes-cli'
              ? 'hermes-cli:workspace-write'
              : 'openclaw:delegated',
      provider,
      model: agentConfig?.model,
      taskType: task.type,
      repo: task.git?.repo,
      branch: task.git?.branch,
      baseBranch: task.git?.baseBranch,
      worktreePath: task.git?.worktreePath,
      providerRuntimeManifest,
    };
  }

  private async recordCodexEvent(
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig | undefined,
    type: string,
    event: Record<string, unknown>,
    summary?: string
  ): Promise<void> {
    const agent =
      agentConfig?.type || (agentConfig?.provider === 'codex-sdk' ? 'codex-sdk' : 'codex');
    const files = this.extractCodexFiles(event);
    const usage = this.extractCodexUsage(event);
    const command = this.extractCodexCommand(event);
    const tool = this.extractCodexTool(event, type);
    const error = this.extractCodexError(event, type);
    const sanitizedSummary = summary ? this.redactTraceText(summary) : undefined;
    const stepType = this.codexTraceStepType(type, event);
    const stream = this.extractCodexStream(event, type);
    this.recordTraceStep(attemptId, stepType, {
      provider: agentConfig?.provider || 'codex-cli',
      eventType: type,
      summary: sanitizedSummary,
      content: stepType === 'stream' ? sanitizedSummary : undefined,
      stream,
      command: command ? this.redactTraceText(command) : undefined,
      tool,
      files,
      error: error ? this.redactTraceText(error) : undefined,
      retryAttempt: this.extractCodexNumber(event, ['retryAttempt', 'retry_attempt', 'attempt']),
      retryDelayMs: this.extractCodexNumber(event, ['retryDelayMs', 'retry_delay_ms', 'delayMs']),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      model: usage?.model || agentConfig?.model,
      finalResult: stepType === 'complete' ? sanitizedSummary : undefined,
    });

    if (this.shouldLogCodexActivity(type)) {
      await activityService.logActivity(
        'agent_event',
        task.id,
        task.title,
        {
          attemptId,
          provider: agentConfig?.provider || 'codex-cli',
          eventType: type,
          summary: sanitizedSummary,
        },
        agent
      );
    }

    if (tool) {
      await this.evaluatePendingBudget(task.id, { toolCalls: 1 }, 'agent.tool', true);
    }

    if (files.length > 0) {
      await this.attachCodexDeliverables(task, attemptId, agent, files);
    }
  }

  private codexTraceStepType(type: string, event?: Record<string, unknown>): AgentRunTraceStepType {
    const normalized = type.toLowerCase();
    if (normalized.includes('retry')) return 'retry';
    if (normalized.includes('abort') || normalized.includes('cancel')) return 'abort';
    if (normalized.includes('failed') || normalized === 'error') return 'error';
    if (normalized.includes('finaliz')) return 'finalize';
    if (
      normalized.includes('delta') ||
      normalized.includes('stream') ||
      normalized.includes('output') ||
      normalized.includes('stdout') ||
      normalized.includes('stderr')
    ) {
      return 'stream';
    }
    if (event && typeof event.item === 'object' && event.item !== null) {
      const itemType = String((event.item as Record<string, unknown>).type || '').toLowerCase();
      if (itemType.includes('delta') || itemType.includes('message_delta')) return 'stream';
    }
    if (type.includes('failed') || type === 'error') return 'error';
    if (type === 'turn.completed' || type === 'response.completed') return 'complete';
    return 'execute';
  }

  private shouldLogCodexActivity(type: string): boolean {
    return (
      type.includes('command') ||
      type.includes('tool') ||
      type.includes('file') ||
      type.includes('retry') ||
      type.includes('abort') ||
      type.includes('completed') ||
      type.includes('failed') ||
      type === 'error'
    );
  }

  private extractCodexFiles(event: unknown): string[] {
    const files = new Set<string>();
    const seen = new Set<unknown>();
    const fileKeys = new Set([
      'file',
      'file_path',
      'filePath',
      'path',
      'relative_path',
      'relativePath',
      'absolute_path',
      'absolutePath',
    ]);

    const visit = (value: unknown, key?: string): void => {
      if (!value) return;
      if (typeof value === 'string') {
        if (key && fileKeys.has(key) && this.looksLikeFilePath(value)) files.add(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item, key);
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        visit(childValue, childKey);
      }
    };

    visit(event);
    return [...files].slice(0, 25);
  }

  private extractCodexCommand(event: unknown): string | undefined {
    const command = this.findCodexString(event, [
      'command',
      'cmd',
      'shell_command',
      'shellCommand',
    ]);
    const args = this.findCodexStringArray(event, ['args', 'argv']);
    if (command && args.length > 0) return `${command} ${args.join(' ')}`;
    return command ?? (args.length > 0 ? args.join(' ') : undefined);
  }

  private extractCodexTool(event: unknown, fallbackType: string): string | undefined {
    const tool = this.findCodexString(event, [
      'tool',
      'tool_name',
      'toolName',
      'function_name',
      'functionName',
    ]);
    if (tool) return tool;

    if (event && typeof event === 'object') {
      const item = (event as Record<string, unknown>).item;
      if (item && typeof item === 'object') {
        const itemType = (item as Record<string, unknown>).type;
        if (typeof itemType === 'string' && itemType.trim()) return itemType.trim();
      }
    }

    return fallbackType;
  }

  private extractCodexError(event: unknown, type: string): string | undefined {
    if (!type.includes('failed') && type !== 'error') return undefined;
    const error = this.findCodexString(event, ['error', 'message']);
    return error;
  }

  private extractCodexStream(
    event: Record<string, unknown>,
    type: string
  ): 'stdout' | 'stderr' | undefined {
    const stream = this.findCodexString(event, ['stream', 'channel', 'fd']);
    if (stream === 'stdout' || stream === 'stderr') return stream;
    if (/stderr|error/i.test(type)) return 'stderr';
    if (/stdout|delta|output|stream/i.test(type)) return 'stdout';
    return undefined;
  }

  private extractCodexNumber(event: unknown, keys: string[]): number | undefined {
    const wanted = new Set(keys);
    const seen = new Set<unknown>();

    const visit = (value: unknown, key?: string): number | undefined => {
      if (!value) return undefined;
      if (typeof value === 'number') {
        return key && wanted.has(key) ? value : undefined;
      }
      if (typeof value === 'string' && key && wanted.has(key)) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          const result = visit(item, key);
          if (result !== undefined) return result;
        }
        return undefined;
      }
      if (typeof value !== 'object' || seen.has(value)) return undefined;
      seen.add(value);
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        const result = visit(childValue, childKey);
        if (result !== undefined) return result;
      }
      return undefined;
    };

    return visit(event);
  }

  private findCodexString(event: unknown, keys: string[]): string | undefined {
    const wanted = new Set(keys);
    const seen = new Set<unknown>();

    const visit = (value: unknown, key?: string): string | undefined => {
      if (!value) return undefined;
      if (typeof value === 'string') {
        if (key && wanted.has(key) && value.trim()) return value.trim();
        return undefined;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          const result = visit(item, key);
          if (result) return result;
        }
        return undefined;
      }
      if (typeof value !== 'object' || seen.has(value)) return undefined;
      seen.add(value);
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        const result = visit(childValue, childKey);
        if (result) return result;
      }
      return undefined;
    };

    return visit(event);
  }

  private findCodexStringArray(event: unknown, keys: string[]): string[] {
    const wanted = new Set(keys);
    const seen = new Set<unknown>();

    const visit = (value: unknown, key?: string): string[] => {
      if (!value) return [];
      if (Array.isArray(value)) {
        if (key && wanted.has(key)) {
          return value
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim())
            .slice(0, 20);
        }
        for (const item of value) {
          const result = visit(item, key);
          if (result.length > 0) return result;
        }
        return [];
      }
      if (typeof value !== 'object' || seen.has(value)) return [];
      seen.add(value);
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        const result = visit(childValue, childKey);
        if (result.length > 0) return result;
      }
      return [];
    };

    return visit(event);
  }

  private redactTraceText(value: string): string {
    let redacted = value;
    for (const [pattern, replacement] of TRACE_SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, replacement);
    }
    return redacted.length > 2000 ? `${redacted.slice(0, 2000)}...` : redacted;
  }

  private looksLikeFilePath(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('\n')) return false;
    if (/^https?:\/\//i.test(trimmed)) return true;
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../'))
      return true;
    return /^[\w.-]+\/[\w./-]+$/.test(trimmed) || /\.[a-z0-9]{1,12}$/i.test(trimmed);
  }

  private async attachCodexDeliverables(
    task: Task,
    attemptId: string,
    agent: string,
    files: string[]
  ): Promise<void> {
    const freshTask = await this.taskService.getTask(task.id);
    if (!freshTask) return;

    const existing = freshTask.deliverables || [];
    const existingKeys = new Set(
      existing.map((deliverable) => `${deliverable.path || ''}:${deliverable.agent || ''}`)
    );
    const created = new Date().toISOString();
    const additions: Deliverable[] = [];

    for (const file of files) {
      const key = `${file}:${agent}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      additions.push({
        id: `deliverable_${nanoid(8)}`,
        title: path.basename(file) || file,
        type: this.inferDeliverableType(file),
        path: file,
        status: 'attached',
        agent,
        workspaceId: 'local',
        sourceRunId: attemptId,
        version: 1,
        created,
        description: `Codex event artifact from attempt ${attemptId}`,
      });
    }

    if (additions.length === 0) return;

    await this.taskService.updateTask(task.id, {
      deliverables: [...existing, ...additions],
    });
    await activityService.logActivity(
      'deliverable_added',
      task.id,
      task.title,
      {
        attemptId,
        provider: 'codex',
        deliverableCount: additions.length,
        paths: additions.map((deliverable) => deliverable.path),
      },
      agent
    );
  }

  private inferDeliverableType(file: string): Deliverable['type'] {
    const lower = file.toLowerCase();
    if (/\.(ts|tsx|js|jsx|py|go|rs|java|cs|rb|php|css|scss|html)$/.test(lower)) return 'code';
    if (/\.(md|txt|docx|pdf)$/.test(lower)) return 'document';
    if (/\.(json|yaml|yml|xml|csv|png|jpg|jpeg|gif|svg)$/.test(lower)) return 'artifact';
    return 'other';
  }

  private async recordCodexThread(task: Task, attemptId: string, threadId: string): Promise<void> {
    const pending = pendingAgents.get(task.id);
    if (pending) {
      pending.threadId = threadId;
    }

    await this.taskService.patchTaskAttempt(task.id, attemptId, { threadId });
  }

  private extractCodexSummary(event: unknown): string | undefined {
    const seen = new Set<unknown>();
    const visit = (value: unknown): string | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      if (seen.has(value)) return undefined;
      seen.add(value);
      const record = value as Record<string, unknown>;
      for (const key of [
        'final_response',
        'finalMessage',
        'final_message',
        'message',
        'text',
        'delta',
        'chunk',
        'content',
        'output',
      ]) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      }
      for (const child of Object.values(record)) {
        const result = visit(child);
        if (result) return result;
      }
      return undefined;
    };
    return visit(event);
  }

  private extractCodexUsage(event: unknown):
    | {
        inputTokens: number;
        outputTokens: number;
        totalTokens?: number;
        cost?: number;
        model?: string;
      }
    | undefined {
    const seen = new Set<unknown>();
    const visit = (value: unknown): Record<string, unknown> | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      if (seen.has(value)) return undefined;
      seen.add(value);
      const record = value as Record<string, unknown>;
      const input =
        record.input_tokens ?? record.inputTokens ?? record.prompt_tokens ?? record.promptTokens;
      const output =
        record.output_tokens ??
        record.outputTokens ??
        record.completion_tokens ??
        record.completionTokens;
      if (typeof input === 'number' && typeof output === 'number') return record;
      for (const child of Object.values(record)) {
        const result = visit(child);
        if (result) return result;
      }
      return undefined;
    };

    const usage = visit(event);
    if (!usage) return undefined;
    const input = (usage.input_tokens ??
      usage.inputTokens ??
      usage.prompt_tokens ??
      usage.promptTokens) as number;
    const output = (usage.output_tokens ??
      usage.outputTokens ??
      usage.completion_tokens ??
      usage.completionTokens) as number;
    const total = usage.total_tokens ?? usage.totalTokens;
    const cost = usage.cost ?? usage.cost_usd ?? usage.costUsd;
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: typeof total === 'number' ? total : input + output,
      cost: typeof cost === 'number' ? cost : undefined,
      model: typeof usage.model === 'string' ? usage.model : undefined,
    };
  }

  private async appendLog(logPath: string, content: string): Promise<void> {
    ensureWithinBase(this.logsDir, logPath);
    await fs.appendFile(logPath, content, 'utf-8');
  }

  private async readOptionalFile(filePath: string): Promise<string> {
    try {
      return (await fs.readFile(filePath, 'utf-8')).trim();
    } catch {
      return '';
    }
  }

  /**
   * Get agent status
   */
  getAgentStatus(taskId: string): AgentStatus | null {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      return null;
    }

    return {
      taskId,
      attemptId: pending.attemptId,
      agent: pending.agent,
      status: 'running',
      startedAt: pending.startedAt,
    };
  }

  /**
   * Get event emitter for a running agent
   */
  getAgentEmitter(taskId: string): EventEmitter | null {
    return pendingAgents.get(taskId)?.emitter || null;
  }

  /**
   * List all pending agent requests (for Veritas to poll)
   */
  async listPendingRequests(): Promise<
    Array<{
      taskId: string;
      attemptId: string;
      prompt: string;
      requestedAt: string;
      callbackUrl: string;
    }>
  > {
    const requestsDir = path.join(getRuntimeDir(), 'agent-requests');

    try {
      const files = await fs.readdir(requestsDir);
      const requests = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            const content = await fs.readFile(path.join(requestsDir, f), 'utf-8');
            return JSON.parse(content);
          })
      );
      return requests;
    } catch {
      // Intentionally silent: requests directory may not exist — return empty list
      return [];
    }
  }

  async getAttemptLog(taskId: string, attemptId: string): Promise<string> {
    validatePathSegment(taskId);
    validatePathSegment(attemptId);
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    ensureWithinBase(this.logsDir, logPath);
    try {
      return await fs.readFile(logPath, 'utf-8');
    } catch {
      throw new Error('Log file not found');
    }
  }

  async listAttempts(taskId: string): Promise<string[]> {
    const files = await fs.readdir(this.logsDir);
    return files
      .filter((f) => f.startsWith(`${taskId}_`) && f.endsWith('.md'))
      .map((f) => f.replace(`${taskId}_`, '').replace('.md', ''));
  }

  private buildTaskPrompt(
    task: Task,
    worktreePath: string,
    attemptId: string,
    profileInstructions?: string
  ): string {
    // Build checkpoint context if available
    let checkpointSection = '';
    if (task.checkpoint) {
      const resumeCount = task.checkpoint.resumeCount || 0;
      const checkpointAge = Math.floor(
        (Date.now() - new Date(task.checkpoint.timestamp).getTime()) / 1000 / 60
      );
      checkpointSection = `
## ⚠️ CHECKPOINT DETECTED — This is a RESUME (not a fresh start)

**Resume Count:** ${resumeCount} time(s)
**Last Checkpoint:** ${task.checkpoint.timestamp} (${checkpointAge} minutes ago)
**Last Step:** ${task.checkpoint.step}

### Saved State:
\`\`\`json
${JSON.stringify(task.checkpoint.state, null, 2)}
\`\`\`

**IMPORTANT:** Continue from where you left off. Review the saved state above to understand what was already done.
`;
    }

    return `# Agent Task Request

**Task ID:** ${task.id}
**Attempt ID:** ${attemptId}
**Worktree:** ${worktreePath}
${checkpointSection}
## Task: ${task.title}

${task.description || 'No description provided.'}

${profileInstructions ? `${profileInstructions}\n` : ''}

## Instructions

1. Work in the directory: \`${worktreePath}\`
2. Complete the task described above
3. Commit your changes with a descriptive message
4. When done, call the completion endpoint:
   \`\`\`bash
   curl -X POST http://localhost:3001/api/agents/${task.id}/complete \\
     -H "Content-Type: application/json" \\
     -d '{"success": true, "summary": "Brief description of what was done"}'
   \`\`\`

If you encounter errors, call with \`success: false\` and include the error message.
`;
  }

  private async initLogFile(
    logPath: string,
    task: Task,
    agent: AgentType,
    prompt: string,
    providerRuntimeManifest: ProviderRuntimeManifest
  ): Promise<void> {
    const header = `# Agent Log: ${task.title}

**Task ID:** ${task.id}
**Agent:** ${agent}
**Started:** ${new Date().toISOString()}
**Worktree:** ${task.git?.worktreePath}
**Provider manifest:** ${providerRuntimeManifest.digest}

<details><summary>Provider runtime manifest</summary>

\`\`\`json
${JSON.stringify(providerRuntimeManifest, null, 2)}
\`\`\`

</details>

## Task Prompt

\`\`\`
${prompt}
\`\`\`

## Progress

*Agent is working...*

`;
    await fs.writeFile(logPath, header, 'utf-8');
  }
}

// Export singleton
export const clawdbotAgentService = new ClawdbotAgentService();

function upsertAttemptHistory(
  history: TaskAttempt[] | undefined,
  attempt: TaskAttempt
): TaskAttempt[] {
  return [...(history ?? []).filter((candidate) => candidate.id !== attempt.id), attempt];
}

function mergeThresholdEvents(
  existing: AgentBudgetThresholdEvent[],
  next: AgentBudgetThresholdEvent[]
): AgentBudgetThresholdEvent[] {
  const byKey = new Map<string, AgentBudgetThresholdEvent>();
  for (const event of [...existing, ...next]) {
    byKey.set(`${event.metric}:${event.threshold}:${event.action}`, event);
  }
  return Array.from(byKey.values());
}
