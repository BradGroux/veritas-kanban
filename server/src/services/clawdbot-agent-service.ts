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
import {
  buildOpenClawTaskSpawnArguments,
  HttpOpenClawTaskAdapter,
  isOpenClawGatewayPrivateIpAllowed,
} from './openclaw-workflow-adapter.js';
import {
  renderCodexCliTaskEnvelope,
  renderCodexSdkTaskEnvelope,
  renderHermesTaskEnvelope,
  renderOpenClawTaskEnvelope,
  type ProviderTaskEnvelopeRenderInput,
  type ProviderTaskEnvelopeTransport,
} from './provider-task-envelope-renderer.js';
import type { ThreadEvent } from '@openai/codex-sdk';
import { evaluateTaskReadiness, RUN_LAUNCH_MANIFEST_SCHEMA_VERSION } from '@veritas-kanban/shared';
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
  AgentBudgetEvaluation,
  AgentProfileLaunchMetadata,
  AgentProfileResolvedLaunch,
  ExecutableAgentProvider,
  ProviderRuntimeCapabilityId,
  ProviderRuntimeControlAction,
  ProviderRuntimeControlSet,
  ProviderRuntimeManifest,
  TaskCommitPolicy,
  TaskEnvelope,
  HarnessSupportStatus,
  HarnessSupportTelemetry,
  RunLaunchManifest,
  RunLaunchManifestDriftResult,
  RunLaunchManifestOrigin,
  RunLaunchManifestPreview,
  RunLaunchRuntime,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { ConflictError } from '../middleware/error-handler.js';
import type { AgentBudgetThresholdEvent } from '@veritas-kanban/shared';
import { getAgentProfilePackageService } from './agent-profile-package-service.js';
import {
  ProviderRuntimeManifestService,
  type ProviderRuntimeProbeRequest,
} from './provider-runtime-manifest-service.js';
import type { WorkspaceFileRepository } from '../storage/interfaces.js';
import { LocalWorkspaceFileRepository } from '../storage/workspace-file-repository.js';
import {
  getProviderRuntimeAdapterDefinition,
  type ProviderRuntimeSurface,
} from './provider-runtime-adapter-registry.js';
import { getInstalledPackageVersion } from '../utils/package-version.js';
import {
  assertProviderRuntimeControl,
  assertProviderRuntimeManifestSnapshot,
  BASELINE_LAUNCH_CAPABILITIES,
  providerRuntimeControls,
} from './provider-runtime-control-service.js';
import { resolveTaskCommitPolicy, TaskEnvelopeService } from './task-envelope-service.js';
import { evaluateHarnessSupportStatus } from './harness-support-service.js';
import { normalizeHarnessSupportProfile } from './harness-support-profile-registry.js';
import { RunLaunchManifestService, diffRunLaunchManifests } from './run-launch-manifest-service.js';
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
  transport: ProviderTaskEnvelopeTransport;
  logPath: string;
  attemptId: string;
  startedAt: string;
  emitter: EventEmitter;
  attempt: TaskAttempt;
  sandboxPolicy?: SandboxPolicyDryRunResult;
  runLaunchManifest: RunLaunchManifest;
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
  renderTaskEnvelope(input: ProviderTaskEnvelopeRenderInput): ProviderTaskEnvelopeTransport;
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
  provider?: ExecutableAgentProvider;
  model?: string;
  providerRuntimeManifest: ProviderRuntimeManifest;
  harnessSupport: HarnessSupportStatus;
  taskEnvelope: TaskEnvelope;
  runLaunchManifest: RunLaunchManifest;
  runLaunchParentAttemptId?: string;
  runLaunchManifestDrift?: RunLaunchManifestDriftResult;
  controls: ProviderRuntimeControlSet;
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
  requiredRuntimeCapabilities?: ProviderRuntimeCapabilityId[];
  commitPolicy?: TaskCommitPolicy;
  parentAttemptId?: string;
}

export interface AgentMessageOptions {
  actor?: string;
  source?: string;
  expectedAttemptId: string;
}

export interface AgentCompletionProvenance {
  attemptId: string;
  providerRuntimeManifestDigest: string;
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
  harnessSupport: HarnessSupportStatus;
  taskEnvelope: TaskEnvelope;
  runLaunchManifest: RunLaunchManifest;
  runLaunchManifestTraceId: string;
  runLaunchParentAttemptId?: string;
  runLaunchManifestDrift?: RunLaunchManifestDriftResult;
  threadId?: string;
  abortController?: AbortController;
  process?: ChildProcessWithoutNullStreams;
  /** Durable session key returned by OpenClaw sessions_spawn (openclaw provider only) */
  openclawSessionKey?: string;
  /** Hermes session identity captured from process output (hermes-cli provider only) */
  hermesSessionId?: string;
  /**
   * The first terminal result prepared for this run. Keep it across a failed
   * authoritative task update so retries only repeat persistence, never
   * provider-stop, abort-trace, or budget-enforcement side effects.
   */
  preparedFinalizationResult?: AgentTerminalResult;
  completionTiming?: {
    endedAt: string;
    durationMs: number;
  };
  completionBudgetEvaluated?: boolean;
  preparedCompletion?: {
    status: AttemptStatus;
    taskBeforeCompletion?: Task;
    completedAttempt: TaskAttempt;
  };
}

interface AgentTerminalResult {
  success: boolean;
  summary?: string;
  error?: string;
}

const pendingAgents = new Map<string, PendingAgent>();
const startingAgents = new Set<string>();
const finalizingAgents = new Map<PendingAgent, Promise<void>>();
const budgetEvaluations = new Map<PendingAgent, Promise<void>>();

export class ClawdbotAgentService {
  private configService: ConfigService;
  private taskService: TaskService;
  private agentHealth: AgentHealthChecker;
  private providerRuntimeManifests: ProviderRuntimeManifestService;
  private taskEnvelopes: TaskEnvelopeService;
  private runLaunchManifests: RunLaunchManifestService;
  private workspaceFiles: WorkspaceFileRepository;
  private logsDir: string;

