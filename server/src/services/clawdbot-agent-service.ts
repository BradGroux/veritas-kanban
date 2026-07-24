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
  renderCodexAppServerTaskEnvelope,
  renderClaudeCodeTaskEnvelope,
  renderAcpStdioTaskEnvelope,
  renderHermesTaskEnvelope,
  renderOpenClawTaskEnvelope,
  type ProviderTaskEnvelopeRenderInput,
  type ProviderTaskEnvelopeTransport,
} from './provider-task-envelope-renderer.js';
import type { ThreadEvent } from '@openai/codex-sdk';
import {
  evaluateTaskReadiness,
  CONVERSATION_LIFECYCLE_SCHEMA_VERSION,
  EXECUTABLE_AGENT_PROVIDERS,
  RUN_LAUNCH_MANIFEST_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
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
  TaskCompletionBlocker,
  TaskCompletionStatus,
  TaskCompletionVerification,
  TaskEnvelope,
  TaskTerminalSource,
  CompletionResult,
  HarnessSupportStatus,
  HarnessSupportTelemetry,
  RunLaunchManifest,
  RunLaunchManifestDriftResult,
  RunLaunchManifestOrigin,
  RunLaunchManifestPreview,
  RunLaunchRuntime,
  CredentialRunRevocationRequest,
  CredentialLeaseTerminalReason,
  RunEventEnvelope,
  RunEventKind,
  RunSupervisorRecord,
  RunSupervisorRecoveryRecord,
  RunSupervisorRecoveryOperation,
  ConversationLaunchRequest,
  ConversationLifecycleRecord,
  ConversationLifecycleResult,
  RunToolCatalog,
  AcpRuntimeProbe,
  AcpSessionNotification,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionUpdate,
  AcpStopReason,
  ProviderRuntimeCapabilityEvidence,
  RunApprovalActionClass,
  RunApprovalRiskClass,
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
import {
  parseCompletionResultForEnvelope,
  parseTaskEnvelope,
} from '../schemas/task-envelope-schemas.js';
import { parseRunLaunchManifest } from '../schemas/run-launch-manifest-schemas.js';
import {
  ProviderCompletionService,
  type ProviderCompletionArtifactClaim,
  type ProviderCompletionEvidenceClaim,
  type ProviderTerminalClaim,
} from './provider-completion-service.js';
import { getCredentialBrokerService } from './credential-broker-service.js';
import { WorktreeService } from './worktree-service.js';
import {
  getRunEventJournalService,
  type RunEventJournalService,
} from './run-event-journal-service.js';
import {
  getProviderRunEventMapper,
  type ProviderMappedRunEvent,
  type ProviderRunEventMapper,
} from './provider-run-event-mappers.js';
import {
  buildClaudeCodeArgs,
  buildSafeClaudeCodeEnv,
  CLAUDE_CODE_CREDENTIAL_ENV_KEYS,
  CLAUDE_CODE_MAX_STREAM_RECORD_BYTES,
  classifyClaudeCodeStreamRecord,
  parseClaudeCodeStreamLine,
  type ClaudeCodeStreamClassification,
  type ClaudeCodeTerminalResult,
  type ClaudeCodeUsage,
} from './claude-code-adapter.js';
import {
  buildCodexAppServerArgs,
  buildSafeCodexAppServerEnv,
  CODEX_APP_SERVER_CERTIFIED_BUILD,
  CODEX_APP_SERVER_MAX_RECORD_BYTES,
  classifyCodexAppServerNotification,
  classifyCodexAppServerServerRequest,
  CodexAppServerRpcClient,
  parseCodexAppServerLine,
  type CodexAppServerClassification,
  type CodexAppServerTerminalResult,
  type CodexAppServerUsage,
} from './codex-app-server-adapter.js';
import {
  getRunApprovalBrokerService,
  type RunApprovalBrokerService,
} from './run-approval-broker-service.js';
import { getRunSupervisorService, type RunSupervisorService } from './run-supervisor-service.js';
import {
  ConversationLifecycleService,
  type ConversationSource,
} from './conversation-lifecycle-service.js';
import {
  assertGrokBuildVersionEvidence,
  buildCopilotAcpArgs,
  buildGrokBuildAcpArgs,
  buildSafeAcpEnv,
  COPILOT_ACP_RUNTIME_PROFILE_ID,
  GROK_BUILD_RUNTIME_PROFILE_ID,
  openAcpStdio,
  probeAcpStdioRuntime,
  type AcpStdioControl,
} from './acp-stdio-adapter.js';
import {
  getToolControlPlaneService,
  type ToolControlPlaneService,
} from './tool-control-plane-service.js';
import { getToolPolicyService } from './tool-policy-service.js';
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
const CLAUDE_CODE_MAX_STDERR_BUFFER_BYTES = 64 * 1024;

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
  conversation: ConversationLifecycleRecord;
}

export interface AgentProviderStopContext {
  taskId: string;
  pending: PendingAgent;
}

export interface AgentProviderProbeContext {
  agentConfig?: AgentConfig;
  health: AgentHealthStatus;
  cwd?: string;
}

export interface AgentProviderAdapter {
  id: ExecutableAgentProvider;
  label: string;
  renderTaskEnvelope(input: ProviderTaskEnvelopeRenderInput): ProviderTaskEnvelopeTransport;
  probe(context: AgentProviderProbeContext): Promise<ProviderRuntimeManifest>;
  runEventMapper: ProviderRunEventMapper;
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
  conversation: ConversationLifecycleRecord;
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
  conversation?: ConversationLaunchRequest;
}

export interface AgentMessageOptions {
  actor?: string;
  source?: string;
  expectedAttemptId: string;
}

export interface AgentCompletionProvenance {
  attemptId: string;
  providerRuntimeManifestDigest: string;
  terminalSource?: TaskTerminalSource;
}

export type AgentMessageDelivery = ConversationLifecycleResult;

export interface CredentialLeaseLifecycle {
  revokeRun(request: CredentialRunRevocationRequest): Promise<number>;
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
  conversation: ConversationLifecycleRecord;
  supervisorId?: string;
  recoveredControl?: boolean;
  threadId?: string;
  abortController?: AbortController;
  process?: ChildProcessWithoutNullStreams;
  codexAppServerControl?: {
    interrupt(): Promise<void>;
    steer(message: string): Promise<string>;
    compact(): Promise<void>;
    archive(): Promise<void>;
    close(): void;
  };
  acpControl?: AcpStdioControl;
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
  terminalClaimIdempotencyKey?: string;
  completionTiming?: {
    endedAt: string;
    durationMs: number;
  };
  completionBudgetEvaluated?: boolean;
  preparedCompletion?: {
    status: AttemptStatus;
    taskBeforeCompletion: Task;
    completedAttempt: TaskAttempt;
    completionResult: CompletionResult;
  };
}

interface AgentTerminalResult {
  success?: boolean;
  status?: TaskCompletionStatus;
  terminalSource?: TaskTerminalSource;
  summary?: string;
  error?: string;
  blockers?: TaskCompletionBlocker[];
  evidence?: ProviderCompletionEvidenceClaim[];
  artifacts?: ProviderCompletionArtifactClaim[];
  verification?: TaskCompletionVerification[];
  continuation?: CompletionResult['continuation'];
}

const pendingAgents = new Map<string, PendingAgent>();
const startingAgents = new Set<string>();
const finalizingAgents = new Map<PendingAgent, Promise<void>>();
const budgetEvaluations = new Map<PendingAgent, Promise<void>>();
const recoveredProcessMonitors = new Map<string, NodeJS.Timeout>();
const COMPLETION_PERSISTENCE_ATTEMPTS = 3;
const NOOP_CREDENTIAL_LEASE_LIFECYCLE: CredentialLeaseLifecycle = {
  async revokeRun() {
    return 0;
  },
};

class CompletionPersistenceError extends Error {
  constructor(readonly persistenceCause: unknown) {
    super(
      persistenceCause instanceof Error
        ? persistenceCause.message
        : 'Provider completion could not be persisted'
    );
    this.name = 'CompletionPersistenceError';
  }
}

class CompletionOwnershipError extends ConflictError {}

function normalizedTaskRevision(task: Pick<Task, 'revision'>): number {
  return typeof task.revision === 'number' && Number.isInteger(task.revision) && task.revision >= 0
    ? task.revision
    : 1;
}

function executableProvider(value: string | undefined): ExecutableAgentProvider | 'system' {
  return EXECUTABLE_AGENT_PROVIDERS.includes(value as ExecutableAgentProvider)
    ? (value as ExecutableAgentProvider)
    : 'system';
}

export class ClawdbotAgentService {
  private configService: ConfigService;
  private taskService: TaskService;
  private agentHealth: AgentHealthChecker;
  private providerRuntimeManifests: ProviderRuntimeManifestService;
  private taskEnvelopes: TaskEnvelopeService;
  private runLaunchManifests: RunLaunchManifestService;
  private providerCompletions: ProviderCompletionService;
  private credentialLeases: CredentialLeaseLifecycle;
  private workspaceFiles: WorkspaceFileRepository;
  private worktrees: Pick<WorktreeService, 'claimOwnership' | 'releaseOwnership'>;
  private runEvents: RunEventJournalService;
  private approvalBroker: RunApprovalBrokerService;
  private runSupervisor: RunSupervisorService;
  private conversationLifecycle: ConversationLifecycleService;
  private toolControlPlane: ToolControlPlaneService;
  private logsDir: string;

  constructor(
    agentHealth?: AgentHealthChecker,
    providerRuntimeManifests = new ProviderRuntimeManifestService(),
    taskEnvelopes = new TaskEnvelopeService(),
    workspaceFiles: WorkspaceFileRepository = new LocalWorkspaceFileRepository(),
    providerCompletions = new ProviderCompletionService(),
    credentialLeases: CredentialLeaseLifecycle = NOOP_CREDENTIAL_LEASE_LIFECYCLE,
    worktrees?: Pick<WorktreeService, 'claimOwnership' | 'releaseOwnership'>,
    runEvents: RunEventJournalService = getRunEventJournalService(),
    approvalBroker: RunApprovalBrokerService = getRunApprovalBrokerService(),
    runSupervisor: RunSupervisorService = getRunSupervisorService(),
    conversationLifecycle = new ConversationLifecycleService(),
    toolControlPlane: ToolControlPlaneService = getToolControlPlaneService()
  ) {
    this.configService = new ConfigService();
    this.taskService = new TaskService();
    this.agentHealth = agentHealth || new AgentHealthService();
    this.providerRuntimeManifests = providerRuntimeManifests;
    this.taskEnvelopes = taskEnvelopes;
    this.runLaunchManifests = new RunLaunchManifestService();
    this.providerCompletions = providerCompletions;
    this.credentialLeases = credentialLeases;
    this.workspaceFiles = workspaceFiles;
    this.worktrees =
      worktrees ??
      new WorktreeService({
        taskService: this.taskService,
        configService: this.configService,
      });
    this.runEvents = runEvents;
    this.approvalBroker = approvalBroker;
    this.runSupervisor = runSupervisor;
    this.conversationLifecycle = conversationLifecycle;
    this.toolControlPlane = toolControlPlane;
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
   * Current task-envelope attempts receive a digest-bound interrupted completion
   * result. Legacy attempts without an envelope retain the older failed/todo
   * migration behavior so the UI and operators have an actionable state.
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

    let recoveredCount = 0;
    let recoveryRequiredCount = 0;

    for (const task of tasks) {
      if (!task.attempt || task.attempt.status !== 'running') continue;
      if (pendingAgents.has(task.id)) continue;

      try {
        const attempt = task.attempt;
        if (
          !attempt.taskEnvelope ||
          !attempt.runLaunchManifest ||
          !attempt.providerRuntimeManifest ||
          !attempt.harnessSupport
        ) {
          const claim: ProviderTerminalClaim = {
            terminalSource: 'operator-interruption',
            status: 'interrupted',
            summary:
              'Legacy running attempt has no durable supervisor bindings and cannot be recovered safely.',
          };
          if (attempt.taskEnvelope && attempt.providerRuntimeManifest) {
            await this.persistRestartedProviderCompletion(
              task,
              attempt,
              claim,
              this.providerCompletions.idempotencyKey({
                taskEnvelope: attempt.taskEnvelope,
                claim,
              }),
              { preserveNonActiveTaskStatus: true }
            );
          } else {
            const failedAttempt: TaskAttempt = {
              ...attempt,
              status: 'failed',
              ended: new Date().toISOString(),
            };
            await this.taskService.updateTask(task.id, {
              ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
              attempt: failedAttempt,
              attempts: upsertAttemptHistory(task.attempts, failedAttempt),
            });
          }
          recoveryRequiredCount += 1;
          continue;
        }

        this.assertPersistedAttemptCompletionBinding(task.id, attempt);
        const provider = executableProvider(attempt.provider);
        if (provider === 'system') {
          throw new CompletionOwnershipError('Persisted attempt has no executable provider.', {
            taskId: task.id,
            attemptId: attempt.id,
          });
        }
        let supervisor = await this.runSupervisor.findByAttempt(
          attempt.taskEnvelope.workspace.workspaceId,
          task.id,
          attempt.id
        );
        let recovery: Awaited<ReturnType<RunSupervisorService['recover']>>;
        if (!supervisor) {
          const recoveryOperations = providerRuntimeControls(attempt.providerRuntimeManifest)
            .controls.filter(
              (control) =>
                control.available &&
                ['status', 'stop', 'reattach', 'resume'].includes(control.action)
            )
            .map((control) => control.action as RunSupervisorRecoveryOperation);
          supervisor = await this.runSupervisor.register({
            workspaceId: attempt.taskEnvelope.workspace.workspaceId,
            taskId: task.id,
            attemptId: attempt.id,
            provider,
            adapter: attempt.providerRuntimeManifest.adapter,
            providerVersion: attempt.providerRuntimeManifest.providerVersion,
            providerRuntimeManifestDigest: attempt.providerRuntimeManifest.digest,
            taskEnvelopeDigest: attempt.taskEnvelope.digest,
            runLaunchManifestDigest: attempt.runLaunchManifest.digest,
            worktreePath: attempt.taskEnvelope.workspace.worktreePath,
            worktreeManifestId: attempt.taskEnvelope.workspace.worktreeManifestId,
            worktreeLeaseId: attempt.taskEnvelope.workspace.ownershipLeaseId,
            recoveryOperations,
            budget: attempt.budget,
          });
          supervisor = await this.runSupervisor.requireRecovery(
            supervisor.id,
            'supervisor-record-missing',
            'The running attempt predates its durable supervisor record.',
            'Verify that no provider process or remote session remains, then launch a new attempt.'
          );
          recovery = { outcome: 'recovery-required', record: supervisor };
        } else {
          recovery = await this.runSupervisor.recover(supervisor.id, {
            provider,
            adapter: attempt.providerRuntimeManifest.adapter,
            providerRuntimeManifestDigest: attempt.providerRuntimeManifest.digest,
            taskEnvelopeDigest: attempt.taskEnvelope.digest,
            runLaunchManifestDigest: attempt.runLaunchManifest.digest,
            worktreePath: attempt.taskEnvelope.workspace.worktreePath,
            worktreeManifestId: attempt.taskEnvelope.workspace.worktreeManifestId,
            worktreeLeaseId: attempt.taskEnvelope.workspace.ownershipLeaseId,
          });
        }
        if (recovery.outcome === 'lease-held') {
          log.info(
            { taskId: task.id, attemptId: attempt.id, supervisorId: supervisor.id },
            'Skipped run recovery because another live supervisor owns the lease'
          );
          continue;
        }
        if (recovery.outcome === 'reattached') {
          await this.restoreRecoveredRun(task, attempt, recovery.record);
          recoveredCount += 1;
          continue;
        }
        if (recovery.outcome === 'terminal') {
          if (recovery.record.terminal?.completionResult) {
            await this.persistSupervisorCompletion(
              task,
              attempt,
              recovery.record.terminal.completionResult
            );
            recoveredCount += 1;
          } else {
            const runRecovery: RunSupervisorRecoveryRecord = {
              code: 'terminal-result-missing',
              detail: 'The supervisor is terminal but has no durable normalized completion result.',
              nextAction:
                'Inspect the terminal run event and provider log, then resolve the attempt manually.',
              recordedAt: new Date().toISOString(),
            };
            const recoveredAttempt: TaskAttempt = {
              ...attempt,
              runSupervisorId: recovery.record.id,
              runRecovery,
            };
            await this.taskService.updateTask(task.id, {
              expectedRevision: normalizedTaskRevision(task),
              ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
              attempt: recoveredAttempt,
              attempts: upsertAttemptHistory(task.attempts, recoveredAttempt),
            });
            recoveryRequiredCount += 1;
          }
          continue;
        }

        const runRecovery = recovery.recovery ?? recovery.record.recovery;
        await this.appendRunEvent(
          task.id,
          attempt.id,
          'run.recovered',
          {
            status: 'recovery-required',
            recoveryCode: runRecovery?.code,
            summary: runRecovery?.detail,
            nextAction: runRecovery?.nextAction,
            lastEventSequence: recovery.record.lastEventSequence,
          },
          {
            provider,
            adapter: attempt.providerRuntimeManifest.adapter,
            agent: attempt.agent,
            model: attempt.model,
            dedupeKey: `run.recovery-required:${recovery.record.revision}`,
          }
        );
        const recoveredAttempt: TaskAttempt = {
          ...attempt,
          runSupervisorId: recovery.record.id,
          runRecovery,
        };
        await this.taskService.updateTask(task.id, {
          expectedRevision: normalizedTaskRevision(task),
          ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
          attempt: recoveredAttempt,
          attempts: upsertAttemptHistory(task.attempts, recoveredAttempt),
        });
        recoveryRequiredCount += 1;
      } catch (err) {
        log.warn(
          { err, taskId: task.id },
          '[ClawdbotAgent] reconcileRunningAttempts: failed to update task'
        );
      }
    }

    if (recoveredCount > 0 || recoveryRequiredCount > 0) {
      log.info(
        { recoveredCount, recoveryRequiredCount },
        '[ClawdbotAgent] Durable run supervisor startup reconciliation complete'
      );
    }
  }

  private async restoreRecoveredRun(
    task: Task,
    attempt: TaskAttempt,
    supervisor: RunSupervisorRecord
  ): Promise<void> {
    if (
      !attempt.providerRuntimeManifest ||
      !attempt.harnessSupport ||
      !attempt.taskEnvelope ||
      !attempt.runLaunchManifest
    ) {
      throw new CompletionOwnershipError('Recovered attempt is missing immutable run evidence.', {
        taskId: task.id,
        attemptId: attempt.id,
      });
    }
    const provider = executableProvider(attempt.provider);
    if (provider === 'system') {
      throw new CompletionOwnershipError('Recovered attempt has no executable provider.', {
        taskId: task.id,
        attemptId: attempt.id,
      });
    }
    const sessionId =
      supervisor.control.kind === 'remote-session'
        ? supervisor.control.sessionId
        : supervisor.control.kind === 'local-process'
          ? supervisor.control.sessionId
          : undefined;
    const recoveredConversation = this.conversationLifecycle.recover(attempt, sessionId);
    const pending: PendingAgent = {
      taskId: task.id,
      attemptId: attempt.id,
      agent: attempt.agent,
      startedAt: attempt.started ?? supervisor.createdAt,
      emitter: new EventEmitter(),
      provider,
      model: attempt.model,
      budget: supervisor.budget ?? attempt.budget,
      agentProfile: attempt.agentProfile,
      providerRuntimeManifest: attempt.providerRuntimeManifest,
      harnessSupport: attempt.harnessSupport,
      taskEnvelope: attempt.taskEnvelope,
      runLaunchManifest: attempt.runLaunchManifest,
      runLaunchManifestTraceId:
        attempt.runLaunchManifestTraceId ?? `run-supervisor:${supervisor.id}`,
      runLaunchParentAttemptId: attempt.runLaunchParentAttemptId,
      runLaunchManifestDrift: attempt.runLaunchManifestDrift,
      conversation: recoveredConversation,
      supervisorId: supervisor.id,
      recoveredControl: true,
      threadId: attempt.threadId ?? sessionId,
      openclawSessionKey: provider === 'openclaw' ? (attempt.sessionKey ?? sessionId) : undefined,
      hermesSessionId: provider === 'hermes-cli' ? sessionId : undefined,
    };
    pendingAgents.set(task.id, pending);
    try {
      await this.reconcileRecoveredRunCursor(task.id, attempt.id, supervisor);
      await this.appendRunEvent(
        task.id,
        attempt.id,
        'run.recovered',
        {
          status: 'reattached',
          supervisorId: supervisor.id,
          controlKind: supervisor.control.kind,
          lastEventSequence: supervisor.lastEventSequence,
          summary: 'Durable run control was reattached after server restart.',
        },
        {
          provider,
          adapter: attempt.providerRuntimeManifest.adapter,
          agent: attempt.agent,
          model: attempt.model,
          dedupeKey: `run.reattached:${supervisor.revision}`,
        }
      );
      if (supervisor.control.kind === 'local-process') {
        this.monitorRecoveredProcess(task.id, pending, supervisor);
      }
    } catch (error) {
      this.clearRecoveredProcessMonitor(task.id);
      pendingAgents.delete(task.id);
      throw error;
    }
  }