  constructor(
    agentHealth?: AgentHealthChecker,
    providerRuntimeManifests = new ProviderRuntimeManifestService(),
    taskEnvelopes = new TaskEnvelopeService(),
    workspaceFiles: WorkspaceFileRepository = new LocalWorkspaceFileRepository()
  ) {
    this.configService = new ConfigService();
    this.taskService = new TaskService();
    this.agentHealth = agentHealth || new AgentHealthService();
    this.providerRuntimeManifests = providerRuntimeManifests;
    this.taskEnvelopes = taskEnvelopes;
    this.runLaunchManifests = new RunLaunchManifestService();
    this.workspaceFiles = workspaceFiles;
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
   * Compile the effective launch evidence without creating an attempt or
   * dispatching a provider process.
   */
  async previewAgentLaunch(
    taskId: string,
    agentType?: AgentType,
    options: AgentStartOptions = {}
  ): Promise<RunLaunchManifestPreview> {
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.type !== 'code') throw new Error('Agents can only be started on code tasks');
    if (!task.git?.worktreePath) {
      throw new Error('Task must have an active worktree to start an agent');
    }

    const config = await this.configService.getConfig();
    const profileLaunch = options.profileId
      ? await getAgentProfilePackageService().resolveLaunch(options.profileId)
      : undefined;
    let agent: AgentType;
    let routingReason: string;
    let routingFallback: AgentType | undefined;
    const requestedAgent = profileLaunch ? profileLaunch.agent : (agentType ?? 'auto');
    if (profileLaunch) {
      agent = profileLaunch.agent;
      routingReason = `Agent profile ${profileLaunch.profile.id}@${profileLaunch.profile.version} selected ${agent}.`;
      routingFallback = profileLaunch.profile.runtime.fallbackAgent;
    } else if (!agentType || agentType === 'auto') {
      const result = await getAgentRoutingService().resolveAgent(task);
      agent = result.agent;
      routingReason = result.reason;
      routingFallback = result.fallback;
    } else {
      agent = agentType;
      routingReason = `Operator explicitly selected ${agent}.`;
    }
    const readiness = this.assertLaunchReadiness(task, agent, options.overrideReason);
    const overrideReason = options.overrideReason?.trim();

    const agentConfig = profileLaunch?.agentConfig ?? this.resolveAgentConfig(config.agents, agent);
    const profileAgentConfig =
      profileLaunch && agentConfig
        ? {
            ...agentConfig,
            provider: profileLaunch.profile.runtime.provider ?? agentConfig.provider,
            model: profileLaunch.model ?? agentConfig.model,
          }
        : agentConfig;
    const provider = this.resolveAgentProvider(profileAgentConfig, agent);
    const agentHealth = await this.assertAgentAvailable(agent, profileAgentConfig);
    const adapter = this.resolveProviderAdapter(provider);
    const budgetService = getAgentBudgetService();
    const budgetSources = {
      workspaceBudget: config.features?.budget?.enabled
        ? config.features.budget.defaultRunBudget
        : undefined,
      agentBudget: profileAgentConfig?.budget,
      profileBudget: options.budget ? undefined : profileLaunch?.profile.policy?.budget,
      runBudget: options.budget,
    };
    const budgetPolicy = budgetService.resolve({
      workspaceBudget: budgetSources.workspaceBudget,
      agentBudget: budgetSources.agentBudget,
      runBudget: budgetSources.runBudget ?? profileLaunch?.budget,
    });
    const budgetEvaluation = budgetService.evaluate(
      budgetPolicy,
      { fanOut: 1 },
      {
        taskId,
        agentId: agent,
        actionType: 'agent.launch-preview',
        project: task.project,
      }
    );
    if (this.isBlockingBudgetDecision(budgetEvaluation.decision)) {
      throw new ConflictError('Agent run budget requires operator action before launch', {
        decision: budgetEvaluation.decision,
        thresholdEvents: budgetEvaluation.thresholdEvents,
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
    const harnessSupport = evaluateHarnessSupportStatus(
      launchAgentConfig as AgentConfig,
      agentHealth,
      providerRuntimeManifest
    );
    const requiredRuntimeCapabilities = this.resolveLaunchRuntimeCapabilities(
      profileLaunch,
      budgetPolicy,
      options.requiredRuntimeCapabilities
    );
    const sandboxPolicy = await getSandboxPolicyService().dryRunWithTrace({
      presetId:
        options.sandboxPresetId ??
        profileLaunch?.sandboxPresetId ??
        launchAgentConfig?.sandboxPresetId,
      provider,
      workspacePath: task.git.worktreePath,
      providerRuntimeManifest,
    });
    const attemptId = `preview_${nanoid(8)}`;
    const startedAt = new Date().toISOString();
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const worktreePath = this.expandPath(task.git.worktreePath);
    const taskEnvelope = await this.taskEnvelopes.build({
      task,
      attemptId,
      createdAt: startedAt,
      worktreePath,
      providerRuntimeManifest,
      commitPolicy: resolveTaskCommitPolicy({
        runPolicy: options.commitPolicy,
        taskPolicy: task.executionPolicy,
        legacyAutoCommitOnComplete: config.features?.agents.autoCommitOnComplete,
      }),
      profileInstructions: profileLaunch?.instructions,
      networkAccessEnabled: sandboxPolicy.result.effective.networkAccessEnabled,
      executionPolicy: task.executionPolicy,
    });
    const taskTransport = adapter.renderTaskEnvelope({
      taskEnvelope,
      profileInstructions: profileLaunch?.instructions,
      checkpoint: task.checkpoint,
    });
    const manifest = await this.compileRunLaunchManifest({
      task,
      taskEnvelope,
      taskTransport,
      attemptId,
      startedAt,
      logPath,
      requestedAgent,
      routingReason,
      routingFallback,
      agent,
      launchAgentConfig,
      provider,
      providerRuntimeManifest,
      requiredRuntimeCapabilities,
      harnessSupport,
      profileLaunch,
      readiness,
      overrideReason,
      sandboxPolicy: sandboxPolicy.result,
      budgetPolicy,
      budgetModelOverride: budgetEvaluation.modelOverride,
      budgetSources,
      options,
    });
    const parentAttempt = await this.resolveParentAttempt(task, options.parentAttemptId);
    return {
      manifest,
      ...(parentAttempt
        ? {
            parentAttemptId: parentAttempt.id,
            drift: diffRunLaunchManifests(manifest, parentAttempt.runLaunchManifest),
          }
        : {}),
    };
  }

  /**
   * Start an agent on a task by delegating to Clawdbot
   */
  async startAgent(
    taskId: string,
    agentType?: AgentType,
    options: AgentStartOptions = {}
  ): Promise<AgentStatus> {
    if (startingAgents.has(taskId) || pendingAgents.has(taskId)) {
      throw new ConflictError('An agent is already running or starting for this task');
    }

    startingAgents.add(taskId);
    try {
      return await this.startReservedAgent(taskId, agentType, options);
    } finally {
      startingAgents.delete(taskId);
    }
  }

  private async startReservedAgent(
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
      throw new ConflictError('An agent is already running for this task');
    }

    // Get agent config — use routing engine when agent is "auto" or not specified
    const config = await this.configService.getConfig();
    const profileLaunch = options.profileId
      ? await getAgentProfilePackageService().resolveLaunch(options.profileId)
      : undefined;
    let agent: AgentType;
    let routingReason: string;
    let routingFallback: AgentType | undefined;
    const requestedAgent = profileLaunch ? profileLaunch.agent : (agentType ?? 'auto');

    if (profileLaunch) {
      agent = profileLaunch.agent;
      routingReason = `Agent profile ${profileLaunch.profile.id}@${profileLaunch.profile.version} selected ${agent}.`;
      routingFallback = profileLaunch.profile.runtime.fallbackAgent;
      log.info(
        `[ClawdbotAgent] Profile ${profileLaunch.profile.id}@${profileLaunch.profile.version} selected ${agent} for task ${taskId}`
      );
    } else if (!agentType || agentType === 'auto') {
      const routing = getAgentRoutingService();
      const result = await routing.resolveAgent(task);
      agent = result.agent;
      routingReason = result.reason;
      routingFallback = result.fallback;
      log.info(
        `[ClawdbotAgent] Routing resolved agent for task ${taskId}: ${agent} (${routingReason})`
      );
    } else {
      agent = agentType;
      routingReason = `Operator explicitly selected ${agent}.`;
    }
    const readiness = this.assertLaunchReadiness(task, agent, options.overrideReason);
    const overrideReason = options.overrideReason?.trim();

    const agentConfig = profileLaunch?.agentConfig ?? this.resolveAgentConfig(config.agents, agent);
    const profileAgentConfig =
      profileLaunch && agentConfig
        ? {
            ...agentConfig,
            provider: profileLaunch.profile.runtime.provider ?? agentConfig.provider,
            model: profileLaunch.model ?? agentConfig.model,
          }
        : agentConfig;
    const provider = this.resolveAgentProvider(profileAgentConfig, agent);
    const agentHealth = await this.assertAgentAvailable(agent, profileAgentConfig);
    const adapter = this.resolveProviderAdapter(provider);
    const budgetService = getAgentBudgetService();
    const budgetSources = {
      workspaceBudget: config.features?.budget?.enabled
        ? config.features.budget.defaultRunBudget
        : undefined,
      agentBudget: profileAgentConfig?.budget,
      profileBudget: options.budget ? undefined : profileLaunch?.profile.policy?.budget,
      runBudget: options.budget,
    };
    const budgetPolicy = budgetService.resolve({
      workspaceBudget: budgetSources.workspaceBudget,
      agentBudget: budgetSources.agentBudget,
      runBudget: budgetSources.runBudget ?? profileLaunch?.budget,
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
    const harnessSupport = evaluateHarnessSupportStatus(
      launchAgentConfig as AgentConfig,
      agentHealth,
      providerRuntimeManifest
    );
    const requiredRuntimeCapabilities = this.resolveLaunchRuntimeCapabilities(
      profileLaunch,
      budgetPolicy,
      options.requiredRuntimeCapabilities
    );
    const sandboxPolicy = await getSandboxPolicyService().dryRunWithTrace({
      presetId:
        options.sandboxPresetId ??
        profileLaunch?.sandboxPresetId ??
        launchAgentConfig?.sandboxPresetId,
      provider,
      workspacePath: task.git.worktreePath,
      providerRuntimeManifest,
    });
    const sandboxTrace = await getGovernanceTraceService().record(sandboxPolicy.trace);

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
    const worktreePath = this.expandPath(task.git.worktreePath);
    const commitPolicy = resolveTaskCommitPolicy({
      runPolicy: options.commitPolicy,
      taskPolicy: task.executionPolicy,
      legacyAutoCommitOnComplete: config.features?.agents.autoCommitOnComplete,
    });
    const taskEnvelope = await this.taskEnvelopes.build({
      task,
      attemptId,
      createdAt: startedAt,
      worktreePath,
      providerRuntimeManifest,
      commitPolicy,
      profileInstructions: profileLaunch?.instructions,
      networkAccessEnabled: sandboxPolicy.result.effective.networkAccessEnabled,
      executionPolicy: task.executionPolicy,
    });

    // Validate path segments for log file
    validatePathSegment(taskId);
    validatePathSegment(attemptId);

    const taskTransport = adapter.renderTaskEnvelope({
      taskEnvelope,
      profileInstructions: profileLaunch?.instructions,
      checkpoint: task.checkpoint,
    });
    const runLaunchManifest = await this.compileRunLaunchManifest({
      task,
      taskEnvelope,
      taskTransport,
      attemptId,
      startedAt,
      logPath,
      requestedAgent,
      routingReason,
      routingFallback,
      agent,
      launchAgentConfig,
      provider,
      providerRuntimeManifest,
      requiredRuntimeCapabilities,
      harnessSupport,
      profileLaunch,
      readiness,
      overrideReason,
      sandboxPolicy: sandboxPolicy.result,
      budgetPolicy,
      budgetModelOverride: budgetEvaluation.modelOverride,
      budgetSources,
      options,
    });
    const parentAttempt = await this.resolveParentAttempt(task, options.parentAttemptId);
    const runLaunchManifestDrift = parentAttempt?.runLaunchManifest
      ? diffRunLaunchManifests(runLaunchManifest, parentAttempt.runLaunchManifest)
      : undefined;
    const runLaunchTrace = await getGovernanceTraceService().record({
      kind: 'policy',
      outcome: runLaunchManifest.enforcement.enforceable ? 'allowed' : 'blocked',
      title: 'Run launch manifest compiled',
      summary: runLaunchManifest.enforcement.enforceable
        ? 'The effective run launch manifest is enforceable.'
        : 'The effective run launch manifest contains launch blockers.',
      remediation:
        runLaunchManifest.enforcement.blockers.map((blocker) => blocker.remediation).join(' ') ||
        undefined,
      subject: {
        taskId,
        agentId: agent,
        actionType: 'agent.start',
      },
      evaluatedRules: runLaunchManifest.enforcement.blockers.map((blocker) => ({
        id: blocker.code,
        label: blocker.field,
        type: 'policy',
        status: 'matched',
        outcome: 'blocked',
        message: blocker.detail,
      })),
      raw: {
        runLaunchManifest,
        parentAttemptId: parentAttempt?.id,
        drift: runLaunchManifestDrift,
        sandboxTraceId: sandboxTrace.id,
      },
    });
    this.runLaunchManifests.assertEnforceable(runLaunchManifest);

    // Create event emitter for status updates
    const emitter = new EventEmitter();

    // Store the exact immutable launch evidence before provider dispatch.
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
      harnessSupport,
      taskEnvelope,
      runLaunchManifest,
      runLaunchManifestTraceId: runLaunchTrace.id,
      runLaunchParentAttemptId: parentAttempt?.id,
      runLaunchManifestDrift,
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

    // Initialize log file (ensure it stays within logs dir)
    ensureWithinBase(this.logsDir, logPath);
    await this.initLogFile(
      logPath,
      task,
      agent,
      taskTransport.content,
      providerRuntimeManifest,
      taskEnvelope,
      runLaunchManifest
    );

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
      harnessSupport,
      taskEnvelope,
      runLaunchManifest,
      runLaunchManifestTraceId: runLaunchTrace.id,
      runLaunchParentAttemptId: parentAttempt?.id,
      runLaunchManifestDrift,
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
      harnessSupport: this.harnessTelemetry(harnessSupport),
    });

    try {
      await adapter.start({
        task,
        agentConfig: launchAgentConfig,
        transport: taskTransport,
        logPath,
        attemptId,
        startedAt,
        emitter,
        attempt,
        sandboxPolicy: sandboxPolicy.result,
        runLaunchManifest,
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
        harnessSupport: this.harnessTelemetry(harnessSupport, 'launch-failed'),
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
      provider,
      model: launchAgentConfig?.model,
      providerRuntimeManifest,
      harnessSupport,
      taskEnvelope,
      runLaunchManifest,
      runLaunchParentAttemptId: parentAttempt?.id,
      runLaunchManifestDrift,
      controls: providerRuntimeControls(providerRuntimeManifest),
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
    result: AgentTerminalResult,
    provenance: AgentCompletionProvenance
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (
      !pending ||
      pending.attemptId !== provenance.attemptId ||
      pending.providerRuntimeManifest.digest !== provenance.providerRuntimeManifestDigest
    ) {
      throw new ConflictError('Provider completion does not match the active run', {
        activeAttemptId: pending?.attemptId,
        completionAttemptId: provenance.attemptId,
        activeManifestDigest: pending?.providerRuntimeManifest.digest,
        completionManifestDigest: provenance.providerRuntimeManifestDigest,
        remediation:
          'Discard the stale callback and retry only from the provider process bound to the active attempt manifest.',
      });
    }

    await this.finalizePendingAgent(taskId, pending, async () => result);
  }

  private async finalizePendingAgent(
    taskId: string,
    pending: PendingAgent,
    prepareResult: () => Promise<AgentTerminalResult>
  ): Promise<void> {
    if (pendingAgents.get(taskId) !== pending) {
      throw new ConflictError('Provider finalization does not match the active run', {
        activeAttemptId: pendingAgents.get(taskId)?.attemptId,
        finalizationAttemptId: pending.attemptId,
      });
    }

    const inFlight = finalizingAgents.get(pending);
    if (inFlight) {
      await inFlight;
      return;
    }

    // Defer preparation to the next microtask so the ownership claim is
    // registered before a synchronous provider stop can emit `close`.
    const finalization = Promise.resolve().then(async () => {
      const result = pending.preparedFinalizationResult ?? (await prepareResult());
      pending.preparedFinalizationResult = result;
      await this.completePendingAgent(taskId, result, pending);
    });
    finalizingAgents.set(pending, finalization);
    try {
      await finalization;
    } finally {
      if (finalizingAgents.get(pending) === finalization) {
        finalizingAgents.delete(pending);
      }
    }
  }

  private async completePendingAgent(
    taskId: string,
    result: AgentTerminalResult,
    pending: PendingAgent
  ): Promise<void> {
    await this.assertPendingRunControl(taskId, pending, 'complete');

    const { attemptId, emitter } = pending;
    const status: AttemptStatus = result.success ? 'complete' : 'failed';
    const timing =
      pending.completionTiming ??
      (pending.completionTiming = (() => {
        const endedAt = new Date().toISOString();
        return {
          endedAt,
          durationMs: new Date(endedAt).getTime() - new Date(pending.startedAt).getTime(),
        };
      })());
    if (pending.budget?.enabled && !pending.completionBudgetEvaluated) {
      // Terminal ownership wins over an older usage report. Waiting behind that
      // report can deadlock when it is itself waiting for this finalization.
      if (!budgetEvaluations.has(pending)) {
        await this.evaluatePendingBudget(
          taskId,
          attemptId,
          { runtimeSeconds: Math.ceil(timing.durationMs / 1000) },
          'agent.complete',
          false
        );
      }
      pending.completionBudgetEvaluated = true;
    }

    const preparedCompletion =
      pending.preparedCompletion ??
      (await (async () => {
        const taskBeforeCompletion = (await this.taskService.getTask(taskId)) ?? undefined;
        const completedAttempt: TaskAttempt = {
          id: attemptId,
          agent: pending.agent,
          status,
          started: pending.startedAt,
          ended: timing.endedAt,
          provider: pending.provider,
          model: pending.model,
          threadId: pending.threadId,
          budget: pending.budget,
          agentProfile: pending.agentProfile,
          providerRuntimeManifest: pending.providerRuntimeManifest,
          harnessSupport: pending.harnessSupport,
          taskEnvelope: pending.taskEnvelope,
          runLaunchManifest: pending.runLaunchManifest,
          runLaunchManifestTraceId: pending.runLaunchManifestTraceId,
          runLaunchParentAttemptId: pending.runLaunchParentAttemptId,
          runLaunchManifestDrift: pending.runLaunchManifestDrift,
        };
        return (pending.preparedCompletion = {
          status,
          taskBeforeCompletion,
          completedAttempt,
        });
      })());
    const { taskBeforeCompletion, completedAttempt } = preparedCompletion;

    // Update task and preserve the exact launch manifest in attempt history.
    await this.taskService.updateTask(taskId, {
      status: result.success ? 'done' : 'in-progress',
      attempt: completedAttempt,
      attempts: upsertAttemptHistory(taskBeforeCompletion?.attempts, completedAttempt),
    });
    if (pendingAgents.get(taskId) === pending) {
      pendingAgents.delete(taskId);
    }

    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const summary = result.summary || result.error || 'No summary provided';
    const { durationMs } = timing;
    const completionStepType = result.success ? 'complete' : 'error';
    const requestFile = path.join(getRuntimeDir(), 'agent-requests', `${taskId}.json`);
    const postCommitEffects: Array<[string, () => void | Promise<void>]> = [
      [
        'append result log',
        () =>
          fs.appendFile(logPath, `\n\n---\n\n## Result\n\n**Status:** ${status}\n\n${summary}\n`),
      ],
      ['emit completion event', () => emitter.emit('complete', { status, summary })],
      [
        'record terminal trace step',
        () =>
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
          }),
      ],
      [
        'emit completion telemetry',
        () =>
          getTelemetryService().emit<RunCompletedEvent>({
            type: 'run.completed',
            taskId,
            attemptId,
            agent: pending.agent,
            project: taskBeforeCompletion?.project,
            durationMs,
            success: result.success,
            error: result.error,
            harnessSupport: this.harnessTelemetry(
              pending.harnessSupport,
              result.success ? 'none' : 'run-failed'
            ),
          }),
      ],
      [
        'complete trace',
        () => getTraceService().completeTrace(attemptId, result.success ? 'completed' : 'failed'),
      ],
      [
        'record completion activity',
        () =>
          activityService.logActivity(
            'agent_completed',
            taskId,
            taskBeforeCompletion?.title || taskId,
            {
              attemptId,
              provider: pending.provider,
              model: pending.model,
              success: result.success,
              summary,
            },
            pending.agent
          ),
      ],
      [
        'remove request file',
        async () => {
          try {
            await fs.unlink(requestFile);
          } catch {
            // Ignore if already deleted.
          }
        },
      ],
    ];
    for (const [effect, run] of postCommitEffects) {
      try {
        await run();
      } catch (error) {
        log.error(
          { err: error, taskId, attemptId, effect },
          '[ClawdbotAgent] Post-commit completion effect failed'
        );
      }
    }

    log.info(`[ClawdbotAgent] Task ${taskId} completed with status: ${status}`);
  }

  /**
   * Stop a running agent
   */
  async stopAgent(taskId: string, expectedAttemptId: string): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending || pending.attemptId !== expectedAttemptId) {
      throw new ConflictError('Stop request does not match the active run', {
        activeAttemptId: pending?.attemptId,
        requestedAttemptId: expectedAttemptId,
      });
    }

    await this.finalizePendingAgent(taskId, pending, async () => {
      await this.assertPendingRunControl(taskId, pending, 'stop');
      await this.resolveProviderAdapter(pending.provider).stop({ taskId, pending });
      this.recordTraceStep(pending.attemptId, 'abort', {
        eventType: 'run.aborted',
        summary: 'Stopped by user',
        reason: 'Stopped by user',
        agent: pending.agent,
        provider: pending.provider,
        model: pending.model,
      });
      return {
        success: false,
        error: 'Stopped by user',
      };
    });
  }

  async sendMessage(
    taskId: string,
    message: string,
    options: AgentMessageOptions
  ): Promise<AgentMessageDelivery> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      throw new Error('No agent running for this task');
    }

    await this.assertActiveRunControl(taskId, 'message', options.expectedAttemptId);

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

  async recordBudgetUsage(
    taskId: string,
    attemptId: string,
    delta: Partial<AgentBudgetUsage>
  ): Promise<void> {
    await this.evaluatePendingBudget(taskId, attemptId, delta, 'agent.usage', true);
  }

  private isBlockingBudgetDecision(decision: AgentBudgetDecision): boolean {
    return decision === 'pause' || decision === 'require-approval' || decision === 'cancel';
  }

  private async serializeBudgetEvaluation<T>(
    pending: PendingAgent,
    evaluate: () => Promise<T>
  ): Promise<T> {
    const previous = budgetEvaluations.get(pending) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(evaluate);
    const tail = current.then(
      () => undefined,
      () => undefined
    );
    budgetEvaluations.set(pending, tail);
    try {
      return await current;
    } finally {
      if (budgetEvaluations.get(pending) === tail) {
        budgetEvaluations.delete(pending);
      }
    }
  }

  private async evaluatePendingBudget(
    taskId: string,
    attemptId: string,
    delta: Partial<AgentBudgetUsage>,
    actionType: string,
    enforce: boolean
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Budget usage does not match the active run', {
        activeAttemptId: pending?.attemptId,
        usageAttemptId: attemptId,
      });
    }
    if (!pending?.budget?.enabled || !pending.budget.policy) return;

    const evaluation = await this.serializeBudgetEvaluation(
      pending,
      async (): Promise<AgentBudgetEvaluation> => {
        const task = await this.taskService.getTask(taskId);
        if (pendingAgents.get(taskId) !== pending || !pending.budget?.policy) {
          throw new ConflictError('Budget usage does not match the active run', {
            activeAttemptId: pendingAgents.get(taskId)?.attemptId,
            usageAttemptId: attemptId,
          });
        }
        const budgetService = getAgentBudgetService();
        const usage = budgetService.mergeUsage(pending.budget.usage, delta);
        const nextEvaluation = budgetService.evaluate(pending.budget.policy, usage, {
          taskId,
          agentId: pending.agent,
          actionType,
          project: task?.project,
        });

        let traceId: string | undefined;
        if (nextEvaluation.trace) {
          traceId = (await getGovernanceTraceService().record(nextEvaluation.trace)).id;
        }
        if (pendingAgents.get(taskId) !== pending || !pending.budget) {
          throw new ConflictError('Budget usage does not match the active run', {
            activeAttemptId: pendingAgents.get(taskId)?.attemptId,
            usageAttemptId: attemptId,
          });
        }

        pending.budget.usage = usage;
        pending.budget.decision = nextEvaluation.decision;
        pending.budget.modelOverride ??= nextEvaluation.modelOverride;
        pending.budget.thresholdEvents = mergeThresholdEvents(
          pending.budget.thresholdEvents,
          nextEvaluation.thresholdEvents
        );
        if (traceId) {
          pending.budget.traceIds = [...new Set([...pending.budget.traceIds, traceId])];
        }
        return nextEvaluation;
      }
    );

    if (!enforce || pending.budgetStopped || !this.isBlockingBudgetDecision(evaluation.decision)) {
      return;
    }

    pending.budgetStopped = true;
    await this.finalizePendingAgent(taskId, pending, async () => {
      const logPath = path.join(this.logsDir, `${taskId}_${pending.attemptId}.md`);
      await this.appendLog(
        logPath,
        `\n## Budget Enforcement\n\nDecision: ${evaluation.decision}\n\n${evaluation.thresholdEvents
          .map((event) => `- ${event.message}`)
          .join('\n')}\n`
      );
      await this.resolveProviderAdapter(pending.provider).stop({ taskId, pending });
      return {
        success: false,
        error: `Budget ${evaluation.decision}: ${evaluation.thresholdEvents
          .map((event) => event.message)
          .join(' ')}`,
      };
    });
  }

  private resolveLaunchRuntimeCapabilities(
    profileLaunch: AgentProfileResolvedLaunch | undefined,
    budgetPolicy: AgentBudgetPolicy | undefined,
    requiredRuntimeCapabilities: ProviderRuntimeCapabilityId[] | undefined
  ): ProviderRuntimeCapabilityId[] {
    const launchRuntimeCapabilities = new Set<ProviderRuntimeCapabilityId>([
      ...BASELINE_LAUNCH_CAPABILITIES,
      ...(requiredRuntimeCapabilities ?? []),
    ]);
    if ((profileLaunch?.profile.tools?.allowed?.length ?? 0) > 0) {
      launchRuntimeCapabilities.add('tool.calls');
    }
    if ((profileLaunch?.profile.tools?.mcpServers?.length ?? 0) > 0) {
      launchRuntimeCapabilities.add('tool.calls');
      launchRuntimeCapabilities.add('tool.mcp');
    }
    const budgetLimits = budgetPolicy?.enabled ? budgetPolicy.limits : undefined;
    if (
      budgetLimits?.inputTokens !== undefined ||
      budgetLimits?.outputTokens !== undefined ||
      budgetLimits?.totalTokens !== undefined ||
      budgetLimits?.costUsd !== undefined
    ) {
      launchRuntimeCapabilities.add('usage.tokens');
    }
    if (budgetLimits?.toolCalls !== undefined) launchRuntimeCapabilities.add('tool.calls');
    return [...launchRuntimeCapabilities].sort((left, right) => left.localeCompare(right));
  }

  private assertLaunchReadiness(
    task: Task,
    agent: AgentType,
    overrideReason: string | undefined
  ): TaskReadinessSummary {
    const readiness = evaluateTaskReadiness(task, { isCodeTask: true, selectedAgent: agent });
    const normalizedOverrideReason = overrideReason?.trim();
    if (!readiness.ready && !normalizedOverrideReason) {
      throw new AgentReadinessError(readiness);
    }
    if (!readiness.ready && normalizedOverrideReason && normalizedOverrideReason.length < 8) {
      throw new AgentReadinessError(
        readiness,
        'Task readiness override reason must be at least 8 characters'
      );
    }
    return readiness;
  }

  private resolveAgentConfig(agents: AgentConfig[], agent: AgentType): AgentConfig | undefined {
    return agents.find((a) => a.type === agent);
  }

  async probeProviderRuntime(
    agentConfig: AgentConfig,
    agent: AgentType = agentConfig.type,
    surface: ProviderRuntimeSurface = 'task'
  ): Promise<ProviderRuntimeManifest> {
    const provider = this.resolveAgentProvider(agentConfig, agent);
    const health = await this.assertAgentAvailable(agent, agentConfig);
    return this.resolveProviderAdapter(provider, surface).probe({ agentConfig, health });
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
    let provider: ExecutableAgentProvider | undefined;
    if (agentConfig?.provider) {
      if (
        agentConfig.provider === 'openclaw' ||
        agentConfig.provider === 'codex-sdk' ||
        agentConfig.provider === 'codex-cli' ||
        agentConfig.provider === 'hermes-cli'
      ) {
        provider = agentConfig.provider;
      } else {
        throw new ConflictError(
          `Provider "${agentConfig.provider}" is configured but has no execution adapter`,
          {
            agent,
            provider: agentConfig.provider,
            reason: 'No executable provider adapter is registered',
          }
        );
      }
    } else if (
      agent === 'codex' &&
      path.basename(agentConfig?.command.trim().split(/\s+/)[0] ?? '') === 'codex'
    ) {
      provider = 'codex-cli';
    } else if (
      agent === 'hermes' &&
      path.basename(agentConfig?.command.trim().split(/\s+/)[0] ?? '') === 'hermes'
    ) {
      provider = 'hermes-cli';
    }

    if (!provider) {
      throw new ConflictError(`Agent "${agent}" has no executable provider adapter`, {
        agent,
        command: agentConfig?.command,
        reason: 'No executable provider adapter is configured',
        remediation:
          'Select an agent profile with an explicit executable provider or configure a supported adapter.',
      });
    }

    // Adapter identity is derived from system-owned profile definitions at the
    // dispatch boundary. A caller-provided supportProfile may carry future
    // certification evidence, but it cannot authorize a different adapter.
    const profile = agentConfig ? normalizeHarnessSupportProfile(agentConfig) : undefined;
    if (profile?.supportTier === 'degraded') {
      throw new ConflictError(
        `Harness support profile "${profile.id}" has an unsafe launch configuration`,
        {
          agent,
          profileId: profile.id,
          adapterId: profile.adapterId,
          provider,
          reason: 'Credential material is not allowed in harness launch commands or arguments',
          remediation: profile.remediation,
        }
      );
    }
    if (profile && profile.adapterId !== provider) {
      throw new ConflictError(
        `Harness support profile "${profile.id}" cannot dispatch through "${provider}"`,
        {
          agent,
          profileId: profile.id,
          adapterId: profile.adapterId,
          provider,
          reason: profile.adapterId
            ? 'Harness support profile adapter does not match the configured provider'
            : 'Harness support profile has no executable adapter',
          remediation: profile.remediation,
        }
      );
    }

    return provider;
  }

  private resolveProviderAdapter(
    provider: ExecutableAgentProvider,
    surface: ProviderRuntimeSurface = 'task'
  ): AgentProviderAdapter {
    const definition = getProviderRuntimeAdapterDefinition(provider, surface);
    const probe = (context: AgentProviderProbeContext) =>
      this.providerRuntimeManifests.probe(
        this.buildProviderRuntimeProbeRequest(provider, context, definition)
      );

    if (provider === 'codex-cli') {
      return {
        id: definition.id,
        label: definition.label,
        renderTaskEnvelope: renderCodexCliTaskEnvelope,
        probe,
        start: ({
          task,
          agentConfig,
          transport,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
          runLaunchManifest,
        }) => {
          this.assertProviderAdapterTransport(provider, transport, runLaunchManifest);
          this.startCodexCli(
            task,
            agentConfig,
            transport.content,
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
        renderTaskEnvelope: renderCodexSdkTaskEnvelope,
        probe,
        start: ({
          task,
          agentConfig,
          transport,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
          runLaunchManifest,
        }) => {
          this.assertProviderAdapterTransport(provider, transport, runLaunchManifest);
          const abortController = new AbortController();
          const pending = pendingAgents.get(task.id);
          if (pending) pending.abortController = abortController;
          void this.startCodexSdk(
            task,
            agentConfig,
            transport.content,
            logPath,
            attemptId,
            startedAt,
            emitter,
            abortController,
            sandboxPolicy
          ).catch(async (error: unknown) => {
            const current = pendingAgents.get(task.id);
            if (!current || current.attemptId !== attemptId) return;
            abortController.abort();
            const message = error instanceof Error ? error.message : 'Codex SDK attempt failed';
            try {
              await this.appendLog(logPath, `\n## Codex SDK Error\n\n${message}\n`);
            } catch (logError) {
              log.error({ err: logError, taskId: task.id }, 'Failed to append Codex SDK error');
            }
            try {
              await this.completeAgent(
                task.id,
                { success: false, error: message },
                {
                  attemptId,
                  providerRuntimeManifestDigest: current.providerRuntimeManifest.digest,
                }
              );
            } catch (finalizationError) {
              if (pendingAgents.get(task.id)?.attemptId === attemptId) {
                pendingAgents.delete(task.id);
              }
              if (emitter.listenerCount('error') > 0) {
                emitter.emit('error', finalizationError);
              }
              log.error(
                { err: finalizationError, taskId: task.id, attemptId },
                'Codex SDK failure could not update stale persisted attempt state'
              );
            }
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
        renderTaskEnvelope: renderHermesTaskEnvelope,
        probe,
        start: ({
          task,
          agentConfig,
          transport,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
          runLaunchManifest,
        }) => {
          this.assertProviderAdapterTransport(provider, transport, runLaunchManifest);
          this.startHermesCli(
            task,
            agentConfig,
            transport.content,
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
      renderTaskEnvelope: renderOpenClawTaskEnvelope,
      probe,
      start: async ({ transport, task, attemptId, agentConfig, runLaunchManifest }) => {
        this.assertProviderAdapterTransport(provider, transport, runLaunchManifest);
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
          prompt: transport.content,
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

  private assertProviderAdapterLaunchManifest(
    provider: ExecutableAgentProvider,
    manifest: RunLaunchManifest
  ): void {
    this.runLaunchManifests.assertEnforceable(manifest);
    if (manifest.providerRuntime.provider !== provider) {
      throw new ConflictError('Run launch manifest provider does not match the selected adapter.', {
        manifestProvider: manifest.providerRuntime.provider,
        adapterProvider: provider,
      });
    }
    if (
      manifest.tools.allowed.length > 0 ||
      manifest.tools.denied.length > 0 ||
      manifest.tools.policyIds.length > 0 ||
      manifest.tools.mcpServers.length > 0
    ) {
      throw new ConflictError(
        'The selected adapter cannot inject the manifest tool and MCP catalog.',
        {
          provider,
          manifestDigest: manifest.digest,
          remediation:
            'Use a run-scoped tool-control adapter after the tool-server control plane is enabled.',
        }
      );
    }
  }

  private assertProviderAdapterTransport(
    provider: ExecutableAgentProvider,
    transport: ProviderTaskEnvelopeTransport,
    manifest: RunLaunchManifest
  ): void {
    this.assertProviderAdapterLaunchManifest(provider, manifest);
    if (
      transport.provider !== provider ||
      transport.taskEnvelopeDigest !== manifest.taskEnvelope.digest
    ) {
      throw new ConflictError(
        'Provider task-envelope transport does not match the selected launch manifest.',
        {
          adapterProvider: provider,
          transportProvider: transport.provider,
          transportTaskEnvelopeDigest: transport.taskEnvelopeDigest,
          manifestTaskEnvelopeDigest: manifest.taskEnvelope.digest,
        }
      );
    }
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
      if (!pending || pendingAgents.get(task.id) !== pending || pending.attemptId !== attemptId) {
        return;
      }
      void this.finalizePendingAgent(task.id, pending, async () => {
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

        return {
          success,
          summary: finalOutput || (success ? 'Hermes completed.' : undefined),
          error: success ? undefined : finalOutput || `Hermes exited with code ${code}`,
        };
      }).catch((error) => {
        if (pendingAgents.get(task.id) !== pending) return;
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
    let eventProcessing = Promise.resolve();
    let eventProcessingError: Error | undefined;
    const enqueueEventProcessing = (work: () => Promise<void>) => {
      eventProcessing = eventProcessing.then(async () => {
        if (eventProcessingError) return;
        try {
          await work();
        } catch (error) {
          eventProcessingError =
            error instanceof Error ? error : new Error('Provider event ingestion failed closed.');
          child.kill('SIGTERM');
        }
      });
    };

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      enqueueEventProcessing(async () => {
        await this.assertPendingManifestSnapshotForAttempt(task.id, attemptId);
        this.recordStreamChunk(task, attemptId, agentConfig, 'codex-cli', 'stdout', chunk);
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          const parsed = await this.handleCodexJsonLine(
            line,
            logPath,
            task,
            attemptId,
            agentConfig
          );
          if (parsed.summary) finalSummary = parsed.summary;
          if (parsed.usage) tokenUsage = parsed.usage;
        }
      });
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      enqueueEventProcessing(async () => {
        await this.assertPendingManifestSnapshotForAttempt(task.id, attemptId);
        stderrBuffer += chunk;
        this.recordStreamChunk(task, attemptId, agentConfig, 'codex-cli', 'stderr', chunk);
        await this.appendLog(logPath, `\n### stderr\n\n\`\`\`\n${chunk.trimEnd()}\n\`\`\`\n`);
      });
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
      if (!pending || pendingAgents.get(task.id) !== pending || pending.attemptId !== attemptId) {
        return;
      }
      void this.finalizePendingAgent(task.id, pending, async () => {
        await eventProcessing;
        if (stdoutBuffer.trim() && !eventProcessingError) {
          const parsed = await this.handleCodexJsonLine(
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
        finalSummary ||= eventProcessingError?.message || '';
        finalSummary ||=
          code === 0 ? 'Codex completed without a final summary.' : stderrBuffer.trim();
        const succeeded = code === 0 && !eventProcessingError;

        if (tokenUsage && !eventProcessingError) {
          await this.assertRunControl(task.id, 'token-usage', attemptId);
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
            attemptId,
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
          success: succeeded,
          durationMs: Date.now() - new Date(startedAt).getTime(),
          provider: 'codex-cli',
          agent: agentConfig?.type || 'codex',
          model: agentConfig?.model,
        });

        return {
          success: succeeded,
          summary: finalSummary,
          error: succeeded ? undefined : finalSummary || `Codex exited with code ${code}`,
        };
      }).catch((error) => {
        if (pendingAgents.get(task.id) !== pending) return;
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

    const sdkExecutable = this.resolveCodexSdkExecutable(agentConfig);
    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({
      codexPathOverride: sdkExecutable.codexPathOverride,
      env: buildSafeCodexEnv(process.env, sandboxPolicy?.effective.envPassthrough),
    });

    const thread = codex.startThread({
      workingDirectory: worktreePath,
      ...this.buildCodexSdkThreadSettings(sandboxPolicy),
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
      const parsed = await this.handleCodexEvent(event, logPath, task, attemptId, agentConfig);
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
      await this.assertRunControl(task.id, 'token-usage', attemptId);
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
        attemptId,
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

    await this.completeAgent(
      task.id,
      {
        success: !failureMessage,
        summary: finalSummary || failureMessage || 'Codex SDK completed without a final summary.',
        error: failureMessage || undefined,
      },
      {
        attemptId,
        providerRuntimeManifestDigest:
          pendingAgents.get(task.id)?.providerRuntimeManifest.digest ?? '',
      }
    );
    emitter.emit('sdk.complete', { taskId: task.id, attemptId });
  }

  private async handleCodexJsonLine(
    line: string,
    logPath: string,
    task?: Task,
    attemptId?: string,
    agentConfig?: AgentConfig
  ): Promise<{
    summary?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens?: number;
      cost?: number;
      model?: string;
    };
  }> {
    const trimmed = line.trim();
    if (!trimmed) return {};

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      await this.appendLog(logPath, `\n### stdout\n\n\`\`\`\n${trimmed}\n\`\`\`\n`);
      return { summary: trimmed };
    }
    return this.handleCodexEvent(event, logPath, task, attemptId, agentConfig);
  }

  private async handleCodexEvent(
    event: ThreadEvent | Record<string, unknown>,
    logPath: string,
    task?: Task,
    attemptId?: string,
    agentConfig?: AgentConfig
  ): Promise<{
    summary?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens?: number;
      cost?: number;
      model?: string;
    };
  }> {
    if (task && attemptId) {
      await this.assertPendingManifestSnapshotForAttempt(task.id, attemptId);
    }
    const record = event as Record<string, unknown>;
    const type = String(record.type || record.event || 'codex.event');
    const summary = this.extractCodexSummary(record);
    const usage = this.extractCodexUsage(record);
    if (usage && task) {
      assertProviderRuntimeControl(
        pendingAgents.get(task.id)?.providerRuntimeManifest,
        'token-usage'
      );
    }
    await this.appendLog(
      logPath,
      `\n### ${type}\n\n${summary ? `${summary}\n\n` : ''}<details><summary>Raw event</summary>\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n\n</details>\n`
    );
    if (task && attemptId) {
      await this.recordCodexEvent(task, attemptId, agentConfig, type, record, summary);
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

  private harnessTelemetry(
    status: HarnessSupportStatus,
    failureClass: HarnessSupportTelemetry['failureClass'] = status.failureClass
  ): HarnessSupportTelemetry {
    return {
      profileId: status.profileId,
      ...(status.adapterId ? { adapterId: status.adapterId } : {}),
      ...(status.providerVersion ? { providerVersion: status.providerVersion } : {}),
      ...(status.providerBuild ? { providerBuild: status.providerBuild } : {}),
      ...(status.manifestDigest ? { manifestDigest: status.manifestDigest } : {}),
      supportTier: status.supportTier,
      failureClass,
    };
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
      await this.assertRunControl(task.id, 'tool-calls', attemptId);
      await this.evaluatePendingBudget(task.id, attemptId, { toolCalls: 1 }, 'agent.tool', true);
    }

    if (files.length > 0) {
      await this.assertRunControl(task.id, 'artifacts', attemptId);
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
    await this.assertRunControl(task.id, 'artifacts', attemptId);
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

    await this.assertRunControl(task.id, 'artifacts', attemptId);
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
  async getAgentStatus(taskId: string): Promise<AgentStatus | null> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      return null;
    }
    await this.assertPendingRunControl(taskId, pending, 'status');

    return {
      taskId,
      attemptId: pending.attemptId,
      agent: pending.agent,
      status: 'running',
      startedAt: pending.startedAt,
      provider: pending.provider,
      model: pending.model,
      providerRuntimeManifest: pending.providerRuntimeManifest,
      harnessSupport: pending.harnessSupport,
      taskEnvelope: pending.taskEnvelope,
      runLaunchManifest: pending.runLaunchManifest,
      runLaunchParentAttemptId: pending.runLaunchParentAttemptId,
      runLaunchManifestDrift: pending.runLaunchManifestDrift,
      controls: providerRuntimeControls(pending.providerRuntimeManifest),
    };
  }

  async assertRunControl(
    taskId: string,
    action: ProviderRuntimeControlAction,
    attemptId?: string
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (pending && (!attemptId || attemptId === pending.attemptId)) {
      await this.assertPendingRunControl(taskId, pending, action);
      return;
    }

    const task = await this.taskService.getTask(taskId);
    const attempts = [task?.attempt, ...(task?.attempts ?? [])].filter(
      (attempt): attempt is TaskAttempt => Boolean(attempt)
    );
    const attempt = attemptId
      ? attempts.find((candidate) => candidate.id === attemptId)
      : task?.attempt;
    assertProviderRuntimeControl(attempt?.providerRuntimeManifest, action);
  }

  async assertActiveRunControl(
    taskId: string,
    action: ProviderRuntimeControlAction,
    attemptId: string,
    expectedManifestDigest?: string
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (
      !pending ||
      pending.attemptId !== attemptId ||
      (expectedManifestDigest && pending.providerRuntimeManifest.digest !== expectedManifestDigest)
    ) {
      throw new ConflictError('Run control does not match the active attempt', {
        action,
        activeAttemptId: pending?.attemptId,
        requestedAttemptId: attemptId,
        activeManifestDigest: pending?.providerRuntimeManifest.digest,
        expectedManifestDigest,
      });
    }
    await this.assertPendingRunControl(taskId, pending, action);
  }

  private async assertPendingRunControl(
    taskId: string,
    pending: PendingAgent,
    action: ProviderRuntimeControlAction
  ): Promise<void> {
    await this.assertPendingManifestSnapshot(taskId, pending, action);
    assertProviderRuntimeControl(pending.providerRuntimeManifest, action);
  }

  private async assertPendingManifestSnapshotForAttempt(
    taskId: string,
    attemptId: string
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError(
        'Provider runtime manifest is stale or invalid: provider event does not match the active attempt',
        {
          activeAttemptId: pending?.attemptId,
          eventAttemptId: attemptId,
          remediation:
            'Terminate the detached provider through its host supervisor, reconcile persisted attempt state, and launch again.',
        }
      );
    }
    await this.assertPendingManifestSnapshot(taskId, pending, 'status');
  }

  private async assertPendingManifestSnapshot(
    taskId: string,
    pending: PendingAgent,
    action: ProviderRuntimeControlAction
  ): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    const persistedAttempt = task?.attempt;
    if (!persistedAttempt || persistedAttempt.id !== pending.attemptId) {
      throw new ConflictError(
        'Provider runtime manifest is stale or invalid: active attempt does not match persisted state',
        {
          action,
          activeAttemptId: pending.attemptId,
          persistedAttemptId: persistedAttempt?.id,
          remediation:
            'Terminate the detached provider through its host supervisor, reconcile persisted attempt state, and launch again.',
        }
      );
    }
    assertProviderRuntimeManifestSnapshot(
      persistedAttempt.providerRuntimeManifest,
      pending.providerRuntimeManifest.digest
    );
    assertProviderRuntimeManifestSnapshot(
      pending.providerRuntimeManifest,
      persistedAttempt.providerRuntimeManifest?.digest
    );
    if (
      !persistedAttempt.runLaunchManifest ||
      persistedAttempt.runLaunchManifest.digest !== pending.runLaunchManifest.digest
    ) {
      throw new ConflictError(
        'Run launch manifest is stale or invalid: persisted launch evidence does not match the active run',
        {
          action,
          activeRunLaunchManifestDigest: pending.runLaunchManifest.digest,
          persistedRunLaunchManifestDigest: persistedAttempt.runLaunchManifest?.digest,
          remediation:
            'Terminate the detached provider, reconcile persisted attempt state, and launch again.',
        }
      );
    }
    this.runLaunchManifests.assertEnforceable(persistedAttempt.runLaunchManifest);
    this.runLaunchManifests.assertEnforceable(pending.runLaunchManifest);
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
    await this.assertRunControl(taskId, 'logs', attemptId);
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

  private async compileRunLaunchManifest(input: {
    task: Task;
    taskEnvelope: TaskEnvelope;
    taskTransport: ProviderTaskEnvelopeTransport;
    attemptId: string;
    startedAt: string;
    logPath: string;
    requestedAgent: AgentType;
    routingReason: string;
    routingFallback?: AgentType;
    agent: AgentType;
    launchAgentConfig?: AgentConfig;
    provider: ExecutableAgentProvider;
    providerRuntimeManifest: ProviderRuntimeManifest;
    requiredRuntimeCapabilities: ProviderRuntimeCapabilityId[];
    harnessSupport: HarnessSupportStatus;
    profileLaunch?: AgentProfileResolvedLaunch;
    readiness: TaskReadinessSummary;
    overrideReason?: string;
    sandboxPolicy: SandboxPolicyDryRunResult;
    budgetPolicy?: AgentBudgetPolicy;
    budgetModelOverride?: string;
    budgetSources: {
      workspaceBudget?: AgentBudgetPolicy;
      agentBudget?: AgentBudgetPolicy;
      profileBudget?: AgentBudgetPolicy;
      runBudget?: AgentBudgetPolicy;
    };
    options: AgentStartOptions;
  }): Promise<RunLaunchManifest> {
    const profile = input.profileLaunch?.profile;
    const hasToolRestrictions =
      (profile?.tools?.allowed?.length ?? 0) > 0 ||
      (profile?.policy?.toolPolicyIds?.length ?? 0) > 0;
    const hasMcpRestrictions = (profile?.tools?.mcpServers?.length ?? 0) > 0;
    const hasPermissionRequirements =
      Boolean(profile?.permissions?.level) || (profile?.permissions?.required?.length ?? 0) > 0;
    const requiredHealthChecks = (profile?.health?.checks ?? [])
      .filter((check) => check.required)
      .map((check) => check.id);
    const selectedSkills = (profile?.tools?.allowed ?? []).filter((tool) =>
      /^skill(?::|\/)/i.test(tool)
    );
    const selectedSharedResources = [
      ...(profile?.instructions?.promptFile
        ? [`instruction-file:${profile.instructions.promptFile}`]
        : []),
      ...(profile?.instructions?.files ?? []).map((file) => `instruction-file:${file}`),
      ...(profile?.workflow?.id ? [`workflow:${profile.workflow.id}`] : []),
      ...(profile?.workflow?.entrypoint
        ? [`workflow-entrypoint:${profile.workflow.entrypoint}`]
        : []),
    ];
    const runtime = this.buildRunLaunchRuntime(
      input.provider,
      input.launchAgentConfig,
      input.task.id,
      input.logPath,
      input.attemptId,
      input.sandboxPolicy
    );
    const worktreePath = input.task.git?.worktreePath
      ? this.expandPath(input.task.git.worktreePath)
      : undefined;
    const repositoryInstructions = worktreePath
      ? ((await this.workspaceFiles.readOptionalText(worktreePath, 'AGENTS.md')) ?? '')
      : '';
    const hasRepositoryInstructions = Boolean(repositoryInstructions.trim());
    const instructions = [
      {
        id: 'effective-task-request',
        kind: 'task' as const,
        content: input.taskTransport.content,
        materialContent: this.normalizeRunLaunchTaskPrompt(
          input.taskTransport.content,
          input.attemptId,
          worktreePath,
          input.taskEnvelope.digest,
          input.providerRuntimeManifest.digest
        ),
        origin:
          `task-envelope:${input.taskEnvelope.schemaVersion};` +
          `adapter:${input.taskTransport.provider}`,
        precedence: 100,
      },
      ...(hasRepositoryInstructions
        ? [
            {
              id: 'repository:AGENTS.md',
              kind: 'repository' as const,
              content: repositoryInstructions,
              origin: 'repository:AGENTS.md',
              precedence: 150,
            },
          ]
        : []),
      ...(input.profileLaunch?.instructions
        ? [
            {
              id: `agent-profile:${profile?.id ?? 'unknown'}`,
              kind: 'profile' as const,
              content: input.profileLaunch.instructions,
              origin: `agent-profile:${profile?.id ?? 'unknown'}@${profile?.version ?? 'unknown'}`,
              precedence: 200,
            },
          ]
        : []),
    ];
    const sandboxOrigin: Omit<RunLaunchManifestOrigin, 'field'> = {
      scope: input.options.sandboxPresetId
        ? 'run'
        : profile?.policy?.sandboxPresetId
          ? 'agent-profile'
          : input.launchAgentConfig?.sandboxPresetId
            ? 'provider'
            : 'system-default',
      source: input.options.sandboxPresetId
        ? `operator-sandbox:${input.sandboxPolicy.preset.id}`
        : profile?.policy?.sandboxPresetId
          ? `agent-profile:${profile.id}@${profile.version}`
          : input.launchAgentConfig?.sandboxPresetId
            ? `agent-config:${input.agent}`
            : `sandbox-default:${input.sandboxPolicy.preset.id}`,
      precedence: input.options.sandboxPresetId
        ? 300
        : profile?.policy?.sandboxPresetId
          ? 200
          : input.launchAgentConfig?.sandboxPresetId
            ? 100
            : 0,
    };
    const sandboxAffectsRuntimeArgs =
      input.provider === 'codex-cli' || input.provider === 'codex-sdk';
    const sandboxAffectsEnvironment =
      input.provider !== 'openclaw' && input.sandboxPolicy.effective.envPassthrough.length > 0;
    const sandboxAffectsCredentials =
      input.provider !== 'openclaw' && input.sandboxPolicy.effective.credentialRefs.length > 0;
    const origins = [
      {
        field: 'taskEnvelope',
        scope: 'task-envelope' as const,
        source: `task-envelope:${input.taskEnvelope.schemaVersion}`,
        precedence: 100,
      },
      {
        field: 'providerRuntime',
        scope: 'provider' as const,
        source: `provider-runtime:${input.providerRuntimeManifest.provider}:${input.providerRuntimeManifest.probeRevision}`,
        precedence: 100,
      },
      {
        field: 'providerRequirements',
        scope: 'provider',
        source: `provider-capabilities:${input.providerRuntimeManifest.provider}:${input.providerRuntimeManifest.probeRevision}`,
        precedence: 100,
      },
      {
        field: 'providerRequirements',
        scope: 'system-default',
        source: 'baseline-launch-capabilities',
        precedence: 0,
      },
      ...((profile?.tools?.allowed?.length ?? 0) > 0 ||
      (profile?.tools?.mcpServers?.length ?? 0) > 0
        ? [
            {
              field: 'providerRequirements',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile?.id}@${profile?.version}`,
              precedence: 200,
            },
          ]
        : []),
      ...(this.budgetRequiresRuntimeEvidence(input.budgetSources.workspaceBudget)
        ? [
            {
              field: 'providerRequirements',
              scope: 'workspace' as const,
              source: 'workspace-budget',
              precedence: 50,
            },
          ]
        : []),
      ...(this.budgetRequiresRuntimeEvidence(input.budgetSources.agentBudget)
        ? [
            {
              field: 'providerRequirements',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}:budget`,
              precedence: 100,
            },
          ]
        : []),
      ...(this.budgetRequiresRuntimeEvidence(input.budgetSources.profileBudget)
        ? [
            {
              field: 'providerRequirements',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile?.id}@${profile?.version}:budget`,
              precedence: 200,
            },
          ]
        : []),
      ...(this.budgetRequiresRuntimeEvidence(input.budgetSources.runBudget)
        ? [
            {
              field: 'providerRequirements',
              scope: 'run' as const,
              source: 'operator-run-budget',
              precedence: 300,
            },
          ]
        : []),
      ...(input.options.requiredRuntimeCapabilities?.length
        ? [
            {
              field: 'providerRequirements',
              scope: 'run' as const,
              source: 'operator-required-capabilities',
              precedence: 300,
            },
          ]
        : []),
      {
        field: 'harnessSupport',
        scope: 'provider',
        source: `harness-support:${input.harnessSupport.profileId}`,
        precedence: 100,
      },
      {
        field: 'instructions.effective-task-request',
        scope: 'task-envelope',
        source: `task-envelope:${input.taskEnvelope.schemaVersion}`,
        precedence: 100,
      },
      {
        field: 'instructions.effective-task-request',
        scope: 'provider',
        source: `adapter:${input.taskTransport.provider}:task-envelope-transport`,
        precedence: 110,
      },
      ...(hasRepositoryInstructions
        ? [
            {
              field: 'instructions.repository:AGENTS.md',
              scope: 'workspace' as const,
              source: 'repository:AGENTS.md',
              precedence: 150,
            },
          ]
        : []),
      ...(input.profileLaunch?.instructions
        ? [
            {
              field: `instructions.agent-profile:${profile?.id ?? 'unknown'}`,
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile?.id}@${profile?.version}`,
              precedence: 200,
            },
          ]
        : []),
      {
        field: 'readiness',
        scope: 'system-default',
        source: 'task-readiness-policy',
        precedence: 0,
      },
      ...(!input.readiness.ready && input.overrideReason
        ? [
            {
              field: 'readiness',
              scope: 'run' as const,
              source: 'operator-readiness-override',
              precedence: 300,
            },
          ]
        : []),
      {
        field: 'routing',
        scope: input.profileLaunch
          ? ('agent-profile' as const)
          : input.requestedAgent === 'auto'
            ? ('workspace' as const)
            : ('run' as const),
        source: input.profileLaunch
          ? `agent-profile:${profile?.id}@${profile?.version}`
          : input.requestedAgent === 'auto'
            ? 'agent-routing:auto'
            : `operator-selection:${input.requestedAgent}`,
        precedence: input.profileLaunch ? 200 : input.requestedAgent === 'auto' ? 100 : 300,
      },
      {
        field: 'runtime.command',
        scope: 'provider' as const,
        source: `adapter:${input.provider}`,
        precedence: 100,
      },
      ...(input.launchAgentConfig?.command
        ? [
            {
              field: 'runtime.command',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}`,
              precedence: 110,
            },
          ]
        : []),
      {
        field: 'runtime.args',
        scope: 'provider',
        source: `adapter:${input.provider}`,
        precedence: 100,
      },
      ...(input.launchAgentConfig?.args?.length
        ? [
            {
              field: 'runtime.args',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}:args`,
              precedence: 110,
            },
          ]
        : []),
      ...(sandboxAffectsRuntimeArgs
        ? [
            {
              field: 'runtime.args',
              ...sandboxOrigin,
            },
          ]
        : []),
      ...(input.provider === 'openclaw' && input.launchAgentConfig
        ? [
            {
              field: 'runtime.args',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}`,
              precedence: 110,
            },
          ]
        : []),
      {
        field: 'runtime.workingDirectory',
        scope: 'provider',
        source: `adapter:${input.provider}`,
        precedence: 100,
      },
      {
        field: 'runtime.worktree',
        scope: 'provider',
        source: `adapter:${input.provider}`,
        precedence: 100,
      },
      {
        field: 'runtime.environmentKeys',
        scope: 'provider',
        source: `adapter-env:${input.provider}`,
        precedence: 100,
      },
      {
        field: 'runtime.environmentKeys',
        scope: 'system-default',
        source: 'host-environment:configured-key-presence',
        precedence: 0,
      },
      ...(sandboxAffectsEnvironment
        ? [
            {
              field: 'runtime.environmentKeys',
              ...sandboxOrigin,
            },
          ]
        : []),
      {
        field: 'runtime.credentialReferences',
        scope: 'provider',
        source: `adapter-credentials:${input.provider}`,
        precedence: 100,
      },
      ...(sandboxAffectsCredentials
        ? [
            {
              field: 'runtime.credentialReferences',
              ...sandboxOrigin,
            },
          ]
        : []),
      ...(input.profileLaunch?.agentConfig?.model
        ? [
            {
              field: 'runtime.model',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}`,
              precedence: 100,
            },
          ]
        : !input.profileLaunch && input.launchAgentConfig?.model
          ? [
              {
                field: 'runtime.model',
                scope: 'provider' as const,
                source: `agent-config:${input.agent}`,
                precedence: 100,
              },
            ]
          : []),
      ...(input.profileLaunch?.model
        ? [
            {
              field: 'runtime.model',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile?.id}@${profile?.version}`,
              precedence: 200,
            },
            ...(input.provider === 'openclaw'
              ? [
                  {
                    field: 'runtime.args',
                    scope: 'agent-profile' as const,
                    source: `agent-profile:${profile?.id}@${profile?.version}:model`,
                    precedence: 200,
                  },
                ]
              : []),
          ]
        : []),
      ...(input.budgetModelOverride
        ? [
            {
              field: 'runtime.model',
              scope: 'run' as const,
              source: 'budget-policy:model-downgrade',
              precedence: 300,
            },
            ...(input.provider === 'openclaw'
              ? [
                  {
                    field: 'runtime.args',
                    scope: 'run' as const,
                    source: 'budget-policy:model-downgrade',
                    precedence: 300,
                  },
                ]
              : []),
          ]
        : []),
      {
        field: 'sandbox',
        ...sandboxOrigin,
      },
      ...(input.budgetSources.workspaceBudget
        ? [
            {
              field: 'budget',
              scope: 'workspace' as const,
              source: 'workspace-budget',
              precedence: 50,
            },
          ]
        : []),
      ...(input.budgetSources.agentBudget
        ? [
            {
              field: 'budget',
              scope: 'provider' as const,
              source: `agent-config:${input.agent}`,
              precedence: 100,
            },
          ]
        : []),
      ...(input.budgetSources.profileBudget && profile
        ? [
            {
              field: 'budget',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile.id}@${profile.version}`,
              precedence: 200,
            },
          ]
        : []),
      ...(input.budgetSources.runBudget
        ? [
            {
              field: 'budget',
              scope: 'run' as const,
              source: 'operator-run-budget',
              precedence: 300,
            },
          ]
        : []),
      ...(!input.budgetSources.workspaceBudget &&
      !input.budgetSources.agentBudget &&
      !input.budgetSources.profileBudget &&
      !input.budgetSources.runBudget
        ? [
            {
              field: 'budget',
              scope: 'system-default' as const,
              source: 'budget:disabled',
              precedence: 0,
            },
          ]
        : []),
      ...(profile
        ? [
            {
              field: 'profile',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile.id}@${profile.version}`,
              precedence: 200,
            },
            {
              field: 'tools',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile.id}@${profile.version}`,
              precedence: 200,
            },
            {
              field: 'permissions',
              scope: 'agent-profile' as const,
              source: `agent-profile:${profile.id}@${profile.version}`,
              precedence: 200,
            },
          ]
        : [
            {
              field: 'tools',
              scope: 'system-default',
              source: 'tool-catalog:none',
              precedence: 0,
            },
            {
              field: 'permissions',
              scope: 'system-default',
              source: 'permission-requirements:none',
              precedence: 0,
            },
          ]),
      {
        field: 'resources',
        scope: profile ? 'agent-profile' : 'system-default',
        source: profile
          ? `agent-profile:${profile.id}@${profile.version}`
          : 'resource-selection:none',
        precedence: profile ? 200 : 0,
      },
      ...(profile?.workflow
        ? [
            {
              field: 'resources',
              scope: 'workflow' as const,
              source: `workflow:${profile.workflow.id ?? profile.workflow.entrypoint ?? 'unknown'}`,
              precedence: 250,
            },
          ]
        : []),
      {
        field: 'requiredHealthChecks',
        scope: profile ? 'agent-profile' : 'system-default',
        source: profile ? `agent-profile:${profile.id}@${profile.version}` : 'health-checks:none',
        precedence: profile ? 200 : 0,
      },
      {
        field: 'workspaceTrust',
        scope: 'system-default',
        source:
          selectedSharedResources.length > 0
            ? 'workspace-trust:resources-blocked'
            : 'workspace-trust:not-required',
        precedence: 0,
      },
      {
        field: 'enforcement',
        scope: 'system-default',
        source: `run-launch-compiler:${RUN_LAUNCH_MANIFEST_SCHEMA_VERSION}`,
        precedence: 1_000,
      },
    ].map((origin): RunLaunchManifestOrigin => ({
      ...origin,
      scope: origin.scope as RunLaunchManifestOrigin['scope'],
    }));

    return this.runLaunchManifests.compile({
      taskId: input.task.id,
      attemptId: input.attemptId,
      createdAt: input.startedAt,
      taskEnvelope: input.taskEnvelope,
      providerRuntimeManifest: input.providerRuntimeManifest,
      requiredRuntimeCapabilities: input.requiredRuntimeCapabilities,
      harnessSupport: input.harnessSupport,
      routing: {
        requestedAgent: input.requestedAgent,
        selectedAgent: input.agent,
        selectedHost: input.provider === 'openclaw' ? 'openclaw-gateway' : 'local-process',
        reason: input.routingReason,
        fallbackAgent: input.routingFallback ?? null,
        fallbackAllowed: Boolean(input.routingFallback),
      },
      ...(profile
        ? {
            profile: {
              id: profile.id,
              version: profile.version,
              role: profile.role,
            },
          }
        : {}),
      readiness: {
        summary: input.readiness,
        overrideReason: input.overrideReason,
      },
      instructions,
      runtime,
      tools: {
        allowed: profile?.tools?.allowed ?? [],
        denied: [],
        policyIds: profile?.policy?.toolPolicyIds ?? [],
        mcpServers: profile?.tools?.mcpServers ?? [],
        enforcement: hasToolRestrictions || hasMcpRestrictions ? 'unavailable' : 'not-required',
      },
      permissions: {
        level: profile?.permissions?.level ?? 'specialist',
        required: profile?.permissions?.required ?? [],
        enforcement: hasPermissionRequirements ? 'unavailable' : 'not-required',
      },
      resources: {
        skills: selectedSkills,
        shared: selectedSharedResources,
        enforcement:
          selectedSkills.length > 0 || selectedSharedResources.length > 0
            ? 'unavailable'
            : 'not-required',
      },
      requiredHealthChecks,
      sandboxPolicy: input.sandboxPolicy,
      budgetPolicy: input.budgetPolicy ?? {
        enabled: false,
        scope: 'run',
      },
      workspaceTrust: {
        status: 'not-required',
        source:
          selectedSharedResources.length > 0
            ? 'Referenced profile files and workflow entrypoints are not loaded by the current adapter and are blocked as unavailable resources.'
            : 'No repository-controlled executable profile components were selected.',
      },
      origins,
    });
  }

  private buildRunLaunchRuntime(
    provider: ExecutableAgentProvider,
    agentConfig: AgentConfig | undefined,
    taskId: string,
    logPath: string,
    attemptId: string,
    sandboxPolicy: SandboxPolicyDryRunResult
  ): RunLaunchRuntime {
    const environment = this.buildRunLaunchEnvironment(provider, sandboxPolicy);
    const runtimeBase = {
      ...(agentConfig?.model ? { model: agentConfig.model } : {}),
      workingDirectory: 'task-worktree' as const,
      worktree: 'required' as const,
      ...environment,
    };
    if (provider === 'codex-cli') {
      const finalPath = this.getCodexFinalPath(logPath, attemptId);
      return {
        ...runtimeBase,
        command: agentConfig?.command || 'codex',
        args: this.buildCodexArgs(agentConfig, '<prompt>', logPath, attemptId, sandboxPolicy).map(
          (argument) => (argument === finalPath ? '<run-log>/final-message.md' : argument)
        ),
      };
    }
    if (provider === 'codex-sdk') {
      const sdkExecutable = this.resolveCodexSdkExecutable(agentConfig);
      const threadSettings = this.buildCodexSdkThreadSettings(sandboxPolicy);
      return {
        ...runtimeBase,
        command: sdkExecutable.manifestCommand,
        args: [
          'startThread',
          `skipGitRepoCheck=${threadSettings.skipGitRepoCheck}`,
          `sandboxMode=${threadSettings.sandboxMode}`,
          `approvalPolicy=${threadSettings.approvalPolicy}`,
          `networkAccessEnabled=${threadSettings.networkAccessEnabled}`,
          'runStreamed',
          '<prompt>',
        ],
      };
    }
    if (provider === 'hermes-cli') {
      return {
        ...runtimeBase,
        command: agentConfig?.command || 'hermes',
        args: ['-z', ...(agentConfig?.args ?? []), '<prompt>'],
      };
    }
    const spawnArguments = buildOpenClawTaskSpawnArguments({
      taskId,
      attemptId,
      agentId: agentConfig?.type || 'openclaw',
      agentName: agentConfig?.name,
      model: agentConfig?.model,
      prompt: '<prompt>',
      timeoutSeconds: 900,
    });
    const sessionKeySource =
      this.firstConfiguredEnvironmentKey(['OPENCLAW_GATEWAY_SESSION_KEY']) ?? 'default:main';
    const gatewayUrlSource =
      this.firstConfiguredEnvironmentKey([
        'OPENCLAW_GATEWAY_URL',
        'CLAWDBOT_GATEWAY',
        'CLAWDBOT_GATEWAY_URL',
      ]) ?? 'default:http://127.0.0.1:18789';
    return {
      ...runtimeBase,
      command: 'openclaw.sessions_spawn',
      args: [
        'tool=sessions_spawn',
        ...Object.entries(spawnArguments).map(([key, value]) => `${key}=${String(value)}`),
        `sessionKey=${sessionKeySource.startsWith('default:') ? sessionKeySource : `env:${sessionKeySource}`}`,
        `gatewayUrl=${gatewayUrlSource.startsWith('default:') ? gatewayUrlSource : `env:${gatewayUrlSource}`}`,
        `allowPrivateIp=${isOpenClawGatewayPrivateIpAllowed()}`,
        'requestTimeoutMs=60000',
      ],
      workingDirectory: 'provider-managed',
      worktree: 'provider-managed',
    };
  }

  private resolveCodexSdkExecutable(agentConfig: AgentConfig | undefined): {
    manifestCommand: string;
    codexPathOverride?: string;
  } {
    const codexPathOverride =
      agentConfig?.command && agentConfig.command !== 'codex' ? agentConfig.command : undefined;
    return {
      manifestCommand: codexPathOverride ?? '@openai/codex-sdk:bundled-codex',
      ...(codexPathOverride ? { codexPathOverride } : {}),
    };
  }

  private buildCodexSdkThreadSettings(sandboxPolicy: SandboxPolicyDryRunResult | undefined): {
    skipGitRepoCheck: true;
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy: 'never';
    networkAccessEnabled: boolean;
  } {
    return {
      skipGitRepoCheck: true,
      sandboxMode: sandboxPolicy?.effective.sandboxMode ?? 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: sandboxPolicy?.effective.networkAccessEnabled ?? true,
    };
  }

  private buildRunLaunchEnvironment(
    provider: ExecutableAgentProvider,
    sandboxPolicy: SandboxPolicyDryRunResult
  ): Pick<RunLaunchRuntime, 'environmentKeys' | 'credentialReferences'> {
    if (provider === 'codex-cli' || provider === 'codex-sdk') {
      const environmentKeys = Object.keys(
        buildSafeCodexEnv(process.env, sandboxPolicy.effective.envPassthrough)
      );
      return {
        environmentKeys,
        credentialReferences: [
          ...sandboxPolicy.effective.credentialRefs,
          ...environmentKeys
            .filter((key) => key === 'CODEX_API_KEY' || key === 'OPENAI_API_KEY')
            .map((key) => `env:${key}`),
        ],
      };
    }
    if (provider === 'hermes-cli') {
      const environmentKeys = Object.keys(
        buildSafeHermesEnv(process.env, sandboxPolicy.effective.envPassthrough)
      );
      return {
        environmentKeys,
        credentialReferences: [
          ...sandboxPolicy.effective.credentialRefs,
          ...environmentKeys
            .filter((key) => key === 'ANTHROPIC_API_KEY' || key === 'HERMES_API_KEY')
            .map((key) => `env:${key}`),
        ],
      };
    }

    const gatewayUrlKey = this.firstConfiguredEnvironmentKey([
      'OPENCLAW_GATEWAY_URL',
      'CLAWDBOT_GATEWAY',
      'CLAWDBOT_GATEWAY_URL',
    ]);
    const gatewayTokenKey = this.firstConfiguredEnvironmentKey([
      'OPENCLAW_GATEWAY_TOKEN',
      'CLAWDBOT_GATEWAY_TOKEN',
    ]);
    const gatewaySessionKey = this.firstConfiguredEnvironmentKey(['OPENCLAW_GATEWAY_SESSION_KEY']);
    const environmentKeys = [
      gatewayUrlKey,
      gatewayTokenKey,
      gatewaySessionKey,
      this.firstConfiguredEnvironmentKey(['OPENCLAW_GATEWAY_ALLOW_PRIVATE']),
    ].filter((key): key is string => Boolean(key));
    return {
      environmentKeys,
      credentialReferences: gatewayTokenKey ? [`env:${gatewayTokenKey}`] : [],
    };
  }

  private firstConfiguredEnvironmentKey(keys: string[]): string | undefined {
    return keys.find((key) => Boolean(process.env[key]));
  }

  private normalizeRunLaunchTaskPrompt(
    prompt: string,
    attemptId: string,
    worktreePath: string | undefined,
    taskEnvelopeDigest: string,
    providerRuntimeDigest: string
  ): string {
    const normalizedIdentifiers = [
      [attemptId, '<attempt-id>'],
      [worktreePath, '<worktree>'],
      [taskEnvelopeDigest, '<task-envelope-digest>'],
      [providerRuntimeDigest, '<provider-runtime-digest>'],
    ].reduce(
      (normalized, [value, replacement]) =>
        value ? normalized.replaceAll(value, replacement ?? '') : normalized,
      prompt
    );
    return normalizedIdentifiers.replace(/\(\d+ minutes ago\)/g, '(<elapsed-minutes> minutes ago)');
  }

  private budgetRequiresRuntimeEvidence(policy: AgentBudgetPolicy | undefined): boolean {
    if (!policy || policy.enabled === false || !policy.limits) return false;
    return (
      policy.limits.inputTokens !== undefined ||
      policy.limits.outputTokens !== undefined ||
      policy.limits.totalTokens !== undefined ||
      policy.limits.costUsd !== undefined ||
      policy.limits.toolCalls !== undefined
    );
  }

  private async resolveParentAttempt(
    task: Task,
    parentAttemptId?: string
  ): Promise<(TaskAttempt & { runLaunchManifest: RunLaunchManifest }) | undefined> {
    if (!parentAttemptId) return undefined;
    const currentTaskParent = [task.attempt, ...(task.attempts ?? [])]
      .filter((attempt): attempt is TaskAttempt => Boolean(attempt))
      .find((attempt) => attempt.id === parentAttemptId);
    const parent =
      currentTaskParent ??
      (await this.taskService.listTasks())
        .flatMap((candidate) => [candidate.attempt, ...(candidate.attempts ?? [])])
        .filter((attempt): attempt is TaskAttempt => Boolean(attempt))
        .find((attempt) => attempt.id === parentAttemptId);
    if (!parent) {
      throw new ConflictError('Parent attempt was not found for launch-manifest comparison.', {
        parentAttemptId,
      });
    }
    if (!parent.runLaunchManifest) {
      throw new ConflictError('Parent attempt has no run launch manifest to compare.', {
        parentAttemptId,
      });
    }
    return parent as TaskAttempt & { runLaunchManifest: RunLaunchManifest };
  }

  private async initLogFile(
    logPath: string,
    task: Task,
    agent: AgentType,
    prompt: string,
    providerRuntimeManifest: ProviderRuntimeManifest,
    taskEnvelope: TaskEnvelope,
    runLaunchManifest: RunLaunchManifest
  ): Promise<void> {
    const header = `# Agent Log: ${task.title}

**Task ID:** ${task.id}
**Agent:** ${agent}
**Started:** ${new Date().toISOString()}
**Worktree:** ${task.git?.worktreePath}
**Provider manifest:** ${providerRuntimeManifest.digest}
**Task envelope:** ${taskEnvelope.digest}
**Run launch manifest:** ${runLaunchManifest.digest}

<details><summary>Provider runtime manifest</summary>

\`\`\`json
${JSON.stringify(providerRuntimeManifest, null, 2)}
\`\`\`

</details>

<details><summary>Task envelope</summary>

\`\`\`json
${JSON.stringify(taskEnvelope, null, 2)}
\`\`\`

</details>

<details><summary>Run launch manifest</summary>

\`\`\`json
${JSON.stringify(runLaunchManifest, null, 2)}
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