  private async reconcileRecoveredRunCursor(
    taskId: string,
    attemptId: string,
    supervisor: RunSupervisorRecord
  ): Promise<void> {
    let cursor = supervisor.lastEventSequence;
    for (;;) {
      const pageStart = cursor;
      const page = await this.runEvents.list({
        taskId,
        attemptId,
        afterSequence: cursor,
        limit: 500,
      });
      for (const event of page.events) cursor = Math.max(cursor, event.sequence);
      if (!page.hasMore) break;
      if (cursor === pageStart) {
        throw new Error('Run event journal pagination did not advance during recovery.');
      }
    }
    if (cursor > supervisor.lastEventSequence) {
      await this.runSupervisor.checkpoint(supervisor.id, {
        lastEventSequence: cursor,
      });
    }
  }

  private monitorRecoveredProcess(
    taskId: string,
    pending: PendingAgent,
    supervisor: RunSupervisorRecord
  ): void {
    this.clearRecoveredProcessMonitor(taskId);
    let checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      if (pendingAgents.get(taskId) !== pending) {
        this.clearRecoveredProcessMonitor(taskId);
        return;
      }
      if (this.runSupervisor.isLocalProcessAlive(supervisor)) return;
      checking = true;
      this.clearRecoveredProcessMonitor(taskId);
      void (async () => {
        await this.runSupervisor.requireRecovery(
          supervisor.id,
          'process-exited',
          'The reattached provider process exited without a recoverable terminal stream.',
          'Review output through the last durable event cursor and launch a new attempt if work remains.'
        );
        await this.finalizePendingAgent(taskId, pending, async () => ({
          status: 'interrupted',
          terminalSource: 'process',
          error: 'Recovered provider process exited without a recoverable terminal result.',
        }));
      })().catch((error) => {
        log.error(
          { err: error, taskId, attemptId: pending.attemptId, supervisorId: supervisor.id },
          'Failed to finalize a recovered provider process after exit'
        );
      });
    }, 1_000);
    timer.unref();
    recoveredProcessMonitors.set(taskId, timer);
  }

  private clearRecoveredProcessMonitor(taskId: string): void {
    const timer = recoveredProcessMonitors.get(taskId);
    if (timer) clearInterval(timer);
    recoveredProcessMonitors.delete(taskId);
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
      cwd: this.expandPath(task.git.worktreePath),
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
    const toolPolicy = await this.resolveLaunchToolPolicy(profileLaunch);
    const runToolCatalog = await this.toolControlPlane.prepareRunCatalog({
      taskId,
      attemptId,
      provider,
      providerRuntimeManifestDigest: providerRuntimeManifest.digest,
      taskEnvelopeDigest: taskEnvelope.digest,
      serverIds: profileLaunch?.profile.tools?.mcpServers ?? [],
      allowedTools: this.intersectToolAllowLists(
        profileLaunch?.profile.tools?.allowed ?? [],
        toolPolicy.allowed
      ),
      deniedTools: toolPolicy.denied,
      cwd: worktreePath,
      persist: false,
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
      runToolCatalog,
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
    let task = await this.taskService.getTask(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found`);
    }

    if (task.type !== 'code') {
      throw new Error('Agents can only be started on code tasks');
    }

    if (!task.git?.worktreePath) {
      throw new Error('Task must have an active worktree to start an agent');
    }

    const conversationRequest = this.normalizeConversationLaunch(options.conversation);
    const conversationSource =
      conversationRequest.mode === 'fresh'
        ? undefined
        : this.conversationLifecycle.source(
            await this.findAttempt(conversationRequest.sourceAttemptId as string),
            conversationRequest.mode
          );

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
      cwd: this.expandPath(task.git.worktreePath),
    });
    const harnessSupport = evaluateHarnessSupportStatus(
      launchAgentConfig as AgentConfig,
      agentHealth,
      providerRuntimeManifest
    );
    const requiredRuntimeCapabilities = this.resolveLaunchRuntimeCapabilities(
      profileLaunch,
      budgetPolicy,
      [
        ...(options.requiredRuntimeCapabilities ?? []),
        ...conversationLaunchCapabilities(conversationRequest.mode),
      ]
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
    if (!task.git?.worktreePath) {
      throw new Error(`Task "${taskId}" lost its worktree allocation before launch`);
    }
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
    const toolPolicy = await this.resolveLaunchToolPolicy(profileLaunch);
    const runToolCatalog = await this.toolControlPlane.prepareRunCatalog({
      taskId,
      attemptId,
      provider,
      providerRuntimeManifestDigest: providerRuntimeManifest.digest,
      taskEnvelopeDigest: taskEnvelope.digest,
      serverIds: profileLaunch?.profile.tools?.mcpServers ?? [],
      allowedTools: this.intersectToolAllowLists(
        profileLaunch?.profile.tools?.allowed ?? [],
        toolPolicy.allowed
      ),
      deniedTools: toolPolicy.denied,
      cwd: worktreePath,
    });

    // Validate path segments for log file
    validatePathSegment(taskId);
    validatePathSegment(attemptId);

    const taskTransport = adapter.renderTaskEnvelope({
      taskEnvelope,
      profileInstructions: profileLaunch?.instructions,
      checkpoint: task.checkpoint,
    });
    const providerTransport =
      conversationRequest.mode === 'fresh'
        ? conversationRequest.message
          ? {
              ...taskTransport,
              content: `${taskTransport.content}\n\n## Operator turn\n\n${conversationRequest.message}`,
            }
          : taskTransport
        : {
            ...taskTransport,
            content: renderConversationTurn(
              conversationRequest.mode,
              conversationSource as ConversationSource,
              conversationRequest.message as string,
              conversationRequest.forkTurnId
            ),
          };
    const runLaunchManifest = await this.compileRunLaunchManifest({
      task,
      taskEnvelope,
      taskTransport: providerTransport,
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
      runToolCatalog,
    });
    const parentAttempt = await this.resolveParentAttempt(
      task,
      conversationSource?.attempt.id ?? options.parentAttemptId
    );
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
    if (conversationSource && conversationRequest.mode !== 'fresh') {
      this.conversationLifecycle.assertCompatible(
        conversationSource,
        runLaunchManifest,
        taskEnvelope,
        conversationRequest.mode
      );
    }
    const conversation = this.conversationLifecycle.create(
      conversationRequest.mode,
      conversationSource,
      conversationRequest.forkTurnId,
      conversationRequest.intent
    );

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
      conversation,
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
      providerTransport.content,
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
      conversation,
    };

    const usesManagedWorktree = Boolean(task.git.worktreeManifestId && task.git.worktreeLeaseId);
    if (usesManagedWorktree) {
      try {
        await this.worktrees.claimOwnership(taskId, attemptId);
      } catch (error) {
        pendingAgents.delete(taskId);
        throw error;
      }
      const claimedTask = await this.taskService.getTask(taskId);
      if (!claimedTask) {
        await this.worktrees.releaseOwnership(taskId, attemptId);
        throw new Error(`Task "${taskId}" disappeared while claiming its worktree`);
      }
      task = claimedTask;
    }
    try {
      await this.taskService.updateTask(taskId, {
        status: 'in-progress',
        attempt,
        attempts: task.attempt ? upsertAttemptHistory(task.attempts, task.attempt) : task.attempts,
      });
    } catch (error) {
      pendingAgents.delete(taskId);
      if (usesManagedWorktree) {
        await this.worktrees.releaseOwnership(taskId, attemptId).catch((releaseError) => {
          log.error(
            { err: releaseError, taskId, attemptId },
            '[ClawdbotAgent] Failed to release worktree ownership after launch persistence failed'
          );
        });
      }
      throw error;
    }

    const telemetry = getTelemetryService();
    let supervisorId: string | undefined;
    try {
      const recoveryOperations = providerRuntimeControls(providerRuntimeManifest)
        .controls.filter(
          (control) =>
            control.available && ['status', 'stop', 'reattach', 'resume'].includes(control.action)
        )
        .map((control) => control.action as RunSupervisorRecoveryOperation);
      const supervisor = await this.runSupervisor.register({
        workspaceId: taskEnvelope.workspace.workspaceId,
        taskId,
        attemptId,
        provider,
        adapter: adapter.id,
        providerVersion: providerRuntimeManifest.providerVersion,
        providerRuntimeManifestDigest: providerRuntimeManifest.digest,
        taskEnvelopeDigest: taskEnvelope.digest,
        runLaunchManifestDigest: runLaunchManifest.digest,
        worktreePath: taskEnvelope.workspace.worktreePath,
        worktreeManifestId: taskEnvelope.workspace.worktreeManifestId,
        worktreeLeaseId: taskEnvelope.workspace.ownershipLeaseId,
        recoveryOperations,
        budget: pendingAgents.get(taskId)?.budget,
      });
      supervisorId = supervisor.id;
      const pending = pendingAgents.get(taskId);
      if (!pending || pending.attemptId !== attemptId) {
        throw new ConflictError('Run supervisor no longer matches the pending launch.', {
          taskId,
          attemptId,
          supervisorId,
        });
      }
      pending.supervisorId = supervisorId;
      await this.taskService.patchTaskAttempt(taskId, attemptId, {
        runSupervisorId: supervisorId,
      });
      const startedEvent = await this.appendRunEvent(
        taskId,
        attemptId,
        'run.started',
        {
          summary: 'Agent run initialized',
          taskEnvelopeDigest: taskEnvelope.digest,
          runLaunchManifestDigest: runLaunchManifest.digest,
          providerRuntimeManifestDigest: providerRuntimeManifest.digest,
          worktreeManifestId: taskEnvelope.workspace.worktreeManifestId,
        },
        {
          provider,
          adapter: adapter.id,
          agent,
          model: launchAgentConfig?.model,
          dedupeKey: 'run.started',
        }
      );
      await this.appendRunEvent(
        taskId,
        attemptId,
        conversation.intent === 'fresh'
          ? 'conversation.started'
          : conversation.intent === 'resume'
            ? 'conversation.resumed'
            : conversation.intent === 'follow-up'
              ? 'conversation.followed-up'
              : 'conversation.forked',
        {
          mode: conversation.mode,
          intent: conversation.intent,
          parentAttemptId: conversation.parentAttemptId,
          parentConversationId: conversation.parentConversationId,
          forkTurnId: conversation.forkTurnId,
        },
        {
          provider,
          adapter: adapter.id,
          agent,
          model: launchAgentConfig?.model,
          causalEventId: startedEvent.eventId,
          dedupeKey: `conversation.${conversation.mode}`,
        }
      );

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

      await telemetry.emit<RunStartedEvent>({
        type: 'run.started',
        taskId,
        attemptId,
        agent,
        model: launchAgentConfig?.model,
        project: task.project,
        harnessSupport: this.harnessTelemetry(harnessSupport),
      });

      await adapter.start({
        task,
        agentConfig: launchAgentConfig,
        transport: providerTransport,
        logPath,
        attemptId,
        startedAt,
        emitter,
        attempt,
        sandboxPolicy: sandboxPolicy.result,
        runLaunchManifest,
        conversation,
      });
    } catch (error: unknown) {
      const startError = error instanceof Error ? error : new Error(String(error));
      await this.appendRunEvent(
        taskId,
        attemptId,
        'run.failed',
        {
          summary: this.redactTraceText(startError.message || `Failed to start ${adapter.label}`),
          phase: 'launch',
        },
        {
          provider,
          adapter: adapter.id,
          agent,
          model: launchAgentConfig?.model,
          dedupeKey: 'run.launch-failed',
        }
      ).catch((journalError) => {
        log.error(
          { err: journalError, taskId, attemptId },
          'Failed to record launch failure in run event journal'
        );
      });
      pendingAgents.delete(taskId);
      this.recordTraceStep(attemptId, 'error', {
        eventType: 'run.start_failed',
        error: this.redactTraceText(startError.message || `Failed to start ${adapter.label}`),
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
      if (supervisorId) {
        await this.runSupervisor
          .markTerminal(
            supervisorId,
            'failed',
            this.redactTraceText(startError.message || `Failed to start ${adapter.label}`)
          )
          .catch((supervisorError) => {
            log.error(
              { err: supervisorError, taskId, attemptId, supervisorId },
              'Failed to mark the durable run supervisor after launch failure'
            );
          });
      }
      await telemetry.emit<RunErrorEvent>({
        type: 'run.error',
        taskId,
        attemptId,
        agent,
        project: task.project,
        error: startError.message || `Failed to start ${adapter.label}`,
        stackTrace: startError.stack,
        harnessSupport: this.harnessTelemetry(harnessSupport, 'launch-failed'),
      });
      throw new Error(`Failed to start agent via ${adapter.label}: ${startError.message}`, {
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
      conversation,
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
  private normalizeTerminalClaim(
    result: AgentTerminalResult,
    terminalSource: TaskTerminalSource
  ): ProviderTerminalClaim {
    if (result.status) {
      return {
        terminalSource,
        status: result.status,
        summary: result.summary,
        error: result.error,
        blockers: result.blockers,
        evidence: result.evidence,
        artifacts: result.artifacts,
        verification: result.verification,
        continuation: result.continuation,
      };
    }
    return this.providerCompletions.normalizeLegacyClaim(
      {
        success: result.success === true,
        summary: result.summary,
        error: result.error,
      },
      terminalSource
    );
  }

  async completeAgent(
    taskId: string,
    result: AgentTerminalResult,
    provenance: AgentCompletionProvenance
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending) {
      const task = await this.taskService.getTask(taskId);
      const persistedAttempt = task?.attempt;
      const terminalSource = provenance.terminalSource ?? 'callback';
      if (
        persistedAttempt?.id === provenance.attemptId &&
        persistedAttempt.providerRuntimeManifest?.digest ===
          provenance.providerRuntimeManifestDigest &&
        persistedAttempt.taskEnvelope
      ) {
        this.assertPersistedAttemptCompletionBinding(taskId, persistedAttempt);
        this.assertTerminalTransport(persistedAttempt.provider, terminalSource);
        const claim = this.normalizeTerminalClaim(result, terminalSource);
        const idempotencyKey = this.providerCompletions.idempotencyKey({
          taskEnvelope: persistedAttempt.taskEnvelope,
          claim,
        });
        if (persistedAttempt.completionResult) {
          const persistedCompletion = this.parsePersistedCompletion(persistedAttempt);
          if (persistedCompletion.idempotencyKey === idempotencyKey) {
            await this.revokeRunCredentialLeases(
              taskId,
              persistedAttempt.id,
              persistedCompletion.status,
              persistedAttempt.runLaunchManifest?.digest
            );
            return;
          }
          throw new ConflictError(
            'Provider completion conflicts with the persisted terminal result',
            {
              attemptId: provenance.attemptId,
              persistedIdempotencyKey: persistedCompletion.idempotencyKey,
              completionIdempotencyKey: idempotencyKey,
              remediation: 'Discard the conflicting callback; the attempt already has an owner.',
            }
          );
        }
        if (
          task &&
          persistedAttempt.provider === 'openclaw' &&
          (terminalSource === 'callback' || terminalSource === 'remote-session') &&
          (persistedAttempt.status === 'running' || persistedAttempt.status === 'failed')
        ) {
          await this.persistRestartedProviderCompletion(
            task,
            persistedAttempt,
            claim,
            idempotencyKey
          );
          return;
        }
      }
      throw new ConflictError('Provider completion does not match the active run', {
        activeAttemptId: task?.attempt?.id,
        completionAttemptId: provenance.attemptId,
        activeManifestDigest: task?.attempt?.providerRuntimeManifest?.digest,
        completionManifestDigest: provenance.providerRuntimeManifestDigest,
        remediation:
          'Discard the stale callback and retry only from the provider process bound to the active attempt manifest.',
      });
    }
    if (
      pending.attemptId !== provenance.attemptId ||
      pending.providerRuntimeManifest.digest !== provenance.providerRuntimeManifestDigest
    ) {
      throw new ConflictError('Provider completion does not match the active run', {
        activeAttemptId: pending.attemptId,
        completionAttemptId: provenance.attemptId,
        activeManifestDigest: pending.providerRuntimeManifest.digest,
        completionManifestDigest: provenance.providerRuntimeManifestDigest,
        remediation:
          'Discard the stale callback and retry only from the provider process bound to the active attempt manifest.',
      });
    }

    const terminalSource = provenance.terminalSource ?? 'callback';
    this.assertTerminalTransport(pending.provider, terminalSource);
    const claim = this.normalizeTerminalClaim(result, terminalSource);
    const idempotencyKey = this.providerCompletions.idempotencyKey({
      taskEnvelope: pending.taskEnvelope,
      claim,
    });
    await this.finalizePendingAgent(
      taskId,
      pending,
      async () => ({
        ...result,
        terminalSource,
      }),
      idempotencyKey
    );
  }

  private assertTerminalTransport(
    provider: string | undefined,
    terminalSource: TaskTerminalSource
  ): void {
    if (
      provider !== 'openclaw' &&
      (terminalSource === 'callback' || terminalSource === 'remote-session')
    ) {
      throw new ConflictError(
        'Provider completion transport is owned by the configured harness adapter',
        {
          provider,
          terminalSource,
          remediation: 'Use the harness-owned process or stream terminal path for this provider.',
        }
      );
    }
  }

  private parsePersistedCompletion(attempt: TaskAttempt): CompletionResult {
    if (!attempt.taskEnvelope || !attempt.completionResult) {
      throw new CompletionOwnershipError(
        'Persisted provider completion is missing its task envelope',
        {
          attemptId: attempt.id,
        }
      );
    }
    try {
      return parseCompletionResultForEnvelope(attempt.completionResult, attempt.taskEnvelope);
    } catch {
      throw new CompletionOwnershipError(
        'Persisted provider completion failed integrity validation',
        {
          attemptId: attempt.id,
          remediation:
            'Repair or remove the corrupted completion record before accepting another terminal claim.',
        }
      );
    }
  }

  private assertCompletionRetryBinding(
    taskId: string,
    expectedAttempt: TaskAttempt,
    latestAttempt: TaskAttempt
  ): void {
    this.assertPersistedAttemptCompletionBinding(taskId, latestAttempt);
    const mismatches = [
      expectedAttempt.provider !== latestAttempt.provider && 'provider',
      expectedAttempt.providerRuntimeManifest?.digest !==
        latestAttempt.providerRuntimeManifest?.digest && 'provider runtime manifest',
      expectedAttempt.taskEnvelope?.digest !== latestAttempt.taskEnvelope?.digest &&
        'task envelope',
      expectedAttempt.runLaunchManifest?.digest !== latestAttempt.runLaunchManifest?.digest &&
        'run launch manifest',
    ].filter((field): field is string => typeof field === 'string');
    if (mismatches.length > 0) {
      throw new CompletionOwnershipError(
        'Persisted attempt binding changed during completion retry',
        {
          attemptId: latestAttempt.id,
          mismatches,
          remediation:
            'Discard the stale local finalizer and reconcile the currently persisted attempt.',
        }
      );
    }
  }

  private assertPersistedAttemptCompletionBinding(taskId: string, attempt: TaskAttempt): void {
    const providerRuntimeManifest = attempt.providerRuntimeManifest;
    const taskEnvelope = attempt.taskEnvelope;
    if (!providerRuntimeManifest || !taskEnvelope) {
      throw new CompletionOwnershipError(
        'Persisted attempt is missing immutable completion bindings',
        { taskId, attemptId: attempt.id }
      );
    }
    let parsedEnvelope: TaskEnvelope;
    let parsedRunLaunchManifest: RunLaunchManifest | undefined;
    try {
      assertProviderRuntimeManifestSnapshot(providerRuntimeManifest);
      parsedEnvelope = parseTaskEnvelope(taskEnvelope);
      parsedRunLaunchManifest = attempt.runLaunchManifest
        ? parseRunLaunchManifest(attempt.runLaunchManifest)
        : undefined;
    } catch {
      throw new CompletionOwnershipError('Persisted attempt binding failed integrity validation', {
        taskId,
        attemptId: attempt.id,
      });
    }
    const mismatches = [
      attempt.provider !== providerRuntimeManifest.provider && 'attempt runtime provider',
      parsedEnvelope.subject.id !== taskId && 'task ID',
      parsedEnvelope.attempt.id !== attempt.id && 'attempt ID',
      parsedEnvelope.launchManifest.digest !== providerRuntimeManifest.digest &&
        'envelope runtime digest',
      parsedEnvelope.launchManifest.provider !== providerRuntimeManifest.provider &&
        'envelope runtime provider',
      parsedEnvelope.launchManifest.adapter !== providerRuntimeManifest.adapter &&
        'envelope runtime adapter',
      parsedEnvelope.launchManifest.protocolVersion !== providerRuntimeManifest.protocolVersion &&
        'envelope runtime protocol',
      parsedRunLaunchManifest?.taskId !== undefined &&
        parsedRunLaunchManifest.taskId !== taskId &&
        'run launch task ID',
      parsedRunLaunchManifest?.attemptId !== undefined &&
        parsedRunLaunchManifest.attemptId !== attempt.id &&
        'run launch attempt ID',
      parsedRunLaunchManifest?.taskEnvelope.digest !== undefined &&
        parsedRunLaunchManifest.taskEnvelope.digest !== parsedEnvelope.digest &&
        'run launch task envelope digest',
      parsedRunLaunchManifest?.providerRuntime.digest !== undefined &&
        parsedRunLaunchManifest.providerRuntime.digest !== providerRuntimeManifest.digest &&
        'run launch runtime digest',
      parsedRunLaunchManifest?.providerRuntime.provider !== undefined &&
        parsedRunLaunchManifest.providerRuntime.provider !== providerRuntimeManifest.provider &&
        'run launch runtime provider',
      parsedRunLaunchManifest?.providerRuntime.adapter !== undefined &&
        parsedRunLaunchManifest.providerRuntime.adapter !== providerRuntimeManifest.adapter &&
        'run launch runtime adapter',
    ].filter((field): field is string => typeof field === 'string');
    if (mismatches.length > 0) {
      throw new CompletionOwnershipError('Persisted attempt completion bindings do not agree', {
        taskId,
        attemptId: attempt.id,
        mismatches,
        remediation: 'Repair the persisted attempt binding before accepting a terminal completion.',
      });
    }
  }

  private async persistSupervisorCompletion(
    task: Task,
    attempt: TaskAttempt,
    value: CompletionResult
  ): Promise<void> {
    if (!attempt.taskEnvelope) {
      throw new CompletionOwnershipError('Durable supervisor completion has no task envelope.', {
        taskId: task.id,
        attemptId: attempt.id,
      });
    }
    this.assertPersistedAttemptCompletionBinding(task.id, attempt);
    const completionResult = parseCompletionResultForEnvelope(value, attempt.taskEnvelope);
    const completedAttempt: TaskAttempt = {
      ...attempt,
      status: completionResult.status === 'success' ? 'complete' : 'failed',
      ended: completionResult.completedAt,
      completionResult,
      runRecovery: undefined,
    };
    let taskSnapshot = task;
    let lastError: unknown;
    for (
      let persistenceAttempt = 1;
      persistenceAttempt <= COMPLETION_PERSISTENCE_ATTEMPTS;
      persistenceAttempt++
    ) {
      try {
        const updatedTask = await this.taskService.updateTask(task.id, {
          expectedRevision: normalizedTaskRevision(taskSnapshot),
          status: taskStatusForCompletion(completionResult.status),
          attempt: completedAttempt,
          attempts: upsertAttemptHistory(taskSnapshot.attempts, completedAttempt),
        });
        if (!updatedTask) {
          throw new CompletionOwnershipError(
            'Task was archived or deleted before supervisor completion could be persisted.',
            { taskId: task.id, attemptId: attempt.id }
          );
        }
        lastError = undefined;
        break;
      } catch (error) {
        if (error instanceof CompletionOwnershipError) throw error;
        lastError = error;
        const latestTask = await this.taskService.getTask(task.id);
        if (latestTask?.attempt?.id !== attempt.id) throw error;
        this.assertCompletionRetryBinding(task.id, completedAttempt, latestTask.attempt);
        if (latestTask.attempt.completionResult) {
          const persisted = this.parsePersistedCompletion(latestTask.attempt);
          if (persisted.idempotencyKey === completionResult.idempotencyKey) {
            lastError = undefined;
            break;
          }
          throw new CompletionOwnershipError(
            'A different terminal result already owns this attempt.',
            {
              taskId: task.id,
              attemptId: attempt.id,
              persistedIdempotencyKey: persisted.idempotencyKey,
              completionIdempotencyKey: completionResult.idempotencyKey,
            }
          );
        }
        taskSnapshot = latestTask;
      }
    }
    if (lastError) throw lastError;
    await this.revokeRunCredentialLeases(
      task.id,
      attempt.id,
      completionResult.status,
      attempt.runLaunchManifest?.digest
    );
    if (attempt.taskEnvelope.workspace.worktreeManifestId) {
      await this.worktrees.releaseOwnership(task.id, attempt.id).catch((error) => {
        log.error(
          { err: error, taskId: task.id, attemptId: attempt.id },
          'Failed to release worktree ownership after supervisor completion recovery'
        );
      });
    }
  }

  private async persistRestartedProviderCompletion(
    task: Task,
    attempt: TaskAttempt,
    claim: ProviderTerminalClaim,
    idempotencyKey: string,
    options: { preserveNonActiveTaskStatus?: boolean } = {}
  ): Promise<void> {
    if (!attempt.taskEnvelope) {
      throw new ConflictError('Restarted provider completion has no task envelope', {
        taskId: task.id,
        attemptId: attempt.id,
      });
    }
    this.assertPersistedAttemptCompletionBinding(task.id, attempt);
    const completionResult = await this.providerCompletions.complete({
      task,
      taskEnvelope: attempt.taskEnvelope,
      claim,
    });
    const completedAttempt: TaskAttempt = {
      ...attempt,
      status: completionResult.status === 'success' ? 'complete' : 'failed',
      ended: completionResult.completedAt,
      completionResult,
    };
    const completionStatus = taskStatusForCompletion(completionResult.status);
    if (attempt.provider === 'openclaw' && completionResult.summary) {
      await this.appendMappedProviderEvent(
        task,
        attempt.id,
        undefined,
        'openclaw',
        this.resolveProviderAdapter('openclaw').runEventMapper.mapEvent(
          'message.completed',
          {
            type: 'message.completed',
            event_id: `completion_${completionResult.idempotencyKey}`,
          },
          completionResult.summary
        )
      );
    }
    await this.appendRunEvent(
      task.id,
      attempt.id,
      'run.recovered',
      {
        summary: completionResult.summary,
        status: completionResult.status,
        terminalSource: completionResult.terminalSource,
      },
      {
        provider: executableProvider(attempt.provider),
        adapter: attempt.provider ?? 'restart-reconciliation',
        agent: attempt.agent,
        model: attempt.model,
        dedupeKey: `run.recovery:${completionResult.idempotencyKey}`,
      }
    );
    await this.appendRunEvent(
      task.id,
      attempt.id,
      completionResult.status === 'success'
        ? 'run.completed'
        : completionResult.status === 'interrupted'
          ? 'run.interrupted'
          : 'run.failed',
      {
        summary: completionResult.summary,
        error: completionResult.error,
        status: completionResult.status,
        terminalSource: completionResult.terminalSource,
      },
      {
        provider: executableProvider(attempt.provider),
        adapter: attempt.provider ?? 'restart-reconciliation',
        agent: attempt.agent,
        model: attempt.model,
        dedupeKey: `run.terminal:${completionResult.idempotencyKey}`,
      }
    );
    const supervisor = await this.runSupervisor.findByAttempt(
      attempt.taskEnvelope.workspace.workspaceId,
      task.id,
      attempt.id
    );
    if (supervisor) {
      await this.runSupervisor.markTerminal(
        supervisor.id,
        completionResult.status === 'success'
          ? 'completed'
          : completionResult.status === 'interrupted'
            ? 'interrupted'
            : 'failed',
        completionResult.summary,
        completionResult.idempotencyKey,
        completionResult
      );
    }
    let taskSnapshot = task;
    let lastError: unknown;
    for (
      let persistenceAttempt = 1;
      persistenceAttempt <= COMPLETION_PERSISTENCE_ATTEMPTS;
      persistenceAttempt++
    ) {
      const taskStatusUpdate =
        options.preserveNonActiveTaskStatus && taskSnapshot.status !== 'in-progress'
          ? {}
          : { status: completionStatus };
      try {
        const updatedTask = await this.taskService.updateTask(task.id, {
          expectedRevision: normalizedTaskRevision(taskSnapshot),
          ...taskStatusUpdate,
          attempt: completedAttempt,
          attempts: upsertAttemptHistory(taskSnapshot.attempts, completedAttempt),
        });
        if (!updatedTask) {
          throw new CompletionOwnershipError(
            'Task was archived or deleted before completion could be persisted',
            { taskId: task.id, attemptId: attempt.id }
          );
        }
        lastError = undefined;
        break;
      } catch (error) {
        if (error instanceof CompletionOwnershipError) throw error;
        lastError = error;
        const latestTask = await this.taskService.getTask(task.id);
        if (latestTask?.attempt?.id !== attempt.id) throw error;
        this.assertCompletionRetryBinding(task.id, completedAttempt, latestTask.attempt);
        if (latestTask.attempt.completionResult) {
          const latestCompletion = this.parsePersistedCompletion(latestTask.attempt);
          if (latestCompletion.idempotencyKey === idempotencyKey) {
            lastError = undefined;
            break;
          }
          throw new CompletionOwnershipError(
            'A different terminal result already owns this attempt',
            {
              taskId: task.id,
              attemptId: attempt.id,
              persistedIdempotencyKey: latestCompletion.idempotencyKey,
              completionIdempotencyKey: idempotencyKey,
            }
          );
        }
        taskSnapshot = latestTask;
      }
    }
    if (lastError) throw lastError;

    await this.revokeRunCredentialLeases(
      task.id,
      attempt.id,
      completionResult.status,
      attempt.runLaunchManifest?.digest
    );
    if (attempt.taskEnvelope.workspace.worktreeManifestId) {
      await this.worktrees.releaseOwnership(task.id, attempt.id).catch((error) => {
        log.error(
          { err: error, taskId: task.id, attemptId: attempt.id },
          '[ClawdbotAgent] Failed to release worktree ownership after restarted completion'
        );
      });
    }

    log.info(
      { taskId: task.id, attemptId: attempt.id, terminalSource: claim.terminalSource },
      '[ClawdbotAgent] Persisted provider completion after server restart'
    );
  }

  private async finalizePendingAgent(
    taskId: string,
    pending: PendingAgent,
    prepareResult: () => Promise<AgentTerminalResult>,
    expectedIdempotencyKey?: string
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
      if (
        expectedIdempotencyKey &&
        pending.terminalClaimIdempotencyKey !== expectedIdempotencyKey
      ) {
        throw new ConflictError('Provider completion conflicts with the claimed terminal result', {
          attemptId: pending.attemptId,
          claimedIdempotencyKey: pending.terminalClaimIdempotencyKey,
          completionIdempotencyKey: expectedIdempotencyKey,
          remediation: 'Discard the conflicting claim; terminal ownership is already committed.',
        });
      }
      return;
    }
    if (
      expectedIdempotencyKey &&
      pending.terminalClaimIdempotencyKey &&
      pending.terminalClaimIdempotencyKey !== expectedIdempotencyKey
    ) {
      throw new ConflictError('Provider completion conflicts with the claimed terminal result', {
        attemptId: pending.attemptId,
        claimedIdempotencyKey: pending.terminalClaimIdempotencyKey,
        completionIdempotencyKey: expectedIdempotencyKey,
        remediation: 'Discard the conflicting claim; terminal ownership is already committed.',
      });
    }

    // Defer preparation to the next microtask so the ownership claim is
    // registered before a synchronous provider stop can emit `close`.
    const finalization = Promise.resolve().then(async () => {
      const result = pending.preparedFinalizationResult ?? (await prepareResult());
      pending.preparedFinalizationResult = result;
      const claim = this.normalizeTerminalClaim(result, result.terminalSource ?? 'process');
      const idempotencyKey = this.providerCompletions.idempotencyKey({
        taskEnvelope: pending.taskEnvelope,
        claim,
      });
      if (expectedIdempotencyKey && expectedIdempotencyKey !== idempotencyKey) {
        throw new ConflictError('Prepared terminal result changed after ownership was claimed', {
          attemptId: pending.attemptId,
          claimedIdempotencyKey: expectedIdempotencyKey,
          completionIdempotencyKey: idempotencyKey,
        });
      }
      if (
        pending.terminalClaimIdempotencyKey &&
        pending.terminalClaimIdempotencyKey !== idempotencyKey
      ) {
        throw new ConflictError('Terminal result conflicts with the claimed completion owner', {
          attemptId: pending.attemptId,
          claimedIdempotencyKey: pending.terminalClaimIdempotencyKey,
          completionIdempotencyKey: idempotencyKey,
        });
      }
      pending.terminalClaimIdempotencyKey = idempotencyKey;
      await this.completePendingAgent(taskId, result, pending);
    });
    finalizingAgents.set(pending, finalization);
    try {
      await finalization;
    } catch (error) {
      if (error instanceof CompletionOwnershipError && pendingAgents.get(taskId) === pending) {
        pendingAgents.delete(taskId);
      }
      throw error;
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
        await this.appendRunEvent(
          taskId,
          attemptId,
          'usage.updated',
          {
            runtimeSeconds: Math.ceil(timing.durationMs / 1000),
            source: 'run-completion',
          },
          {
            provider: pending.provider,
            adapter: pending.provider,
            agent: pending.agent,
            model: pending.model,
            dedupeKey: 'usage.runtime-terminal',
          }
        );
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
        if (!taskBeforeCompletion) {
          throw new ConflictError('Task disappeared before completion could be persisted', {
            taskId,
            attemptId,
          });
        }
        const claim = this.normalizeTerminalClaim(result, result.terminalSource ?? 'process');
        const completionResult = await this.providerCompletions.complete({
          task: taskBeforeCompletion,
          taskEnvelope: pending.taskEnvelope,
          claim,
        });
        const status: AttemptStatus = completionResult.status === 'success' ? 'complete' : 'failed';
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
          runSupervisorId: pending.supervisorId,
          runLaunchManifestTraceId: pending.runLaunchManifestTraceId,
          runLaunchParentAttemptId: pending.runLaunchParentAttemptId,
          runLaunchManifestDrift: pending.runLaunchManifestDrift,
          conversation: pending.conversation,
          completionResult,
        };
        return (pending.preparedCompletion = {
          status,
          taskBeforeCompletion,
          completedAttempt,
          completionResult,
        });
      })());
    const { status, taskBeforeCompletion, completionResult } = preparedCompletion;
    const successful = completionResult.status === 'success';

    if (pending.provider === 'openclaw' && completionResult.summary) {
      await this.appendMappedProviderEvent(
        taskBeforeCompletion,
        attemptId,
        undefined,
        'openclaw',
        this.resolveProviderAdapter('openclaw').runEventMapper.mapEvent(
          'message.completed',
          {
            type: 'message.completed',
            event_id: `completion_${completionResult.idempotencyKey}`,
          },
          completionResult.summary
        )
      );
    }
    const terminalKind: RunEventKind =
      completionResult.status === 'success'
        ? 'run.completed'
        : completionResult.status === 'interrupted'
          ? 'run.interrupted'
          : 'run.failed';
    await this.appendRunEvent(
      taskId,
      attemptId,
      terminalKind,
      {
        summary: completionResult.summary,
        error: completionResult.error,
        status: completionResult.status,
        terminalSource: completionResult.terminalSource,
        durationMs: timing.durationMs,
      },
      {
        provider: pending.provider,
        adapter: pending.provider,
        agent: pending.agent,
        model: pending.model,
        dedupeKey: `run.terminal:${completionResult.idempotencyKey}`,
      }
    );
    if (pending.supervisorId) {
      await this.runSupervisor.markTerminal(
        pending.supervisorId,
        completionResult.status === 'success'
          ? 'completed'
          : completionResult.status === 'interrupted'
            ? 'interrupted'
            : 'failed',
        completionResult.summary,
        completionResult.idempotencyKey,
        completionResult
      );
    }
    const persistedHere = await this.persistPendingCompletion(taskId, pending, preparedCompletion);
    if (pendingAgents.get(taskId) === pending) {
      pendingAgents.delete(taskId);
    }
    this.clearRecoveredProcessMonitor(taskId);
    if (!persistedHere) return;

    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const summary = completionResult.summary;
    const { durationMs } = timing;
    const completionStepType = successful ? 'complete' : 'error';
    const requestFile = path.join(getRuntimeDir(), 'agent-requests', `${taskId}.json`);
    const postCommitEffects: Array<[string, () => void | Promise<void>]> = [
      [
        'release worktree ownership',
        () =>
          pending.taskEnvelope.workspace.worktreeManifestId
            ? this.worktrees.releaseOwnership(taskId, pending.attemptId)
            : undefined,
      ],
      [
        'revoke run credential leases',
        () =>
          this.revokeRunCredentialLeases(
            taskId,
            pending.attemptId,
            completionResult.status,
            pending.runLaunchManifest?.digest
          ),
      ],
      ['close run tool sessions', () => this.toolControlPlane.closeRun(taskId, pending.attemptId)],
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
            eventType: successful ? 'run.completed' : 'run.failed',
            summary: this.redactTraceText(summary),
            success: successful,
            status,
            error: completionResult.error
              ? this.redactTraceText(completionResult.error)
              : undefined,
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
            success: successful,
            error: completionResult.error ?? undefined,
            harnessSupport: this.harnessTelemetry(
              pending.harnessSupport,
              successful ? 'none' : 'run-failed'
            ),
          }),
      ],
      [
        'complete trace',
        () => getTraceService().completeTrace(attemptId, successful ? 'completed' : 'failed'),
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
              success: successful,
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

  private async revokeRunCredentialLeases(
    taskId: string,
    attemptId: string,
    status: TaskCompletionStatus,
    runLaunchManifestDigest?: string
  ): Promise<void> {
    const reason: CredentialLeaseTerminalReason =
      status === 'success'
        ? 'run-completed'
        : status === 'interrupted'
          ? 'run-interrupted'
          : 'run-failed';
    await this.credentialLeases.revokeRun({
      taskId,
      attemptId,
      ...(runLaunchManifestDigest ? { runLaunchManifestDigest } : {}),
      reason,
    });
  }

  private async persistPendingCompletion(
    taskId: string,
    pending: PendingAgent,
    prepared: NonNullable<PendingAgent['preparedCompletion']>
  ): Promise<boolean> {
    let taskSnapshot = prepared.taskBeforeCompletion;
    let lastError: unknown;
    for (let attempt = 1; attempt <= COMPLETION_PERSISTENCE_ATTEMPTS; attempt++) {
      if (!taskSnapshot) {
        throw new ConflictError('Task disappeared before completion could be persisted', {
          taskId,
          attemptId: pending.attemptId,
        });
      }
      try {
        const updatedTask = await this.taskService.updateTask(taskId, {
          expectedRevision: normalizedTaskRevision(taskSnapshot),
          status: taskStatusForCompletion(prepared.completionResult.status),
          attempt: prepared.completedAttempt,
          attempts: upsertAttemptHistory(taskSnapshot.attempts, prepared.completedAttempt),
        });
        if (!updatedTask) {
          throw new CompletionOwnershipError(
            'Task was archived or deleted before completion could be persisted',
            { taskId, attemptId: pending.attemptId }
          );
        }
        return true;
      } catch (error) {
        if (error instanceof CompletionOwnershipError) throw error;
        lastError = error;
        let latestTask: Task | null;
        try {
          latestTask = await this.taskService.getTask(taskId);
        } catch {
          latestTask = null;
        }
        if (!latestTask) continue;
        if (latestTask.attempt?.id !== pending.attemptId) {
          throw new CompletionOwnershipError(
            'Provider finalization no longer matches the active attempt',
            {
              taskId,
              activeAttemptId: latestTask.attempt?.id,
              finalizationAttemptId: pending.attemptId,
            }
          );
        }
        this.assertCompletionRetryBinding(taskId, prepared.completedAttempt, latestTask.attempt);
        if (latestTask.attempt.completionResult) {
          const persisted = this.parsePersistedCompletion(latestTask.attempt);
          if (persisted.idempotencyKey === prepared.completionResult.idempotencyKey) return true;
          throw new CompletionOwnershipError(
            'A different terminal result already owns this attempt',
            {
              taskId,
              attemptId: pending.attemptId,
              persistedIdempotencyKey: persisted.idempotencyKey,
              completionIdempotencyKey: prepared.completionResult.idempotencyKey,
            }
          );
        }
        taskSnapshot = latestTask;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Provider completion persistence retry budget was exhausted');
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
      await this.stopPendingProvider(pending);
      await this.appendRunEvent(
        taskId,
        pending.attemptId,
        'run.interrupted',
        { summary: 'Stopped by user', phase: 'requested' },
        {
          provider: 'operator',
          adapter: 'veritas-run-control',
          agent: pending.agent,
          model: pending.model,
          dedupeKey: 'run.interruption-requested',
        }
      );
      this.recordTraceStep(pending.attemptId, 'abort', {
        eventType: 'run.aborted',
        summary: 'Stopped by user',
        reason: 'Stopped by user',
        agent: pending.agent,
        provider: pending.provider,
        model: pending.model,
      });
      return {
        status: 'interrupted',
        terminalSource: 'operator-interruption',
        error: 'Stopped by user',
      };
    });
  }

  private async stopPendingProvider(pending: PendingAgent): Promise<void> {
    if (pending.recoveredControl && pending.supervisorId) {
      const supervisor = await this.runSupervisor.get(pending.supervisorId);
      if (supervisor.control.kind === 'local-process') {
        await this.runSupervisor.stopLocalProcess(pending.supervisorId);
      } else {
        await this.resolveProviderAdapter(pending.provider).stop({
          taskId: pending.taskId,
          pending,
        });
      }
      return;
    }

    await this.resolveProviderAdapter(pending.provider).stop({
      taskId: pending.taskId,
      pending,
    });
    if (!pending.supervisorId) return;
    const supervisor = await this.runSupervisor.get(pending.supervisorId);
    if (supervisor.control.kind === 'local-process') {
      await this.runSupervisor.stopLocalProcess(pending.supervisorId);
    }
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
    const redacted = this.redactTraceText(content);
    const logPath = path.join(this.logsDir, `${taskId}_${pending.attemptId}.md`);

    const journalEvent = await this.appendRunEvent(
      taskId,
      pending.attemptId,
      'message.operator',
      {
        content: `${actor}: ${redacted}`,
        actor,
        source: options.source || 'agent-panel',
      },
      {
        provider: 'operator',
        adapter: 'veritas-operator-message',
        agent: pending.agent,
        model: pending.model,
      }
    );
    await this.appendLog(
      logPath,
      `\n## Operator Message\n\n**Actor:** ${actor}\n**Source:** ${
        options.source || 'agent-panel'
      }\n\n${redacted}\n`
    );
    this.emitJournalOutput(journalEvent);
    this.recordTraceStep(pending.attemptId, 'execute', {
      eventType: 'operator.message',
      actor,
      source: options.source,
      summary: redacted,
      agent: pending.agent,
      provider: pending.provider,
      model: pending.model,
    });

    if (pending.provider === 'codex-app-server' && pending.codexAppServerControl) {
      const turnId = await pending.codexAppServerControl.steer(content);
      const conversation = await this.recordConversationIdentity(taskId, pending.attemptId, {
        turnId,
      });
      await this.appendRunEvent(
        taskId,
        pending.attemptId,
        'conversation.steered',
        {
          actor,
          conversationId: conversation.conversationId,
          turnId,
        },
        {
          provider: pending.provider,
          adapter: pending.provider,
          agent: pending.agent,
          model: pending.model,
          causalEventId: journalEvent.eventId,
          dedupeKey: `conversation.steered:${journalEvent.eventId}`,
        }
      );
      return {
        action: 'steer',
        taskId,
        attemptId: pending.attemptId,
        delivered: true,
        note: 'Message delivered through provider-native turn steering.',
        conversation,
      };
    }

    return {
      action: 'steer',
      taskId,
      attemptId: pending.attemptId,
      delivered: false,
      note: 'Provider does not expose a verified native steering control; message was recorded only.',
      conversation: pending.conversation,
    };
  }

  async resumeConversation(
    taskId: string,
    sourceAttemptId: string,
    message: string,
    options: Omit<AgentStartOptions, 'conversation' | 'parentAttemptId'> = {}
  ): Promise<AgentStatus> {
    const source = this.conversationLifecycle.source(
      await this.findAttempt(sourceAttemptId),
      'resume'
    );
    return this.startAgent(taskId, source.attempt.agent, {
      ...options,
      parentAttemptId: source.attempt.id,
      conversation: { mode: 'resume', intent: 'resume', sourceAttemptId, message },
    });
  }

  async followUpConversation(
    taskId: string,
    sourceAttemptId: string,
    message: string,
    options: Omit<AgentStartOptions, 'conversation' | 'parentAttemptId'> = {}
  ): Promise<AgentStatus> {
    const source = this.conversationLifecycle.source(
      await this.findAttempt(sourceAttemptId),
      'resume'
    );
    return this.startAgent(taskId, source.attempt.agent, {
      ...options,
      parentAttemptId: source.attempt.id,
      conversation: {
        mode: 'resume',
        intent: 'follow-up',
        sourceAttemptId,
        message,
      },
    });
  }

  async forkConversation(
    taskId: string,
    sourceAttemptId: string,
    message: string,
    forkTurnId?: string,
    options: Omit<AgentStartOptions, 'conversation' | 'parentAttemptId'> = {}
  ): Promise<AgentStatus> {
    const source = this.conversationLifecycle.source(
      await this.findAttempt(sourceAttemptId),
      'fork'
    );
    return this.startAgent(taskId, source.attempt.agent, {
      ...options,
      parentAttemptId: source.attempt.id,
      conversation: {
        mode: 'fork',
        intent: 'fork',
        sourceAttemptId,
        message,
        ...(forkTurnId ? { forkTurnId } : {}),
      },
    });
  }

  async compactConversation(
    taskId: string,
    attemptId: string,
    actor = 'operator'
  ): Promise<ConversationLifecycleResult> {
    const pending = this.assertPendingConversation(taskId, attemptId);
    await this.assertPendingRunControl(taskId, pending, 'compact');
    if (!pending.codexAppServerControl) {
      throw new ConflictError('The active provider has no native compaction control.');
    }
    await pending.codexAppServerControl.compact();
    const conversation = await this.transitionPendingConversation(taskId, pending, 'compacted');
    await this.recordConversationControlEvent(taskId, pending, 'compact', actor, conversation);
    return {
      action: 'compact',
      taskId,
      attemptId,
      delivered: true,
      note: 'Provider-native conversation compaction started.',
      conversation,
    };
  }

  async archiveConversation(
    taskId: string,
    attemptId: string,
    actor = 'operator'
  ): Promise<ConversationLifecycleResult> {
    const pending = this.assertPendingConversation(taskId, attemptId);
    let conversation = pending.conversation;
    await this.finalizePendingAgent(taskId, pending, async () => {
      await this.assertPendingRunControl(taskId, pending, 'archive');
      if (!pending.codexAppServerControl) {
        throw new ConflictError('The active provider has no native archive control.');
      }
      await pending.codexAppServerControl.archive();
      conversation = await this.transitionPendingConversation(taskId, pending, 'archived');
      await this.recordConversationControlEvent(taskId, pending, 'archive', actor, conversation);
      pending.codexAppServerControl.close();
      return {
        status: 'interrupted',
        terminalSource: 'operator-interruption',
        error: 'Conversation archived by operator',
      };
    });
    return {
      action: 'archive',
      taskId,
      attemptId,
      delivered: true,
      note: 'Provider-native conversation archive completed.',
      conversation,
    };
  }

  async closeConversation(
    taskId: string,
    attemptId: string,
    actor = 'operator'
  ): Promise<ConversationLifecycleResult> {
    const pending = this.assertPendingConversation(taskId, attemptId);
    let conversation = pending.conversation;
    await this.finalizePendingAgent(taskId, pending, async () => {
      await this.assertPendingRunControl(taskId, pending, 'close');
      await pending.codexAppServerControl?.interrupt();
      conversation = await this.transitionPendingConversation(taskId, pending, 'closed');
      await this.recordConversationControlEvent(taskId, pending, 'close', actor, conversation);
      pending.codexAppServerControl?.close();
      return {
        status: 'interrupted',
        terminalSource: 'operator-interruption',
        error: 'Conversation closed by operator',
      };
    });
    return {
      action: 'close',
      taskId,
      attemptId,
      delivered: true,
      note: 'Conversation closed and any active provider turn was interrupted.',
      conversation,
    };
  }

  async interruptConversation(
    taskId: string,
    attemptId: string,
    actor = 'operator'
  ): Promise<ConversationLifecycleResult> {
    const pending = this.assertPendingConversation(taskId, attemptId);
    const conversation = pending.conversation;
    await this.finalizePendingAgent(taskId, pending, async () => {
      await this.assertPendingRunControl(taskId, pending, 'interrupt');
      await this.stopPendingProvider(pending);
      await this.recordConversationControlEvent(taskId, pending, 'interrupt', actor, conversation);
      return {
        status: 'interrupted',
        terminalSource: 'operator-interruption',
        error: 'Conversation interrupted by operator',
      };
    });
    return {
      action: 'interrupt',
      taskId,
      attemptId,
      delivered: true,
      note: 'Provider turn interrupted.',
      conversation,
    };
  }

  private assertPendingConversation(taskId: string, attemptId: string): PendingAgent {
    const pending = pendingAgents.get(taskId);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Conversation control does not match the active attempt.', {
        taskId,
        requestedAttemptId: attemptId,
        activeAttemptId: pending?.attemptId,
      });
    }
    return pending;
  }

  private async transitionPendingConversation(
    taskId: string,
    pending: PendingAgent,
    state: 'compacted' | 'archived' | 'closed'
  ): Promise<ConversationLifecycleRecord> {
    const conversation = this.conversationLifecycle.transition(pending.conversation, state);
    pending.conversation = conversation;
    await this.taskService.patchTaskAttempt(taskId, pending.attemptId, { conversation });
    return conversation;
  }

  private async recordConversationControlEvent(
    taskId: string,
    pending: PendingAgent,
    action: 'interrupt' | 'compact' | 'archive' | 'close',
    actor: string,
    conversation: ConversationLifecycleRecord
  ): Promise<void> {
    const event = await this.appendRunEvent(
      taskId,
      pending.attemptId,
      action === 'interrupt'
        ? 'conversation.interrupted'
        : action === 'compact'
          ? 'conversation.compacted'
          : action === 'archive'
            ? 'conversation.archived'
            : 'conversation.closed',
      {
        action,
        actor: actor.trim() || 'operator',
        conversationId: conversation.conversationId,
        turnId: conversation.currentTurnId,
        state: conversation.state,
      },
      {
        provider: 'operator',
        adapter: 'veritas-conversation-lifecycle',
        agent: pending.agent,
        model: pending.model,
        dedupeKey: `conversation.${action}:${conversation.updatedAt}`,
      }
    );
    this.emitJournalOutput(event);
  }

  async recordBudgetUsage(
    taskId: string,
    attemptId: string,
    delta: Partial<AgentBudgetUsage>
  ): Promise<void> {
    await this.appendRunEvent(taskId, attemptId, 'usage.updated', {
      ...delta,
      source: 'external-report',
    });
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
        status: 'interrupted',
        terminalSource: 'operator-interruption',
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

  private async resolveLaunchToolPolicy(
    profileLaunch: AgentProfileResolvedLaunch | undefined
  ): Promise<{ allowed: string[]; denied: string[] }> {
    const policyIds = profileLaunch?.profile.policy?.toolPolicyIds ?? [];
    if (policyIds.length === 0) return { allowed: [], denied: [] };
    const denied = new Set<string>();
    let allowed: Set<string> | undefined;
    const service = getToolPolicyService();
    for (const policyId of policyIds) {
      const policy = await service.getToolPolicy(policyId);
      if (!policy) {
        throw new ConflictError(`Tool policy ${policyId} was not found.`, {
          profileId: profileLaunch?.profile.id,
          policyId,
        });
      }
      for (const tool of policy.denied) denied.add(tool);
      if (policy.allowed.includes('*')) continue;
      const current = new Set(policy.allowed);
      allowed =
        allowed === undefined ? current : new Set([...allowed].filter((tool) => current.has(tool)));
    }
    return {
      allowed: [...(allowed ?? [])].sort(),
      denied: [...denied].sort(),
    };
  }

  private intersectToolAllowLists(profileAllowed: string[], policyAllowed: string[]): string[] {
    const normalize = (values: string[]) =>
      values.length === 0 || values.includes('*') ? undefined : new Set(values);
    const profile = normalize(profileAllowed);
    const policy = normalize(policyAllowed);
    if (!profile && !policy) return [];
    if (!profile) return [...(policy as Set<string>)].sort();
    if (!policy) return [...profile].sort();
    return [...profile].filter((tool) => policy.has(tool)).sort();
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
        agentConfig.provider === 'codex-app-server' ||
        agentConfig.provider === 'claude-code' ||
        agentConfig.provider === 'acp-stdio' ||
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
      agent === 'codex-app-server' &&
      path.basename(agentConfig?.command.trim().split(/\s+/)[0] ?? '') === 'codex'
    ) {
      provider = 'codex-app-server';
    } else if (
      agent === 'claude-code' &&
      path.basename(agentConfig?.command.trim().split(/\s+/)[0] ?? '') === 'claude'
    ) {
      provider = 'claude-code';
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
        runEventMapper: getProviderRunEventMapper(provider),
        start: async ({
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
          await this.startCodexCli(
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
        runEventMapper: getProviderRunEventMapper(provider),
        start: async ({
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
            if (error instanceof CompletionPersistenceError) {
              if (emitter.listenerCount('error') > 0) {
                emitter.emit('error', error.persistenceCause);
              }
              log.error(
                { err: error.persistenceCause, taskId: task.id, attemptId },
                'Codex SDK completion could not be persisted after bounded retries'
              );
              return;
            }
            abortController.abort();
            const message = this.redactTraceText(
              error instanceof Error ? error.message : 'Codex SDK attempt failed'
            );
            try {
              const journalEvent = await this.appendRunEvent(
                task.id,
                attemptId,
                'run.error',
                { summary: message, error: message, phase: 'stream' },
                {
                  provider: 'codex-sdk',
                  adapter: 'codex-sdk',
                  agent: agentConfig?.type || 'codex-sdk',
                  model: agentConfig?.model,
                }
              );
              this.emitJournalOutput(journalEvent);
              await this.appendLog(logPath, `\n## Codex SDK Error\n\n${message}\n`);
            } catch (logError) {
              log.error(
                { err: logError, taskId: task.id },
                'Failed to record Codex SDK error evidence'
              );
            }
            try {
              await this.completeAgent(
                task.id,
                { success: false, error: message },
                {
                  attemptId,
                  terminalSource: 'stream',
                  providerRuntimeManifestDigest: current.providerRuntimeManifest.digest,
                }
              );
            } catch (finalizationError) {
              const retryable =
                current.preparedCompletion !== undefined &&
                !(finalizationError instanceof CompletionOwnershipError);
              if (!retryable && pendingAgents.get(task.id)?.attemptId === attemptId) {
                pendingAgents.delete(task.id);
              }
              if (emitter.listenerCount('error') > 0) {
                emitter.emit('error', finalizationError);
              }
              log.error(
                { err: finalizationError, taskId: task.id, attemptId, retryable },
                retryable
                  ? 'Codex SDK failure completion remains pending after bounded persistence retries'
                  : 'Codex SDK failure could not update stale persisted attempt state'
              );
            }
          });
        },
        stop: ({ pending }) => {
          pending.abortController?.abort();
        },
      };
    }

    if (provider === 'codex-app-server') {
      return {
        id: definition.id,
        label: definition.label,
        renderTaskEnvelope: renderCodexAppServerTaskEnvelope,
        probe,
        runEventMapper: getProviderRunEventMapper(provider),
        start: async ({
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
          await this.startCodexAppServer(
            task,
            agentConfig,
            transport.content,
            logPath,
            attemptId,
            startedAt,
            emitter,
            sandboxPolicy,
            runLaunchManifest
          );
        },
        stop: async ({ pending }) => {
          try {
            await pending.codexAppServerControl?.interrupt();
          } catch (error) {
            log.warn(
              { err: error, taskId: pending.taskId },
              'Codex app-server cooperative interrupt failed; closing the supervised process'
            );
          }
          pending.codexAppServerControl?.close();
          const child = pending.process;
          if (!child || child.exitCode != null || child.signalCode != null) return;
          const forcedStop = setTimeout(() => {
            if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
          }, 5_000);
          child.once('close', () => clearTimeout(forcedStop));
        },
      };
    }

    if (provider === 'acp-stdio') {
      return {
        id: definition.id,
        label: definition.label,
        renderTaskEnvelope: renderAcpStdioTaskEnvelope,
        probe: (context) => this.probeAcpProviderRuntime(context, definition),
        runEventMapper: getProviderRunEventMapper(provider),
        start: async ({
          task,
          agentConfig,
          transport,
          logPath,
          attemptId,
          sandboxPolicy,
          runLaunchManifest,
          conversation,
        }) => {
          this.assertProviderAdapterTransport(provider, transport, runLaunchManifest);
          await this.startAcpStdio(
            task,
            agentConfig,
            transport.content,
            logPath,
            attemptId,
            sandboxPolicy,
            runLaunchManifest,
            conversation
          );
        },
        stop: async ({ pending }) => {
          pending.abortController?.abort();
          await pending.acpControl?.cancel().catch(() => undefined);
          await pending.acpControl?.close().catch(() => undefined);
        },
      };
    }

    if (provider === 'claude-code') {
      return {
        id: definition.id,
        label: definition.label,
        renderTaskEnvelope: renderClaudeCodeTaskEnvelope,
        probe,
        runEventMapper: getProviderRunEventMapper(provider),
        start: async ({
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
          await this.startClaudeCode(
            task,
            agentConfig,
            transport.content,
            logPath,
            attemptId,
            startedAt,
            emitter,
            sandboxPolicy,
            runLaunchManifest
          );
        },
        stop: ({ pending }) => {
          const child = pending.process;
          if (!child || child.exitCode != null || child.signalCode != null) return;
          child.kill('SIGTERM');
          const forcedStop = setTimeout(() => {
            if (child.exitCode == null && child.signalCode == null) {
              child.kill('SIGKILL');
              log.warn(
                { taskId: pending.taskId },
                '[ClawdbotAgent] Claude Code SIGKILL issued after graceful stop timeout'
              );
            }
          }, 5_000);
          child.once('close', () => clearTimeout(forcedStop));
        },
      };
    }

    if (provider === 'hermes-cli') {
      return {
        id: definition.id,
        label: definition.label,
        renderTaskEnvelope: renderHermesTaskEnvelope,
        probe,
        runEventMapper: getProviderRunEventMapper(provider),
        start: async ({
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
          await this.startHermesCli(
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
      runEventMapper: getProviderRunEventMapper(provider),
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
        await this.recordConversationIdentity(task.id, attemptId, {
          conversationId: result.sessionKey,
        });
        void this.recordAgentStarted(
          task,
          attemptId,
          agentConfig?.type || 'openclaw',
          'openclaw',
          agentConfig
        );
        const pending = pendingAgents.get(task.id);
        if (!pending || pending.attemptId !== attemptId || !pending.supervisorId) {
          throw new ConflictError('OpenClaw session has no durable run supervisor binding.', {
            taskId: task.id,
            attemptId,
          });
        }
        pending.openclawSessionKey = result.sessionKey;
        await this.runSupervisor.attachRemoteSession(pending.supervisorId, result.sessionKey);
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
      manifest.tools.mcpServers.length > 0 &&
      (!manifest.tools.catalogDigest || manifest.tools.enforcement !== 'enforced')
    ) {
      throw new ConflictError('The selected adapter has no immutable run-scoped tool catalog.', {
        provider,
        manifestDigest: manifest.digest,
        remediation: 'Validate and compile every selected tool server before provider dispatch.',
      });
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

  private async probeAcpProviderRuntime(
    context: AgentProviderProbeContext,
    definition: ReturnType<typeof getProviderRuntimeAdapterDefinition>
  ): Promise<ProviderRuntimeManifest> {
    const agentConfig = context.agentConfig;
    if (!agentConfig) {
      throw new ConflictError('ACP runtime probe requires an explicit agent configuration.');
    }
    const supportProfile = normalizeHarnessSupportProfile(agentConfig);
    if (supportProfile.id === GROK_BUILD_RUNTIME_PROFILE_ID) {
      assertGrokBuildVersionEvidence(context.health.providerVersion);
    }
    const args = this.buildAcpProviderArgs(agentConfig, supportProfile.id);
    const runtime = await probeAcpStdioRuntime({
      command: agentConfig.command,
      args,
      cwd: context.cwd ?? process.cwd(),
      environment: process.env,
      environmentKeys: [
        ...supportProfile.launch.environmentAllowlist,
        ...supportProfile.launch.credentialAllowlist,
      ],
      runtimeProfileId: supportProfile.id,
    });
    const base = this.buildProviderRuntimeProbeRequest('acp-stdio', context, definition);
    const providerVersion = acpProviderVersion(runtime);
    return this.providerRuntimeManifests.probe({
      ...base,
      protocolVersion: 'acp/v1',
      identity: {
        ...base.identity,
        providerVersion,
        providerBuild: acpCapabilityBuild(runtime),
        verified: true,
        source: runtime.agentInfo.version ? 'acp-initialize:agentInfo' : 'acp-initialize:protocol',
        diagnostics: [
          ...(base.identity.diagnostics ?? []),
          `ACP protocol ${runtime.protocolVersion} negotiated with ${runtime.agentInfo.name}.`,
          ...(runtime.runtimeProfile
            ? [
                `ACP runtime profile ${runtime.runtimeProfile.id}@${runtime.runtimeProfile.revision} matches tested release ${runtime.runtimeProfile.testedRelease} (${runtime.runtimeProfile.testedCommit}).`,
                `Known limitations: ${runtime.runtimeProfile.limitations.join(', ')}.`,
              ]
            : []),
        ],
      },
      capabilities: negotiatedAcpCapabilities(definition.capabilities, runtime),
    });
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
        : provider === 'codex-app-server'
          ? CODEX_APP_SERVER_CERTIFIED_BUILD
          : undefined;
    const diagnostics: string[] = [...(context.health.diagnostics ?? [])];

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

  private async attachSpawnedProcess(
    pending: PendingAgent,
    child: ChildProcessWithoutNullStreams
  ): Promise<void> {
    if (!pending.supervisorId || !child.pid) {
      child.kill('SIGTERM');
      throw new ConflictError('Provider process has no durable run supervisor binding.', {
        taskId: pending.taskId,
        attemptId: pending.attemptId,
        supervisorId: pending.supervisorId,
        pid: child.pid,
      });
    }
    try {
      await this.runSupervisor.attachLocalProcess(
        pending.supervisorId,
        child.pid,
        process.platform === 'win32' ? undefined : child.pid
      );
    } catch (error) {
      child.kill('SIGTERM');
      throw error;
    }
  }

  private async startAcpStdio(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    sandboxPolicy: SandboxPolicyDryRunResult | undefined,
    runLaunchManifest: RunLaunchManifest,
    conversation: ConversationLifecycleRecord
  ): Promise<void> {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath || !agentConfig) {
      throw new ConflictError('ACP launch requires an explicit agent and task worktree.');
    }
    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('ACP launch no longer matches the active attempt.');
    }
    const supportProfile = normalizeHarnessSupportProfile(agentConfig);
    const runToolCatalog = runLaunchManifest.tools.catalogDigest
      ? await this.toolControlPlane.getRunCatalog(task.id, attemptId)
      : undefined;
    if (runToolCatalog && runToolCatalog.digest !== runLaunchManifest.tools.catalogDigest) {
      throw new ConflictError('ACP run tool catalog does not match launch evidence.');
    }
    const mcpServers = runToolCatalog ? await this.toolControlPlane.acpConfig(runToolCatalog) : [];
    const toolEnvironmentKeys = runToolCatalog
      ? await this.toolControlPlane.environmentKeys(runToolCatalog)
      : [];
    const approvalAbort = new AbortController();
    pending.abortController = approvalAbort;
    let activeSessionId: string | undefined;
    const summaryChunks: string[] = [];
    const control = await openAcpStdio({
      command: agentConfig.command,
      args: this.buildAcpProviderArgs(agentConfig, supportProfile.id),
      cwd: worktreePath,
      environment: process.env,
      environmentKeys: [
        ...(sandboxPolicy?.effective.envPassthrough ?? []),
        ...toolEnvironmentKeys,
        ...supportProfile.launch.environmentAllowlist,
        ...supportProfile.launch.credentialAllowlist,
      ],
      runtimeProfileId: supportProfile.id,
      onSpawn: async (child) => {
        pending.process = child;
        await this.attachSpawnedProcess(pending, child);
      },
      onNotification: async (notification) => {
        if (activeSessionId && notification.sessionId !== activeSessionId) {
          throw new ConflictError('ACP session update does not match the active session.', {
            expectedSessionId: activeSessionId,
            receivedSessionId: notification.sessionId,
          });
        }
        const summary = await this.recordAcpSessionUpdate(
          task,
          attemptId,
          agentConfig,
          notification
        );
        if (summary) summaryChunks.push(summary);
      },
      onPermissionRequest: (request) =>
        this.resolveAcpPermission(task, attemptId, agentConfig, request, approvalAbort.signal),
    });
    const launchProviderVersion = acpProviderVersion(control.probe);
    if (
      runLaunchManifest.providerRuntime.providerBuild !== acpCapabilityBuild(control.probe) ||
      runLaunchManifest.providerRuntime.providerVersion !== launchProviderVersion
    ) {
      await control.close();
      throw new ConflictError(
        'ACP runtime identity or capabilities drifted after launch evidence was compiled.',
        {
          expectedProviderVersion: runLaunchManifest.providerRuntime.providerVersion,
          receivedProviderVersion: launchProviderVersion,
          expectedProviderBuild: runLaunchManifest.providerRuntime.providerBuild,
          receivedProviderBuild: acpCapabilityBuild(control.probe),
          remediation: 'Compile a new launch preview and start the run again.',
        }
      );
    }
    try {
      activeSessionId = await control.openSession({
        mode: conversation.mode,
        cwd: worktreePath,
        mcpServers,
        conversationId: conversation.conversationId ?? conversation.parentConversationId,
      });
    } catch (error) {
      approvalAbort.abort();
      await control.close().catch(() => undefined);
      throw error;
    }
    pending.acpControl = control;
    pending.threadId = activeSessionId;
    await this.recordConversationIdentity(task.id, attemptId, {
      conversationId: activeSessionId,
    });
    await this.recordAgentStarted(task, attemptId, agentConfig.type, 'acp-stdio', agentConfig);

    void control
      .prompt(prompt)
      .then(async (response) => {
        approvalAbort.abort();
        await control.close();
        const summary =
          summaryChunks.join('').trim().slice(-20_000) ||
          `ACP session stopped with ${response.stopReason}.`;
        await this.finalizePendingAgent(task.id, pending, async () => ({
          status: acpCompletionStatus(response.stopReason),
          terminalSource: 'stream',
          summary,
          ...(response.stopReason === 'refusal'
            ? { error: 'ACP agent refused the requested turn.' }
            : {}),
        }));
      })
      .catch(async (error: unknown) => {
        approvalAbort.abort();
        await control.close().catch(() => undefined);
        if (pendingAgents.get(task.id) !== pending) return;
        const message = this.redactTraceText(
          error instanceof Error ? error.message : 'ACP prompt failed.'
        );
        await this.appendLog(logPath, `\n## ACP Error\n\n${message}\n`).catch(() => undefined);
        await this.finalizePendingAgent(task.id, pending, async () => ({
          status: 'failed',
          terminalSource: 'stream',
          error: message,
          summary: message,
        }));
      });
  }

  private async recordAcpSessionUpdate(
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig,
    notification: AcpSessionNotification
  ): Promise<string | undefined> {
    const update = notification.update;
    const updateType = update.sessionUpdate;
    const summary = this.redactTraceText(acpUpdateSummary(update));
    const kind: RunEventKind =
      updateType === 'agent_message_chunk'
        ? 'message.delta'
        : updateType === 'agent_thought_chunk'
          ? 'reasoning.delta'
          : updateType === 'user_message_chunk'
            ? 'message.operator'
            : updateType === 'tool_call'
              ? 'tool.started'
              : updateType === 'tool_call_update'
                ? update.status === 'completed' || update.status === 'failed'
                  ? 'tool.completed'
                  : 'progress'
                : updateType === 'plan'
                  ? 'progress'
                  : 'provider.unknown';
    const event = await this.appendRunEvent(
      task.id,
      attemptId,
      kind,
      {
        providerType: `acp.${updateType}`,
        summary,
        update,
      },
      {
        provider: 'acp-stdio',
        adapter: 'acp-stdio',
        agent: agentConfig.type,
        model: agentConfig.model,
        sessionId: notification.sessionId,
        itemId:
          'toolCallId' in update && typeof update.toolCallId === 'string'
            ? update.toolCallId
            : undefined,
      }
    );
    this.emitJournalOutput(event);
    this.recordTraceStep(attemptId, kind === 'run.error' ? 'error' : 'stream', {
      provider: 'acp-stdio',
      eventType: `acp.${updateType}`,
      summary,
    });
    return updateType === 'agent_message_chunk' ? summary : undefined;
  }

  private async resolveAcpPermission(
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig,
    request: AcpRequestPermissionRequest,
    signal: AbortSignal
  ): Promise<AcpRequestPermissionResponse> {
    const pending = pendingAgents.get(task.id);
    if (
      !pending ||
      pending.attemptId !== attemptId ||
      (pending.threadId && request.sessionId !== pending.threadId)
    ) {
      throw new ConflictError('ACP permission request does not match the active run.');
    }
    const actionClass = acpApprovalActionClass(request.toolCall.kind);
    const riskClass = acpApprovalRisk(request.toolCall.kind);
    const approval = await this.approvalBroker.request({
      workspaceId: 'local',
      taskId: task.id,
      attemptId,
      provider: 'acp-stdio',
      agentId: agentConfig.type,
      providerRequestId: request.toolCall.toolCallId,
      threadId: request.sessionId,
      itemId: request.toolCall.toolCallId,
      requestKind: 'approval',
      actionClass,
      action: request.toolCall.title || request.toolCall.name || 'ACP tool call',
      details: this.redactTraceText(JSON.stringify(request.toolCall.rawInput ?? {})).slice(
        0,
        4_000
      ),
      workingDirectory: task.git?.worktreePath,
      resourceScope: (request.toolCall.locations ?? []).map((location) => location.path),
      riskClass,
      policyReason: 'ACP provider requested permission through session/request_permission.',
      evidenceRevision: pending.runLaunchManifest.digest,
      mobileSafe: riskClass === 'low',
      exactAction: {
        name: request.toolCall.name,
        kind: request.toolCall.kind,
        input: request.toolCall.rawInput,
        options: request.options.map((option) => ({
          optionId: option.optionId,
          kind: option.kind,
        })),
      },
    });
    let decision: Awaited<ReturnType<RunApprovalBrokerService['awaitDecision']>>;
    try {
      decision = await this.approvalBroker.awaitDecision(approval.id, { signal });
    } catch (error) {
      if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
      throw error;
    }
    if (decision.request.status === 'approved') {
      const allowed = request.options.find((option) => option.kind === 'allow_once');
      return allowed
        ? { outcome: { outcome: 'selected', optionId: allowed.optionId } }
        : { outcome: { outcome: 'cancelled' } };
    }
    if (decision.request.status === 'rejected') {
      const rejected = request.options.find((option) => option.kind === 'reject_once');
      return rejected
        ? { outcome: { outcome: 'selected', optionId: rejected.optionId } }
        : { outcome: { outcome: 'cancelled' } };
    }
    return { outcome: { outcome: 'cancelled' } };
  }

  private async startCodexAppServer(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter,
    sandboxPolicy: SandboxPolicyDryRunResult | undefined,
    runLaunchManifest: RunLaunchManifest
  ): Promise<void> {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Codex app-server');
    }
    const runToolCatalog = runLaunchManifest.tools.catalogDigest
      ? await this.toolControlPlane.getRunCatalog(task.id, attemptId)
      : undefined;
    if (runToolCatalog && runToolCatalog.digest !== runLaunchManifest.tools.catalogDigest) {
      throw new ConflictError('Run tool catalog does not match launch evidence.');
    }
    const mcpServers = runToolCatalog
      ? await this.toolControlPlane.providerConfig(runToolCatalog)
      : undefined;
    const toolEnvironmentKeys = runToolCatalog
      ? await this.toolControlPlane.environmentKeys(runToolCatalog)
      : [];
    const command = agentConfig?.command || 'codex';
    const args = buildCodexAppServerArgs(agentConfig?.args);
    const child = spawn(command, args, {
      cwd: worktreePath,
      env: buildSafeCodexAppServerEnv(process.env, [
        ...(sandboxPolicy?.effective.envPassthrough ?? []),
        ...toolEnvironmentKeys,
      ]),
      shell: false,
      detached: process.platform !== 'win32',
    });
    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      child.kill('SIGTERM');
      throw new ConflictError('Codex app-server launch was cancelled before process spawn.', {
        taskId: task.id,
        attemptId,
      });
    }
    pending.process = child;
    await this.attachSpawnedProcess(pending, child);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let finalSummary = '';
    let terminalResult: CodexAppServerTerminalResult | undefined;
    let tokenUsage: CodexAppServerUsage | undefined;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let eventProcessing = Promise.resolve();
    let eventProcessingError: Error | undefined;
    let launchError: Error | undefined;
    let runtimeTimedOut = false;
    let gracefulCloseTimer: NodeJS.Timeout | undefined;
    let gracefulCloseRequested = false;
    const approvalBroker = this.approvalBroker;
    const approvalTasks = new Set<Promise<void>>();
    const runtimeSeconds = runLaunchManifest.budget.enabled
      ? runLaunchManifest.budget.limits?.runtimeSeconds
      : undefined;
    if (
      runtimeSeconds !== undefined &&
      runtimeSeconds > 0 &&
      !Number.isSafeInteger(runtimeSeconds * 1_000)
    ) {
      child.kill('SIGTERM');
      throw new Error('Codex app-server runtime budget exceeds the supported timer range.');
    }

    const enqueueEventProcessing = (work: () => Promise<void>) => {
      eventProcessing = eventProcessing.then(async () => {
        if (eventProcessingError) return;
        try {
          await work();
        } catch (error) {
          eventProcessingError =
            error instanceof Error ? error : new Error('Provider event ingestion failed closed.');
          void approvalBroker
            .cancelAttempt('local', task.id, attemptId, 'Codex app-server event ingestion failed.')
            .catch((cancelError) => {
              log.warn(
                { err: cancelError, taskId: task.id, attemptId },
                'Failed to cancel Codex app-server approvals after event ingestion failure'
              );
            });
          rpcClient.close(eventProcessingError);
          child.kill('SIGTERM');
        }
      });
    };

    const rpcClient = new CodexAppServerRpcClient({
      write(line) {
        if (!child.stdin.writable) {
          throw new Error('Codex app-server stdin is not writable.');
        }
        child.stdin.write(line);
      },
      onOverloadRetry: (method, retryAttempt, delayMs) => {
        enqueueEventProcessing(async () => {
          const event = await this.appendRunEvent(
            task.id,
            attemptId,
            'progress',
            {
              summary: `Codex app-server overloaded during ${method}; retry ${retryAttempt} scheduled in ${delayMs}ms.`,
              method,
              retryAttempt,
              delayMs,
            },
            {
              provider: 'codex-app-server',
              adapter: 'codex-app-server',
              agent: agentConfig?.type || 'codex-app-server',
              model: agentConfig?.model,
              dedupeKey: `codex-app-server.overload:${method}:${retryAttempt}`,
            }
          );
          this.emitJournalOutput(event);
        });
      },
    });

    const closeConnection = () => {
      rpcClient.close(new Error('Codex app-server connection is closing.'));
      if (child.stdin.writable) child.stdin.end();
      if (gracefulCloseTimer || child.exitCode != null || child.signalCode != null) return;
      gracefulCloseTimer = setTimeout(() => {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
      }, 5_000);
    };

    const cancelAndDrainApprovals = async (reason: string) => {
      await approvalBroker.cancelAttempt('local', task.id, attemptId, reason);
      await Promise.allSettled([...approvalTasks]);
    };

    const requestGracefulClose = (reason = 'Codex app-server connection is closing.') => {
      if (gracefulCloseRequested) return;
      gracefulCloseRequested = true;
      void cancelAndDrainApprovals(reason)
        .catch((error) => {
          log.warn(
            { err: error, taskId: task.id, attemptId },
            'Failed to drain Codex app-server approvals before close'
          );
        })
        .finally(closeConnection);
    };

    pending.codexAppServerControl = {
      interrupt: async () => {
        if (!threadId || !turnId || terminalResult) return;
        await rpcClient.interrupt(threadId, turnId);
      },
      steer: async (message) => {
        if (!threadId || !turnId || terminalResult) {
          throw new ConflictError('Codex app-server has no steerable active turn.');
        }
        const steeredTurnId = await rpcClient.steer(threadId, turnId, message);
        if (steeredTurnId !== turnId) {
          throw new ConflictError('Codex app-server steering changed the active turn identity.');
        }
        return steeredTurnId;
      },
      compact: async () => {
        if (!threadId || !turnId || terminalResult) {
          throw new ConflictError('Codex app-server has no active conversation to compact.');
        }
        await rpcClient.compact(threadId);
      },
      archive: async () => {
        if (!threadId) {
          throw new ConflictError('Codex app-server has no conversation to archive.');
        }
        await rpcClient.archive(threadId);
      },
      close: () => requestGracefulClose('Codex app-server attempt was stopped.'),
    };

    const processLine = async (line: string) => {
      const record = parseCodexAppServerLine(line);
      const inbound = await rpcClient.acceptRecord(record);
      if (inbound.kind === 'response') return;
      if (inbound.kind === 'server-request') {
        const brokerRequest = classifyCodexAppServerServerRequest(inbound.record);
        if (!brokerRequest) {
          rpcClient.respondToServerRequest(inbound.record);
          await this.handleCodexAppServerDeniedRequest(
            inbound.method,
            inbound.record,
            task,
            attemptId,
            agentConfig,
            logPath
          );
          return;
        }
        const approval = await approvalBroker.request({
          workspaceId: 'local',
          taskId: task.id,
          attemptId,
          provider: 'codex-app-server',
          agentId: agentConfig?.type || 'codex-app-server',
          evidenceRevision: runLaunchManifest.providerRuntime.digest,
          ...brokerRequest,
        });
        const approvalTask = (async () => {
          const resolution = await approvalBroker.awaitDecision(approval.id);
          if (resolution.request.status === 'pending') {
            throw new Error('Run approval broker returned a pending decision.');
          }
          rpcClient.respondToServerRequest(inbound.record, {
            status: resolution.request.status,
            responseData: resolution.responseData,
            note: resolution.request.resolution?.note,
          });
        })().catch((error) => {
          log.error(
            {
              err: error,
              taskId: task.id,
              attemptId,
              approvalId: approval.id,
              providerRequestId: brokerRequest.providerRequestId,
            },
            'Codex app-server approval resolution failed closed'
          );
          try {
            rpcClient.respondToServerRequest(inbound.record);
          } catch (responseError) {
            log.warn(
              {
                err: responseError,
                taskId: task.id,
                attemptId,
                approvalId: approval.id,
              },
              'Failed to send the fail-closed Codex app-server approval response'
            );
          }
          if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
        });
        approvalTasks.add(approvalTask);
        void approvalTask.finally(() => approvalTasks.delete(approvalTask));
        return;
      }
      const classified = await this.handleCodexAppServerNotification(
        inbound.record,
        task,
        attemptId,
        agentConfig,
        logPath
      );
      if (classified.summary) finalSummary = classified.summary;
      if (classified.usage) tokenUsage = classified.usage;
      if (classified.sessionId || classified.turnId || classified.itemId) {
        await this.recordConversationIdentity(task.id, attemptId, {
          conversationId: classified.sessionId,
          turnId: classified.turnId,
          itemId: classified.itemId,
        });
      }
      if (classified.usage) {
        await this.recordConversationContext(
          task.id,
          attemptId,
          classified.usage.totalTokens,
          classified.usage.modelContextWindow
        );
      }
      if (classified.terminal) {
        terminalResult = classified.terminal;
        requestGracefulClose('Codex app-server turn reached a terminal state.');
      }
    };

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      enqueueEventProcessing(async () => {
        await this.assertPendingManifestSnapshotForAttempt(task.id, attemptId);
        await this.recordStreamChunk(
          task,
          attemptId,
          agentConfig,
          'codex-app-server',
          'stdout',
          chunk
        );
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        if (Buffer.byteLength(stdoutBuffer, 'utf8') > CODEX_APP_SERVER_MAX_RECORD_BYTES) {
          throw new Error('Codex app-server record exceeded the 4 MiB safety limit.');
        }
        for (const line of lines) {
          if (line.trim()) await processLine(line);
        }
      });
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      const accumulated = Buffer.from(`${stderrBuffer}${chunk}`, 'utf8');
      stderrBuffer =
        accumulated.byteLength > CLAUDE_CODE_MAX_STDERR_BUFFER_BYTES
          ? accumulated
              .subarray(accumulated.byteLength - CLAUDE_CODE_MAX_STDERR_BUFFER_BYTES)
              .toString('utf8')
          : accumulated.toString('utf8');
      enqueueEventProcessing(async () => {
        await this.assertPendingManifestSnapshotForAttempt(task.id, attemptId);
        await this.recordStreamChunk(
          task,
          attemptId,
          agentConfig,
          'codex-app-server',
          'stderr',
          chunk
        );
        await this.appendLog(
          logPath,
          `\n### stderr\n\n\`\`\`\n${this.redactTraceText(chunk.trimEnd())}\n\`\`\`\n`
        );
      });
    });

    child.on('error', (error) => {
      launchError = error;
      rpcClient.close(error);
      void approvalBroker
        .cancelAttempt('local', task.id, attemptId, 'Codex app-server process failed to launch.')
        .catch((cancelError) => {
          log.warn(
            { err: cancelError, taskId: task.id, attemptId },
            'Failed to cancel Codex app-server approvals after process error'
          );
        });
      enqueueEventProcessing(async () => {
        const message = this.redactTraceText(error.message);
        const event = await this.appendRunEvent(
          task.id,
          attemptId,
          'run.error',
          { summary: message, error: message, phase: 'process' },
          {
            provider: 'codex-app-server',
            adapter: 'codex-app-server',
            agent: agentConfig?.type || 'codex-app-server',
            model: agentConfig?.model,
          }
        );
        this.emitJournalOutput(event);
        if (emitter.listenerCount('error') > 0) emitter.emit('error', error);
      });
    });

    void this.appendLog(
      logPath,
      `\n## Codex app-server\n\n**Command:** \`${[command, ...args].join(
        ' '
      )}\`\n**Worktree:** \`${worktreePath}\`\n**Configuration:** strict stdio with only the run-scoped MCP catalog; hooks, plugins, apps, and remote control disabled\n\n`
    );

    void (async () => {
      try {
        await this.recordAgentStarted(
          task,
          attemptId,
          agentConfig?.type || 'codex-app-server',
          'codex-app-server',
          agentConfig
        );
        await rpcClient.initialize();
        const threadInput = {
          cwd: worktreePath,
          model: agentConfig?.model,
          sandboxMode: sandboxPolicy?.effective.sandboxMode ?? 'workspace-write',
          ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        };
        threadId =
          pending.conversation.mode === 'resume'
            ? await rpcClient.resumeThread({
                ...threadInput,
                threadId: requireConversationId(pending.conversation, 'Codex app-server resume'),
              })
            : pending.conversation.mode === 'fork'
              ? await rpcClient.forkThread({
                  ...threadInput,
                  threadId: requireParentConversationId(
                    pending.conversation,
                    'Codex app-server fork'
                  ),
                  ...(pending.conversation.forkTurnId
                    ? { lastTurnId: pending.conversation.forkTurnId }
                    : {}),
                })
              : await rpcClient.startThread(threadInput);
        await this.recordConversationIdentity(task.id, attemptId, {
          conversationId: threadId,
        });
        if (pending.supervisorId) {
          await this.runSupervisor.checkpoint(pending.supervisorId, {
            sessionId: threadId,
            threadId,
          });
        }
        turnId = await rpcClient.startTurn({
          threadId,
          prompt,
          cwd: worktreePath,
          model: agentConfig?.model,
        });
        await this.recordConversationIdentity(task.id, attemptId, { turnId });
        await this.appendLog(
          logPath,
          `\n## Codex app-server Session\n\n**Thread:** ${threadId}\n**Turn:** ${turnId}\n`
        );
      } catch (error) {
        launchError =
          error instanceof Error ? error : new Error('Codex app-server launch failed closed.');
        rpcClient.close(launchError);
        child.kill('SIGTERM');
      }
    })();

    let runtimeTimer: NodeJS.Timeout | undefined;
    let remainingRuntimeMs =
      runtimeSeconds && runtimeSeconds > 0 ? runtimeSeconds * 1_000 : undefined;
    const onRuntimeTimeout = () => {
      runtimeTimedOut = true;
      enqueueEventProcessing(async () => {
        const message = `Codex app-server runtime limit exceeded after ${runtimeSeconds} seconds.`;
        const event = await this.appendRunEvent(
          task.id,
          attemptId,
          'run.error',
          { summary: message, error: message, phase: 'timeout' },
          {
            provider: 'codex-app-server',
            adapter: 'codex-app-server',
            agent: agentConfig?.type || 'codex-app-server',
            model: agentConfig?.model,
            dedupeKey: 'codex-app-server.runtime-timeout',
          }
        );
        this.emitJournalOutput(event);
      });
      void pending.codexAppServerControl
        ?.interrupt()
        .catch((error) => {
          log.warn(
            { err: error, taskId: task.id, attemptId },
            'Codex app-server runtime interrupt failed; closing the supervised process'
          );
        })
        .finally(() => requestGracefulClose('Codex app-server runtime budget was exhausted.'));
    };
    const scheduleRuntimeTimer = () => {
      if (remainingRuntimeMs === undefined) return;
      const delay = Math.min(remainingRuntimeMs, 2_147_483_647);
      runtimeTimer = setTimeout(() => {
        remainingRuntimeMs = Math.max(0, (remainingRuntimeMs ?? 0) - delay);
        if (remainingRuntimeMs > 0) scheduleRuntimeTimer();
        else onRuntimeTimeout();
      }, delay);
    };
    if (remainingRuntimeMs !== undefined) scheduleRuntimeTimer();

    child.on('close', (code, signal) => {
      if (runtimeTimer) clearTimeout(runtimeTimer);
      if (gracefulCloseTimer) clearTimeout(gracefulCloseTimer);
      if (pendingAgents.get(task.id) !== pending || pending.attemptId !== attemptId) return;
      void this.finalizePendingAgent(task.id, pending, async () => {
        await eventProcessing;
        if (stdoutBuffer.trim() && !eventProcessingError) {
          try {
            await processLine(stdoutBuffer);
          } catch (error) {
            eventProcessingError =
              error instanceof Error
                ? error
                : new Error('Codex app-server final stream record failed.');
          }
        }
        await cancelAndDrainApprovals('Codex app-server process exited.');
        rpcClient.close();

        const timeoutError = runtimeTimedOut
          ? `Codex app-server runtime limit exceeded after ${runtimeSeconds} seconds.`
          : undefined;
        const succeeded =
          !runtimeTimedOut &&
          !eventProcessingError &&
          !launchError &&
          terminalResult?.success === true;
        const processError =
          signal && !terminalResult
            ? `Codex app-server terminated by signal ${signal}.`
            : code !== 0 && !terminalResult
              ? `Codex app-server exited with code ${code ?? 'unknown'}.`
              : undefined;
        const missingTerminalError =
          !terminalResult && !processError
            ? 'Codex app-server stream ended without an authoritative turn/completed notification.'
            : undefined;
        const error =
          timeoutError ??
          eventProcessingError?.message ??
          launchError?.message ??
          terminalResult?.error ??
          processError ??
          missingTerminalError;
        const summary =
          finalSummary ||
          error ||
          (succeeded ? 'Codex app-server completed.' : this.redactTraceText(stderrBuffer.trim()));

        if (tokenUsage && !eventProcessingError) {
          await this.assertRunControl(task.id, 'token-usage', attemptId);
          await getTelemetryService().emit<TokenTelemetryEvent>({
            type: 'run.tokens',
            taskId: task.id,
            attemptId,
            agent: agentConfig?.type || 'codex-app-server',
            project: task.project,
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.totalTokens,
            model: agentConfig?.model,
          });
          await this.evaluatePendingBudget(
            task.id,
            attemptId,
            {
              inputTokens: tokenUsage.inputTokens,
              outputTokens: tokenUsage.outputTokens,
              totalTokens: tokenUsage.totalTokens,
            },
            'agent.tokens',
            false
          );
        }

        await this.appendLog(
          logPath,
          `\n## Codex app-server Exit\n\n**Exit code:** ${code ?? 'none'}\n**Signal:** ${
            signal ?? 'none'
          }\n**Duration:** ${Date.now() - new Date(startedAt).getTime()}ms\n**Thread:** ${
            threadId ?? 'not reported'
          }\n**Turn:** ${turnId ?? 'not reported'}\n**Result:** ${
            terminalResult?.status ?? 'missing'
          }\n`
        );
        this.recordTraceStep(attemptId, succeeded ? 'finalize' : 'error', {
          eventType: 'run.finalizing',
          exitCode: code,
          signal,
          success: succeeded,
          terminalStatus: terminalResult?.status,
          sessionId: threadId,
          turnId,
          provider: 'codex-app-server',
          agent: agentConfig?.type || 'codex-app-server',
          model: agentConfig?.model,
        });
        return {
          success: succeeded,
          terminalSource: 'stream',
          summary,
          error: succeeded ? undefined : error,
        };
      }).catch((error) => {
        if (pendingAgents.get(task.id) !== pending) return;
        log.error({ err: error, taskId: task.id }, 'Failed to finalize Codex app-server attempt');
      });
    });
  }

  private async handleCodexAppServerNotification(
    record: Record<string, unknown>,
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig | undefined,
    logPath: string
  ): Promise<CodexAppServerClassification> {
    const rawClassification = classifyCodexAppServerNotification(record);
    const classified: CodexAppServerClassification = {
      ...rawClassification,
      ...(rawClassification.summary
        ? { summary: this.redactTraceText(rawClassification.summary) }
        : {}),
      ...(rawClassification.terminal?.error
        ? {
            terminal: {
              ...rawClassification.terminal,
              error: this.redactTraceText(rawClassification.terminal.error),
            },
          }
        : {}),
    };
    const agent = agentConfig?.type || 'codex-app-server';
    const journalEvent = await this.appendMappedProviderEvent(
      task,
      attemptId,
      agentConfig,
      'codex-app-server',
      this.resolveProviderAdapter('codex-app-server').runEventMapper.mapEvent(
        classified.providerType,
        recordValueForProvider(record, 'params'),
        classified.summary
      )
    );
    this.emitJournalOutput(journalEvent);
    if (classified.usage) {
      await this.appendRunEvent(
        task.id,
        attemptId,
        'usage.updated',
        {
          inputTokens: classified.usage.inputTokens,
          outputTokens: classified.usage.outputTokens,
          totalTokens: classified.usage.totalTokens,
          model: agentConfig?.model,
        },
        {
          provider: 'codex-app-server',
          adapter: 'codex-app-server',
          agent,
          model: agentConfig?.model,
          causalEventId: journalEvent.eventId,
          dedupeKey: `${journalEvent.eventId}:usage`,
        }
      );
    }
    this.recordTraceStep(
      attemptId,
      classified.providerType.includes('delta')
        ? 'stream'
        : classified.terminal?.success
          ? 'complete'
          : classified.terminal
            ? 'error'
            : classified.providerType.includes('started')
              ? 'execute'
              : 'stream',
      {
        provider: 'codex-app-server',
        eventType: classified.providerType,
        summary: classified.summary,
        files: classified.files,
        sessionId: classified.sessionId,
        turnId: classified.turnId,
        itemId: classified.itemId,
        inputTokens: classified.usage?.inputTokens,
        outputTokens: classified.usage?.outputTokens,
        totalTokens: classified.usage?.totalTokens,
        model: agentConfig?.model,
      }
    );
    if (isCodexAppServerToolStart(record)) {
      await this.assertRunControl(task.id, 'tool-calls', attemptId);
      await this.evaluatePendingBudget(task.id, attemptId, { toolCalls: 1 }, 'agent.tool', true);
    }
    if (classified.files.length > 0) {
      await this.attachProviderDeliverables(
        task,
        attemptId,
        agent,
        'codex-app-server',
        'Codex app-server',
        classified.files
      );
    }
    if (
      classified.providerType.startsWith('item/') ||
      classified.providerType.startsWith('turn/') ||
      classified.terminal
    ) {
      await activityService.logActivity(
        'agent_event',
        task.id,
        task.title,
        {
          attemptId,
          provider: 'codex-app-server',
          eventType: classified.providerType,
          summary: classified.summary,
        },
        agent
      );
    }
    await this.appendLog(
      logPath,
      `\n### ${classified.providerType}\n\n${
        classified.summary ? `${this.redactTraceText(classified.summary)}\n\n` : ''
      }<details><summary>Raw event</summary>\n\n\`\`\`json\n${this.redactTraceText(
        JSON.stringify(journalEvent.payload.raw ?? {}, null, 2)
      )}\n\`\`\`\n\n</details>\n`
    );
    return classified;
  }

  private async handleCodexAppServerDeniedRequest(
    method: string,
    record: Record<string, unknown>,
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig | undefined,
    logPath: string
  ): Promise<void> {
    const agent = agentConfig?.type || 'codex-app-server';
    const summary = `Denied provider request ${method}; the required Veritas broker is unavailable.`;
    const requested = await this.appendMappedProviderEvent(
      task,
      attemptId,
      agentConfig,
      'codex-app-server',
      this.resolveProviderAdapter('codex-app-server').runEventMapper.mapEvent(
        method,
        recordValueForProvider(record, 'params'),
        summary
      )
    );
    this.emitJournalOutput(requested);
    const resolved = await this.appendRunEvent(
      task.id,
      attemptId,
      'approval.resolved',
      {
        summary,
        method,
        decision: 'denied',
      },
      {
        provider: 'codex-app-server',
        adapter: 'codex-app-server',
        agent,
        model: agentConfig?.model,
        causalEventId: requested.eventId,
        dedupeKey: `${requested.eventId}:denied`,
      }
    );
    this.emitJournalOutput(resolved);
    this.recordTraceStep(attemptId, 'error', {
      provider: 'codex-app-server',
      eventType: method,
      summary,
      agent,
      model: agentConfig?.model,
    });
    await activityService.logActivity(
      'agent_event',
      task.id,
      task.title,
      {
        attemptId,
        provider: 'codex-app-server',
        eventType: method,
        decision: 'denied',
      },
      agent
    );
    await this.appendLog(
      logPath,
      `\n### ${method}\n\n${summary}\n\n<details><summary>Raw request</summary>\n\n\`\`\`json\n${this.redactTraceText(
        JSON.stringify(requested.payload.raw ?? {}, null, 2)
      )}\n\`\`\`\n\n</details>\n`
    );
  }

  private async startClaudeCode(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter,
    sandboxPolicy: SandboxPolicyDryRunResult | undefined,
    runLaunchManifest: RunLaunchManifest
  ): Promise<void> {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Claude Code');
    }
    const runtimeSeconds = runLaunchManifest.budget.enabled
      ? runLaunchManifest.budget.limits?.runtimeSeconds
      : undefined;
    if (
      runtimeSeconds !== undefined &&
      runtimeSeconds > 0 &&
      !Number.isSafeInteger(runtimeSeconds * 1_000)
    ) {
      throw new Error('Claude Code runtime budget exceeds the supported timer range.');
    }
    const repositoryInstructions =
      (await this.workspaceFiles.readOptionalText(worktreePath, 'AGENTS.md'))?.trim() ?? '';
    const effectivePrompt = repositoryInstructions
      ? `${prompt}\n\n# Repository Instructions\n\n${repositoryInstructions}`
      : prompt;
    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Claude Code launch was cancelled before process spawn.', {
        taskId: task.id,
        attemptId,
      });
    }
    const runToolCatalog = runLaunchManifest.tools.catalogDigest
      ? await this.toolControlPlane.getRunCatalog(task.id, attemptId)
      : undefined;
    if (runToolCatalog && runToolCatalog.digest !== runLaunchManifest.tools.catalogDigest) {
      throw new ConflictError('Run tool catalog does not match launch evidence.');
    }
    const claudeMcp = runToolCatalog
      ? await this.toolControlPlane.claudeConfig(runToolCatalog)
      : undefined;
    const toolEnvironmentKeys = runToolCatalog
      ? await this.toolControlPlane.environmentKeys(runToolCatalog)
      : [];
    const command = agentConfig?.command || 'claude';
    const args = buildClaudeCodeArgs({
      prompt: effectivePrompt,
      model: agentConfig?.model,
      extraArgs: agentConfig?.args,
      ...(pending.conversation.mode === 'resume'
        ? {
            resumeSessionId: requireConversationId(pending.conversation, 'Claude Code resume'),
          }
        : pending.conversation.mode === 'fork'
          ? {
              resumeSessionId: requireParentConversationId(
                pending.conversation,
                'Claude Code fork'
              ),
              forkSession: true,
            }
          : {}),
      sandboxMode: sandboxPolicy?.effective.sandboxMode ?? 'workspace-write',
      networkAccessEnabled: sandboxPolicy?.effective.networkAccessEnabled ?? true,
      maxBudgetUsd: runLaunchManifest.budget.enabled
        ? runLaunchManifest.budget.limits?.costUsd
        : undefined,
      ...(claudeMcp
        ? {
            mcpConfig: claudeMcp.config,
            mcpAllowedTools: claudeMcp.allowedToolNames,
          }
        : {}),
    });
    const serializedMcpConfig = claudeMcp ? JSON.stringify(claudeMcp.config) : undefined;
    await this.appendLog(
      logPath,
      `\n## Claude Code\n\n**Command:** \`${[
        command,
        ...args.map((argument) =>
          argument === effectivePrompt
            ? '<prompt>'
            : argument === serializedMcpConfig
              ? '<run-tool-catalog>'
              : argument
        ),
      ].join(
        ' '
      )}\`\n**Worktree:** \`${worktreePath}\`\n**Configuration:** bare mode with Veritas-owned static permissions and only the run-scoped MCP catalog\n\n`
    );
    await this.recordAgentStarted(
      task,
      attemptId,
      agentConfig?.type || 'claude-code',
      'claude-code',
      agentConfig
    );

    const child = spawn(command, args, {
      cwd: worktreePath,
      env: buildSafeClaudeCodeEnv(process.env, [
        ...(sandboxPolicy?.effective.envPassthrough ?? []),
        ...toolEnvironmentKeys,
      ]),
      shell: false,
      detached: process.platform !== 'win32',
    });
    pending.process = child;
    await this.attachSpawnedProcess(pending, child);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let finalSummary = '';
    let terminalResult: ClaudeCodeTerminalResult | undefined;
    let tokenUsage: ClaudeCodeUsage | undefined;
    let recordedSessionId: string | undefined;
    let eventProcessing = Promise.resolve();
    let eventProcessingError: Error | undefined;
    let runtimeTimedOut = false;
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
    const processLine = async (line: string) => {
      const classified = await this.handleClaudeCodeJsonLine(
        line,
        task,
        attemptId,
        agentConfig,
        logPath
      );
      if (classified.summary) finalSummary = classified.summary;
      if (classified.usage) {
        tokenUsage = classified.usage;
        await this.recordConversationContext(task.id, attemptId, classified.usage.totalTokens);
      }
      if (classified.terminal) terminalResult = classified.terminal;
      if (classified.sessionId && classified.sessionId !== recordedSessionId) {
        recordedSessionId = classified.sessionId;
        await this.recordClaudeCodeSession(task, attemptId, classified.sessionId);
      }
    };

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      enqueueEventProcessing(async () => {
        await this.assertPendingManifestSnapshotForAttempt(task.id, attemptId);
        await this.recordStreamChunk(task, attemptId, agentConfig, 'claude-code', 'stdout', chunk);
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        if (Buffer.byteLength(stdoutBuffer, 'utf8') > CLAUDE_CODE_MAX_STREAM_RECORD_BYTES) {
          throw new Error('Claude Code stream record exceeded the 1 MiB safety limit.');
        }
        for (const line of lines) {
          if (line.trim()) await processLine(line);
        }
      });
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      const accumulated = Buffer.from(`${stderrBuffer}${chunk}`, 'utf8');
      stderrBuffer =
        accumulated.byteLength > CLAUDE_CODE_MAX_STDERR_BUFFER_BYTES
          ? accumulated
              .subarray(accumulated.byteLength - CLAUDE_CODE_MAX_STDERR_BUFFER_BYTES)
              .toString('utf8')
          : accumulated.toString('utf8');
      enqueueEventProcessing(async () => {
        await this.assertPendingManifestSnapshotForAttempt(task.id, attemptId);
        await this.recordStreamChunk(task, attemptId, agentConfig, 'claude-code', 'stderr', chunk);
        await this.appendLog(
          logPath,
          `\n### stderr\n\n\`\`\`\n${this.redactTraceText(chunk.trimEnd())}\n\`\`\`\n`
        );
      });
    });

    child.on('error', (error) => {
      enqueueEventProcessing(async () => {
        const message = this.redactTraceText(error.message);
        const journalEvent = await this.appendRunEvent(
          task.id,
          attemptId,
          'run.error',
          { summary: message, error: message, phase: 'process' },
          {
            provider: 'claude-code',
            adapter: 'claude-code',
            agent: agentConfig?.type || 'claude-code',
            model: agentConfig?.model,
          }
        );
        this.emitJournalOutput(journalEvent);
        await this.appendLog(logPath, `\n## Claude Code Process Error\n\n${message}\n`);
        if (emitter.listenerCount('error') > 0) emitter.emit('error', error);
      });
    });

    let runtimeTimer: NodeJS.Timeout | undefined;
    let remainingRuntimeMs =
      runtimeSeconds && runtimeSeconds > 0 ? runtimeSeconds * 1_000 : undefined;
    const onRuntimeTimeout = () => {
      runtimeTimedOut = true;
      enqueueEventProcessing(async () => {
        const message = `Claude Code runtime limit exceeded after ${runtimeSeconds} seconds.`;
        const event = await this.appendRunEvent(
          task.id,
          attemptId,
          'run.error',
          { summary: message, error: message, phase: 'timeout' },
          {
            provider: 'claude-code',
            adapter: 'claude-code',
            agent: agentConfig?.type || 'claude-code',
            model: agentConfig?.model,
            dedupeKey: 'claude-code.runtime-timeout',
          }
        );
        this.emitJournalOutput(event);
      });
      child.kill('SIGTERM');
    };
    const scheduleRuntimeTimer = () => {
      if (remainingRuntimeMs === undefined) return;
      const delay = Math.min(remainingRuntimeMs, 2_147_483_647);
      runtimeTimer = setTimeout(() => {
        remainingRuntimeMs = Math.max(0, (remainingRuntimeMs ?? 0) - delay);
        if (remainingRuntimeMs > 0) {
          scheduleRuntimeTimer();
        } else {
          onRuntimeTimeout();
        }
      }, delay);
    };
    if (remainingRuntimeMs !== undefined) scheduleRuntimeTimer();

    child.on('close', (code, signal) => {
      if (runtimeTimer) clearTimeout(runtimeTimer);
      if (!pending || pendingAgents.get(task.id) !== pending || pending.attemptId !== attemptId) {
        return;
      }
      void this.finalizePendingAgent(task.id, pending, async () => {
        await eventProcessing;
        if (stdoutBuffer.trim() && !eventProcessingError) {
          try {
            await processLine(stdoutBuffer);
          } catch (error) {
            eventProcessingError =
              error instanceof Error ? error : new Error('Claude Code final stream record failed.');
          }
        }

        const signalError = signal ? `Claude Code terminated by signal ${signal}.` : undefined;
        const timeoutError = runtimeTimedOut
          ? `Claude Code runtime limit exceeded after ${runtimeSeconds} seconds.`
          : undefined;
        const protocolError =
          eventProcessingError?.message ??
          (!terminalResult
            ? 'Claude Code stream ended without an authoritative result record.'
            : undefined);
        const succeeded =
          code === 0 &&
          !signal &&
          !runtimeTimedOut &&
          !eventProcessingError &&
          terminalResult?.success === true;
        const error =
          timeoutError ??
          protocolError ??
          terminalResult?.error ??
          signalError ??
          (!succeeded ? `Claude Code exited with code ${code ?? 'unknown'}.` : undefined);
        const summary =
          terminalResult?.summary ||
          finalSummary ||
          error ||
          (succeeded ? 'Claude Code completed.' : this.redactTraceText(stderrBuffer.trim()));

        if (tokenUsage && !eventProcessingError) {
          await this.assertRunControl(task.id, 'token-usage', attemptId);
          await getTelemetryService().emit<TokenTelemetryEvent>({
            type: 'run.tokens',
            taskId: task.id,
            attemptId,
            agent: agentConfig?.type || 'claude-code',
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
          `\n## Claude Code Exit\n\n**Exit code:** ${code ?? 'none'}\n**Signal:** ${signal ?? 'none'}\n**Duration:** ${Date.now() - new Date(startedAt).getTime()}ms\n**Session:** ${recordedSessionId ?? 'not reported'}\n**Result:** ${terminalResult?.subtype ?? 'missing'}\n`
        );
        this.recordTraceStep(attemptId, succeeded ? 'finalize' : 'error', {
          eventType: 'run.finalizing',
          exitCode: code,
          signal,
          success: succeeded,
          terminalSubtype: terminalResult?.subtype,
          sessionId: recordedSessionId,
          provider: 'claude-code',
          agent: agentConfig?.type || 'claude-code',
          model: agentConfig?.model,
        });

        return {
          success: succeeded,
          terminalSource: 'process',
          summary,
          error: succeeded ? undefined : error,
        };
      }).catch((error) => {
        if (pendingAgents.get(task.id) !== pending) return;
        log.error({ err: error, taskId: task.id }, 'Failed to finalize Claude Code attempt');
      });
    });
  }

  private async handleClaudeCodeJsonLine(
    line: string,
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig | undefined,
    logPath: string
  ): Promise<ClaudeCodeStreamClassification> {
    const record = parseClaudeCodeStreamLine(line);
    const rawClassification = classifyClaudeCodeStreamRecord(record);
    const classified: ClaudeCodeStreamClassification = {
      ...rawClassification,
      ...(rawClassification.summary
        ? { summary: this.redactTraceText(rawClassification.summary) }
        : {}),
      ...(rawClassification.terminal
        ? {
            terminal: {
              ...rawClassification.terminal,
              ...(rawClassification.terminal.summary
                ? { summary: this.redactTraceText(rawClassification.terminal.summary) }
                : {}),
              ...(rawClassification.terminal.error
                ? { error: this.redactTraceText(rawClassification.terminal.error) }
                : {}),
            },
          }
        : {}),
    };
    const agent = agentConfig?.type || 'claude-code';
    const journalEvent = await this.appendMappedProviderEvent(
      task,
      attemptId,
      agentConfig,
      'claude-code',
      this.resolveProviderAdapter('claude-code').runEventMapper.mapEvent(
        classified.providerType,
        record,
        classified.summary
      )
    );
    this.emitJournalOutput(journalEvent);
    if (classified.usage) {
      await this.appendRunEvent(
        task.id,
        attemptId,
        'usage.updated',
        {
          inputTokens: classified.usage.inputTokens,
          outputTokens: classified.usage.outputTokens,
          totalTokens: classified.usage.totalTokens,
          cost: classified.usage.cost,
          model: classified.usage.model || agentConfig?.model,
        },
        {
          provider: 'claude-code',
          adapter: 'claude-code',
          agent,
          model: classified.usage.model || agentConfig?.model,
          causalEventId: journalEvent.eventId,
          dedupeKey: `${journalEvent.eventId}:usage`,
        }
      );
    }
    this.recordTraceStep(
      attemptId,
      classified.providerType.includes('text_delta')
        ? 'stream'
        : classified.terminal?.success
          ? 'complete'
          : classified.terminal
            ? 'error'
            : classified.providerType.includes('api_retry')
              ? 'retry'
              : 'execute',
      {
        provider: 'claude-code',
        eventType: classified.providerType,
        summary: classified.summary,
        tool: classified.tool,
        files: classified.files,
        sessionId: classified.sessionId,
        parentToolUseId: classified.parentToolUseId,
        inputTokens: classified.usage?.inputTokens,
        outputTokens: classified.usage?.outputTokens,
        totalTokens: classified.usage?.totalTokens,
        cost: classified.usage?.cost,
        model: classified.usage?.model || agentConfig?.model,
      }
    );
    if (classified.tool && classified.providerType === 'assistant.tool_use') {
      await this.assertRunControl(task.id, 'tool-calls', attemptId);
      await this.evaluatePendingBudget(task.id, attemptId, { toolCalls: 1 }, 'agent.tool', true);
    }
    if (classified.files.length > 0) {
      await this.attachProviderDeliverables(
        task,
        attemptId,
        agent,
        'claude-code',
        'Claude Code',
        classified.files
      );
    }
    if (
      classified.tool ||
      classified.terminal ||
      classified.providerType.includes('hook_') ||
      classified.providerType.includes('api_retry')
    ) {
      await activityService.logActivity(
        'agent_event',
        task.id,
        task.title,
        {
          attemptId,
          provider: 'claude-code',
          eventType: classified.providerType,
          summary: classified.summary,
        },
        agent
      );
    }
    await this.appendLog(
      logPath,
      `\n### ${classified.providerType}\n\n${
        classified.summary ? `${this.redactTraceText(classified.summary)}\n\n` : ''
      }<details><summary>Raw event</summary>\n\n\`\`\`json\n${this.redactTraceText(
        JSON.stringify(journalEvent.payload.raw ?? {}, null, 2)
      )}\n\`\`\`\n\n</details>\n`
    );
    return classified;
  }

  private async recordClaudeCodeSession(
    task: Task,
    attemptId: string,
    sessionId: string
  ): Promise<void> {
    await this.recordConversationIdentity(task.id, attemptId, { conversationId: sessionId });
  }

  private async startHermesCli(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter,
    sandboxPolicy: SandboxPolicyDryRunResult | undefined
  ): Promise<void> {
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
      detached: process.platform !== 'win32',
    });

    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      child.kill('SIGTERM');
      throw new ConflictError('Hermes launch was cancelled before process spawn.', {
        taskId: task.id,
        attemptId,
      });
    }
    pending.process = child;
    await this.attachSpawnedProcess(pending, child);

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
    const SESSION_ID_PATTERN = /hermes[_-]session[_-]id[:\s]+([a-zA-Z0-9_-]{8,})/i;

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      enqueueEventProcessing(() =>
        this.recordStreamChunk(task, attemptId, agentConfig, 'hermes-cli', 'stdout', chunk)
      );
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
      enqueueEventProcessing(async () => {
        await this.recordStreamChunk(task, attemptId, agentConfig, 'hermes-cli', 'stderr', chunk);
        await this.appendLog(
          logPath,
          `\n### stderr\n\n\`\`\`\n${this.redactTraceText(chunk.trimEnd())}\n\`\`\`\n`
        );

        // Extract session identity from stderr output if Hermes emits it
        const sessionMatch = SESSION_ID_PATTERN.exec(chunk);
        if (sessionMatch) {
          const hermesSessionId = sessionMatch[1];
          const p = pendingAgents.get(task.id);
          if (p && !p.hermesSessionId) {
            p.hermesSessionId = hermesSessionId;
            if (p.supervisorId) {
              await this.runSupervisor.checkpoint(p.supervisorId, {
                sessionId: hermesSessionId,
              });
            }
            log.debug(
              { taskId: task.id, hermesSessionId },
              '[ClawdbotAgent] Hermes session ID captured'
            );
          }
        }
      });
    });

    child.on('error', (error) => {
      enqueueEventProcessing(async () => {
        const message = this.redactTraceText(error.message);
        const event = await this.appendRunEvent(
          task.id,
          attemptId,
          'run.error',
          { summary: message, error: message, phase: 'process' },
          {
            provider: 'hermes-cli',
            adapter: 'hermes-cli',
            agent: agentConfig?.type || 'hermes',
            model: agentConfig?.model,
          }
        );
        this.emitJournalOutput(event);
        this.recordTraceStep(attemptId, 'error', {
          eventType: 'process.error',
          error: message,
          provider: 'hermes-cli',
          agent: agentConfig?.type || 'hermes',
          model: agentConfig?.model,
        });
        await this.appendLog(logPath, `\n## Hermes Process Error\n\n${message}\n`);
        emitter.emit('error', error);
      });
    });

    child.on('close', (code, signal) => {
      if (!pending || pendingAgents.get(task.id) !== pending || pending.attemptId !== attemptId) {
        return;
      }
      void this.finalizePendingAgent(task.id, pending, async () => {
        await eventProcessing;
        const finalOutput = stdoutBuffer.trim() || stderrBuffer.trim();
        const success = code === 0 && !eventProcessingError;
        const boundedOutput = eventProcessingError?.message || finalOutput;

        await this.appendLog(
          logPath,
          `\n## Hermes Exit\n\n**Exit code:** ${code ?? 'none'}\n**Signal:** ${signal ?? 'none'}\n**Duration:** ${Date.now() - new Date(startedAt).getTime()}ms\n\n**Output:**\n\`\`\`\n${this.redactTraceText(boundedOutput)}\n\`\`\`\n`
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
          terminalSource: 'process',
          summary: boundedOutput || (success ? 'Hermes completed.' : undefined),
          error: success ? undefined : boundedOutput || `Hermes exited with code ${code}`,
        };
      }).catch((error) => {
        if (pendingAgents.get(task.id) !== pending) return;
        log.error({ err: error, taskId: task.id }, 'Failed to finalize Hermes attempt');
      });
    });
  }

  private async startCodexCli(
    task: Task,
    agentConfig: AgentConfig | undefined,
    prompt: string,
    logPath: string,
    attemptId: string,
    startedAt: string,
    emitter: EventEmitter,
    sandboxPolicy: SandboxPolicyDryRunResult | undefined
  ): Promise<void> {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Codex CLI');
    }

    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Codex CLI launch was cancelled before process spawn.', {
        taskId: task.id,
        attemptId,
      });
    }
    const command = agentConfig?.command || 'codex';
    const args = this.buildCodexArgs(
      agentConfig,
      prompt,
      logPath,
      attemptId,
      sandboxPolicy,
      pending.conversation
    );
    const child = spawn(command, args, {
      cwd: worktreePath,
      env: buildSafeCodexEnv(process.env, sandboxPolicy?.effective.envPassthrough),
      shell: false,
      detached: process.platform !== 'win32',
    });
    pending.process = child;
    await this.attachSpawnedProcess(pending, child);

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
        await this.recordStreamChunk(task, attemptId, agentConfig, 'codex-cli', 'stdout', chunk);
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
        await this.recordStreamChunk(task, attemptId, agentConfig, 'codex-cli', 'stderr', chunk);
        await this.appendLog(
          logPath,
          `\n### stderr\n\n\`\`\`\n${this.redactTraceText(chunk.trimEnd())}\n\`\`\`\n`
        );
      });
    });

    child.on('error', (error) => {
      enqueueEventProcessing(async () => {
        const message = this.redactTraceText(error.message);
        const journalEvent = await this.appendRunEvent(
          task.id,
          attemptId,
          'run.error',
          { summary: message, error: message, phase: 'process' },
          {
            provider: 'codex-cli',
            adapter: 'codex-cli',
            agent: agentConfig?.type || 'codex',
            model: agentConfig?.model,
          }
        );
        this.emitJournalOutput(journalEvent);
        this.recordTraceStep(attemptId, 'error', {
          eventType: 'process.error',
          error: message,
          provider: 'codex-cli',
          agent: agentConfig?.type || 'codex',
          model: agentConfig?.model,
        });
        await this.appendLog(logPath, `\n## Codex Process Error\n\n${message}\n`);
        emitter.emit('error', error);
      });
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
          terminalSource: 'process',
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
    sandboxPolicy?: SandboxPolicyDryRunResult,
    conversation?: ConversationLifecycleRecord
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
    if (conversation?.mode === 'resume') {
      if (!conversation.conversationId) {
        throw new ConflictError('Codex CLI resume requires an exact conversation ID.');
      }
      args.push('resume', conversation.conversationId, prompt);
    } else {
      args.push(prompt);
    }
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

    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Codex SDK launch was cancelled before thread creation.', {
        taskId: task.id,
        attemptId,
      });
    }
    const threadSettings = {
      workingDirectory: worktreePath,
      ...this.buildCodexSdkThreadSettings(sandboxPolicy),
      model: agentConfig?.model,
    };
    const thread =
      pending.conversation.mode === 'resume'
        ? codex.resumeThread(
            requireConversationId(pending.conversation, 'Codex SDK resume'),
            threadSettings
          )
        : codex.startThread(threadSettings);
    if (pending.conversation.mode === 'resume') {
      await this.recordConversationIdentity(task.id, attemptId, {
        conversationId: requireConversationId(pending.conversation, 'Codex SDK resume'),
      });
    }

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
      await this.recordConversationContext(
        task.id,
        attemptId,
        tokenUsage.totalTokens ?? tokenUsage.inputTokens + tokenUsage.outputTokens
      );
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

    try {
      await this.completeAgent(
        task.id,
        {
          success: !failureMessage,
          summary: finalSummary || failureMessage || 'Codex SDK completed without a final summary.',
          error: failureMessage || undefined,
        },
        {
          attemptId,
          terminalSource: 'stream',
          providerRuntimeManifestDigest:
            pendingAgents.get(task.id)?.providerRuntimeManifest.digest ?? '',
        }
      );
    } catch (error) {
      throw new CompletionPersistenceError(error);
    }
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
    if (task && attemptId) {
      await this.recordCodexEvent(task, attemptId, agentConfig, type, record, summary);
    }
    const redactedRecord = this.redactTraceText(JSON.stringify(record, null, 2));
    await this.appendLog(
      logPath,
      `\n### ${type}\n\n${summary ? `${this.redactTraceText(summary)}\n\n` : ''}<details><summary>Raw event</summary>\n\n\`\`\`json\n${redactedRecord}\n\`\`\`\n\n</details>\n`
    );
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

  private async appendRunEvent(
    taskId: string,
    attemptId: string,
    kind: RunEventKind,
    payload: Record<string, unknown>,
    options: Partial<ProviderMappedRunEvent> & {
      provider?: ExecutableAgentProvider | 'operator' | 'system';
      adapter?: string;
      agent?: string;
      model?: string;
    } = {}
  ): Promise<RunEventEnvelope> {
    const pending = pendingAgents.get(taskId);
    const provider = options.provider ?? pending?.provider ?? 'system';
    const result = await this.runEvents.append({
      taskId,
      attemptId,
      kind,
      payload,
      providerEventId: options.providerEventId,
      providerTimestamp: options.providerTimestamp,
      sessionId: options.sessionId,
      turnId: options.turnId,
      itemId: options.itemId,
      parentEventId: options.parentEventId,
      causalEventId: options.causalEventId,
      dedupeKey: options.dedupeKey,
      source: {
        provider,
        adapter: options.adapter ?? (typeof provider === 'string' ? provider : 'system'),
        agent: options.agent ?? pending?.agent,
        model: options.model ?? pending?.model,
      },
    });
    if (pending?.supervisorId && pending.attemptId === attemptId) {
      await this.runSupervisor.checkpoint(pending.supervisorId, {
        lastEventSequence: result.event.sequence,
        budget: pending.budget,
        sessionId: pending.threadId ?? pending.hermesSessionId ?? pending.openclawSessionKey,
        threadId: pending.threadId,
      });
    }
    return result.event;
  }

  private async appendMappedProviderEvent(
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig | undefined,
    provider: ExecutableAgentProvider,
    mapped: ProviderMappedRunEvent
  ): Promise<RunEventEnvelope> {
    return this.appendRunEvent(task.id, attemptId, mapped.kind, mapped.payload, {
      ...mapped,
      provider,
      adapter: provider,
      agent: agentConfig?.type || task.agent || provider,
      model: agentConfig?.model,
    });
  }

  private emitJournalOutput(event: RunEventEnvelope): void {
    const pending = pendingAgents.get(event.taskId);
    if (!pending || pending.attemptId !== event.attemptId) return;
    const content =
      typeof event.payload.content === 'string'
        ? event.payload.content
        : typeof event.payload.summary === 'string'
          ? event.payload.summary
          : undefined;
    if (!content?.trim()) return;
    const type: AgentOutput['type'] =
      event.source.provider === 'operator'
        ? 'stdin'
        : event.kind === 'stream.stderr' || event.kind === 'run.error'
          ? 'stderr'
          : event.source.provider === 'system'
            ? 'system'
            : 'stdout';
    pending.emitter.emit('output', {
      type,
      content,
      timestamp: event.receivedAt,
    } satisfies AgentOutput);
  }

  private async recordStreamChunk(
    task: Task,
    attemptId: string,
    agentConfig: AgentConfig | undefined,
    provider: ExecutableAgentProvider,
    stream: 'stdout' | 'stderr',
    chunk: string
  ): Promise<void> {
    const content = this.redactTraceText(chunk.trimEnd());
    if (!content.trim()) return;
    const mapper = this.resolveProviderAdapter(provider).runEventMapper;
    const event = await this.appendMappedProviderEvent(
      task,
      attemptId,
      agentConfig,
      provider,
      mapper.mapStream(stream, content)
    );
    this.emitJournalOutput(event);
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
            : provider === 'codex-app-server'
              ? 'codex-app-server:strict-config:approval-never'
              : provider === 'claude-code'
                ? 'claude-code:static-permissions'
                : provider === 'acp-stdio'
                  ? 'acp-stdio:negotiated-v1'
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
    const provider = agentConfig?.provider === 'codex-sdk' ? 'codex-sdk' : 'codex-cli';
    const journalEvent = await this.appendMappedProviderEvent(
      task,
      attemptId,
      agentConfig,
      provider,
      this.resolveProviderAdapter(provider).runEventMapper.mapEvent(type, event, sanitizedSummary)
    );
    this.emitJournalOutput(journalEvent);
    if (usage) {
      await this.appendRunEvent(
        task.id,
        attemptId,
        'usage.updated',
        {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cost: usage.cost,
          model: usage.model || agentConfig?.model,
        },
        {
          provider,
          adapter: provider,
          agent,
          model: usage.model || agentConfig?.model,
          causalEventId: journalEvent.eventId,
          dedupeKey: `${journalEvent.eventId}:usage`,
        }
      );
    }
    this.recordTraceStep(attemptId, stepType, {
      provider,
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
      await this.attachProviderDeliverables(
        task,
        attemptId,
        agent,
        agentConfig?.provider || 'codex-cli',
        'Codex',
        files
      );
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

  private async attachProviderDeliverables(
    task: Task,
    attemptId: string,
    agent: string,
    provider: string,
    providerLabel: string,
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
        description: `${providerLabel} event artifact from attempt ${attemptId}`,
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
        provider,
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
    await this.recordConversationIdentity(task.id, attemptId, { conversationId: threadId });
  }

  private async recordConversationIdentity(
    taskId: string,
    attemptId: string,
    identity: { conversationId?: string; turnId?: string; itemId?: string }
  ): Promise<ConversationLifecycleRecord> {
    const pending = pendingAgents.get(taskId);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Conversation identity no longer matches the active attempt.', {
        taskId,
        attemptId,
      });
    }
    const conversation = this.conversationLifecycle.bind(pending.conversation, identity);
    pending.conversation = conversation;
    if (identity.conversationId) pending.threadId = identity.conversationId;
    await this.taskService.patchTaskAttempt(taskId, attemptId, {
      ...(identity.conversationId ? { threadId: identity.conversationId } : {}),
      conversation,
    });
    if (pending.supervisorId) {
      await this.runSupervisor.checkpoint(pending.supervisorId, {
        sessionId: conversation.conversationId,
        threadId: conversation.conversationId,
      });
    }
    return conversation;
  }

  private async recordConversationContext(
    taskId: string,
    attemptId: string,
    usedTokens: number,
    limitTokens?: number
  ): Promise<ConversationLifecycleRecord> {
    const pending = pendingAgents.get(taskId);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Conversation context no longer matches the active attempt.', {
        taskId,
        attemptId,
      });
    }
    const conversation = this.conversationLifecycle.recordContext(
      pending.conversation,
      usedTokens,
      limitTokens
    );
    pending.conversation = conversation;
    await this.taskService.patchTaskAttempt(taskId, attemptId, { conversation });
    return conversation;
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
      conversation: pending.conversation,
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

  async resolveRunEventAttemptId(taskId: string, requestedAttemptId?: string): Promise<string> {
    validatePathSegment(taskId);
    if (requestedAttemptId) validatePathSegment(requestedAttemptId);
    const pending = pendingAgents.get(taskId);
    if (pending && (!requestedAttemptId || pending.attemptId === requestedAttemptId)) {
      return pending.attemptId;
    }
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new Error('Task not found');
    const attempts = [task.attempt, ...(task.attempts ?? [])].filter(
      (attempt): attempt is TaskAttempt => Boolean(attempt)
    );
    const resolved = requestedAttemptId
      ? attempts.find((attempt) => attempt.id === requestedAttemptId)
      : task.attempt;
    if (!resolved) throw new Error('Run attempt not found');
    return resolved.id;
  }

  async getRunEvents(taskId: string, attemptId: string, afterSequence = 0, limit = 200) {
    await this.assertRunControl(taskId, 'logs', attemptId);
    return this.runEvents.list({ taskId, attemptId, afterSequence, limit });
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
    runToolCatalog?: RunToolCatalog;
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
      input.sandboxPolicy,
      input.budgetPolicy,
      input.options.conversation
    );
    if (input.runToolCatalog) {
      runtime.environmentKeys = [
        ...new Set([
          ...runtime.environmentKeys,
          ...(await this.toolControlPlane.environmentKeys(input.runToolCatalog)),
        ]),
      ].sort();
      if (input.provider === 'claude-code') {
        const promptIndex = runtime.args.lastIndexOf('<prompt>');
        const marker = `<run-tool-catalog:${input.runToolCatalog.digest}>`;
        runtime.args.splice(
          promptIndex < 0 ? runtime.args.length : promptIndex,
          0,
          '--strict-mcp-config',
          '--mcp-config',
          marker
        );
      }
    }
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
      input.provider === 'codex-cli' ||
      input.provider === 'codex-sdk' ||
      input.provider === 'codex-app-server';
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
        field: 'workspace',
        scope: 'task-envelope',
        source: 'task-envelope:worktree-allocation',
        precedence: 100,
      },
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
        denied: input.runToolCatalog
          ? input.runToolCatalog.entries.flatMap((entry) =>
              entry.tools
                .filter((tool) => tool.decision === 'deny')
                .map((tool) => tool.qualifiedName)
            )
          : [],
        policyIds: profile?.policy?.toolPolicyIds ?? [],
        mcpServers: profile?.tools?.mcpServers ?? [],
        ...(input.runToolCatalog ? { catalogDigest: input.runToolCatalog.digest } : {}),
        enforcement: hasToolRestrictions
          ? 'unavailable'
          : input.runToolCatalog
            ? 'enforced'
            : hasMcpRestrictions
              ? 'unavailable'
              : 'not-required',
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
      runToolCatalog: input.runToolCatalog,
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
    sandboxPolicy: SandboxPolicyDryRunResult,
    budgetPolicy?: AgentBudgetPolicy,
    conversationRequest?: ConversationLaunchRequest
  ): RunLaunchRuntime {
    const environment = this.buildRunLaunchEnvironment(provider, sandboxPolicy, agentConfig);
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
        args: this.buildCodexArgs(
          agentConfig,
          '<prompt>',
          logPath,
          attemptId,
          sandboxPolicy,
          manifestConversation(conversationRequest)
        ).map((argument) => (argument === finalPath ? '<run-log>/final-message.md' : argument)),
      };
    }
    if (provider === 'codex-sdk') {
      const sdkExecutable = this.resolveCodexSdkExecutable(agentConfig);
      const threadSettings = this.buildCodexSdkThreadSettings(sandboxPolicy);
      return {
        ...runtimeBase,
        command: sdkExecutable.manifestCommand,
        args: [
          conversationRequest?.mode === 'resume' ? 'resumeThread' : 'startThread',
          ...(conversationRequest?.mode === 'resume' ? ['<source-conversation>'] : []),
          `skipGitRepoCheck=${threadSettings.skipGitRepoCheck}`,
          `sandboxMode=${threadSettings.sandboxMode}`,
          `approvalPolicy=${threadSettings.approvalPolicy}`,
          `networkAccessEnabled=${threadSettings.networkAccessEnabled}`,
          'runStreamed',
          '<prompt>',
        ],
      };
    }
    if (provider === 'codex-app-server') {
      return {
        ...runtimeBase,
        command: agentConfig?.command || 'codex',
        args: buildCodexAppServerArgs(agentConfig?.args),
      };
    }
    if (provider === 'claude-code') {
      return {
        ...runtimeBase,
        command: agentConfig?.command || 'claude',
        args: buildClaudeCodeArgs({
          prompt: '<prompt>',
          model: agentConfig?.model,
          extraArgs: agentConfig?.args,
          ...(conversationRequest?.mode === 'resume'
            ? { resumeSessionId: '<source-conversation>' }
            : conversationRequest?.mode === 'fork'
              ? { resumeSessionId: '<source-conversation>', forkSession: true }
              : {}),
          sandboxMode: sandboxPolicy.effective.sandboxMode,
          networkAccessEnabled: sandboxPolicy.effective.networkAccessEnabled,
          maxBudgetUsd: budgetPolicy?.enabled ? budgetPolicy.limits?.costUsd : undefined,
        }),
      };
    }
    if (provider === 'acp-stdio') {
      const supportProfile = agentConfig ? normalizeHarnessSupportProfile(agentConfig) : undefined;
      return {
        ...runtimeBase,
        command: agentConfig?.command || '',
        args: agentConfig ? this.buildAcpProviderArgs(agentConfig, supportProfile?.id) : [],
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
    sandboxPolicy: SandboxPolicyDryRunResult,
    agentConfig?: AgentConfig
  ): Pick<RunLaunchRuntime, 'environmentKeys' | 'credentialReferences'> {
    if (provider === 'codex-cli' || provider === 'codex-sdk' || provider === 'codex-app-server') {
      const environmentKeys = Object.keys(
        provider === 'codex-app-server'
          ? buildSafeCodexAppServerEnv(process.env, sandboxPolicy.effective.envPassthrough)
          : buildSafeCodexEnv(process.env, sandboxPolicy.effective.envPassthrough)
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
    if (provider === 'claude-code') {
      const environmentKeys = Object.keys(
        buildSafeClaudeCodeEnv(process.env, sandboxPolicy.effective.envPassthrough)
      );
      const credentialKeys = new Set<string>(CLAUDE_CODE_CREDENTIAL_ENV_KEYS);
      return {
        environmentKeys,
        credentialReferences: [
          ...sandboxPolicy.effective.credentialRefs,
          ...environmentKeys.filter((key) => credentialKeys.has(key)).map((key) => `env:${key}`),
        ],
      };
    }
    if (provider === 'acp-stdio') {
      const supportProfile = agentConfig ? normalizeHarnessSupportProfile(agentConfig) : undefined;
      const profileEnvironmentKeys = [
        ...(supportProfile?.launch.environmentAllowlist ?? []),
        ...(supportProfile?.launch.credentialAllowlist ?? []),
      ];
      const environmentKeys = Object.keys(
        buildSafeAcpEnv(process.env, [
          ...sandboxPolicy.effective.envPassthrough,
          ...profileEnvironmentKeys,
        ])
      );
      const credentialKeys = new Set(supportProfile?.launch.credentialAllowlist ?? []);
      return {
        environmentKeys,
        credentialReferences: [
          ...sandboxPolicy.effective.credentialRefs,
          ...environmentKeys.filter((key) => credentialKeys.has(key)).map((key) => `env:${key}`),
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

  private buildAcpProviderArgs(agentConfig: AgentConfig, supportProfileId?: string): string[] {
    if (supportProfileId === COPILOT_ACP_RUNTIME_PROFILE_ID) {
      return buildCopilotAcpArgs({
        model: agentConfig.model,
        extraArgs: agentConfig.args,
      });
    }
    if (supportProfileId === GROK_BUILD_RUNTIME_PROFILE_ID) {
      return buildGrokBuildAcpArgs({
        model: agentConfig.model,
        extraArgs: agentConfig.args,
      });
    }
    return [...agentConfig.args];
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
    const parent = currentTaskParent ?? (await this.findAttempt(parentAttemptId));
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

  private async findAttempt(attemptId: string): Promise<TaskAttempt | undefined> {
    return (await this.taskService.listTasks())
      .flatMap((candidate) => [candidate.attempt, ...(candidate.attempts ?? [])])
      .filter((attempt): attempt is TaskAttempt => Boolean(attempt))
      .find((attempt) => attempt.id === attemptId);
  }

  private normalizeConversationLaunch(
    request: ConversationLaunchRequest | undefined
  ): ConversationLaunchRequest & { mode: 'fresh' | 'resume' | 'fork' } {
    if (!request || request.mode === 'fresh') {
      if (
        request?.sourceAttemptId ||
        request?.forkTurnId ||
        (request?.intent && request.intent !== 'fresh')
      ) {
        throw new ConflictError('Fresh conversation launch cannot reference prior history.');
      }
      const message = request?.message?.trim();
      return {
        mode: 'fresh',
        intent: 'fresh',
        ...(message ? { message } : {}),
      };
    }
    const intent = request.intent ?? request.mode;
    if (
      (request.mode === 'resume' && !['resume', 'follow-up'].includes(intent)) ||
      (request.mode === 'fork' && intent !== 'fork')
    ) {
      throw new ConflictError(
        `Conversation ${intent} is incompatible with ${request.mode} launch mode.`
      );
    }
    const sourceAttemptId = request.sourceAttemptId?.trim();
    const message = request.message?.trim();
    if (!sourceAttemptId || sourceAttemptId.length > 120) {
      throw new ConflictError(`Conversation ${request.mode} requires a valid source attempt ID.`);
    }
    if (!message || Buffer.byteLength(message, 'utf8') > 20_000) {
      throw new ConflictError(
        `Conversation ${request.mode} requires a non-empty follow-up message of at most 20,000 bytes.`
      );
    }
    if (request.mode === 'resume' && request.forkTurnId) {
      throw new ConflictError('Conversation resume cannot specify a fork turn.');
    }
    const forkTurnId = request.forkTurnId?.trim();
    if (forkTurnId && forkTurnId.length > 240) {
      throw new ConflictError('Conversation fork turn ID exceeds the supported limit.');
    }
    return {
      mode: request.mode,
      intent,
      sourceAttemptId,
      message,
      ...(forkTurnId ? { forkTurnId } : {}),
    };
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

function acpCapabilityBuild(probe: AcpRuntimeProbe): string {
  return probe.runtimeProfile
    ? `acp-v1:${probe.capabilityDigest}:profile:${probe.runtimeProfile.id}@${probe.runtimeProfile.revision}:${probe.runtimeProfile.digest}`
    : `acp-v1:${probe.capabilityDigest}`;
}

function acpProviderVersion(probe: AcpRuntimeProbe): string {
  return probe.agentInfo.version
    ? `${probe.agentInfo.name} ${probe.agentInfo.version}`
    : `${probe.agentInfo.name} (ACP v1)`;
}

function negotiatedAcpCapabilities(
  baseline: ProviderRuntimeCapabilityEvidence[],
  probe: AcpRuntimeProbe
): ProviderRuntimeCapabilityEvidence[] {
  const canResume =
    probe.capabilities.loadSession === true ||
    Boolean(probe.capabilities.sessionCapabilities?.resume);
  const overrides = new Map<ProviderRuntimeCapabilityId, ProviderRuntimeCapabilityEvidence>([
    [
      'run.resume',
      acpNegotiatedCapability(
        'run.resume',
        canResume,
        'The ACP runtime negotiated session/resume or session/load.',
        'The ACP runtime did not negotiate session/resume or session/load.'
      ),
    ],
    [
      'run.follow-up',
      acpNegotiatedCapability(
        'run.follow-up',
        canResume,
        'The ACP runtime can resume the exact session for a follow-up turn.',
        'Follow-up requires negotiated session/resume or session/load support.'
      ),
    ],
    [
      'run.fork',
      acpNegotiatedCapability(
        'run.fork',
        Boolean(probe.capabilities.sessionCapabilities?.fork),
        'The ACP runtime negotiated session/fork.',
        'The ACP runtime did not negotiate session/fork.'
      ),
    ],
    [
      'run.close',
      acpNegotiatedCapability(
        'run.close',
        Boolean(probe.capabilities.sessionCapabilities?.close),
        'The ACP runtime negotiated session/close.',
        'The ACP runtime did not negotiate session/close.'
      ),
    ],
  ]);
  return baseline.map((capability) => overrides.get(capability.id) ?? capability);
}

function acpNegotiatedCapability(
  id: ProviderRuntimeCapabilityId,
  supported: boolean,
  supportedReason: string,
  unsupportedReason: string
): ProviderRuntimeCapabilityEvidence {
  return {
    id,
    state: supported ? 'supported' : 'unsupported',
    source: 'runtime-probe',
    reason: supported ? supportedReason : unsupportedReason,
  };
}

function acpCompletionStatus(stopReason: AcpStopReason): TaskCompletionStatus {
  if (stopReason === 'end_turn') return 'success';
  if (stopReason === 'refusal') return 'blocked';
  if (stopReason === 'cancelled') return 'interrupted';
  return 'partial';
}

function acpUpdateSummary(update: AcpSessionUpdate): string {
  const record = update as Record<string, unknown>;
  const content = record.content;
  if (
    content &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    typeof (content as Record<string, unknown>).text === 'string'
  ) {
    return (content as Record<string, unknown>).text as string;
  }
  if (update.sessionUpdate === 'plan' && Array.isArray(record.entries)) {
    return record.entries
      .flatMap((entry) =>
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).content === 'string'
          ? [(entry as Record<string, unknown>).content as string]
          : []
      )
      .join('\n');
  }
  const title = typeof record.title === 'string' ? record.title : undefined;
  const status = typeof record.status === 'string' ? record.status : undefined;
  return [title, status].filter(Boolean).join(' - ') || `ACP ${update.sessionUpdate}`;
}

function acpApprovalActionClass(kind: string | null | undefined): RunApprovalActionClass {
  const normalized = kind?.toLowerCase();
  if (normalized === 'execute') return 'shell';
  if (normalized === 'fetch') return 'network';
  if (['read', 'edit', 'delete', 'move', 'search'].includes(normalized ?? '')) {
    return 'filesystem';
  }
  return 'tool';
}

function acpApprovalRisk(kind: string | null | undefined): RunApprovalRiskClass {
  const normalized = kind?.toLowerCase();
  if (['read', 'search', 'think'].includes(normalized ?? '')) return 'low';
  if (['delete', 'execute', 'fetch'].includes(normalized ?? '')) return 'high';
  return 'medium';
}

// Export singleton
export const clawdbotAgentService = new ClawdbotAgentService(
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  {
    revokeRun: (request) => getCredentialBrokerService().revokeRun(request),
  }
);

function conversationLaunchCapabilities(
  mode: 'fresh' | 'resume' | 'fork'
): ProviderRuntimeCapabilityId[] {
  if (mode === 'fresh') return [];
  return mode === 'resume' ? ['run.resume', 'run.follow-up'] : ['run.fork', 'run.follow-up'];
}

function manifestConversation(
  request: ConversationLaunchRequest | undefined
): ConversationLifecycleRecord | undefined {
  if (!request || request.mode === 'fresh') return undefined;
  const timestamp = '1970-01-01T00:00:00.000Z';
  return {
    schemaVersion: CONVERSATION_LIFECYCLE_SCHEMA_VERSION,
    mode: request.mode,
    intent: request.intent ?? request.mode,
    ...(request.mode === 'resume' ? { conversationId: '<source-conversation>' } : {}),
    ...(request.mode === 'fork' ? { parentConversationId: '<source-conversation>' } : {}),
    state: 'active',
    contextWindow: { posture: 'unknown', measuredAt: timestamp },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function requireConversationId(record: ConversationLifecycleRecord, action: string): string {
  if (!record.conversationId) {
    throw new ConflictError(`${action} requires a durable conversation ID.`);
  }
  return record.conversationId;
}

function requireParentConversationId(record: ConversationLifecycleRecord, action: string): string {
  if (!record.parentConversationId) {
    throw new ConflictError(`${action} requires a durable parent conversation ID.`);
  }
  return record.parentConversationId;
}

function renderConversationTurn(
  mode: 'resume' | 'fork',
  source: ConversationSource,
  message: string,
  forkTurnId?: string
): string {
  return `# Conversation ${mode === 'resume' ? 'Follow-Up' : 'Fork'}

- Lifecycle: \`${CONVERSATION_LIFECYCLE_SCHEMA_VERSION}\`
- Source attempt: \`${source.attempt.id}\`
- Source conversation: \`${source.conversationId}\`
${forkTurnId ? `- Fork through turn: \`${forkTurnId}\`\n` : ''}
## Operator Input

${message}
`;
}

function taskStatusForCompletion(status: TaskCompletionStatus): 'done' | 'blocked' | 'in-progress' {
  if (status === 'success') return 'done';
  if (status === 'blocked') return 'blocked';
  return 'in-progress';
}

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

function recordValueForProvider(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isCodexAppServerToolStart(record: Record<string, unknown>): boolean {
  if (record.method !== 'item/started') return false;
  const params = recordValueForProvider(record, 'params');
  const item = recordValueForProvider(params, 'item');
  return [
    'commandExecution',
    'mcpToolCall',
    'dynamicToolCall',
    'collabAgentToolCall',
    'webSearch',
  ].includes(typeof item.type === 'string' ? item.type : '');
}
