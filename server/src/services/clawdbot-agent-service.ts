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
import * as fs from '../storage/fs-helpers.js';
import path from 'path';
import { createHash } from 'node:crypto';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { getTelemetryService } from './telemetry-service.js';
import { getAgentRoutingService } from './agent-routing-service.js';
import { getGovernanceTraceService } from './governance-trace-service.js';
import { getSandboxPolicyService, type SandboxPolicyService } from './sandbox-policy-service.js';
import {
  getRunEgressGatewayService,
  RUN_EGRESS_UPSTREAM_PROXY_ENV_KEY,
  runEgressPolicyRequiresGateway,
  type RunEgressGatewayApprovalRequest,
  type RunEgressGatewayApprovalResult,
  type RunEgressGatewayHandle,
  type RunEgressGatewayService,
} from './run-egress-gateway-service.js';
import { getAgentBudgetService } from './agent-budget-service.js';
import {
  getDurableGoalSupervisorService,
  type DurableGoalContinuationDispatchRequest,
  type DurableGoalSupervisorService,
} from './durable-goal-supervisor-service.js';
import {
  getReflectionExtractionJobService,
  type ReflectionExtractionJobService,
} from './reflection-extraction-job-service.js';
import { scheduleReflectionExtractionJob } from './reflection-extraction-worker-service.js';
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
import { type ProviderTaskEnvelopeTransport } from './provider-task-envelope-renderer.js';
import type { ThreadEvent } from '@openai/codex-sdk';
import {
  evaluateTaskReadiness,
  CONVERSATION_LIFECYCLE_SCHEMA_VERSION,
  DEFAULT_ROUTING_CONFIG,
  EXECUTABLE_AGENT_PROVIDERS,
  RUN_DEPENDENCY_CIRCUIT_EVIDENCE_SCHEMA_VERSION,
  ZERO_AGENT_BUDGET_USAGE,
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
  NetworkEgressTelemetryEvent,
  TokenTelemetryEvent,
  TaskReadinessSummary,
  SandboxPolicyDryRunResult,
  AgentBudgetPolicy,
  AgentBudgetState,
  AgentBudgetUsage,
  AgentBudgetDecision,
  AgentBudgetEvaluation,
  RunRecoveryRecord,
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
  TaskCompletionEvidence,
  TaskEnvelope,
  TaskTerminalSource,
  CompletionResult,
  CompletionPhaseAuthorityEvidence,
  HarnessSupportStatus,
  HarnessSupportTelemetry,
  RunLaunchManifest,
  RunLaunchManifestDriftResult,
  RunLaunchManifestPreview,
  RunDependencyCircuitEvidence,
  DependencyCircuitTelemetry,
  RunLaunchPhaseAuthority,
  PhaseName,
  PhaseAuthorityDimension,
  PhaseCapabilityEvidence,
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
  AcpRuntimeProbe,
  AcpSessionNotification,
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionUpdate,
  AcpStopReason,
  ProviderRuntimeCapabilityEvidence,
  RunApprovalActionClass,
  RunApprovalRequest,
  RunApprovalRiskClass,
  WorkspaceExecutionTrustScanResult,
  AdmissionReservationRelease,
  AdmissionCancellationInput,
  AdmissionExecutionTreeCancellationResult,
  AdmissionAgentLaunchOptions,
  AdmissionLaunchSource,
  AdmissionQueueClaim,
  ExecutionTreeBudgetPolicy,
  ExecutionTreeEdgeKind,
  ExecutionTreeIdentity,
  RunTerminalExecuteRequest,
  RunTerminalHandle,
  WorkspaceCheckpoint,
  WorkspaceCheckpointBoundary,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { redactString } from '../lib/redact.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../middleware/error-handler.js';
import type { AgentBudgetThresholdEvent } from '@veritas-kanban/shared';
import { getAgentProfilePackageService } from './agent-profile-package-service.js';
import { ProviderRuntimeManifestService } from './provider-runtime-manifest-service.js';
import type { WorkspaceFileRepository } from '../storage/interfaces.js';
import { LocalWorkspaceFileRepository } from '../storage/workspace-file-repository.js';
import {
  getProviderRuntimeAdapterDefinition,
  type ProviderRuntimeSurface,
} from './provider-runtime-adapter-registry.js';
import {
  buildProviderRuntimeProbeRequest,
  resolveExecutableAgentProvider,
  type AgentProviderProbeContext,
} from './provider-runtime-resolution.js';
import {
  assertProviderRuntimeControl,
  assertProviderRuntimeManifestSnapshot,
  BASELINE_LAUNCH_CAPABILITIES,
  providerRuntimeControls,
} from './provider-runtime-control-service.js';
import { resolveTaskCommitPolicy, TaskEnvelopeService } from './task-envelope-service.js';
import { evaluateHarnessSupportStatus } from './harness-support-service.js';
import { getHarnessCompatibilityRecordDigest } from './harness-compatibility-matrix-service.js';
import {
  harnessToolCatalogDelivery,
  normalizeHarnessSupportProfile,
} from './harness-support-profile-registry.js';
import { RunLaunchManifestService, diffRunLaunchManifests } from './run-launch-manifest-service.js';
import { RunLaunchCompiler } from './run-launch-compiler.js';
import { RunTerminalExecuteRequestSchema } from '../schemas/run-terminal-schemas.js';
import {
  ProviderCompletionService,
  type ProviderCompletionArtifactClaim,
  type ProviderCompletionEvidenceClaim,
  type ProviderTerminalClaim,
} from './provider-completion-service.js';
import {
  AttemptLifecycleCoordinator,
  CompletionOwnershipError,
} from './attempt-lifecycle-coordinator.js';
import { getCredentialBrokerService } from './credential-broker-service.js';
import { WorktreeService } from './worktree-service.js';
import {
  getRunEventJournalService,
  type RunEventJournalService,
} from './run-event-journal-service.js';
import { getRunTerminalService, type RunTerminalService } from './run-terminal-service.js';
import {
  getRunFileExecutionPolicyService,
  type RunFileExecutionEvaluationInput,
  type RunFileExecutionPolicyService,
} from './run-file-execution-policy-service.js';
import { type ProviderMappedRunEvent } from './provider-run-event-mappers.js';
import {
  AgentProviderAdapterRegistry,
  type AgentProviderAdapterHost,
  type AgentProviderAdmissionEvidence,
  type AgentProviderStartContext,
} from './agent-provider-adapter-registry.js';
export type {
  AgentProviderAdapter,
  AgentProviderAdmissionEvidence,
  AgentProviderStartContext,
  AgentProviderStopContext,
} from './agent-provider-adapter-registry.js';
import {
  buildClaudeCodeArgs,
  buildSafeClaudeCodeEnv,
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
  getAdmissionControlService,
  type AdmissionControlService,
} from './admission-control-service.js';
import {
  ConversationLifecycleService,
  type ConversationSource,
} from './conversation-lifecycle-service.js';
import {
  getWorkspaceCheckpointService,
  type WorkspaceCheckpointService,
} from './workspace-checkpoint-service.js';
import {
  WorkspaceCheckpointRewindService,
  type WorkspaceCheckpointRewindRequest,
  type WorkspaceCheckpointRewindResult,
  type WorkspaceCheckpointRewindRuntimeSnapshot,
} from './workspace-checkpoint-rewind-service.js';
import {
  assertGrokBuildVersionEvidence,
  buildCopilotAcpArgs,
  buildGrokBuildAcpArgs,
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
import {
  getRunToolBridgeService,
  RUN_TOOL_BRIDGE_SERVER_ID,
  type RunToolBridgeLaunch,
  type RunToolBridgeService,
} from './run-tool-bridge-service.js';
import { getToolPolicyService } from './tool-policy-service.js';
import { RunRecoveryPolicyService } from './run-recovery-policy-service.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import {
  FilesystemSandboxService,
  getFilesystemSandboxService,
  type FilesystemSandboxLaunchPlan,
} from './filesystem-sandbox-service.js';
import {
  getWorkspaceExecutionTrustService,
  type WorkspaceExecutionTrustService,
} from './workspace-execution-trust-service.js';
import {
  PhaseLaunchAuthorityService,
  type PhaseLaunchParentSnapshot,
} from './phase-launch-authority-service.js';
import { RunPhaseAuthorityService } from './run-phase-authority-service.js';
import {
  getPhaseTransitionService,
  type PhaseTransitionService,
} from './phase-transition-service.js';
import { verifyPhaseCapabilityEvidenceDigest } from './phase-capability-service.js';
import {
  agentHostDependencyIdentity,
  defaultDependencyCircuitExecutionService,
  providerDependencyIdentity,
} from './dependency-circuit-runtime.js';
import {
  DependencyCircuitExecutionService,
  type DependencyCircuitExecutionOptions,
} from './dependency-circuit-routing-service.js';
import {
  interpretCodexEvent,
  redactProviderTraceText,
  type CodexEventInterpretation,
} from './codex-event-interpreter.js';
const log = createLogger('clawdbot-agent-service');
const CLAUDE_CODE_MAX_STDERR_BUFFER_BYTES = 64 * 1024;
const providerDependencyExecutionOptions = {
  signalsForError: (error: unknown) => {
    const candidate =
      error instanceof Error
        ? (error as Error & { code?: string; status?: number; statusCode?: number })
        : undefined;
    return {
      callerCancelled: candidate?.name === 'AbortError',
      timedOut:
        candidate?.name === 'TimeoutError' ||
        candidate?.code === 'ETIMEDOUT' ||
        /\\btime(?:d)?\\s*out\\b/i.test(candidate?.message ?? ''),
      statusCode: candidate?.statusCode ?? candidate?.status,
      errorCode: candidate?.code,
    };
  },
} satisfies DependencyCircuitExecutionOptions;

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
  runRetry?: RunRecoveryRecord;
  activePhaseEvidence?: PhaseCapabilityEvidence;
  conversation: ConversationLifecycleRecord;
  controls: ProviderRuntimeControlSet;
  admissionReservationId?: string;
  executionTree?: ExecutionTreeIdentity;
  terminals: RunTerminalHandle[];
}

export type RunTerminalExecutionResult =
  | {
      status: 'approval-required';
      approval: RunApprovalRequest;
    }
  | {
      status: 'started';
      approval: RunApprovalRequest;
      handle: RunTerminalHandle;
    };

export interface AgentQueueStatus {
  taskId: string;
  attemptId: string;
  queueId: string;
  agent: AgentType;
  status: 'queued';
  enqueuedAt: string;
  retryAfterMs: number;
  limitingScopes: Array<{
    scope: string;
    scopeId: string;
  }>;
}

export type AgentLaunchStatus = AgentStatus | AgentQueueStatus;

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
  phase?: PhaseName;
  parentAttemptId?: string;
  conversation?: ConversationLaunchRequest;
  /** Internal durable recovery context. API callers cannot supply this field. */
  recovery?: RunRecoveryRecord;
  admissionIdempotencyKey?: string;
  rootTaskId?: string;
  /** Internal durable queue claim. API callers cannot supply this field. */
  admissionQueueClaim?: AdmissionQueueClaim;
}

export interface AgentMessageOptions {
  actor?: string;
  source?: string;
  expectedAttemptId: string;
}

export interface AgentStopOptions {
  actor?: 'operator' | 'system';
  source?: string;
  reason?: string;
  terminalSource?: TaskTerminalSource;
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

interface ProviderConversationCursor {
  conversationId: string;
  turnId?: string;
  itemId?: string;
}

interface CodexAppServerRewindState {
  token: string;
  phase: 'quiescing' | 'quiesced' | 'committed' | 'rolled-back';
  sourceThreadId: string;
  sourceTurnId: string;
  resolveQuiesced?: () => void;
  rejectQuiesced?: (error: Error) => void;
}

interface CodexAppServerControl {
  interrupt(): Promise<void>;
  steer(message: string): Promise<string>;
  compact(): Promise<void>;
  archive(): Promise<void>;
  close(): void;
  runtimeIdentity(): {
    threadId: string;
    turnId?: string;
    generation: number;
  };
  quiesceForRewind(): Promise<string>;
  forkForRewind(
    token: string,
    cursor: ProviderConversationCursor,
    rollback: boolean
  ): Promise<string>;
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
  executionTreeUsage: AgentBudgetUsage;
  recoveryBudgetBase?: AgentBudgetUsage;
  budgetStopped?: boolean;
  agentProfile?: AgentProfileLaunchMetadata;
  providerRuntimeManifest: ProviderRuntimeManifest;
  harnessSupport: HarnessSupportStatus;
  taskEnvelope: TaskEnvelope;
  runLaunchManifest: RunLaunchManifest;
  runLaunchManifestTraceId: string;
  runLaunchParentAttemptId?: string;
  runLaunchManifestDrift?: RunLaunchManifestDriftResult;
  runRetry?: RunRecoveryRecord;
  activePhaseEvidence?: PhaseCapabilityEvidence;
  conversation: ConversationLifecycleRecord;
  supervisorId?: string;
  admissionReservationId?: string;
  executionTree?: ExecutionTreeIdentity;
  recoveredControl?: boolean;
  threadId?: string;
  abortController?: AbortController;
  process?: ChildProcessWithoutNullStreams;
  codexAppServerControl?: CodexAppServerControl;
  acpControl?: AcpStdioControl;
  runToolBridge?: RunToolBridgeLaunch;
  filesystemSandboxPlan?: FilesystemSandboxLaunchPlan;
  egressGateway?: RunEgressGatewayHandle;
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
    dependencyCircuits?: RunDependencyCircuitEvidence;
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
const pendingRunTerminalLaunches = new Map<PendingAgent, Set<Promise<RunTerminalHandle>>>();
const budgetEvaluations = new Map<PendingAgent, Promise<void>>();
const recoveredProcessMonitors = new Map<string, NodeJS.Timeout>();
const scheduledRecoveries = new Map<
  string,
  { attemptId: string; timer: ReturnType<typeof setTimeout> }
>();
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
  private runLaunchCompiler: RunLaunchCompiler;
  private providerAdapters: AgentProviderAdapterRegistry;
  private providerCompletions: ProviderCompletionService;
  private attemptLifecycle: AttemptLifecycleCoordinator;
  private credentialLeases: CredentialLeaseLifecycle;
  private workspaceFiles: WorkspaceFileRepository;
  private worktrees: Pick<WorktreeService, 'claimOwnership' | 'releaseOwnership'>;
  private runEvents: RunEventJournalService;
  private approvalBroker: RunApprovalBrokerService;
  private runSupervisor: RunSupervisorService;
  private admission: AdmissionControlService;
  private admissionQueueDrain?: Promise<void>;
  private conversationLifecycle: ConversationLifecycleService;
  private toolControlPlane: ToolControlPlaneService;
  private runToolBridge: RunToolBridgeService;
  private runRecoveryPolicy: RunRecoveryPolicyService;
  private filesystemSandbox: Pick<
    FilesystemSandboxService,
    'compile' | 'activate' | 'cleanup' | 'wrap'
  >;
  private sandboxPolicies: Pick<SandboxPolicyService, 'dryRunWithTrace'>;
  private runEgressGateway: Pick<RunEgressGatewayService, 'start' | 'stopRun'>;
  private durableGoalSupervisor: Pick<
    DurableGoalSupervisorService,
    'handleRunCompletion' | 'reconcilePlannedForTask'
  > &
    Partial<Pick<DurableGoalSupervisorService, 'approveRollover'>>;
  private reflectionExtractionJobs: Pick<ReflectionExtractionJobService, 'enqueue'>;
  private workspaceExecutionTrust: Pick<
    WorkspaceExecutionTrustService,
    'scan' | 'evaluateForLaunch' | 'assertFresh'
  >;
  private phaseAuthority: PhaseLaunchAuthorityService;
  private phaseTransitions?: Pick<PhaseTransitionService, 'getCurrent'> &
    Partial<Pick<PhaseTransitionService, 'list'>>;
  private runPhaseAuthority: RunPhaseAuthorityService;
  private dependencyExecution: DependencyCircuitExecutionService;
  private runTerminals: Pick<
    RunTerminalService,
    'execute' | 'list' | 'cleanupAttempt' | 'reconcileAttempt'
  >;
  private runFileExecutionPolicy: Pick<RunFileExecutionPolicyService, 'evaluate' | 'revalidate'>;
  private workspaceCheckpoints: Pick<WorkspaceCheckpointService, 'captureBoundary'>;
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
    toolControlPlane: ToolControlPlaneService = getToolControlPlaneService(),
    runToolBridge: RunToolBridgeService = getRunToolBridgeService(),
    runRecoveryPolicy = new RunRecoveryPolicyService(),
    filesystemSandbox: Pick<
      FilesystemSandboxService,
      'compile' | 'activate' | 'cleanup' | 'wrap'
    > = getFilesystemSandboxService(),
    sandboxPolicies: Pick<SandboxPolicyService, 'dryRunWithTrace'> = getSandboxPolicyService(),
    workspaceExecutionTrust: Pick<
      WorkspaceExecutionTrustService,
      'scan' | 'evaluateForLaunch' | 'assertFresh'
    > = getWorkspaceExecutionTrustService(),
    phaseAuthority = new PhaseLaunchAuthorityService(),
    phaseTransitions?: Pick<PhaseTransitionService, 'getCurrent'> &
      Partial<Pick<PhaseTransitionService, 'list'>>,
    admission: AdmissionControlService = getAdmissionControlService(),
    runEgressGateway: Pick<
      RunEgressGatewayService,
      'start' | 'stopRun'
    > = getRunEgressGatewayService(),
    durableGoalSupervisor: Pick<
      DurableGoalSupervisorService,
      'handleRunCompletion' | 'reconcilePlannedForTask'
    > &
      Partial<
        Pick<DurableGoalSupervisorService, 'approveRollover'>
      > = getDurableGoalSupervisorService(),
    reflectionExtractionJobs: Pick<
      ReflectionExtractionJobService,
      'enqueue'
    > = getReflectionExtractionJobService(),
    dependencyExecution: DependencyCircuitExecutionService = defaultDependencyCircuitExecutionService(),
    runTerminals: Pick<
      RunTerminalService,
      'execute' | 'list' | 'cleanupAttempt' | 'reconcileAttempt'
    > = getRunTerminalService(),
    workspaceCheckpoints: Pick<
      WorkspaceCheckpointService,
      'captureBoundary'
    > = getWorkspaceCheckpointService(),
    runFileExecutionPolicy: Pick<
      RunFileExecutionPolicyService,
      'evaluate' | 'revalidate'
    > = getRunFileExecutionPolicyService()
  ) {
    this.configService = new ConfigService();
    this.taskService = new TaskService();
    this.agentHealth = agentHealth || new AgentHealthService();
    this.providerRuntimeManifests = providerRuntimeManifests;
    this.taskEnvelopes = taskEnvelopes;
    this.runLaunchManifests = new RunLaunchManifestService();
    this.providerCompletions = providerCompletions;
    this.attemptLifecycle = new AttemptLifecycleCoordinator(this.taskService);
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
    this.admission = admission;
    this.conversationLifecycle = conversationLifecycle;
    this.toolControlPlane = toolControlPlane;
    this.runToolBridge = runToolBridge;
    this.runRecoveryPolicy = runRecoveryPolicy;
    this.filesystemSandbox = filesystemSandbox;
    this.sandboxPolicies = sandboxPolicies;
    this.runEgressGateway = runEgressGateway;
    this.durableGoalSupervisor = durableGoalSupervisor;
    this.reflectionExtractionJobs = reflectionExtractionJobs;
    this.dependencyExecution = dependencyExecution;
    this.runTerminals = runTerminals;
    this.workspaceCheckpoints = workspaceCheckpoints;
    this.runFileExecutionPolicy = runFileExecutionPolicy;
    this.workspaceExecutionTrust = workspaceExecutionTrust;
    this.phaseAuthority = phaseAuthority;
    this.phaseTransitions = phaseTransitions;
    this.providerAdapters = this.createProviderAdapterRegistry();
    this.runLaunchCompiler = new RunLaunchCompiler({
      runLaunchManifests: this.runLaunchManifests,
      workspaceFiles: this.workspaceFiles,
      toolControlPlane: this.toolControlPlane,
      runToolBridge: this.runToolBridge,
      phaseAuthority: this.phaseAuthority,
      expandPath: (value) => this.expandPath(value),
      getCodexFinalPath: (logPath, attemptId) => this.getCodexFinalPath(logPath, attemptId),
      buildCodexArgs: (...args) => this.buildCodexArgs(...args),
      buildAcpProviderArgs: (...args) => this.buildAcpProviderArgs(...args),
    });
    const transitionAuthority = phaseTransitions
      ? {
          getCurrent: (...args: Parameters<PhaseTransitionService['getCurrent']>) =>
            phaseTransitions.getCurrent(...args),
          list: (...args: Parameters<PhaseTransitionService['list']>) =>
            phaseTransitions.list?.(...args) ?? Promise.resolve([]),
        }
      : {
          getCurrent: (...args: Parameters<PhaseTransitionService['getCurrent']>) =>
            getPhaseTransitionService().getCurrent(...args),
          list: (...args: Parameters<PhaseTransitionService['list']>) =>
            getPhaseTransitionService().list(...args),
        };
    this.runPhaseAuthority = new RunPhaseAuthorityService({
      tasks: {
        findById: (id) => this.taskService.getTask(id),
      },
      transitions: transitionAuthority,
    });
    this.logsDir = getLogsDir();
    this.ensureLogsDir();
  }

  private async ensureLogsDir(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
  }

  async reconcileQueuedLaunches(): Promise<void> {
    if (this.admissionQueueDrain) return this.admissionQueueDrain;
    let continueDraining = false;
    this.admissionQueueDrain = this.drainAdmissionQueue().then((hasMore) => {
      continueDraining = hasMore;
    });
    try {
      await this.admissionQueueDrain;
    } finally {
      this.admissionQueueDrain = undefined;
    }
    if (continueDraining) this.scheduleAdmissionQueueDrain();
  }

  private scheduleAdmissionQueueDrain(): void {
    queueMicrotask(() => {
      void this.reconcileQueuedLaunches().catch((error) => {
        log.error({ err: error }, '[ClawdbotAgent] Admission queue drain failed');
      });
    });
  }

  private async drainAdmissionQueue(): Promise<boolean> {
    for (let index = 0; index < 100; index++) {
      const claim = await this.admission.claimNextQueued();
      if (!claim) return false;
      const { entry, reservation } = claim;
      if (entry.target?.kind === 'workflow-root' || entry.target?.kind === 'workflow-step') {
        const { getWorkflowRunService } = await import('./workflow-run-service.js');
        await getWorkflowRunService().dispatchQueuedAdmission(claim);
        continue;
      }
      const queuedAgent =
        entry.target?.kind === 'direct' || entry.target?.kind === 'agent-launch'
          ? entry.target.agent
          : entry.agent;
      if (!queuedAgent) {
        await this.admission
          .release(reservation.id, 'start-failed', `queue-target-missing:${entry.id}`)
          .catch(() => {});
        await this.admission.terminateQueueEntry(
          entry.id,
          'ADMISSION_QUEUE_TARGET_MISSING',
          'The queued direct launch has no agent target.'
        );
        continue;
      }
      if (startingAgents.has(entry.request.taskId) || pendingAgents.has(entry.request.taskId)) {
        await this.admission
          .release(reservation.id, 'start-failed', `queue-task-busy:${entry.id}`)
          .catch(() => {});
        await this.admission.requeueQueueEntry(
          entry.id,
          'QUEUE_TASK_BUSY',
          'The task already has a launch owner.'
        );
        continue;
      }

      startingAgents.add(entry.request.taskId);
      try {
        const queuedOptions =
          entry.target?.kind === 'agent-launch' ? entry.target.options : undefined;
        const result = await this.startReservedAgent(entry.request.taskId, queuedAgent, {
          ...queuedOptions,
          rootTaskId: entry.request.rootTaskId,
          admissionQueueClaim: claim,
        });
        if (result.status === 'queued') {
          throw new ConflictError('A leased queue entry cannot enqueue itself again.', {
            code: 'ADMISSION_QUEUE_RECURSION',
            queueId: entry.id,
          });
        }
      } catch (error) {
        const current = await this.admission.getQueueEntry(entry.id);
        const task = await this.taskService.getTask(entry.request.taskId);
        if (current.state === 'dispatched' || task?.attempt?.id === entry.attemptId) {
          if (current.state !== 'dispatched') {
            await this.admission
              .release(reservation.id, 'start-failed', `queue-attempt-persisted:${entry.id}`)
              .catch(() => {});
            await this.admission.terminateQueueEntry(
              entry.id,
              'QUEUE_ATTEMPT_PERSISTED',
              'Attempt state became durable before dispatch ownership could be confirmed.'
            );
          }
          continue;
        }
        await this.admission
          .release(reservation.id, 'start-failed', `queue-launch-failed:${entry.id}`)
          .catch(() => {});
        const failure = this.queueDispatchFailure(error);
        if (failure.terminal) {
          await this.admission.terminateQueueEntry(entry.id, failure.code, failure.reason);
        } else {
          await this.admission.requeueQueueEntry(entry.id, failure.code, failure.reason);
        }
      } finally {
        startingAgents.delete(entry.request.taskId);
      }
    }
    return true;
  }

  private agentAdmissionSource(
    executionTree: ExecutionTreeIdentity,
    recovery?: RunRecoveryRecord
  ): Extract<
    AdmissionLaunchSource,
    'direct' | 'conversation' | 'recovery' | 'fallback' | 'child-agent'
  > {
    if (recovery) return recovery.action === 'fallback' ? 'fallback' : 'recovery';
    if (executionTree.edge === 'child-agent') return 'child-agent';
    return executionTree.edge === 'root' ? 'direct' : 'conversation';
  }

  private admissionAgentLaunchOptions(
    options: AgentStartOptions,
    conversation: ConversationLaunchRequest,
    overrideReason?: string
  ): AdmissionAgentLaunchOptions {
    const persistConversation =
      options.conversation !== undefined ||
      conversation.mode !== 'fresh' ||
      conversation.message !== undefined;
    return {
      ...(options.profileId ? { profileId: options.profileId } : {}),
      ...(overrideReason ? { overrideReason } : {}),
      ...(options.sandboxPresetId ? { sandboxPresetId: options.sandboxPresetId } : {}),
      ...(options.budget ? { budget: structuredClone(options.budget) } : {}),
      ...(options.requiredRuntimeCapabilities?.length
        ? { requiredRuntimeCapabilities: [...options.requiredRuntimeCapabilities] }
        : {}),
      ...(options.commitPolicy ? { commitPolicy: options.commitPolicy } : {}),
      ...(options.phase ? { phase: options.phase } : {}),
      ...(options.parentAttemptId ? { parentAttemptId: options.parentAttemptId } : {}),
      ...(persistConversation ? { conversation: structuredClone(conversation) } : {}),
      ...(options.recovery ? { recovery: structuredClone(options.recovery) } : {}),
    };
  }

  private assertProviderAdmissionEvidence(
    evidence: AgentProviderAdmissionEvidence,
    attempt: TaskAttempt
  ): void {
    const missing = [
      evidence.schemaVersion !== 'provider-admission-evidence/v1' ? 'schemaVersion' : undefined,
      attempt.admissionReservationId !== evidence.reservationId ? 'reservationId' : undefined,
      !attempt.executionTree ||
      JSON.stringify(attempt.executionTree) !== JSON.stringify(evidence.executionTree)
        ? 'executionTree'
        : undefined,
      evidence.outcome === 'queued-dispatch' && !evidence.queueEntryId ? 'queueEntryId' : undefined,
      evidence.outcome === 'admitted' && evidence.queueEntryId ? 'queueOutcome' : undefined,
    ].filter((field): field is string => Boolean(field));
    if (missing.length > 0) {
      throw new ConflictError('Provider launch is missing required admission evidence.', {
        code: 'PROVIDER_ADMISSION_EVIDENCE_INVALID',
        fields: missing,
      });
    }
  }

  private queueDispatchFailure(error: unknown): {
    terminal: boolean;
    code: string;
    reason: string;
  } {
    const candidate = error as {
      message?: unknown;
      statusCode?: unknown;
      details?: unknown;
    };
    const details =
      candidate.details && typeof candidate.details === 'object'
        ? (candidate.details as Record<string, unknown>)
        : {};
    const detailCode = typeof details.code === 'string' ? details.code : undefined;
    const statusCode = typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined;
    const redactedReason = this.redactTraceText(
      typeof candidate.message === 'string'
        ? candidate.message
        : 'Queued launch failed before dispatch.'
    );
    const terminal =
      error instanceof AgentReadinessError ||
      detailCode === 'ADMISSION_QUEUE_DRIFT' ||
      detailCode === 'ADMISSION_QUEUE_RECURSION' ||
      statusCode === 400 ||
      statusCode === 403 ||
      statusCode === 404;
    return {
      terminal,
      code: (
        detailCode ?? (terminal ? 'QUEUE_AUTHORITY_REJECTED' : 'QUEUE_TRANSIENT_FAILURE')
      ).slice(0, 160),
      reason: redactedReason.trim().slice(0, 1_000) || 'Queued launch failed before dispatch.',
    };
  }

  /**
   * Reconcile persisted running attempts after a server restart.
   *
   * After an unexpected restart the in-memory `pendingAgents` map is empty,
   * but task files can still contain attempts with status `'running'`.
   * Attempts with complete durable supervisor bindings are recovered through
   * their supervisor. Older attempts receive a digest-bound interrupted
   * completion when possible, or are blocked for operator recovery.
   *
   * Safe to call multiple times; only tasks whose current attempt is `'running'`
   * and whose taskId is NOT in `pendingAgents` are touched.
   */
  async reconcileRunningAttempts(): Promise<void> {
    await this.admission.expireAbandoned();
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
            await this.persistRestartedProviderCompletion(task, attempt, claim, {
              preserveNonActiveTaskStatus: true,
            });
          } else {
            const failedAttempt: TaskAttempt = {
              ...attempt,
              status: 'failed',
              ended: new Date().toISOString(),
            };
            await this.attemptLifecycle.persistActiveAttempt({
              task,
              attempt: failedAttempt,
              ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
            });
          }
          recoveryRequiredCount += 1;
          continue;
        }

        this.attemptLifecycle.assertCompletionBinding(task.id, attempt);
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
            await this.attemptLifecycle.persistActiveAttempt({
              task,
              attempt: recoveredAttempt,
              ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
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
        await this.attemptLifecycle.persistActiveAttempt({
          task,
          attempt: recoveredAttempt,
          ...(task.status === 'in-progress' ? { status: 'blocked' } : {}),
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
    await this.reconcileDurableGoalContinuations(tasks);
  }

  /**
   * Restore durable retry/fallback timers after process restart.
   *
   * A record left in `launching` has no child attempt, otherwise the child
   * would be the task's current attempt. Re-queueing that exact record is safe
   * because the task revision and parent attempt ID are claimed again before
   * launch.
   */
  async reconcilePendingRecoveries(): Promise<void> {
    let tasks: Task[];
    try {
      tasks = await this.taskService.listTasks();
    } catch (error) {
      log.warn({ err: error }, '[ClawdbotAgent] reconcilePendingRecoveries: failed to list tasks');
      return;
    }

    let scheduledCount = 0;
    for (const task of tasks) {
      const attempt = task.attempt;
      const recovery = attempt?.runRetry;
      if (!attempt || !recovery) continue;
      if (attempt.status === 'running' || !['scheduled', 'launching'].includes(recovery.state)) {
        continue;
      }

      try {
        let record = recovery;
        if (record.state === 'launching') {
          record = {
            ...record,
            state: 'scheduled',
            notBefore: new Date().toISOString(),
            reason: `${record.reason} Re-queued after server restart before child launch.`,
          };
          const recoveredAttempt = { ...attempt, runRetry: record };
          const updated = await this.attemptLifecycle.persistActiveAttempt({
            task,
            attempt: recoveredAttempt,
          });
          if (!updated) continue;
          await this.appendRunEvent(
            task.id,
            attempt.id,
            'recovery.reconciled',
            {
              action: record.action,
              sequence: record.sequence,
              state: record.state,
              notBefore: record.notBefore,
            },
            {
              provider: 'system',
              adapter: 'run-recovery',
              agent: record.selectedAgent,
              dedupeKey: `recovery.reconciled:${record.sequence}`,
            }
          );
        }
        this.scheduleTaskRecovery(task.id, attempt.id, record);
        scheduledCount += 1;
      } catch (error) {
        log.warn(
          { err: error, taskId: task.id, attemptId: attempt.id },
          '[ClawdbotAgent] Failed to reconcile pending recovery'
        );
      }
    }

    if (scheduledCount > 0) {
      log.info(
        { scheduledCount },
        '[ClawdbotAgent] Durable retry/fallback reconciliation complete'
      );
    }
  }

  async getTaskRecovery(taskId: string): Promise<RunRecoveryRecord | null> {
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new NotFoundError(`Task "${taskId}" not found`);
    if (task.attempt?.runRetry) return task.attempt.runRetry;
    return (
      [...(task.attempts ?? [])].reverse().find((attempt) => attempt.runRetry)?.runRetry ?? null
    );
  }

  async cancelTaskRecovery(
    taskId: string,
    expectedAttemptId: string,
    actor = 'operator'
  ): Promise<RunRecoveryRecord> {
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new NotFoundError(`Task "${taskId}" not found`);
    const attempt = task.attempt;
    const recovery = attempt?.runRetry;
    if (!attempt || attempt.id !== expectedAttemptId || !recovery) {
      throw new ConflictError('Recovery cancellation does not match the active attempt', {
        activeAttemptId: attempt?.id,
        requestedAttemptId: expectedAttemptId,
      });
    }
    if (!['scheduled', 'launching'].includes(recovery.state)) {
      throw new ConflictError('Recovery is not pending cancellation', {
        attemptId: attempt.id,
        recoveryState: recovery.state,
      });
    }

    const cancelled: RunRecoveryRecord = {
      ...recovery,
      state: 'cancelled',
      action: 'cancelled',
      reason: 'Automatic recovery was cancelled by an operator.',
      backoffMs: 0,
      cancelledAt: new Date().toISOString(),
      cancelledBy: actor.trim() || 'operator',
      handoff: {
        summary: 'Automatic recovery was cancelled.',
        nextActions: ['Launch a new attempt explicitly if the objective should continue.'],
      },
    };
    const cancelledAttempt = { ...attempt, runRetry: cancelled };
    const updated = await this.attemptLifecycle.persistActiveAttempt({
      task,
      attempt: cancelledAttempt,
    });
    if (!updated) throw new Error(`Task "${taskId}" disappeared during recovery cancellation`);
    this.clearScheduledRecovery(taskId, expectedAttemptId);
    await this.appendRunEvent(
      taskId,
      attempt.id,
      'recovery.cancelled',
      {
        action: recovery.action,
        sequence: recovery.sequence,
        actor: cancelled.cancelledBy,
      },
      {
        provider: 'operator',
        adapter: 'run-recovery',
        agent: recovery.selectedAgent,
        dedupeKey: `recovery.cancelled:${recovery.sequence}`,
      }
    );
    return cancelled;
  }

  private async planTaskRecovery(
    taskId: string,
    failedAttempt: TaskAttempt,
    failure: RunRecoveryRecord['failure']
  ): Promise<RunRecoveryRecord | null> {
    const task = await this.taskService.getTask(taskId);
    if (!task || task.attempt?.id !== failedAttempt.id) return null;
    const currentAttempt = task.attempt;
    const currentRecovery = currentAttempt.runRetry;
    if (
      currentRecovery &&
      ['scheduled', 'approval-required', 'exhausted', 'cancelled'].includes(currentRecovery.state)
    ) {
      return currentRecovery;
    }
    const redactedFailure = {
      ...failure,
      summary: this.redactTraceText(failure.summary),
    };

    const launchManifest = currentAttempt.runLaunchManifest;
    const routing = launchManifest?.routing;
    const maxRetries = routing?.maxRetries ?? DEFAULT_ROUTING_CONFIG.maxRetries;
    const fallbackOnFailure = routing?.fallbackOnFailure ?? routing?.fallbackAllowed ?? false;
    const requiredRuntimeCapabilities = [
      ...(launchManifest?.providerRequirements.required ?? []),
    ] as ProviderRuntimeCapabilityId[];
    const previousSequence = currentRecovery?.sequence ?? 0;
    const fallbackUsed = currentRecovery?.fallbackUsed ?? false;
    const cumulativeBudget =
      currentAttempt.budget?.usage ??
      currentRecovery?.cumulativeBudget ??
      ({ ...ZERO_AGENT_BUDGET_USAGE } satisfies AgentBudgetUsage);
    const preferredFallback = currentRecovery?.fallbackAgent ?? routing?.fallbackAgent ?? undefined;
    let fallbackAgent: AgentType | undefined = preferredFallback;
    let fallbackEligible: boolean | undefined;
    let fallbackReason: string | undefined;

    if (failure.retryable && previousSequence >= maxRetries && fallbackOnFailure && !fallbackUsed) {
      const fallback = await getAgentRoutingService().getFallback(task, currentAttempt.agent, {
        ...(preferredFallback ? { preferredFallback } : {}),
        requiredRuntimeCapabilities,
      });
      fallbackAgent = fallback?.agent ?? preferredFallback;
      fallbackEligible = Boolean(fallback);
      fallbackReason =
        fallback?.reason ??
        (fallbackAgent
          ? `Fallback ${fallbackAgent} is unavailable or lacks required runtime capabilities.`
          : 'No compatible fallback route is configured.');
    }

    const decisionInput = {
      rootRunId: currentRecovery?.rootRunId ?? currentAttempt.id,
      parentRunId: currentAttempt.id,
      selectedAgent: currentAttempt.agent,
      routingDecision:
        currentRecovery?.routingDecision ??
        routing?.reason ??
        'Legacy run without captured routing evidence.',
      ...(launchManifest?.digest ? { sourceManifestDigest: launchManifest.digest } : {}),
      requiredRuntimeCapabilities,
      cumulativeBudget,
      previousSequence,
      fallbackUsed,
      maxRetries,
      fallbackOnFailure,
      ...(fallbackAgent ? { fallbackAgent } : {}),
      ...(fallbackEligible !== undefined ? { fallbackEligible } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
    };
    let decision = this.runRecoveryPolicy.decide(redactedFailure, decisionInput);

    if (decision.action === 'fallback' && fallbackAgent) {
      try {
        const preview = await this.previewAgentLaunch(
          taskId,
          fallbackAgent,
          this.recoveryLaunchOptions(currentAttempt, decision)
        );
        this.runLaunchManifests.assertEnforceable(preview.manifest);
      } catch (error) {
        decision = this.runRecoveryPolicy.decide(redactedFailure, {
          ...decisionInput,
          fallbackEligible: false,
          fallbackReason: this.redactTraceText(
            error instanceof Error ? error.message : String(error)
          ),
        });
      }
    }

    const recoveredAttempt = { ...currentAttempt, runRetry: decision };
    try {
      const updated = await this.attemptLifecycle.persistActiveAttempt({
        task,
        attempt: recoveredAttempt,
        ...(decision.state === 'approval-required' ? { status: 'blocked' as const } : {}),
      });
      if (!updated) return null;
    } catch (error) {
      const latest = await this.taskService.getTask(taskId);
      if (
        latest?.attempt?.id === currentAttempt.id &&
        latest.attempt.runRetry?.state === decision.state &&
        latest.attempt.runRetry.sequence === decision.sequence
      ) {
        return latest.attempt.runRetry;
      }
      throw error;
    }

    await this.appendRunEvent(
      taskId,
      currentAttempt.id,
      `recovery.${decision.state}`,
      {
        action: decision.action,
        state: decision.state,
        sequence: decision.sequence,
        failureClass: decision.failure.classification,
        reason: decision.reason,
        backoffMs: decision.backoffMs,
        notBefore: decision.notBefore,
        selectedAgent: decision.selectedAgent,
        fallbackAgent: decision.fallbackAgent,
        cumulativeBudget: decision.cumulativeBudget,
        handoff: decision.handoff,
      },
      {
        provider: 'system',
        adapter: 'run-recovery',
        agent: decision.selectedAgent,
        dedupeKey: `recovery.${decision.state}:${decision.sequence}`,
      }
    );
    if (decision.state === 'scheduled') {
      this.scheduleTaskRecovery(taskId, currentAttempt.id, decision);
    }
    return decision;
  }

  private recoveryLaunchOptions(
    parentAttempt: TaskAttempt,
    recovery: RunRecoveryRecord
  ): AgentStartOptions {
    const retryingSameAgent = recovery.action === 'retry';
    return {
      ...(retryingSameAgent && parentAttempt.agentProfile?.id
        ? { profileId: parentAttempt.agentProfile.id }
        : {}),
      ...(parentAttempt.runLaunchManifest?.sandbox.presetId
        ? { sandboxPresetId: parentAttempt.runLaunchManifest.sandbox.presetId }
        : {}),
      ...(parentAttempt.runLaunchManifest?.budget
        ? { budget: parentAttempt.runLaunchManifest.budget }
        : {}),
      ...(parentAttempt.runLaunchManifest?.providerRequirements.required.length
        ? {
            requiredRuntimeCapabilities: [
              ...parentAttempt.runLaunchManifest.providerRequirements.required,
            ] as ProviderRuntimeCapabilityId[],
          }
        : {}),
      ...(parentAttempt.taskEnvelope?.commitPolicy
        ? { commitPolicy: parentAttempt.taskEnvelope.commitPolicy }
        : {}),
      parentAttemptId: parentAttempt.id,
      recovery,
      admissionIdempotencyKey: `recovery:${recovery.rootRunId}:${recovery.parentRunId}:${recovery.sequence}`,
    };
  }

  private async claimTaskRecoveryAfterAdmission(
    taskId: string,
    task: Task,
    options: AgentStartOptions
  ): Promise<Task> {
    const requested = options.recovery;
    if (!requested) return task;
    const parentAttempt = task.attempt;
    const current = parentAttempt?.runRetry;
    if (
      !parentAttempt ||
      parentAttempt.id !== options.parentAttemptId ||
      !current ||
      !['scheduled', 'launching'].includes(current.state) ||
      current.rootRunId !== requested.rootRunId ||
      current.parentRunId !== requested.parentRunId ||
      current.sequence !== requested.sequence ||
      current.action !== requested.action ||
      current.selectedAgent !== requested.selectedAgent
    ) {
      throw new ConflictError('Recovery launch no longer matches the pending parent attempt', {
        taskId,
        activeAttemptId: parentAttempt?.id,
        parentAttemptId: options.parentAttemptId,
        recoveryState: current?.state,
        recoverySequence: current?.sequence,
      });
    }
    if (current.state === 'launching') return task;

    const launching: RunRecoveryRecord = { ...current, state: 'launching' };
    const claimedAttempt = { ...parentAttempt, runRetry: launching };
    const claimed = await this.attemptLifecycle.persistActiveAttempt({
      task,
      attempt: claimedAttempt,
    });
    if (!claimed) throw new NotFoundError(`Task "${taskId}" disappeared during recovery launch`);
    await this.appendRunEvent(
      taskId,
      parentAttempt.id,
      'recovery.launching',
      {
        action: launching.action,
        sequence: launching.sequence,
        selectedAgent: launching.selectedAgent,
      },
      {
        provider: 'system',
        adapter: 'run-recovery',
        agent: launching.selectedAgent,
        dedupeKey: `recovery.launching:${launching.sequence}`,
      }
    );
    return claimed;
  }

  private scheduleTaskRecovery(
    taskId: string,
    attemptId: string,
    recovery: RunRecoveryRecord
  ): void {
    if (recovery.state !== 'scheduled') return;
    this.clearScheduledRecovery(taskId);
    const notBefore = recovery.notBefore ? Date.parse(recovery.notBefore) : Date.now();
    const delay = Math.max(0, Math.min(2_147_483_647, notBefore - Date.now()));
    const timer = setTimeout(() => {
      const scheduled = scheduledRecoveries.get(taskId);
      if (!scheduled || scheduled.attemptId !== attemptId) return;
      scheduledRecoveries.delete(taskId);
      void this.launchScheduledTaskRecovery(taskId, attemptId).catch((error) => {
        log.error(
          { err: error, taskId, attemptId },
          '[ClawdbotAgent] Scheduled recovery launch failed'
        );
      });
    }, delay);
    timer.unref?.();
    scheduledRecoveries.set(taskId, { attemptId, timer });
  }

  private clearScheduledRecovery(taskId: string, expectedAttemptId?: string): void {
    const scheduled = scheduledRecoveries.get(taskId);
    if (!scheduled || (expectedAttemptId && scheduled.attemptId !== expectedAttemptId)) return;
    clearTimeout(scheduled.timer);
    scheduledRecoveries.delete(taskId);
  }

  private async launchScheduledTaskRecovery(taskId: string, attemptId: string): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    const parentAttempt = task?.attempt;
    const recovery = parentAttempt?.runRetry;
    if (
      !task ||
      !parentAttempt ||
      parentAttempt.id !== attemptId ||
      parentAttempt.status === 'running' ||
      recovery?.state !== 'scheduled'
    ) {
      return;
    }
    if (recovery.notBefore && Date.parse(recovery.notBefore) > Date.now()) {
      this.scheduleTaskRecovery(taskId, attemptId, recovery);
      return;
    }

    try {
      const child = await this.startAgent(
        taskId,
        recovery.selectedAgent,
        this.recoveryLaunchOptions(parentAttempt, recovery)
      );
      if (child.status === 'queued') {
        await this.appendRunEvent(
          taskId,
          attemptId,
          'recovery.queued',
          {
            action: recovery.action,
            sequence: recovery.sequence,
            queueId: child.queueId,
            selectedAgent: child.agent,
            retryAfterMs: child.retryAfterMs,
          },
          {
            provider: 'system',
            adapter: 'run-recovery',
            agent: child.agent,
            dedupeKey: `recovery.queued:${recovery.sequence}`,
          }
        );
      }
    } catch (error) {
      const latest = await this.taskService.getTask(taskId);
      if (latest?.attempt?.id === attemptId) {
        await this.planTaskRecovery(
          taskId,
          latest.attempt,
          this.runRecoveryPolicy.classifyError(error)
        );
      }
      throw error;
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
    const recoveredAdmission = await this.admission.recoverVerifiedRun({
      workspaceId: attempt.taskEnvelope.workspace.workspaceId,
      taskId: task.id,
      attemptId: attempt.id,
    });
    if (
      attempt.admissionReservationId &&
      recoveredAdmission?.id !== attempt.admissionReservationId
    ) {
      throw new CompletionOwnershipError(
        'Recovered attempt admission binding does not match the durable reservation.',
        {
          taskId: task.id,
          attemptId: attempt.id,
          expectedReservationId: attempt.admissionReservationId,
          recoveredReservationId: recoveredAdmission?.id,
        }
      );
    }
    const pending: PendingAgent = {
      taskId: task.id,
      attemptId: attempt.id,
      agent: attempt.agent,
      startedAt: attempt.started ?? supervisor.createdAt,
      emitter: new EventEmitter(),
      provider,
      model: attempt.model,
      budget: supervisor.budget ?? attempt.budget,
      executionTreeUsage: recoveredAdmission?.executionBudget?.committed ?? {
        ...ZERO_AGENT_BUDGET_USAGE,
      },
      executionTree: attempt.executionTree ?? recoveredAdmission?.request.executionTree,
      recoveryBudgetBase: attempt.runRetry?.cumulativeBudget,
      agentProfile: attempt.agentProfile,
      providerRuntimeManifest: attempt.providerRuntimeManifest,
      harnessSupport: attempt.harnessSupport,
      taskEnvelope: attempt.taskEnvelope,
      runLaunchManifest: attempt.runLaunchManifest,
      runLaunchManifestTraceId:
        attempt.runLaunchManifestTraceId ?? `run-supervisor:${supervisor.id}`,
      runLaunchParentAttemptId: attempt.runLaunchParentAttemptId,
      runLaunchManifestDrift: attempt.runLaunchManifestDrift,
      runRetry: attempt.runRetry,
      activePhaseEvidence: attempt.runLaunchManifest.phase?.evidence,
      conversation: recoveredConversation,
      supervisorId: supervisor.id,
      admissionReservationId: recoveredAdmission?.id,
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
    const routingPolicy = config.agentRouting ?? DEFAULT_ROUTING_CONFIG;
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
    const provider = resolveExecutableAgentProvider(profileAgentConfig, agent);
    const agentHealth = await this.assertAgentAvailable(agent, profileAgentConfig);
    const adapter = this.providerAdapters.resolve(provider);
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
    const recoveryBudgetUsage = options.recovery
      ? {
          ...options.recovery.cumulativeBudget,
          retries: Math.max(options.recovery.cumulativeBudget.retries, options.recovery.sequence),
          fanOut: Math.max(1, options.recovery.cumulativeBudget.fanOut),
        }
      : { fanOut: 1 };
    const budgetEvaluation = budgetService.evaluate(budgetPolicy, recoveryBudgetUsage, {
      taskId,
      agentId: agent,
      actionType: 'agent.launch-preview',
      project: task.project,
    });
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
    const providerProbeCwd = this.expandPath(task.git.worktreePath);
    const providerRuntimeManifest = await this.dependencyExecution.execute(
      providerDependencyIdentity(provider, launchAgentConfig?.model, task.project),
      () =>
        adapter.probe({
          agentConfig: launchAgentConfig,
          health: agentHealth,
          cwd: providerProbeCwd,
        }),
      providerDependencyExecutionOptions
    );
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
    const parentAttempt = await this.resolveParentAttempt(task, options.parentAttemptId);
    const parentPhase = await this.resolveParentPhaseSnapshot(parentAttempt);
    let sandboxPolicy = await this.sandboxPolicies.dryRunWithTrace({
      presetId:
        options.sandboxPresetId ??
        profileLaunch?.sandboxPresetId ??
        launchAgentConfig?.sandboxPresetId,
      provider,
      workspacePath: task.git.worktreePath,
      providerRuntimeManifest,
    });
    if (options.phase || parentPhase?.evidence?.identity.mode === 'profile') {
      sandboxPolicy = await this.sandboxPolicies.dryRunWithTrace({
        preset: this.phaseAuthority.narrowSandboxPreset(
          sandboxPolicy.result.preset,
          options.phase,
          parentPhase
        ),
        provider,
        workspacePath: task.git.worktreePath,
        providerRuntimeManifest,
      });
    }
    const attemptId = `preview_${nanoid(8)}`;
    const startedAt = new Date().toISOString();
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const worktreePath = this.expandPath(task.git.worktreePath);
    const workspaceTrustScan = await this.workspaceExecutionTrust.scan(worktreePath);
    const trustSandbox = this.workspaceTrustSandboxPolicy(sandboxPolicy.result, workspaceTrustScan);
    const filesystemSandboxPlan = await this.filesystemSandbox.compile({
      taskId,
      attemptId,
      provider,
      workspacePath: worktreePath,
      sandboxPolicy: trustSandbox.policy,
      providerRuntimeManifestDigest: providerRuntimeManifest.digest,
      providerCommand: launchAgentConfig?.command,
    });
    const workspaceTrustEvaluation = await this.workspaceExecutionTrust.evaluateForLaunch({
      workspacePath: worktreePath,
      constraints: this.workspaceTrustConstraints(
        trustSandbox.policy,
        filesystemSandboxPlan,
        profileLaunch,
        trustSandbox.projectExecutableConfigurationBlocked
      ),
    });
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
      networkAccessEnabled: trustSandbox.policy.effective.networkAccessEnabled,
      executionPolicy: task.executionPolicy,
    });
    const toolPolicy = await this.resolveLaunchToolPolicy(profileLaunch);
    const launchPhaseAuthority = this.runLaunchCompiler.compilePhaseAuthority({
      requestedPhase: options.phase,
      parentPhase,
      profileLaunch,
      sandboxPolicy: trustSandbox.policy,
      providerRuntimeManifest,
      filesystemSandboxPlan,
      provider,
      toolCatalogSelected: (profileLaunch?.profile.tools?.mcpServers?.length ?? 0) > 0,
    });
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
      ...(launchPhaseAuthority.evidence.identity.mode === 'profile'
        ? { phaseEvidence: launchPhaseAuthority.evidence }
        : {}),
    });
    const taskTransport = adapter.renderTaskEnvelope({
      taskEnvelope,
      profileInstructions: profileLaunch?.instructions,
      checkpoint: task.checkpoint,
    });
    const manifest = await this.runLaunchCompiler.compile({
      task,
      taskEnvelope,
      taskTransport,
      attemptId,
      startedAt,
      logPath,
      requestedAgent,
      routingReason,
      routingFallback,
      routingFallbackOnFailure: routingPolicy.fallbackOnFailure,
      routingMaxRetries: routingPolicy.maxRetries,
      agent,
      launchAgentConfig,
      provider,
      providerRuntimeManifest,
      requiredRuntimeCapabilities,
      harnessSupport,
      profileLaunch,
      readiness,
      overrideReason,
      sandboxPolicy: trustSandbox.policy,
      budgetPolicy,
      budgetModelOverride: budgetEvaluation.modelOverride,
      budgetSources,
      options,
      runToolCatalog,
      filesystemSandboxPlan,
      workspaceTrustEvaluation,
      parentPhase,
      phaseAuthority: launchPhaseAuthority,
    });
    const dependencyCircuits = await this.captureDependencyCircuits(
      provider,
      launchAgentConfig?.model,
      taskEnvelope.workspace.workspaceId,
      manifest.routing.selectedHost
    );
    return {
      manifest,
      dependencyCircuits,
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
  ): Promise<AgentLaunchStatus> {
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
  ): Promise<AgentLaunchStatus> {
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
    if (task.attempt?.status === 'running') {
      throw new ConflictError('Task already has a persisted running attempt.', {
        taskId,
        attemptId: task.attempt.id,
        runSupervisorId: task.attempt.runSupervisorId,
        admissionReservationId: task.attempt.admissionReservationId,
      });
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
    const routingPolicy = config.agentRouting ?? DEFAULT_ROUTING_CONFIG;
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
        {
          agent,
          profileId: profileLaunch.profile.id,
          profileVersion: profileLaunch.profile.version,
          taskId,
        },
        '[ClawdbotAgent] Profile selected agent for task'
      );
    } else if (!agentType || agentType === 'auto') {
      const routing = getAgentRoutingService();
      const result = await routing.resolveAgent(task);
      agent = result.agent;
      routingReason = result.reason;
      routingFallback = result.fallback;
      log.info({ agent, routingReason, taskId }, '[ClawdbotAgent] Routing resolved agent for task');
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
    const provider = resolveExecutableAgentProvider(profileAgentConfig, agent);
    const agentHealth = await this.assertAgentAvailable(agent, profileAgentConfig);
    const adapter = this.providerAdapters.resolve(provider);
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
    const recoveryBudgetUsage = options.recovery
      ? {
          ...options.recovery.cumulativeBudget,
          retries: Math.max(options.recovery.cumulativeBudget.retries, options.recovery.sequence),
          fanOut: Math.max(1, options.recovery.cumulativeBudget.fanOut),
        }
      : { fanOut: 1 };
    const budgetEvaluation = budgetService.evaluate(budgetPolicy, recoveryBudgetUsage, {
      taskId,
      agentId: agent,
      actionType: 'agent.start',
      project: task.project,
    });
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
    const providerProbeCwd = this.expandPath(task.git.worktreePath);
    const providerRuntimeManifest = await this.dependencyExecution.execute(
      providerDependencyIdentity(provider, launchAgentConfig?.model, task.project),
      () =>
        adapter.probe({
          agentConfig: launchAgentConfig,
          health: agentHealth,
          cwd: providerProbeCwd,
        }),
      providerDependencyExecutionOptions
    );
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
    const parentAttempt = await this.resolveParentAttempt(
      task,
      conversationSource?.attempt.id ?? options.parentAttemptId
    );
    const parentPhase = await this.resolveParentPhaseSnapshot(parentAttempt);
    let sandboxPolicy = await this.sandboxPolicies.dryRunWithTrace({
      presetId:
        options.sandboxPresetId ??
        profileLaunch?.sandboxPresetId ??
        launchAgentConfig?.sandboxPresetId,
      provider,
      workspacePath: task.git.worktreePath,
      providerRuntimeManifest,
    });
    if (options.phase || parentPhase?.evidence?.identity.mode === 'profile') {
      sandboxPolicy = await this.sandboxPolicies.dryRunWithTrace({
        preset: this.phaseAuthority.narrowSandboxPreset(
          sandboxPolicy.result.preset,
          options.phase,
          parentPhase
        ),
        provider,
        workspacePath: task.git.worktreePath,
        providerRuntimeManifest,
      });
    }
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
    const attemptId = options.admissionQueueClaim?.entry.attemptId ?? `attempt_${nanoid(8)}`;
    const startedAt = new Date().toISOString();
    if (!task.git?.worktreePath) {
      throw new Error(`Task "${taskId}" lost its worktree allocation before launch`);
    }
    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const worktreePath = this.expandPath(task.git.worktreePath);
    const workspaceTrustScan = await this.workspaceExecutionTrust.scan(worktreePath);
    const trustSandbox = this.workspaceTrustSandboxPolicy(sandboxPolicy.result, workspaceTrustScan);
    const filesystemSandboxPlan = await this.filesystemSandbox.compile({
      taskId,
      attemptId,
      provider,
      workspacePath: worktreePath,
      sandboxPolicy: trustSandbox.policy,
      providerRuntimeManifestDigest: providerRuntimeManifest.digest,
      providerCommand: launchAgentConfig?.command,
    });
    const workspaceTrustEvaluation = await this.workspaceExecutionTrust.evaluateForLaunch({
      workspacePath: worktreePath,
      constraints: this.workspaceTrustConstraints(
        trustSandbox.policy,
        filesystemSandboxPlan,
        profileLaunch,
        trustSandbox.projectExecutableConfigurationBlocked
      ),
    });
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
      networkAccessEnabled: trustSandbox.policy.effective.networkAccessEnabled,
      executionPolicy: task.executionPolicy,
    });
    const toolPolicy = await this.resolveLaunchToolPolicy(profileLaunch);
    const launchPhaseAuthority = this.runLaunchCompiler.compilePhaseAuthority({
      requestedPhase: options.phase,
      parentPhase,
      profileLaunch,
      sandboxPolicy: trustSandbox.policy,
      providerRuntimeManifest,
      filesystemSandboxPlan,
      provider,
      toolCatalogSelected: (profileLaunch?.profile.tools?.mcpServers?.length ?? 0) > 0,
    });
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
      ...(launchPhaseAuthority.evidence.identity.mode === 'profile'
        ? { phaseEvidence: launchPhaseAuthority.evidence }
        : {}),
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
    const runLaunchManifest = await this.runLaunchCompiler.compile({
      task,
      taskEnvelope,
      taskTransport: providerTransport,
      attemptId,
      startedAt,
      logPath,
      requestedAgent,
      routingReason,
      routingFallback,
      routingFallbackOnFailure: routingPolicy.fallbackOnFailure,
      routingMaxRetries: routingPolicy.maxRetries,
      agent,
      launchAgentConfig,
      provider,
      providerRuntimeManifest,
      requiredRuntimeCapabilities,
      harnessSupport,
      profileLaunch,
      readiness,
      overrideReason,
      sandboxPolicy: trustSandbox.policy,
      budgetPolicy,
      budgetModelOverride: budgetEvaluation.modelOverride,
      budgetSources,
      options,
      runToolCatalog,
      filesystemSandboxPlan,
      workspaceTrustEvaluation,
      parentPhase,
      phaseAuthority: launchPhaseAuthority,
    });
    const runLaunchManifestDrift = parentAttempt?.runLaunchManifest
      ? diffRunLaunchManifests(runLaunchManifest, parentAttempt.runLaunchManifest)
      : undefined;
    const launchDependencyCircuits = await this.captureDependencyCircuits(
      provider,
      launchAgentConfig?.model,
      taskEnvelope.workspace.workspaceId,
      runLaunchManifest.routing.selectedHost
    );
    const runRetry = options.recovery
      ? {
          ...options.recovery,
          state: 'launched' as const,
          launchedAt: startedAt,
          launchedRunId: attemptId,
          launchedManifestDigest: runLaunchManifest.digest,
          selectedAgent: agent,
        }
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
    const executionTree =
      options.admissionQueueClaim?.entry.request.executionTree ??
      this.buildExecutionTreeIdentity({
        taskId,
        rootTaskId: options.rootTaskId,
        workspaceId: taskEnvelope.workspace.workspaceId,
        attemptId,
        parentAttempt,
        provider,
        conversationIntent: conversation.intent,
        recoveryAction: options.recovery?.action,
        rootIdempotencyKey: options.admissionIdempotencyKey,
      });
    await this.admission.assertExecutionTreeLaunchAllowed(executionTree.rootObjectiveId);
    const inheritedBudgetPolicies = parentAttempt?.admissionReservationId
      ? ((await this.admission.get(parentAttempt.admissionReservationId)).request.budgetPolicies ??
        [])
      : [];
    const executionBudgetPolicies = mergeExecutionTreeBudgetPolicies([
      ...inheritedBudgetPolicies.filter(
        (policy) => policy.scope !== 'agent' || policy.scopeId === agent
      ),
      ...this.executionTreeBudgetPolicies({
        executionTree,
        workspaceId: taskEnvelope.workspace.workspaceId,
        agent,
        attemptId,
        budgetPolicy,
        budgetSources,
        isRoot: !parentAttempt,
      }),
    ]);
    const admissionSource = this.agentAdmissionSource(executionTree, options.recovery);
    const admissionInput = {
      taskId,
      rootTaskId: options.rootTaskId,
      workspaceId: taskEnvelope.workspace.workspaceId,
      provider,
      hostId: runLaunchManifest.routing.selectedHost,
      source: admissionSource,
      idempotencyKey: options.admissionIdempotencyKey,
      executionTree,
      budgetPolicies: executionBudgetPolicies,
      budgetRequest: {
        fanOut: 1,
        retries: options.recovery ? 1 : 0,
      },
    } as const;
    const admissionDecision = options.admissionQueueClaim
      ? undefined
      : await this.admission.admitOrQueue(admissionInput, {
          target: {
            kind: 'agent-launch',
            agent,
            source: admissionSource,
            options: this.admissionAgentLaunchOptions(options, conversationRequest, overrideReason),
          },
          attemptId,
          priority: task.priority,
        });
    if (admissionDecision?.outcome === 'queued' && admissionDecision.queueEntry) {
      try {
        await this.filesystemSandbox.cleanup(filesystemSandboxPlan);
      } catch {
        // The queue is durable; best-effort cleanup must not discard the launch request.
      }
      this.scheduleAdmissionQueueDrain();
      return {
        taskId,
        attemptId: admissionDecision.queueEntry.attemptId,
        queueId: admissionDecision.queueEntry.id,
        agent,
        status: 'queued',
        enqueuedAt: admissionDecision.queueEntry.createdAt,
        retryAfterMs: admissionDecision.queueEntry.retryAfterMs,
        limitingScopes: admissionDecision.queueEntry.limitingPolicies.map((policy) => ({
          scope: policy.scope,
          scopeId: policy.scopeId,
        })),
      };
    }
    if (
      admissionDecision &&
      (admissionDecision.outcome !== 'admitted' || !admissionDecision.reservation)
    ) {
      throw new ConflictError(
        admissionDecision.outcome === 'retryable-overload'
          ? 'Agent launch is waiting for admission capacity.'
          : admissionDecision.outcome === 'queue-overflow'
            ? 'The admission queue is full.'
            : 'Agent launch violates an admission policy.',
        {
          code:
            admissionDecision.outcome === 'retryable-overload'
              ? 'ADMISSION_OVERLOAD'
              : admissionDecision.outcome === 'queue-overflow'
                ? 'ADMISSION_QUEUE_OVERFLOW'
                : 'ADMISSION_POLICY_DENIED',
          decision: admissionDecision,
        }
      );
    }
    const queuedClaim = options.admissionQueueClaim;
    if (queuedClaim) {
      const queuedRequest = queuedClaim.reservation.request;
      const driftFields = [
        queuedClaim.entry.state !== 'leased' ? 'queueState' : undefined,
        queuedClaim.entry.attemptId !== attemptId ? 'attemptId' : undefined,
        (queuedClaim.entry.target?.kind === 'direct' ||
        queuedClaim.entry.target?.kind === 'agent-launch'
          ? queuedClaim.entry.target.agent
          : queuedClaim.entry.agent) !== agent
          ? 'agent'
          : undefined,
        queuedClaim.entry.reservationId !== queuedClaim.reservation.id
          ? 'reservationId'
          : undefined,
        queuedRequest.source !== admissionSource ? 'source' : undefined,
        queuedRequest.taskId !== taskId ? 'taskId' : undefined,
        queuedRequest.rootTaskId !== (options.rootTaskId ?? taskId) ? 'rootTaskId' : undefined,
        queuedRequest.workspaceId !== taskEnvelope.workspace.workspaceId
          ? 'workspaceId'
          : undefined,
        queuedRequest.provider !== provider ? 'provider' : undefined,
        queuedRequest.hostId !== runLaunchManifest.routing.selectedHost ? 'hostId' : undefined,
        JSON.stringify(queuedRequest.executionTree) !== JSON.stringify(executionTree)
          ? 'executionTree'
          : undefined,
        JSON.stringify(queuedRequest.budgetPolicies ?? []) !==
        JSON.stringify(executionBudgetPolicies)
          ? 'budgetPolicies'
          : undefined,
      ].filter((field): field is string => Boolean(field));
      if (driftFields.length > 0) {
        throw new ConflictError('Queued launch authority changed before dispatch.', {
          code: 'ADMISSION_QUEUE_DRIFT',
          queueId: queuedClaim.entry.id,
          driftFields,
        });
      }
    }
    const admissionReservationCandidate =
      queuedClaim?.reservation ?? admissionDecision?.reservation;
    if (!admissionReservationCandidate) {
      throw new ConflictError('Agent launch has no admission reservation.', {
        code: 'ADMISSION_RESERVATION_MISSING',
      });
    }
    let admissionReservation;
    try {
      admissionReservation = queuedClaim
        ? await this.admission.bindQueuedAttempt(
            queuedClaim.entry.id,
            admissionReservationCandidate.id,
            attemptId
          )
        : await this.admission.bindAttempt(admissionReservationCandidate.id, attemptId);
      await this.admission.recordBudgetUsage(admissionReservation.id, {
        schemaVersion: 'execution-tree-budget-event/v1',
        id: `launch_${attemptId}`,
        mode: 'delta',
        usage: {
          ...ZERO_AGENT_BUDGET_USAGE,
          fanOut: 1,
          retries: options.recovery ? 1 : 0,
        },
        source: 'agent-launch',
        occurredAt: startedAt,
      });
    } catch (error) {
      await this.admission
        .releaseIfUnbound(
          admissionReservationCandidate.id,
          'start-failed',
          `bind-failed:${attemptId}`
        )
        .catch(() => {});
      throw error;
    }
    try {
      task = await this.claimTaskRecoveryAfterAdmission(taskId, task, options);
    } catch (error) {
      await this.releaseAdmission(
        admissionReservation.id,
        'start-failed',
        `recovery-claim-failed:${attemptId}`
      );
      throw error;
    }
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
      runRetry,
      activePhaseEvidence: runLaunchManifest.phase?.evidence,
      conversation,
      admissionReservationId: admissionReservation.id,
      executionTree,
      executionTreeUsage: {
        ...ZERO_AGENT_BUDGET_USAGE,
        fanOut: 1,
        retries: options.recovery ? 1 : 0,
      },
      filesystemSandboxPlan,
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
      recoveryBudgetBase: options.recovery?.cumulativeBudget,
    });

    // Initialize log file (ensure it stays within logs dir)
    ensureWithinBase(this.logsDir, logPath);
    try {
      await this.initLogFile(
        logPath,
        task,
        agent,
        providerTransport.content,
        providerRuntimeManifest,
        taskEnvelope,
        runLaunchManifest
      );
    } catch (error) {
      pendingAgents.delete(taskId);
      await this.releaseAdmission(
        admissionReservation.id,
        'start-failed',
        `log-init-failed:${attemptId}`
      );
      throw error;
    }

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
      runRetry,
      conversation,
      admissionReservationId: admissionReservation.id,
      executionTree,
    };

    const usesManagedWorktree = Boolean(task.git?.worktreeManifestId && task.git.worktreeLeaseId);
    if (usesManagedWorktree) {
      try {
        await this.worktrees.claimOwnership(taskId, attemptId);
      } catch (error) {
        pendingAgents.delete(taskId);
        await this.releaseAdmission(
          admissionReservation.id,
          'start-failed',
          `worktree-claim-failed:${attemptId}`
        );
        throw error;
      }
      const claimedTask = await this.taskService.getTask(taskId);
      if (!claimedTask) {
        await this.worktrees.releaseOwnership(taskId, attemptId);
        pendingAgents.delete(taskId);
        await this.releaseAdmission(
          admissionReservation.id,
          'start-failed',
          `task-missing:${attemptId}`
        );
        throw new Error(`Task "${taskId}" disappeared while claiming its worktree`);
      }
      task = claimedTask;
    }
    if (options.recovery) {
      const claimedRecovery = task.attempt?.runRetry;
      if (
        task.attempt?.id !== options.parentAttemptId ||
        claimedRecovery?.state !== 'launching' ||
        claimedRecovery.sequence !== options.recovery.sequence ||
        claimedRecovery.parentRunId !== options.recovery.parentRunId
      ) {
        pendingAgents.delete(taskId);
        await this.releaseAdmission(
          admissionReservation.id,
          'start-failed',
          `recovery-binding-failed:${attemptId}`
        );
        throw new ConflictError('Recovery launch no longer matches the claimed parent attempt', {
          taskId,
          activeAttemptId: task.attempt?.id,
          parentAttemptId: options.parentAttemptId,
          recoveryState: claimedRecovery?.state,
          recoverySequence: claimedRecovery?.sequence,
        });
      }
    }
    try {
      const pending = pendingAgents.get(taskId);
      if (!pending || pending.attemptId !== attemptId) {
        throw new ConflictError('Run launch no longer matches the pending attempt.');
      }
      const toolCatalogDelivery = launchAgentConfig
        ? harnessToolCatalogDelivery(normalizeHarnessSupportProfile(launchAgentConfig).id)
        : 'native';
      pending.runToolBridge =
        runToolCatalog &&
        (toolCatalogDelivery === 'veritas-bridge' ||
          this.runToolBridge.requiresBridge(runToolCatalog))
          ? this.runToolBridge.issue({
              taskId,
              attemptId,
              catalogDigest: runToolCatalog.digest,
              runLaunchManifestDigest: runLaunchManifest.digest,
            })
          : undefined;
      await this.attemptLifecycle.beginAttempt({
        task,
        attempt,
      });
    } catch (error) {
      pendingAgents.delete(taskId);
      this.runToolBridge.revokeRun(taskId, attemptId);
      await this.releaseAdmission(
        admissionReservation.id,
        'start-failed',
        `attempt-persistence-failed:${attemptId}`
      );
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
        ...(filesystemSandboxPlan.directories
          ? {
              sandbox: {
                rootPath: filesystemSandboxPlan.directories.rootPath,
                policyHash: filesystemSandboxPlan.evidence.policyHash,
              },
            }
          : {}),
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
      await this.attemptLifecycle.patchActiveAttempt(taskId, attemptId, {
        runSupervisorId: supervisorId,
      });
      if (queuedClaim) {
        await this.admission.markQueueDispatched(queuedClaim.entry.id, attemptId);
      }
      if (options.recovery && runRetry) {
        await this.appendRunEvent(
          taskId,
          attemptId,
          'recovery.launched',
          {
            action: runRetry.action,
            sequence: runRetry.sequence,
            parentAttemptId: options.parentAttemptId,
            launchedAttemptId: attemptId,
            selectedAgent: agent,
            sourceManifestDigest: runRetry.sourceManifestDigest,
            launchedManifestDigest: runRetry.launchedManifestDigest,
            cumulativeBudget: runRetry.cumulativeBudget,
          },
          {
            provider: 'system',
            adapter: 'run-recovery',
            agent,
            dedupeKey: `recovery.launched:${runRetry.sequence}`,
          }
        );
      }
      const startedEvent = await this.appendRunEvent(
        taskId,
        attemptId,
        'run.started',
        {
          summary: 'Agent run initialized',
          taskEnvelopeDigest: taskEnvelope.digest,
          runLaunchManifestDigest: runLaunchManifest.digest,
          providerRuntimeManifestDigest: providerRuntimeManifest.digest,
          phaseEvidenceDigest: runLaunchManifest.phase?.evidence.digest,
          phaseIdentity: runLaunchManifest.phase?.evidence.identity,
          worktreeManifestId: taskEnvelope.workspace.worktreeManifestId,
          dependencyCircuits: launchDependencyCircuits,
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
          phaseEvidenceDigest: runLaunchManifest.phase?.evidence.digest,
          phaseIdentity: runLaunchManifest.phase?.evidence.identity,
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
        admissionSource,
        admissionOutcome: queuedClaim ? 'queued-dispatch' : 'admitted',
        harnessSupport: this.harnessTelemetry(harnessSupport),
        dependencyCircuits: this.dependencyCircuitTelemetry(launchDependencyCircuits),
      });

      await this.workspaceExecutionTrust.assertFresh(
        worktreePath,
        runLaunchManifest.workspaceTrust
      );
      await this.filesystemSandbox.activate(filesystemSandboxPlan);
      const egressPolicy = trustSandbox.policy.effective.networkPolicy;
      if (egressPolicy && runEgressPolicyRequiresGateway(egressPolicy)) {
        if (provider === 'openclaw' && trustSandbox.policy.preset.enforcement === 'required') {
          throw new ConflictError(
            'OpenClaw cannot enforce a Veritas run-scoped egress gateway for this preset.',
            {
              provider,
              presetId: trustSandbox.policy.preset.id,
              policyHash: egressPolicy.policyHash,
              remediation:
                'Use a local provider adapter with gateway enforcement or select a preset that does not require fine-grained egress controls.',
            }
          );
        }
        if (provider === 'openclaw') {
          this.recordTraceStep(attemptId, 'execute', {
            eventType: 'network.egress.gateway-bypass-advisory',
            policyHash: egressPolicy.policyHash,
            provider,
            presetId: trustSandbox.policy.preset.id,
          });
        } else {
          const pending = pendingAgents.get(taskId);
          if (!pending || pending.attemptId !== attemptId) {
            throw new ConflictError('Run egress gateway no longer matches the pending launch.', {
              taskId,
              attemptId,
            });
          }
          pending.egressGateway = await this.runEgressGateway.start({
            runId: attemptId,
            policy: egressPolicy,
            upstreamProxyUrl: process.env[RUN_EGRESS_UPSTREAM_PROXY_ENV_KEY],
            onApprovalRequired: (request) =>
              this.resolveRunEgressApproval(
                task,
                attemptId,
                provider,
                agent,
                runLaunchManifest,
                request
              ),
            onDecision: async (event) => {
              this.recordTraceStep(attemptId, 'execute', {
                eventType: 'network.egress.decision',
                gatewayId: event.gatewayId,
                runKey: event.runKey,
                occurredAt: event.occurredAt,
                policyHash: event.decision.policyHash,
                protocol: event.decision.protocol,
                hostKey: event.decision.hostKey,
                port: event.decision.port,
                method: event.decision.method,
                decision: event.decision.decision,
                reason: event.decision.reason,
                blockedAddressClass: event.decision.blockedAddressClass,
                approvalEligible: event.decision.approvalEligible,
                approvalId: event.decision.approvalId,
                policyReason: event.decision.policyReason,
              });
              await telemetry.emit<NetworkEgressTelemetryEvent>({
                type: 'network.egress',
                taskId,
                attemptId,
                agent,
                provider,
                project: task.project,
                gatewayId: event.gatewayId,
                runKey: event.runKey,
                policyHash: event.decision.policyHash,
                protocol: event.decision.protocol,
                hostKey: event.decision.hostKey,
                port: event.decision.port,
                method: event.decision.method,
                decision: event.decision.decision,
                reason: event.decision.reason,
                policyReason: event.decision.policyReason,
                blockedAddressClass: event.decision.blockedAddressClass,
                approvalEligible: event.decision.approvalEligible,
                approvalId: event.decision.approvalId,
              });
            },
          });
          this.recordTraceStep(attemptId, 'execute', {
            eventType: 'network.egress.gateway-started',
            evidence: pending.egressGateway.evidence,
          });
        }
      }
      const providerAdmission: AgentProviderAdmissionEvidence = {
        schemaVersion: 'provider-admission-evidence/v1',
        source: admissionSource,
        outcome: queuedClaim ? 'queued-dispatch' : 'admitted',
        reservationId: admissionReservation.id,
        ...(queuedClaim ? { queueEntryId: queuedClaim.entry.id } : {}),
        executionTree,
      };
      await this.admission.assertExecutionTreeLaunchAllowed(executionTree.rootObjectiveId);
      this.assertProviderAdmissionEvidence(providerAdmission, attempt);
      const launchCheckpointBoundary: WorkspaceCheckpointBoundary = runRetry
        ? 'before-retry'
        : executionTree.edge === 'provider-handoff'
          ? 'before-provider-handoff'
          : 'before-user-turn';
      const launchPending = pendingAgents.get(taskId);
      if (!launchPending || launchPending.attemptId !== attemptId) {
        throw new ConflictError('Workspace checkpoint no longer matches the pending launch.', {
          taskId,
          attemptId,
        });
      }
      await this.capturePendingWorkspaceCheckpoint(
        taskId,
        launchPending,
        launchCheckpointBoundary,
        `launch:${attemptId}:${launchCheckpointBoundary}`,
        startedEvent.eventId
      );
      await this.dependencyExecution.executeAll(
        [
          providerDependencyIdentity(
            provider,
            launchAgentConfig?.model,
            taskEnvelope.workspace.workspaceId
          ),
          agentHostDependencyIdentity(
            runLaunchManifest.routing.selectedHost,
            taskEnvelope.workspace.workspaceId
          ),
        ],
        () =>
          Promise.resolve(
            adapter.start({
              task,
              agentConfig: launchAgentConfig,
              transport: providerTransport,
              logPath,
              attemptId,
              startedAt,
              emitter,
              attempt,
              sandboxPolicy: trustSandbox.policy,
              runLaunchManifest,
              conversation,
              admission: providerAdmission,
            })
          ),
        providerDependencyExecutionOptions
      );
    } catch (error: unknown) {
      const startError = error instanceof Error ? error : new Error(String(error));
      const failedDependencyCircuits = await this.captureDependencyCircuits(
        provider,
        launchAgentConfig?.model,
        taskEnvelope.workspace.workspaceId,
        runLaunchManifest.routing.selectedHost
      ).catch(() => undefined);
      await this.releaseAdmission(
        admissionReservation.id,
        'start-failed',
        `provider-start-failed:${attemptId}`
      );
      await this.appendRunEvent(
        taskId,
        attemptId,
        'run.failed',
        {
          summary: this.redactTraceText(startError.message || `Failed to start ${adapter.label}`),
          phase: 'launch',
          ...(failedDependencyCircuits ? { dependencyCircuits: failedDependencyCircuits } : {}),
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
      await this.attemptLifecycle.persistLaunchFailure(taskId, failedAttempt);
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
        ...(failedDependencyCircuits
          ? {
              dependencyCircuits: this.dependencyCircuitTelemetry(failedDependencyCircuits),
            }
          : {}),
      });
      const launchCleanupEffects: Array<[string, () => void | Promise<void>]> = [
        [
          'release worktree ownership',
          async () => {
            if (usesManagedWorktree) {
              await this.worktrees.releaseOwnership(taskId, attemptId);
            }
          },
        ],
        [
          'revoke run credential leases',
          () =>
            this.revokeRunCredentialLeases(taskId, attemptId, 'failed', runLaunchManifest.digest),
        ],
        ['close run tool sessions', () => this.toolControlPlane.closeRun(taskId, attemptId)],
        [
          'remove run filesystem sandbox',
          () => this.filesystemSandbox.cleanup(filesystemSandboxPlan),
        ],
      ];
      for (const [effect, cleanup] of launchCleanupEffects) {
        try {
          await cleanup();
        } catch (cleanupError) {
          log.error(
            { err: cleanupError, taskId, attemptId, effect },
            'Failed to clean up a failed recovery-capable launch'
          );
        }
      }
      await this.planTaskRecovery(
        taskId,
        failedAttempt,
        this.runRecoveryPolicy.classifyError(startError)
      ).catch((recoveryError) => {
        log.error(
          { err: recoveryError, taskId, attemptId },
          'Failed to persist recovery policy after provider launch failure'
        );
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
      runRetry,
      activePhaseEvidence: runLaunchManifest.phase?.evidence,
      conversation,
      controls: providerRuntimeControls(providerRuntimeManifest),
      admissionReservationId: admissionReservation.id,
      executionTree,
      terminals: this.runTerminals.list(taskEnvelope.workspace.workspaceId, taskId, attemptId),
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
        this.attemptLifecycle.assertCompletionBinding(taskId, persistedAttempt);
        this.assertTerminalTransport(persistedAttempt.provider, terminalSource);
        const claim = this.normalizeTerminalClaim(result, terminalSource);
        const idempotencyKey = this.providerCompletions.idempotencyKey({
          taskEnvelope: persistedAttempt.taskEnvelope,
          claim,
        });
        if (persistedAttempt.completionResult) {
          const persistedCompletion =
            this.attemptLifecycle.parsePersistedCompletion(persistedAttempt);
          if (persistedCompletion.idempotencyKey === idempotencyKey) {
            await this.admission.releaseByAttempt(
              persistedAttempt.taskEnvelope.workspace.workspaceId,
              taskId,
              persistedAttempt.id,
              persistedCompletion.status === 'success'
                ? 'completed'
                : persistedCompletion.status === 'interrupted'
                  ? 'interrupted'
                  : 'failed',
              `duplicate-completion:${persistedCompletion.idempotencyKey}`
            );
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
          await this.persistRestartedProviderCompletion(task, persistedAttempt, claim);
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
    const persisted = await this.attemptLifecycle.persistCompletion({
      task,
      attempt,
      completionResult: value,
      clearRunRecovery: true,
    });
    const { completionResult, attempt: completedAttempt } = persisted;
    this.scheduleReflectionExtraction(attempt.taskEnvelope.workspace.workspaceId, completionResult);
    await this.admission.releaseByAttempt(
      attempt.taskEnvelope.workspace.workspaceId,
      task.id,
      attempt.id,
      admissionReleaseReason(completionResult.status),
      `recovered-completion:${completionResult.idempotencyKey}`
    );
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
    if (completionResult.status !== 'success') {
      await this.planTaskRecovery(
        task.id,
        completedAttempt,
        this.runRecoveryPolicy.classifyCompletion(completionResult)
      );
    }
  }

  private async persistRestartedProviderCompletion(
    task: Task,
    attempt: TaskAttempt,
    claim: ProviderTerminalClaim,
    options: { preserveNonActiveTaskStatus?: boolean } = {}
  ): Promise<void> {
    if (!attempt.taskEnvelope) {
      throw new ConflictError('Restarted provider completion has no task envelope', {
        taskId: task.id,
        attemptId: attempt.id,
      });
    }
    this.attemptLifecycle.assertCompletionBinding(task.id, attempt);
    const dependencyCircuits = attempt.runLaunchManifest
      ? await this.captureDependencyCircuits(
          attempt.runLaunchManifest.providerRuntime.provider,
          attempt.model,
          attempt.taskEnvelope.workspace.workspaceId,
          attempt.runLaunchManifest.routing.selectedHost
        ).catch((error) => {
          log.error(
            { err: error, taskId: task.id, attemptId: attempt.id },
            'Failed to capture dependency circuit completion evidence'
          );
          return undefined;
        })
      : undefined;
    const completionResult = await this.providerCompletions.complete({
      task,
      taskEnvelope: attempt.taskEnvelope,
      claim,
      ...(dependencyCircuits
        ? { harnessEvidence: this.dependencyCircuitCompletionEvidence(dependencyCircuits) }
        : {}),
      ...(await this.completionPhaseEvidence(
        task.id,
        attempt.id,
        attempt.runLaunchManifest?.phase
      )),
    });
    await this.runTerminals.reconcileAttempt(
      attempt.taskEnvelope.workspace.workspaceId,
      task.id,
      attempt.id
    );
    await this.runTerminals.cleanupAttempt(
      attempt.taskEnvelope.workspace.workspaceId,
      task.id,
      attempt.id
    );
    if (attempt.provider === 'openclaw' && completionResult.summary) {
      await this.appendMappedProviderEvent(
        task,
        attempt.id,
        undefined,
        'openclaw',
        this.providerAdapters.resolve('openclaw').runEventMapper.mapEvent(
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
        ...(dependencyCircuits ? { dependencyCircuits } : {}),
      },
      {
        provider: executableProvider(attempt.provider),
        adapter: attempt.provider ?? 'restart-reconciliation',
        agent: attempt.agent,
        model: attempt.model,
        dedupeKey: `run.recovery:${completionResult.idempotencyKey}`,
      }
    );
    const terminalEvent = await this.appendRunEvent(
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
    await this.attemptLifecycle.persistCompletion({
      task,
      attempt,
      completionResult,
      preserveNonActiveTaskStatus: options.preserveNonActiveTaskStatus,
    });
    this.scheduleReflectionExtraction(
      attempt.taskEnvelope.workspace.workspaceId,
      completionResult,
      terminalEvent.eventId
    );

    await this.admission.releaseByAttempt(
      attempt.taskEnvelope.workspace.workspaceId,
      task.id,
      attempt.id,
      admissionReleaseReason(completionResult.status),
      `restart-completion:${completionResult.idempotencyKey}`
    );
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
      const prepared = pending.preparedFinalizationResult;
      if (prepared && pending.terminalClaimIdempotencyKey) {
        await this.releaseAdmission(
          pending.admissionReservationId,
          admissionReleaseReason(prepared.status, prepared.success),
          `finalization-failed:${pending.terminalClaimIdempotencyKey}`
        );
      }
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
    if (!pending.completionBudgetEvaluated) {
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
        const dependencyCircuits = await this.captureDependencyCircuits(
          pending.provider,
          pending.model,
          pending.taskEnvelope.workspace.workspaceId,
          pending.runLaunchManifest.routing.selectedHost
        ).catch((error) => {
          log.error(
            { err: error, taskId, attemptId },
            'Failed to capture dependency circuit completion evidence'
          );
          return undefined;
        });
        const completionResult = await this.providerCompletions.complete({
          task: taskBeforeCompletion,
          taskEnvelope: pending.taskEnvelope,
          claim,
          ...(dependencyCircuits
            ? { harnessEvidence: this.dependencyCircuitCompletionEvidence(dependencyCircuits) }
            : {}),
          ...(await this.completionPhaseEvidence(
            taskId,
            attemptId,
            pending.runLaunchManifest.phase
          )),
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
          admissionReservationId: pending.admissionReservationId,
          executionTree: pending.executionTree,
          runLaunchManifestTraceId: pending.runLaunchManifestTraceId,
          runLaunchParentAttemptId: pending.runLaunchParentAttemptId,
          runLaunchManifestDrift: pending.runLaunchManifestDrift,
          runRetry: pending.runRetry,
          conversation: pending.conversation,
          completionResult,
        };
        return (pending.preparedCompletion = {
          status,
          taskBeforeCompletion,
          completedAttempt,
          completionResult,
          dependencyCircuits,
        });
      })());
    const { status, taskBeforeCompletion, completionResult, dependencyCircuits } =
      preparedCompletion;
    const terminalLaunches = [...(pendingRunTerminalLaunches.get(pending) ?? [])];
    if (terminalLaunches.length > 0) {
      await Promise.allSettled(terminalLaunches);
    }
    await this.runTerminals.cleanupAttempt(
      pending.taskEnvelope.workspace.workspaceId,
      taskId,
      attemptId
    );
    const successful = completionResult.status === 'success';

    if (pending.provider === 'openclaw' && completionResult.summary) {
      await this.appendMappedProviderEvent(
        taskBeforeCompletion,
        attemptId,
        undefined,
        'openclaw',
        this.providerAdapters.resolve('openclaw').runEventMapper.mapEvent(
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
    const terminalEvent = await this.appendRunEvent(
      taskId,
      attemptId,
      terminalKind,
      {
        summary: completionResult.summary,
        error: completionResult.error,
        status: completionResult.status,
        terminalSource: completionResult.terminalSource,
        durationMs: timing.durationMs,
        ...(dependencyCircuits ? { dependencyCircuits } : {}),
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
    await this.releaseAdmission(
      pending.admissionReservationId,
      admissionReleaseReason(completionResult.status),
      `completion:${completionResult.idempotencyKey}`
    );
    this.scheduleReflectionExtraction(
      pending.taskEnvelope.workspace.workspaceId,
      completionResult,
      terminalEvent.eventId
    );
    if (!persistedHere) return;

    const logPath = path.join(this.logsDir, `${taskId}_${attemptId}.md`);
    const summary = completionResult.summary;
    const { durationMs } = timing;
    const completionStepType = successful ? 'complete' : 'error';
    const requestFile = path.join(getRuntimeDir(), 'agent-requests', `${taskId}.json`);
    let durableGoalSupervised = false;
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
            ...(dependencyCircuits
              ? {
                  dependencyCircuits: this.dependencyCircuitTelemetry(dependencyCircuits),
                }
              : {}),
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
      [
        'supervise durable goal completion',
        async () => {
          // Fail closed: if ownership lookup errors or is ambiguous, do not let
          // the legacy recovery loop race a possible durable goal continuation.
          durableGoalSupervised = true;
          const result = await this.durableGoalSupervisor.handleRunCompletion(
            {
              workspaceId: pending.taskEnvelope.workspace.workspaceId,
              taskId,
              attemptId,
              parentAttemptId: pending.runLaunchParentAttemptId,
              conversationId: pending.conversation.conversationId,
              completion: completionResult,
              usage: pending.executionTreeUsage,
            },
            (request) => this.dispatchDurableGoalContinuation(request)
          );
          durableGoalSupervised = result.action !== 'not-found';
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

    if (!successful && !durableGoalSupervised) {
      await this.planTaskRecovery(
        taskId,
        preparedCompletion.completedAttempt,
        this.runRecoveryPolicy.classifyCompletion(completionResult)
      ).catch((recoveryError) => {
        log.error(
          { err: recoveryError, taskId, attemptId },
          '[ClawdbotAgent] Failed to persist automatic recovery decision'
        );
      });
    }

    log.info({ status, taskId }, '[ClawdbotAgent] Task completed');
  }

  private scheduleReflectionExtraction(
    workspaceId: string,
    completion: CompletionResult,
    runEventId?: string
  ): void {
    scheduleReflectionExtractionJob({
      jobs: this.reflectionExtractionJobs,
      workspaceId,
      completion,
      runEventId,
      onError: (error) => {
        log.error(
          {
            err: error,
            taskId: completion.taskId,
            attemptId: completion.attemptId,
          },
          '[ClawdbotAgent] Reflection extraction enqueue failed'
        );
      },
    });
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
    try {
      await this.credentialLeases.revokeRun({
        taskId,
        attemptId,
        ...(runLaunchManifestDigest ? { runLaunchManifestDigest } : {}),
        reason,
      });
    } finally {
      this.runToolBridge.revokeRun(taskId, attemptId);
      await this.runEgressGateway.stopRun(attemptId);
    }
  }

  private async releaseAdmission(
    reservationId: string | undefined,
    reason: AdmissionReservationRelease['reason'],
    idempotencyKey: string
  ): Promise<void> {
    if (!reservationId) return;
    try {
      await this.admission.release(reservationId, reason, idempotencyKey);
      this.scheduleAdmissionQueueDrain();
    } catch (error) {
      log.error(
        { err: error, reservationId, reason },
        '[ClawdbotAgent] Failed to release admission reservation'
      );
    }
  }

  private async persistPendingCompletion(
    taskId: string,
    pending: PendingAgent,
    prepared: NonNullable<PendingAgent['preparedCompletion']>
  ): Promise<boolean> {
    if (!prepared.taskBeforeCompletion) {
      throw new ConflictError('Task disappeared before completion could be persisted', {
        taskId,
        attemptId: pending.attemptId,
      });
    }
    await this.attemptLifecycle.persistCompletion({
      task: prepared.taskBeforeCompletion,
      attempt: prepared.completedAttempt,
      completionResult: prepared.completionResult,
    });
    return true;
  }

  /**
   * Stop a running agent
   */
  async stopAgent(
    taskId: string,
    expectedAttemptId: string,
    options: AgentStopOptions = {}
  ): Promise<void> {
    const pending = pendingAgents.get(taskId);
    if (!pending || pending.attemptId !== expectedAttemptId) {
      throw new ConflictError('Stop request does not match the active run', {
        activeAttemptId: pending?.attemptId,
        requestedAttemptId: expectedAttemptId,
      });
    }

    await this.finalizePendingAgent(taskId, pending, async () => {
      const reason = options.reason?.trim() || 'Stopped by user';
      const actor = options.actor ?? 'operator';
      await this.assertPendingRunControl(taskId, pending, 'stop');
      await this.stopPendingProvider(pending);
      await this.appendRunEvent(
        taskId,
        pending.attemptId,
        'run.interrupted',
        { summary: reason, phase: 'requested', actor, source: options.source },
        {
          provider: actor,
          adapter: options.source ?? 'veritas-run-control',
          agent: pending.agent,
          model: pending.model,
          dedupeKey:
            actor === 'operator'
              ? 'run.interruption-requested'
              : `run.interruption-requested:${options.source ?? actor}`,
        }
      );
      this.recordTraceStep(pending.attemptId, 'abort', {
        eventType: 'run.aborted',
        summary: reason,
        reason,
        agent: pending.agent,
        provider: pending.provider,
        model: pending.model,
      });
      return {
        status: 'interrupted',
        terminalSource: options.terminalSource ?? 'operator-interruption',
        error: reason,
      };
    });
  }

  async cancelExecutionTree(
    rootObjectiveId: string,
    input: AdmissionCancellationInput
  ): Promise<AdmissionExecutionTreeCancellationResult> {
    const cancellation = await this.admission.cancelExecutionTree(rootObjectiveId, input);
    const runningAttempts: AdmissionExecutionTreeCancellationResult['runningAttempts'] = [];
    let interruptedAttempts = 0;
    for (const attempt of cancellation.runningAttempts) {
      try {
        await this.stopAgent(attempt.taskId, attempt.attemptId);
        interruptedAttempts += 1;
      } catch {
        runningAttempts.push(attempt);
      }
    }
    return {
      ...cancellation,
      interruptedAttempts,
      reservationsReleased: cancellation.reservationsReleased + interruptedAttempts,
      runningAttempts,
    };
  }

  private async stopPendingProvider(pending: PendingAgent): Promise<void> {
    if (pending.recoveredControl && pending.supervisorId) {
      const supervisor = await this.runSupervisor.get(pending.supervisorId);
      if (supervisor.control.kind === 'local-process') {
        await this.runSupervisor.stopLocalProcess(pending.supervisorId);
      } else {
        await this.providerAdapters.resolve(pending.provider).stop({
          taskId: pending.taskId,
          pending,
        });
      }
      return;
    }

    await this.providerAdapters.resolve(pending.provider).stop({
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
      await this.capturePendingWorkspaceCheckpoint(
        taskId,
        pending,
        'before-user-turn',
        `operator-turn:${journalEvent.eventId}`,
        journalEvent.eventId
      );
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

  async rewindWorkspaceCheckpoint(
    taskId: string,
    input: {
      attemptId: string;
      targetCheckpointId: string;
      descendantCheckpointId: string;
      requestId: string;
      resolutions?: WorkspaceCheckpointRewindRequest['resolutions'];
    }
  ): Promise<WorkspaceCheckpointRewindResult> {
    await this.assertActiveRunControl(taskId, 'interrupt', input.attemptId);
    await this.assertActiveRunControl(taskId, 'fork', input.attemptId);
    const pending = this.requireWorkspaceRewindPending(taskId, input.attemptId);
    const request: WorkspaceCheckpointRewindRequest = {
      taskEnvelope: pending.taskEnvelope,
      taskId,
      ...input,
    };
    const service = new WorkspaceCheckpointRewindService({
      approvals: this.approvalBroker,
      runtime: {
        inspect: async (runtimeRequest) => this.inspectWorkspaceRewindRuntime(runtimeRequest),
        quiesce: async (runtimeRequest) => {
          const snapshot = this.inspectWorkspaceRewindRuntime(runtimeRequest);
          if (snapshot.stateDigest !== runtimeRequest.expectedStateDigest) {
            throw new ConflictError('Workspace rewind runtime changed before quiescence.', {
              expectedStateDigest: runtimeRequest.expectedStateDigest,
              currentStateDigest: snapshot.stateDigest,
            });
          }
          const active = this.requireWorkspaceRewindPending(
            runtimeRequest.taskId,
            runtimeRequest.attemptId
          );
          const token = await active.codexAppServerControl.quiesceForRewind();
          return { token, snapshot };
        },
        commit: async ({
          request: runtimeRequest,
          token,
          targetConversationCursor,
          transaction,
        }) => {
          const active = this.requireWorkspaceRewindPending(
            runtimeRequest.taskId,
            runtimeRequest.attemptId
          );
          const target = parseProviderConversationCursor(targetConversationCursor);
          const conversationId = await active.codexAppServerControl.forkForRewind(
            token,
            target,
            false
          );
          await this.recordWorkspaceRewindConversation(active, conversationId, target);
          const runtime = this.inspectWorkspaceRewindRuntime(
            runtimeRequest,
            targetConversationCursor
          );
          const event = await this.appendRunEvent(
            runtimeRequest.taskId,
            runtimeRequest.attemptId,
            'workspace.rewind.committed',
            {
              transactionId: transaction.id,
              targetCheckpointId: runtimeRequest.targetCheckpointId,
              descendantCheckpointId: runtimeRequest.descendantCheckpointId,
              conversationId,
            },
            {
              provider: active.provider,
              adapter: active.provider,
              agent: active.agent,
              model: active.model,
              dedupeKey: `workspace.rewind.committed:${transaction.id}`,
            }
          );
          this.emitJournalOutput(event);
          return runtime;
        },
        rollback: async ({ request: runtimeRequest, token, snapshot }) => {
          const active = this.requireWorkspaceRewindPending(
            runtimeRequest.taskId,
            runtimeRequest.attemptId
          );
          const descendant = parseProviderConversationCursor(snapshot.conversationCursor);
          const conversationId = await active.codexAppServerControl.forkForRewind(
            token,
            descendant,
            true
          );
          await this.recordWorkspaceRewindConversation(active, conversationId, descendant);
          const runtime = this.inspectWorkspaceRewindRuntime(
            runtimeRequest,
            snapshot.conversationCursor
          );
          const event = await this.appendRunEvent(
            runtimeRequest.taskId,
            runtimeRequest.attemptId,
            'workspace.rewind.rolled-back',
            {
              targetCheckpointId: runtimeRequest.targetCheckpointId,
              descendantCheckpointId: runtimeRequest.descendantCheckpointId,
              conversationId,
            },
            {
              provider: active.provider,
              adapter: active.provider,
              agent: active.agent,
              model: active.model,
              dedupeKey: `workspace.rewind.rolled-back:${runtimeRequest.requestId}`,
            }
          );
          this.emitJournalOutput(event);
          return runtime;
        },
      },
    });
    return service.execute(request);
  }

  private requireWorkspaceRewindPending(
    taskId: string,
    attemptId: string
  ): PendingAgent & {
    provider: 'codex-app-server';
    codexAppServerControl: CodexAppServerControl;
  } {
    const pending = pendingAgents.get(taskId);
    if (
      !pending ||
      pending.attemptId !== attemptId ||
      pending.provider !== 'codex-app-server' ||
      !pending.codexAppServerControl
    ) {
      throw new ConflictError(
        'Workspace rewind currently requires the exact active Codex app-server attempt.',
        {
          taskId,
          attemptId,
          activeAttemptId: pending?.attemptId,
          activeProvider: pending?.provider,
        }
      );
    }
    return pending as PendingAgent & {
      provider: 'codex-app-server';
      codexAppServerControl: CodexAppServerControl;
    };
  }

  private inspectWorkspaceRewindRuntime(
    request: WorkspaceCheckpointRewindRequest,
    rewindAnchorCursor?: string
  ): WorkspaceCheckpointRewindRuntimeSnapshot {
    const pending = this.requireWorkspaceRewindPending(request.taskId, request.attemptId);
    const conversationCursor = workspaceConversationCursor(pending.conversation);
    if (!conversationCursor) {
      throw new ConflictError('Workspace rewind runtime has no durable conversation cursor.');
    }
    const runtimeIdentity = pending.codexAppServerControl.runtimeIdentity();
    return {
      provider: pending.provider,
      agentId: pending.agent,
      evidenceRevision: pending.providerRuntimeManifest.digest,
      stateDigest: digestRunLaunchValue({
        schemaVersion: 'workspace-checkpoint-runtime-state/v1',
        taskId: request.taskId,
        attemptId: request.attemptId,
        provider: pending.provider,
        providerRuntimeManifestDigest: pending.providerRuntimeManifest.digest,
        conversationCursor,
        runtimeIdentity,
      }),
      conversationCursor,
      ...(rewindAnchorCursor ? { rewindAnchorCursor } : {}),
    };
  }

  private async recordWorkspaceRewindConversation(
    pending: PendingAgent,
    conversationId: string,
    anchor: ProviderConversationCursor
  ): Promise<void> {
    const {
      conversationId: _conversationId,
      currentTurnId: _currentTurnId,
      lastItemId: _lastItemId,
      parentConversationId: _parentConversationId,
      parentAttemptId: _parentAttemptId,
      forkTurnId: _forkTurnId,
      ...base
    } = pending.conversation;
    const updatedAt = new Date().toISOString();
    const conversation: ConversationLifecycleRecord = {
      ...base,
      mode: 'fork',
      intent: 'fork',
      conversationId,
      parentConversationId: anchor.conversationId,
      ...(anchor.turnId ? { forkTurnId: anchor.turnId } : {}),
      state: 'active',
      contextWindow: { posture: 'unknown', measuredAt: updatedAt },
      updatedAt,
    };
    pending.conversation = conversation;
    pending.threadId = conversationId;
    await this.attemptLifecycle.patchActiveAttempt(pending.taskId, pending.attemptId, {
      threadId: conversationId,
      conversation,
    });
    if (pending.supervisorId) {
      await this.runSupervisor.checkpoint(pending.supervisorId, {
        sessionId: conversationId,
        threadId: conversationId,
      });
    }
  }

  async resumeConversation(
    taskId: string,
    sourceAttemptId: string,
    message: string,
    options: Omit<AgentStartOptions, 'conversation' | 'parentAttemptId'> = {}
  ): Promise<AgentLaunchStatus> {
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
  ): Promise<AgentLaunchStatus> {
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

  async rolloverDurableGoal(goalId: string, expectedRevision: number, actorId: string) {
    const approveRollover = this.durableGoalSupervisor.approveRollover;
    if (!approveRollover) {
      throw new ConflictError('Durable goal rollover supervision is unavailable.');
    }
    return approveRollover.call(
      this.durableGoalSupervisor,
      {
        goalId,
        expectedRevision,
        actorId,
      },
      (request) => this.dispatchDurableGoalContinuation(request)
    );
  }

  private async dispatchDurableGoalContinuation(
    request: DurableGoalContinuationDispatchRequest
  ): Promise<{ attemptId: string; queueId?: string }> {
    const options: Omit<AgentStartOptions, 'conversation' | 'parentAttemptId'> = {
      admissionIdempotencyKey: request.admissionIdempotencyKey,
      budget: request.remainingBudget
        ? {
            enabled: true,
            name: `Durable goal ${request.goal.id} remaining budget`,
            scope: 'run',
            limits: request.remainingBudget,
            hardAction: 'pause',
          }
        : undefined,
      rootTaskId:
        request.goal.root.kind === 'task'
          ? request.goal.root.taskId
          : (request.goal.root.taskId ?? request.sourceTaskId),
    };
    const result =
      request.kind === 'rollover'
        ? await this.startDurableGoalRollover(request, options)
        : await this.followUpConversation(
            request.sourceTaskId,
            request.sourceAttemptId,
            request.message,
            options
          );
    return {
      attemptId: result.attemptId,
      ...('queueId' in result ? { queueId: result.queueId } : {}),
    };
  }

  private async startDurableGoalRollover(
    request: DurableGoalContinuationDispatchRequest,
    options: Omit<AgentStartOptions, 'conversation' | 'parentAttemptId'>
  ): Promise<AgentLaunchStatus> {
    const source = await this.findAttempt(request.sourceAttemptId);
    if (!source || !['complete', 'failed'].includes(source.status)) {
      throw new ConflictError('Durable goal rollover requires a terminal source attempt.', {
        sourceAttemptId: request.sourceAttemptId,
        sourceStatus: source?.status,
      });
    }
    return this.startAgent(request.sourceTaskId, source.agent, {
      ...options,
      parentAttemptId: source.id,
      conversation: {
        mode: 'fresh',
        intent: 'fresh',
        message: request.message,
      },
    });
  }

  private async reconcileDurableGoalContinuations(tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      const attempt = task.attempt;
      const workspaceId = attempt?.taskEnvelope?.workspace.workspaceId;
      if (!attempt || !workspaceId) continue;
      try {
        await this.durableGoalSupervisor.reconcilePlannedForTask(
          {
            workspaceId,
            taskId: task.id,
            currentAttemptId: attempt.id,
            parentAttemptId: attempt.runLaunchParentAttemptId,
            currentAttemptRunning: attempt.status === 'running',
          },
          (request) => this.dispatchDurableGoalContinuation(request)
        );
      } catch (error) {
        log.warn(
          { err: error, taskId: task.id, attemptId: attempt.id },
          '[ClawdbotAgent] Failed to reconcile a durable goal continuation'
        );
      }
    }
  }

  async forkConversation(
    taskId: string,
    sourceAttemptId: string,
    message: string,
    forkTurnId?: string,
    options: Omit<AgentStartOptions, 'conversation' | 'parentAttemptId'> = {}
  ): Promise<AgentLaunchStatus> {
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
    await this.capturePendingWorkspaceCheckpoint(
      taskId,
      pending,
      'before-compaction',
      `compact:${pending.conversation.updatedAt}`
    );
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
    await this.attemptLifecycle.patchActiveAttempt(taskId, pending.attemptId, { conversation });
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
        phaseEvidenceDigest: pending.activePhaseEvidence?.digest,
        phaseIdentity: pending.activePhaseEvidence?.identity,
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
    await this.recordExecutionTreeUsage(pending, delta, actionType);
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
        if (pending.recoveryBudgetBase) {
          if (delta.runtimeSeconds !== undefined) {
            usage.runtimeSeconds =
              pending.recoveryBudgetBase.runtimeSeconds + Math.max(0, delta.runtimeSeconds);
          }
          if (delta.idleRuntimeSeconds !== undefined) {
            usage.idleRuntimeSeconds =
              pending.recoveryBudgetBase.idleRuntimeSeconds + Math.max(0, delta.idleRuntimeSeconds);
          }
          if (pending.runRetry) {
            usage.retries = Math.max(usage.retries, pending.runRetry.sequence);
          }
        }
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
      await this.providerAdapters.resolve(pending.provider).stop({ taskId, pending });
      return {
        status: 'interrupted',
        terminalSource: 'operator-interruption',
        error: `Budget ${evaluation.decision}: ${evaluation.thresholdEvents
          .map((event) => event.message)
          .join(' ')}`,
      };
    });
  }

  private async recordExecutionTreeUsage(
    pending: PendingAgent,
    delta: Partial<AgentBudgetUsage>,
    source: string
  ): Promise<void> {
    if (!pending.admissionReservationId) return;
    await this.serializeBudgetEvaluation(pending, async () => {
      const usage = getAgentBudgetService().mergeUsage(pending.executionTreeUsage, delta);
      const digest = createHash('sha256')
        .update(`${source}:${JSON.stringify(usage)}`)
        .digest('hex')
        .slice(0, 32);
      await this.admission.recordBudgetUsage(pending.admissionReservationId as string, {
        schemaVersion: 'execution-tree-budget-event/v1',
        id: `usage_${digest}`,
        mode: 'snapshot',
        usage,
        source,
        occurredAt: pending.startedAt,
      });
      pending.executionTreeUsage = usage;
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

  private async captureDependencyCircuits(
    provider: string,
    model: string | undefined,
    workspaceId: string,
    selectedHost: string
  ): Promise<RunDependencyCircuitEvidence> {
    const [providerCircuit, agentHostCircuit] = await Promise.all([
      this.dependencyExecution.inspect(providerDependencyIdentity(provider, model, workspaceId)),
      this.dependencyExecution.inspect(agentHostDependencyIdentity(selectedHost, workspaceId)),
    ]);
    return {
      schemaVersion: RUN_DEPENDENCY_CIRCUIT_EVIDENCE_SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      provider: providerCircuit,
      agentHost: agentHostCircuit,
    };
  }

  private dependencyCircuitTelemetry(
    evidence: RunDependencyCircuitEvidence
  ): DependencyCircuitTelemetry {
    const states = [evidence.provider.state, evidence.agentHost.state];
    return {
      provider: evidence.provider.state,
      agentHost: evidence.agentHost.state,
      openCount: states.filter((state) => state === 'open').length,
      halfOpenCount: states.filter((state) => state === 'half-open').length,
    };
  }

  private dependencyCircuitCompletionEvidence(
    evidence: RunDependencyCircuitEvidence
  ): TaskCompletionEvidence[] {
    return [
      {
        id: 'dependency-circuit-provider',
        kind: 'other',
        source: 'harness',
        summary: `Provider dependency circuit was ${evidence.provider.state} at completion.`,
        reference: evidence.provider.dependency.id,
        requirementIds: [],
        verified: true,
      },
      {
        id: 'dependency-circuit-agent-host',
        kind: 'other',
        source: 'harness',
        summary: `Agent host dependency circuit was ${evidence.agentHost.state} at completion.`,
        reference: evidence.agentHost.dependency.id,
        requirementIds: [],
        verified: true,
      },
    ];
  }

  async probeProviderRuntime(
    agentConfig: AgentConfig,
    agent: AgentType = agentConfig.type,
    surface: ProviderRuntimeSurface = 'task'
  ): Promise<ProviderRuntimeManifest> {
    const provider = resolveExecutableAgentProvider(agentConfig, agent);
    const health = await this.assertAgentAvailable(agent, agentConfig);
    return this.dependencyExecution.execute(
      providerDependencyIdentity(provider, agentConfig.model),
      () => this.providerAdapters.resolve(provider, surface).probe({ agentConfig, health }),
      providerDependencyExecutionOptions
    );
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

  private createProviderAdapterRegistry(): AgentProviderAdapterRegistry {
    const host: AgentProviderAdapterHost = {
      probe: (provider, context, definition) =>
        this.providerRuntimeManifests.probe(
          buildProviderRuntimeProbeRequest(provider, context, definition)
        ),
      probeAcp: (context, definition) => this.probeAcpProviderRuntime(context, definition),
      assertTransport: (provider, transport, manifest) =>
        this.assertProviderAdapterTransport(provider, transport, manifest),
      getPending: (taskId) => pendingAgents.get(taskId),
      startCodexCli: ({
        task,
        agentConfig,
        transport,
        logPath,
        attemptId,
        startedAt,
        emitter,
        sandboxPolicy,
        runLaunchManifest,
      }) =>
        this.startCodexCli(
          task,
          agentConfig,
          transport.content,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
          runLaunchManifest
        ),
      startCodexSdk: (
        {
          task,
          agentConfig,
          transport,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
          runLaunchManifest,
        },
        abortController
      ) =>
        this.startCodexSdk(
          task,
          agentConfig,
          transport.content,
          logPath,
          attemptId,
          startedAt,
          emitter,
          abortController,
          sandboxPolicy,
          runLaunchManifest
        ),
      handleCodexSdkError: (context, abortController, error) =>
        this.handleCodexSdkAdapterError(context, abortController, error),
      startCodexAppServer: ({
        task,
        agentConfig,
        transport,
        logPath,
        attemptId,
        startedAt,
        emitter,
        sandboxPolicy,
        runLaunchManifest,
      }) =>
        this.startCodexAppServer(
          task,
          agentConfig,
          transport.content,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
          runLaunchManifest
        ),
      startAcpStdio: ({
        task,
        agentConfig,
        transport,
        logPath,
        attemptId,
        sandboxPolicy,
        runLaunchManifest,
        conversation,
      }) =>
        this.startAcpStdio(
          task,
          agentConfig,
          transport.content,
          logPath,
          attemptId,
          sandboxPolicy,
          runLaunchManifest,
          conversation
        ),
      startClaudeCode: ({
        task,
        agentConfig,
        transport,
        logPath,
        attemptId,
        startedAt,
        emitter,
        sandboxPolicy,
        runLaunchManifest,
      }) =>
        this.startClaudeCode(
          task,
          agentConfig,
          transport.content,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy,
          runLaunchManifest
        ),
      startHermesCli: ({
        task,
        agentConfig,
        transport,
        logPath,
        attemptId,
        startedAt,
        emitter,
        sandboxPolicy,
      }) =>
        this.startHermesCli(
          task,
          agentConfig,
          transport.content,
          logPath,
          attemptId,
          startedAt,
          emitter,
          sandboxPolicy
        ),
      startOpenClaw: (context) => this.startOpenClawAdapter(context),
      warn: (details, message) => log.warn(details, message),
    };
    return new AgentProviderAdapterRegistry(host);
  }

  private async handleCodexSdkAdapterError(
    context: AgentProviderStartContext,
    abortController: AbortController,
    error: unknown
  ): Promise<void> {
    const { task, attemptId, emitter, logPath, agentConfig } = context;
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
      log.error({ err: logError, taskId: task.id }, 'Failed to record Codex SDK error evidence');
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
  }

  private async startOpenClawAdapter(context: AgentProviderStartContext): Promise<void> {
    const { transport, task, attemptId, agentConfig } = context;
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
    await this.attemptLifecycle.patchActiveAttempt(task.id, attemptId, {
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
    const base = buildProviderRuntimeProbeRequest('acp-stdio', context, definition);
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

  private filesystemSandboxLaunch(
    pending: PendingAgent,
    command: string,
    args: string[],
    cwd: string
  ) {
    const plan = pending.filesystemSandboxPlan;
    const evidence = pending.runLaunchManifest.sandbox.filesystem;
    if (!plan || !evidence) {
      throw new ConflictError('Provider launch is missing compiled filesystem sandbox evidence.', {
        taskId: pending.taskId,
        attemptId: pending.attemptId,
      });
    }
    if (
      plan.evidence.policyHash !== evidence.policyHash ||
      plan.evidence.backend !== evidence.backend ||
      plan.evidence.capabilityVersion !== evidence.capabilityVersion
    ) {
      throw new ConflictError(
        'Filesystem sandbox launch plan changed after manifest compilation.',
        {
          taskId: pending.taskId,
          attemptId: pending.attemptId,
          manifestPolicyHash: evidence.policyHash,
          launchPolicyHash: plan.evidence.policyHash,
        }
      );
    }
    return this.filesystemSandbox.wrap(plan, command, args, cwd);
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
    const bridgeOnly = harnessToolCatalogDelivery(supportProfile.id) === 'veritas-bridge';
    if (bridgeOnly && runToolCatalog && !pending.runToolBridge) {
      throw new ConflictError('ACP profile requires the Veritas run tool bridge.');
    }
    const mcpServers =
      runToolCatalog && !bridgeOnly ? await this.toolControlPlane.acpConfig(runToolCatalog) : [];
    if (pending.runToolBridge) {
      mcpServers.push(this.runToolBridge.acpServer(pending.runToolBridge));
    }
    const toolEnvironmentKeys =
      runToolCatalog && !bridgeOnly
        ? await this.toolControlPlane.environmentKeys(runToolCatalog)
        : [];
    const approvalAbort = new AbortController();
    pending.abortController = approvalAbort;
    let activeSessionId: string | undefined;
    const summaryChunks: string[] = [];
    const launch = this.filesystemSandboxLaunch(
      pending,
      agentConfig.command,
      this.buildAcpProviderArgs(agentConfig, supportProfile.id),
      worktreePath
    );
    const control = await openAcpStdio({
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      environment: this.withRunEgressEnvironment(pending, {
        ...process.env,
        ...launch.environment,
      }),
      environmentKeys: [
        ...(sandboxPolicy?.effective.envPassthrough ?? []),
        ...toolEnvironmentKeys,
        ...supportProfile.launch.environmentAllowlist,
        ...supportProfile.launch.credentialAllowlist,
        ...Object.keys(launch.environment),
        ...Object.keys(pending.egressGateway?.environment ?? {}),
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

  private async resolveRunEgressApproval(
    task: Task,
    attemptId: string,
    provider: ExecutableAgentProvider,
    agentId: string,
    runLaunchManifest: RunLaunchManifest,
    request: RunEgressGatewayApprovalRequest
  ): Promise<RunEgressGatewayApprovalResult> {
    const phase = await this.bindPhaseApproval(task.id, attemptId, runLaunchManifest, [
      {
        dimension: 'network.egress',
        requestedScopes: [request.host],
      },
    ]);
    const providerRequestId = `egress:${digestRunLaunchValue({
      gatewayId: request.gatewayId,
      protocol: request.protocol,
      host: request.host,
      port: request.port,
      method: request.method,
      path: request.path,
      policyHash: request.decision.policyHash,
    }).slice('sha256:'.length, 'sha256:'.length + 32)}`;
    const approval = await this.approvalBroker.request({
      workspaceId: 'local',
      taskId: task.id,
      attemptId,
      provider,
      agentId,
      providerRequestId,
      requestKind: 'approval',
      actionClass: 'network',
      action: `Allow ${request.protocol} egress to ${request.host}:${request.port}`,
      details: `Blocked by ${request.decision.reason}; method ${request.method ?? 'not available'}.`,
      resourceScope: [request.host, `${request.protocol}:${request.port}`],
      workingDirectory: task.git?.worktreePath,
      riskClass: 'high',
      policyReason: request.decision.reason,
      evidenceRevision: runLaunchManifest.digest,
      mobileSafe: false,
      exactAction: {
        protocol: request.protocol,
        host: request.host,
        port: request.port,
        method: request.method,
        path: request.path,
        policyHash: request.decision.policyHash,
        blockedReason: request.decision.reason,
      },
      ...(phase ? { phase } : {}),
    });
    if (request.signal.aborted) {
      await this.approvalBroker.cancelAttempt(
        'local',
        task.id,
        attemptId,
        'Run egress gateway stopped.'
      );
      return { approvalId: approval.id, approved: false };
    }
    try {
      const resolved = await this.approvalBroker.awaitDecision(approval.id, {
        signal: request.signal,
      });
      return {
        approvalId: approval.id,
        approved: resolved.request.status === 'approved',
      };
    } catch (error) {
      if (request.signal.aborted) {
        await this.approvalBroker.cancelAttempt(
          'local',
          task.id,
          attemptId,
          'Run egress gateway stopped.'
        );
        return { approvalId: approval.id, approved: false };
      }
      throw error;
    }
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
    const phase = await this.bindPhaseApproval(
      task.id,
      attemptId,
      pending.runLaunchManifest,
      phaseRequirementsForAcpRequest(request)
    );
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
      ...(phase ? { phase } : {}),
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

  private async bindPhaseApproval(
    taskId: string,
    attemptId: string,
    manifest: RunLaunchManifest,
    requirements: Array<{
      dimension: PhaseAuthorityDimension;
      requestedScopes: string[];
    }>
  ) {
    if (manifest.phase?.evidence.identity.mode !== 'profile' || requirements.length === 0) {
      return undefined;
    }
    const authority = this.runPhaseAuthority;
    const snapshot = await authority.getActive('local', taskId, attemptId, 1);
    if (!snapshot) {
      throw new ConflictError('Phase-controlled approval lost its active authority snapshot.', {
        taskId,
        attemptId,
      });
    }
    return authority.binding(snapshot, requirements);
  }

  private async completionPhaseEvidence(
    taskId: string,
    attemptId: string,
    launchPhase?: RunLaunchPhaseAuthority
  ): Promise<{ phase: CompletionPhaseAuthorityEvidence } | Record<string, never>> {
    if (!launchPhase) return {};
    const snapshot = await this.runPhaseAuthority.get('local', taskId, attemptId, 100);
    if (!snapshot) return {};
    return {
      phase: {
        launchEvidenceDigest: snapshot.launch.evidence.digest,
        effectiveEvidence: snapshot.effectiveEvidence,
        transitionSequence: snapshot.transitionSequence,
        authorityExpansions: snapshot.history.filter((record) =>
          record.authorityDelta.entries.some((entry) => entry.addedScopes.length > 0)
        ),
      },
    };
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
    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Codex app-server launch was cancelled before process spawn.', {
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
    const mcpServers: Record<string, unknown> = runToolCatalog
      ? await this.toolControlPlane.providerConfig(runToolCatalog)
      : {};
    if (pending.runToolBridge) {
      mcpServers[RUN_TOOL_BRIDGE_SERVER_ID] = this.runToolBridge.codexServer(pending.runToolBridge);
    }
    const toolEnvironmentKeys = runToolCatalog
      ? await this.toolControlPlane.environmentKeys(runToolCatalog)
      : [];
    const command = agentConfig?.command || 'codex';
    const args = buildCodexAppServerArgs(agentConfig?.args);
    const launch = this.filesystemSandboxLaunch(pending, command, args, worktreePath);
    const launchEnvironment = this.runToolBridge.launchEnvironment(
      buildSafeCodexAppServerEnv(process.env, [
        ...(sandboxPolicy?.effective.envPassthrough ?? []),
        ...toolEnvironmentKeys,
      ]),
      pending.runToolBridge
    );
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: this.withRunEgressEnvironment(pending, {
        ...launchEnvironment,
        ...launch.environment,
      }),
      shell: false,
      detached: process.platform !== 'win32',
    });
    pending.process = child;
    await this.attachSpawnedProcess(pending, child);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let finalSummary = '';
    let terminalResult: CodexAppServerTerminalResult | undefined;
    let tokenUsage: CodexAppServerUsage | undefined;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let conversationGeneration = 0;
    let rewindState: CodexAppServerRewindState | undefined;
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
        if (
          rewindState &&
          (rewindState.phase === 'quiescing' || rewindState.phase === 'quiesced')
        ) {
          throw new ConflictError('Codex app-server is quiesced for an approved workspace rewind.');
        }
        if (!threadId || terminalResult) {
          throw new ConflictError('Codex app-server has no controllable conversation.');
        }
        if (!turnId) {
          turnId = await rpcClient.startTurn({
            threadId,
            prompt: message,
            cwd: worktreePath,
            model: agentConfig?.model,
          });
          conversationGeneration += 1;
          return turnId;
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
      runtimeIdentity: () => {
        if (!threadId) {
          throw new ConflictError('Codex app-server has no durable runtime identity.');
        }
        return {
          threadId,
          ...(turnId ? { turnId } : {}),
          generation: conversationGeneration,
        };
      },
      quiesceForRewind: async () => {
        if (!threadId || !turnId || terminalResult) {
          throw new ConflictError(
            'Codex app-server rewind requires a live, non-terminal provider turn.'
          );
        }
        if (
          rewindState &&
          (rewindState.phase === 'quiescing' || rewindState.phase === 'quiesced')
        ) {
          throw new ConflictError('Codex app-server already has a workspace rewind in progress.');
        }
        const token = `rewind_${nanoid()}`;
        const sourceThreadId = threadId;
        const sourceTurnId = turnId;
        let timeout: NodeJS.Timeout | undefined;
        const quiesced = new Promise<void>((resolve, reject) => {
          rewindState = {
            token,
            phase: 'quiescing',
            sourceThreadId,
            sourceTurnId,
            resolveQuiesced: resolve,
            rejectQuiesced: reject,
          };
          timeout = setTimeout(() => {
            if (rewindState?.token !== token || rewindState.phase !== 'quiescing') return;
            rewindState = undefined;
            reject(
              new ConflictError(
                'Codex app-server did not confirm turn interruption for workspace rewind.'
              )
            );
          }, 10_000);
        });
        try {
          await rpcClient.interrupt(threadId, turnId);
          await quiesced;
          return token;
        } catch (error) {
          if (rewindState?.token === token && rewindState.phase === 'quiescing') {
            rewindState = undefined;
          }
          throw error;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      },
      forkForRewind: async (token, cursor, rollback) => {
        if (!rewindState || rewindState.token !== token) {
          throw new ConflictError('Codex app-server rewind token is stale or unknown.');
        }
        if (
          (!rollback && rewindState.phase !== 'quiesced') ||
          (rollback && rewindState.phase !== 'quiesced' && rewindState.phase !== 'committed')
        ) {
          throw new ConflictError('Codex app-server rewind runtime is not in a recoverable state.');
        }
        if (
          !cursor.turnId ||
          cursor.itemId ||
          cursor.conversationId !== rewindState.sourceThreadId ||
          (!rollback && cursor.turnId === rewindState.sourceTurnId)
        ) {
          throw new ConflictError(
            'Codex app-server can rewind only to an earlier exact turn in the active thread.'
          );
        }
        const recoveredThreadId = await rpcClient.forkThread({
          cwd: worktreePath,
          model: agentConfig?.model,
          sandboxMode: sandboxPolicy?.effective.sandboxMode ?? 'workspace-write',
          ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
          threadId: cursor.conversationId,
          ...(cursor.turnId ? { lastTurnId: cursor.turnId } : {}),
        });
        threadId = recoveredThreadId;
        turnId = undefined;
        conversationGeneration += 1;
        rewindState.phase = rollback ? 'rolled-back' : 'committed';
        return recoveredThreadId;
      },
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
      const rewindClassification = classifyCodexAppServerNotification(inbound.record);
      if (rewindState?.phase === 'quiescing' && rewindClassification.terminal) {
        turnId = undefined;
        rewindState.phase = 'quiesced';
        rewindState.resolveQuiesced?.();
        rewindState.resolveQuiesced = undefined;
        rewindState.rejectQuiesced = undefined;
        const interrupted = await this.appendRunEvent(
          task.id,
          attemptId,
          'conversation.interrupted',
          {
            reason: 'workspace-rewind-quiescence',
            conversationId: threadId,
            turnId: rewindClassification.turnId,
          },
          {
            provider: 'codex-app-server',
            adapter: 'codex-app-server',
            agent: agentConfig?.type || 'codex-app-server',
            model: agentConfig?.model,
            dedupeKey: `workspace-rewind-quiesced:${rewindClassification.turnId ?? 'unknown'}`,
          }
        );
        this.emitJournalOutput(interrupted);
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
      this.providerAdapters
        .resolve('codex-app-server')
        .runEventMapper.mapEvent(
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
      this.providerAdapters
        .resolve('codex-app-server')
        .runEventMapper.mapEvent(method, recordValueForProvider(record, 'params'), summary)
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
    let claudeMcp = runToolCatalog
      ? await this.toolControlPlane.claudeConfig(runToolCatalog)
      : undefined;
    if (pending.runToolBridge) {
      const bridgeMcp = this.runToolBridge.claudeServer(pending.runToolBridge);
      const nativeServers =
        claudeMcp?.config.mcpServers &&
        typeof claudeMcp.config.mcpServers === 'object' &&
        !Array.isArray(claudeMcp.config.mcpServers)
          ? (claudeMcp.config.mcpServers as Record<string, unknown>)
          : {};
      const bridgeServers = bridgeMcp.config.mcpServers as Record<string, unknown>;
      claudeMcp = {
        config: { mcpServers: { ...nativeServers, ...bridgeServers } },
        allowedToolNames: [
          ...(claudeMcp?.allowedToolNames ?? []),
          ...bridgeMcp.allowedToolNames,
        ].sort(),
      };
    }
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

    const launch = this.filesystemSandboxLaunch(pending, command, args, worktreePath);
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: this.withRunEgressEnvironment(pending, {
        ...buildSafeClaudeCodeEnv(process.env, [
          ...(sandboxPolicy?.effective.envPassthrough ?? []),
          ...toolEnvironmentKeys,
        ]),
        ...launch.environment,
      }),
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
      this.providerAdapters
        .resolve('claude-code')
        .runEventMapper.mapEvent(classified.providerType, record, classified.summary)
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

    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Hermes launch was cancelled before process spawn.', {
        taskId: task.id,
        attemptId,
      });
    }
    const launch = this.filesystemSandboxLaunch(pending, command, args, worktreePath);
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: this.withRunEgressEnvironment(pending, {
        ...buildSafeHermesEnv(process.env, sandboxPolicy?.effective.envPassthrough),
        ...launch.environment,
      }),
      shell: false,
      detached: process.platform !== 'win32',
    });
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
    sandboxPolicy: SandboxPolicyDryRunResult | undefined,
    runLaunchManifest: RunLaunchManifest
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
    if (pending.runLaunchManifest.digest !== runLaunchManifest.digest) {
      throw new ConflictError('Codex CLI bridge launch evidence changed before dispatch.');
    }
    const command = agentConfig?.command || 'codex';
    const args = this.buildCodexArgs(
      agentConfig,
      prompt,
      logPath,
      attemptId,
      sandboxPolicy,
      pending.conversation,
      pending.runToolBridge ? this.runToolBridge.codexCliOverride(pending.runToolBridge) : undefined
    );
    const launch = this.filesystemSandboxLaunch(pending, command, args, worktreePath);
    const launchEnvironment = this.runToolBridge.launchEnvironment(
      buildSafeCodexEnv(process.env, sandboxPolicy?.effective.envPassthrough),
      pending.runToolBridge
    );
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: this.withRunEgressEnvironment(pending, {
        ...launchEnvironment,
        ...launch.environment,
      }),
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
    conversation?: ConversationLifecycleRecord,
    runToolBridgeOverride?: string
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
    if (runToolBridgeOverride) args.push('-c', runToolBridgeOverride);
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
    sandboxPolicy: SandboxPolicyDryRunResult | undefined,
    runLaunchManifest: RunLaunchManifest
  ): Promise<void> {
    const worktreePath = this.expandPath(task.git?.worktreePath || '');
    if (!worktreePath) {
      throw new Error('Task worktree path is required for Codex SDK');
    }

    const pending = pendingAgents.get(task.id);
    if (!pending || pending.attemptId !== attemptId) {
      throw new ConflictError('Codex SDK launch was cancelled before thread creation.', {
        taskId: task.id,
        attemptId,
      });
    }
    if (pending.runLaunchManifest.digest !== runLaunchManifest.digest) {
      throw new ConflictError('Codex SDK bridge launch evidence changed before dispatch.');
    }
    const sdkExecutable = this.runLaunchCompiler.resolveCodexSdkExecutable(agentConfig);
    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({
      codexPathOverride: sdkExecutable.codexPathOverride,
      env: this.withRunEgressEnvironment(pending, {
        ...this.runToolBridge.launchEnvironment(
          buildSafeCodexEnv(process.env, sandboxPolicy?.effective.envPassthrough),
          pending.runToolBridge
        ),
        ...pending.filesystemSandboxPlan?.environment,
      }),
      ...(pending.runToolBridge
        ? {
            config: this.runToolBridge.codexConfig(pending.runToolBridge) as NonNullable<
              ConstructorParameters<typeof Codex>[0]
            >['config'],
          }
        : {}),
    });
    const threadSettings = {
      workingDirectory: worktreePath,
      ...this.runLaunchCompiler.buildCodexSdkThreadSettings(sandboxPolicy),
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
    const interpreted = interpretCodexEvent(record, type);
    const { summary, usage } = interpreted;
    if (usage && task) {
      assertProviderRuntimeControl(
        pendingAgents.get(task.id)?.providerRuntimeManifest,
        'token-usage'
      );
    }
    if (task && attemptId) {
      await this.recordCodexEvent(task, attemptId, agentConfig, type, record, interpreted);
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
    const compatibilityDigest = getHarnessCompatibilityRecordDigest(status.profileId);
    return {
      profileId: status.profileId,
      ...(compatibilityDigest ? { compatibilityDigest } : {}),
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

  private async capturePendingWorkspaceCheckpoint(
    taskId: string,
    pending: PendingAgent,
    boundary: WorkspaceCheckpointBoundary,
    operationId: string,
    causalEventId?: string
  ): Promise<WorkspaceCheckpoint | null> {
    if (pendingAgents.get(taskId) !== pending) {
      throw new ConflictError('Workspace checkpoint no longer matches the active run.', {
        taskId,
        attemptId: pending.attemptId,
      });
    }
    const result = await this.workspaceCheckpoints.captureBoundary({
      taskEnvelope: pending.taskEnvelope,
      taskId,
      attemptId: pending.attemptId,
      operationId,
      boundary,
      turnId: pending.conversation.currentTurnId,
      conversationCursor: workspaceConversationCursor(pending.conversation),
    });
    if (result.status === 'skipped') return null;

    const { checkpoint } = result;
    const event = await this.appendRunEvent(
      taskId,
      pending.attemptId,
      'workspace.checkpoint.created',
      {
        checkpointId: checkpoint.id,
        boundary: checkpoint.boundary,
        checkpointDigest: checkpoint.digest,
        worktreeManifestId: checkpoint.worktreeManifestId,
        fileCount: checkpoint.fileCount,
        contentBytes: checkpoint.contentBytes,
        excludedCount: checkpoint.excludedCount,
        ...(checkpoint.conversationCursor
          ? {
              conversationCursorDigest: digestRunLaunchValue(checkpoint.conversationCursor),
            }
          : {}),
      },
      {
        provider: 'system',
        adapter: 'workspace-checkpoint',
        agent: pending.agent,
        model: pending.model,
        causalEventId,
        dedupeKey: `workspace.checkpoint.created:${checkpoint.id}`,
      }
    );
    this.emitJournalOutput(event);
    this.recordTraceStep(pending.attemptId, 'execute', {
      eventType: 'workspace.checkpoint.created',
      checkpointId: checkpoint.id,
      boundary: checkpoint.boundary,
      checkpointDigest: checkpoint.digest,
    });
    return checkpoint;
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
      workspaceId: pending?.taskEnvelope?.workspace.workspaceId ?? 'local',
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
    const outputArtifact =
      event.payload.outputArtifact &&
      typeof event.payload.outputArtifact === 'object' &&
      !Array.isArray(event.payload.outputArtifact)
        ? event.payload.outputArtifact
        : undefined;
    const content =
      typeof event.payload.content === 'string'
        ? event.payload.content
        : typeof event.payload.summary === 'string'
          ? event.payload.summary
          : outputArtifact && typeof outputArtifact.content === 'string'
            ? outputArtifact.content
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
    const mapper = this.providerAdapters.resolve(provider).runEventMapper;
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
    interpreted: CodexEventInterpretation
  ): Promise<void> {
    const agent =
      agentConfig?.type || (agentConfig?.provider === 'codex-sdk' ? 'codex-sdk' : 'codex');
    const { summary, files, usage, command, tool, error } = interpreted;
    const sanitizedSummary = summary ? this.redactTraceText(summary) : undefined;
    const stepType = interpreted.traceStepType;
    const stream = interpreted.stream;
    const provider = agentConfig?.provider === 'codex-sdk' ? 'codex-sdk' : 'codex-cli';
    const journalEvent = await this.appendMappedProviderEvent(
      task,
      attemptId,
      agentConfig,
      provider,
      this.providerAdapters.resolve(provider).runEventMapper.mapEvent(type, event, sanitizedSummary)
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
      retryAttempt: interpreted.retryAttempt,
      retryDelayMs: interpreted.retryDelayMs,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      model: usage?.model || agentConfig?.model,
      finalResult: stepType === 'complete' ? sanitizedSummary : undefined,
    });

    if (interpreted.logActivity) {
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

  private redactTraceText(value: string): string {
    return redactProviderTraceText(value);
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
    await this.attemptLifecycle.patchActiveAttempt(taskId, attemptId, {
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
    await this.attemptLifecycle.patchActiveAttempt(taskId, attemptId, { conversation });
    return conversation;
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
      runRetry: pending.runRetry,
      activePhaseEvidence: pending.activePhaseEvidence,
      conversation: pending.conversation,
      controls: providerRuntimeControls(pending.providerRuntimeManifest),
      admissionReservationId: pending.admissionReservationId,
      executionTree: pending.executionTree,
      terminals: this.runTerminals.list(
        pending.taskEnvelope.workspace.workspaceId,
        taskId,
        pending.attemptId
      ),
    };
  }

  async executeRunTerminal(
    taskId: string,
    attemptId: string,
    inputRequest: RunTerminalExecuteRequest
  ): Promise<RunTerminalExecutionResult> {
    const request = RunTerminalExecuteRequestSchema.parse(inputRequest);
    const pending = pendingAgents.get(taskId);
    if (!pending || pending.attemptId !== attemptId) {
      throw new NotFoundError('Active run terminal scope not found.');
    }
    await this.assertPendingManifestSnapshotForAttempt(taskId, attemptId);
    const worktreeRoot = this.expandPath(pending.taskEnvelope.workspace.worktreePath);
    const executeScope = pending.taskEnvelope.allowedSideEffects.find(
      (sideEffect) =>
        sideEffect.kind === 'process-execute' &&
        path.resolve(this.expandPath(sideEffect.scope)) === path.resolve(worktreeRoot)
    );
    if (!executeScope) {
      throw new ForbiddenError('The immutable task envelope does not allow process execution.', {
        taskId,
        attemptId,
      });
    }
    const filesystemPlan = pending.filesystemSandboxPlan;
    if (!filesystemPlan || !pending.runLaunchManifest.sandbox.filesystem) {
      throw new ConflictError('Run terminal execution has no compiled filesystem posture.', {
        taskId,
        attemptId,
      });
    }
    if (pending.runLaunchManifest.sandbox.enforcement === 'required' && !filesystemPlan.wrapper) {
      throw new ConflictError(
        'Run terminal execution cannot inherit the provider-native filesystem sandbox.',
        {
          taskId,
          attemptId,
          filesystemState: filesystemPlan.evidence.state,
          remediation:
            'Use a run with a host-wrappable filesystem posture or keep terminal execution disabled.',
        }
      );
    }
    for (const value of [request.command, ...request.args]) {
      if (redactString(value) !== value) {
        throw new ValidationError(
          'Credential-shaped values are not allowed in terminal command arguments.'
        );
      }
    }
    await this.runTerminals.reconcileAttempt(
      pending.taskEnvelope.workspace.workspaceId,
      taskId,
      attemptId
    );

    const commandClass = classifyPhaseCommand([request.command, ...request.args]);
    const credentialScopes = request.environmentKeys
      .map((key) => `env:${key}`)
      .filter((reference) =>
        pending.runLaunchManifest.runtime.credentialReferences.includes(reference)
      );
    const phaseRequirements: Array<{
      dimension: PhaseAuthorityDimension;
      requestedScopes: string[];
    }> = [
      { dimension: 'filesystem.read', requestedScopes: ['<workspace>'] },
      { dimension: 'command.execute', requestedScopes: [commandClass] },
      ...(commandClass === 'inspect'
        ? []
        : [
            {
              dimension: 'filesystem.write' as const,
              requestedScopes: ['<workspace>'],
            },
          ]),
      ...(credentialScopes.length > 0
        ? [
            {
              dimension: 'credential.access' as const,
              requestedScopes: credentialScopes,
            },
          ]
        : []),
      ...(commandClass === 'publish'
        ? [
            {
              dimension: 'external.action' as const,
              requestedScopes: ['mutate'],
            },
          ]
        : []),
    ];
    const phase = await this.bindPhaseApproval(
      taskId,
      attemptId,
      pending.runLaunchManifest,
      phaseRequirements
    );
    if (!pending.executionTree) {
      throw new ConflictError('Run terminal execution has no durable execution-tree identity.', {
        taskId,
        attemptId,
        code: 'run-file-execution-tree-missing',
      });
    }
    const fileExecutionInput: RunFileExecutionEvaluationInput = {
      workspaceId: pending.taskEnvelope.workspace.workspaceId,
      taskId,
      rootObjectiveId: pending.executionTree.rootObjectiveId,
      executionNodeId: pending.executionTree.nodeId,
      runId: attemptId,
      attemptId,
      workflowStepId:
        pending.executionTree.edge === 'workflow-step' ? pending.executionTree.nodeId : null,
      launchManifestDigest: pending.runLaunchManifest.digest,
      phaseEvidenceDigest: phase?.evidenceDigest ?? null,
      worktreeRoot,
      baseline: pending.taskEnvelope.workspace.baseline,
      request,
      ...(pending.taskEnvelope.fileExecutionPolicy
        ? { policy: pending.taskEnvelope.fileExecutionPolicy }
        : {}),
    };
    const fileExecution = await this.runFileExecutionPolicy.evaluate(fileExecutionInput);
    if (fileExecution.decision === 'deny') {
      throw new ForbiddenError(
        'Project policy denies execution of a referenced run-produced file.',
        {
          taskId,
          attemptId,
          evidenceDigest: fileExecution.digest,
          reasonCode: fileExecution.reasonCode,
        }
      );
    }
    const humanFileApproval = fileExecution.decision === 'human-approval';
    const requestedApproval = await this.approvalBroker.request({
      workspaceId: pending.taskEnvelope.workspace.workspaceId,
      taskId,
      attemptId,
      provider: pending.provider,
      agentId: pending.agent,
      providerRequestId: request.requestId,
      requestKind: 'approval',
      actionClass: 'shell',
      action: `Execute ${request.command}`,
      details: this.redactTraceText(
        JSON.stringify({
          args: request.args,
          fileExecution: fileExecution.references.map((reference) => ({
            kind: reference.kind,
            path: reference.relativePath,
            source: reference.source,
            digest: reference.contentSha256,
            decision: reference.decision,
          })),
        })
      ).slice(0, 8_000),
      resourceScope: [
        `command:${commandClass}`,
        `cwd:${request.cwd ?? '.'}`,
        ...request.environmentKeys.map((key) => `env:${key}`),
        ...fileExecution.references.map(
          (reference) => `file:${reference.source}:${reference.contentSha256}`
        ),
      ],
      workingDirectory: request.cwd ?? '.',
      riskClass: humanFileApproval ? 'critical' : 'high',
      policyReason: humanFileApproval
        ? 'External, unknown, or project-governed run-produced bytes require a fresh human decision before execution.'
        : 'A provider-neutral terminal child requires exact operator approval before launch.',
      evidenceRevision: pending.runLaunchManifest.digest,
      mobileSafe: false,
      exactAction: { request, fileExecution },
      fileExecution,
      ...(humanFileApproval ? { decisionAuthority: 'human-only' as const } : {}),
      ...(phase ? { phase } : {}),
    });
    const approval = await this.approvalBroker.get(
      requestedApproval.id,
      pending.taskEnvelope.workspace.workspaceId
    );
    if (approval.status === 'pending') {
      return { status: 'approval-required', approval };
    }
    if (approval.status !== 'approved') {
      throw new ForbiddenError('Run terminal execution was not approved.', {
        approvalId: approval.id,
        status: approval.status,
      });
    }
    const approvedEnvironment = Object.fromEntries(
      pending.runLaunchManifest.runtime.environmentKeys.flatMap((key) => {
        const value = process.env[key];
        return typeof value === 'string' ? [[key, value]] : [];
      })
    );
    if (pendingAgents.get(taskId) !== pending || finalizingAgents.has(pending)) {
      throw new ConflictError('Run terminal execution raced with run finalization.', {
        taskId,
        attemptId,
      });
    }
    const launch = this.runTerminals.execute(
      {
        workspaceId: pending.taskEnvelope.workspace.workspaceId,
        taskId,
        attemptId,
        launchManifestDigest: pending.runLaunchManifest.digest,
        worktreeRoot,
        environment: approvedEnvironment,
        allowedCommands: [request.command],
        fileExecutionEvidenceDigest: fileExecution.digest,
        beforeSpawn: async () => {
          await this.assertPendingManifestSnapshotForAttempt(taskId, attemptId);
          if (pendingAgents.get(taskId) !== pending || finalizingAgents.has(pending)) {
            throw new ConflictError('Run terminal execution raced with run finalization.', {
              taskId,
              attemptId,
            });
          }
          const currentPhase = await this.bindPhaseApproval(
            taskId,
            attemptId,
            pending.runLaunchManifest,
            phaseRequirements
          );
          if (JSON.stringify(currentPhase) !== JSON.stringify(phase)) {
            throw new ConflictError('Run terminal phase evidence changed after approval.', {
              taskId,
              attemptId,
              expectedPhaseEvidenceDigest: phase?.evidenceDigest,
              currentPhaseEvidenceDigest: currentPhase?.evidenceDigest,
            });
          }
          await this.runFileExecutionPolicy.revalidate(fileExecutionInput, fileExecution);
        },
        wrap: (command, args, cwd) => {
          const launch = this.filesystemSandboxLaunch(pending, command, args, cwd);
          return {
            ...launch,
            environment: this.withRunEgressEnvironment(pending, launch.environment),
          };
        },
      },
      request
    );
    const launches = pendingRunTerminalLaunches.get(pending) ?? new Set();
    launches.add(launch);
    pendingRunTerminalLaunches.set(pending, launches);
    void launch.then(
      () => {
        launches.delete(launch);
        if (launches.size === 0) pendingRunTerminalLaunches.delete(pending);
      },
      () => {
        launches.delete(launch);
        if (launches.size === 0) pendingRunTerminalLaunches.delete(pending);
      }
    );
    const handle = await launch;
    return { status: 'started', approval, handle };
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
    const persistedPhase = persistedAttempt.runLaunchManifest.phase?.evidence;
    if (!persistedPhase) {
      pending.activePhaseEvidence = undefined;
      return;
    }
    if (!verifyPhaseCapabilityEvidenceDigest(persistedPhase)) {
      throw new ConflictError(
        'Phase authority is stale or invalid: initial launch evidence digest does not match',
        {
          action,
          phaseEvidenceDigest: persistedPhase.digest,
          remediation:
            'Terminate the detached provider, reconcile persisted phase evidence, and launch again.',
        }
      );
    }
    const currentPhase = await this.getCurrentPhase(
      pending.taskEnvelope.workspace.workspaceId,
      taskId,
      pending.attemptId
    );
    if (currentPhase && currentPhase.manifestDigest !== persistedAttempt.runLaunchManifest.digest) {
      throw new ConflictError(
        'Phase authority is stale or invalid: transition evidence belongs to another launch manifest',
        {
          action,
          phaseTransitionManifestDigest: currentPhase.manifestDigest,
          runLaunchManifestDigest: persistedAttempt.runLaunchManifest.digest,
          remediation:
            'Terminate the detached provider, reconcile the phase transition journal, and launch again.',
        }
      );
    }
    const activePhase = currentPhase?.effectiveEvidence ?? persistedPhase;
    if (!verifyPhaseCapabilityEvidenceDigest(activePhase) || activePhase.status === 'blocked') {
      throw new ConflictError(
        'Phase authority is stale or invalid: active evidence cannot authorize run control',
        {
          action,
          phaseEvidenceDigest: activePhase.digest,
          phaseStatus: activePhase.status,
          remediation:
            'Terminate the detached provider, reconcile active phase evidence, and launch again.',
        }
      );
    }
    pending.activePhaseEvidence = activePhase;
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

  private workspaceTrustConstraints(
    sandboxPolicy: SandboxPolicyDryRunResult,
    filesystemSandboxPlan: FilesystemSandboxLaunchPlan,
    profileLaunch: AgentProfileResolvedLaunch | undefined,
    projectExecutableConfigurationBlocked: boolean
  ) {
    const allowedTools = profileLaunch?.profile.tools?.allowed ?? [];
    const requiredPermissions = profileLaunch?.profile.permissions?.required ?? [];
    const externalMutationAllowed = [...allowedTools, ...requiredPermissions].some((value) =>
      /(?:deploy|publish|release|github|webhook|external|mutation|write-api)/i.test(value)
    );
    return {
      sandboxMode: sandboxPolicy.effective.sandboxMode,
      networkAccessEnabled: sandboxPolicy.effective.networkAccessEnabled,
      taskCredentialReferences: [...sandboxPolicy.effective.credentialRefs],
      filesystemEnforcement: filesystemSandboxPlan.evidence.state,
      selectedToolServerCount: profileLaunch?.profile.tools?.mcpServers?.length ?? 0,
      externalMutationAllowed,
      projectExecutableConfigurationBlocked,
    };
  }

  private workspaceTrustSandboxPolicy(
    policy: SandboxPolicyDryRunResult,
    scan: WorkspaceExecutionTrustScanResult
  ): {
    policy: SandboxPolicyDryRunResult;
    projectExecutableConfigurationBlocked: boolean;
  } {
    const executableEntries = scan.inventory.entries.filter(
      (entry) => entry.posture === 'executable'
    );
    if (executableEntries.length === 0) {
      return { policy, projectExecutableConfigurationBlocked: true };
    }
    const decision = scan.currentDecision;
    const decisionIsCurrent =
      decision && decision.mode !== 'revoked' && decision.inventoryDigest === scan.inventory.digest;
    const restricted =
      decisionIsCurrent &&
      (decision.mode === 'restricted' ||
        (decision.mode === 'trusted' &&
          scan.inventory.projectPolicy.maximumTrust === 'restricted'));
    if (!restricted || executableEntries.some((entry) => entry.relativePath.startsWith('git:'))) {
      return { policy, projectExecutableConfigurationBlocked: false };
    }
    const deniedPaths = [
      ...new Set([
        ...policy.preset.filesystem.deniedPaths,
        ...executableEntries.map((entry) => entry.relativePath),
      ]),
    ].sort();
    return {
      policy: {
        ...policy,
        preset: {
          ...policy.preset,
          filesystem: {
            ...policy.preset.filesystem,
            deniedPaths,
          },
        },
      },
      projectExecutableConfigurationBlocked: true,
    };
  }

  private withRunEgressEnvironment(
    pending: PendingAgent,
    environment: NodeJS.ProcessEnv
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries({
        ...environment,
        ...pending.egressGateway?.environment,
      }).filter(
        (entry): entry is [string, string] =>
          entry[0] !== RUN_EGRESS_UPSTREAM_PROXY_ENV_KEY && typeof entry[1] === 'string'
      )
    );
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

  private buildExecutionTreeIdentity(input: {
    taskId: string;
    rootTaskId?: string;
    workspaceId: string;
    attemptId: string;
    parentAttempt?: TaskAttempt;
    provider: ExecutableAgentProvider;
    conversationIntent: ConversationLifecycleRecord['intent'];
    recoveryAction?: RunRecoveryRecord['action'];
    rootIdempotencyKey?: string;
  }): ExecutionTreeIdentity {
    const parent = input.parentAttempt?.executionTree;
    const parentNodeId = parent?.nodeId ?? input.parentAttempt?.id;
    const parentTaskId = input.parentAttempt?.runLaunchManifest?.taskId;
    const isChildAgent = Boolean(parentTaskId && parentTaskId !== input.taskId);
    const rootIdempotencyKey = input.rootIdempotencyKey?.trim();
    const nodeId =
      !parentNodeId && rootIdempotencyKey
        ? `node_${createHash('sha256')
            .update(`idempotency:${rootIdempotencyKey}`)
            .digest('hex')
            .slice(0, 32)}`
        : input.attemptId;
    let edge: ExecutionTreeEdgeKind = 'root';
    if (parentNodeId) {
      edge =
        input.recoveryAction === 'fallback'
          ? 'fallback'
          : input.recoveryAction
            ? 'retry'
            : isChildAgent
              ? 'child-agent'
              : input.parentAttempt?.provider !== input.provider
                ? 'provider-handoff'
                : input.conversationIntent === 'resume'
                  ? 'resume'
                  : input.conversationIntent === 'follow-up'
                    ? 'follow-up'
                    : input.conversationIntent === 'fork'
                      ? 'fork'
                      : 'follow-up';
    }
    const objectiveSeed = `${input.workspaceId}:${input.rootTaskId ?? input.taskId}:${
      parentNodeId ?? nodeId
    }`;
    return {
      schemaVersion: 'execution-tree-identity/v1',
      rootObjectiveId:
        parent?.rootObjectiveId ??
        `objective_${createHash('sha256').update(objectiveSeed).digest('hex').slice(0, 32)}`,
      nodeId,
      ...(parentNodeId ? { parentNodeId } : {}),
      edge,
      depth: parent ? parent.depth + 1 : parentNodeId ? 1 : 0,
    };
  }

  private executionTreeBudgetPolicies(input: {
    executionTree: ExecutionTreeIdentity;
    workspaceId: string;
    agent: AgentType;
    attemptId: string;
    budgetPolicy?: AgentBudgetPolicy;
    budgetSources: {
      workspaceBudget?: AgentBudgetPolicy;
      agentBudget?: AgentBudgetPolicy;
      profileBudget?: AgentBudgetPolicy;
      runBudget?: AgentBudgetPolicy;
    };
    isRoot: boolean;
  }): ExecutionTreeBudgetPolicy[] {
    return [
      executionTreePolicy(
        input.budgetSources.workspaceBudget,
        'workspace',
        input.workspaceId,
        'Workspace budget'
      ),
      executionTreePolicy(
        input.budgetSources.agentBudget,
        'agent',
        input.agent,
        `Agent ${input.agent} budget`
      ),
      executionTreePolicy(
        input.budgetSources.profileBudget,
        'agent',
        input.agent,
        `Agent profile ${input.agent} budget`,
        `profile:${input.agent}`
      ),
      executionTreePolicy(
        input.budgetSources.runBudget,
        'run',
        input.executionTree.rootObjectiveId,
        'Run budget',
        'effective-run'
      ),
      input.isRoot
        ? executionTreePolicy(
            input.budgetPolicy,
            'root-objective',
            input.executionTree.rootObjectiveId,
            'Root objective budget'
          )
        : undefined,
    ].filter((policy): policy is ExecutionTreeBudgetPolicy => Boolean(policy));
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

  private async resolveParentPhaseSnapshot(
    parent:
      | (TaskAttempt & {
          runLaunchManifest: RunLaunchManifest;
        })
      | undefined
  ): Promise<PhaseLaunchParentSnapshot | undefined> {
    if (!parent) return undefined;
    const manifest = parent.runLaunchManifest;
    const workspaceId = parent.taskEnvelope?.workspace.workspaceId;
    const current = workspaceId
      ? await this.getCurrentPhase(workspaceId, manifest.taskId, parent.id)
      : null;
    if (current && current.manifestDigest !== manifest.digest) {
      throw new ConflictError('Parent phase transition evidence references a different launch.', {
        parentAttemptId: parent.id,
        parentManifestDigest: manifest.digest,
        transitionManifestDigest: current.manifestDigest,
      });
    }
    return {
      attemptId: parent.id,
      manifestDigest: manifest.digest,
      ...(current?.effectiveEvidence
        ? { evidence: current.effectiveEvidence }
        : manifest.phase?.evidence
          ? { evidence: manifest.phase.evidence }
          : {}),
    };
  }

  private getCurrentPhase(workspaceId: string, taskId: string, attemptId: string) {
    return (this.phaseTransitions ?? getPhaseTransitionService()).getCurrent(
      workspaceId,
      taskId,
      attemptId
    );
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

function phaseRequirementsForAcpRequest(
  request: AcpRequestPermissionRequest
): Array<{ dimension: PhaseAuthorityDimension; requestedScopes: string[] }> {
  const kind = request.toolCall.kind?.toLowerCase();
  if (kind === 'read' || kind === 'search') {
    return [{ dimension: 'filesystem.read', requestedScopes: ['<workspace>'] }];
  }
  if (kind === 'edit' || kind === 'delete' || kind === 'move') {
    return [{ dimension: 'filesystem.write', requestedScopes: ['<workspace>'] }];
  }
  if (kind === 'execute') {
    const commandClass = classifyPhaseCommand(request.toolCall.rawInput);
    return [
      { dimension: 'command.execute', requestedScopes: [commandClass] },
      ...(commandClass === 'publish'
        ? [
            {
              dimension: 'external.action' as const,
              requestedScopes: ['mutate'],
            },
          ]
        : []),
    ];
  }
  if (kind === 'fetch') {
    return [
      { dimension: 'network.egress', requestedScopes: ['*'] },
      { dimension: 'external.action', requestedScopes: ['read'] },
    ];
  }
  if (kind === 'think') return [];
  return [{ dimension: 'external.action', requestedScopes: ['mutate'] }];
}

function classifyPhaseCommand(value: unknown): string {
  const command = commandText(value).toLowerCase();
  if (!command) return 'unclassified';
  if (
    /\b(?:git\s+push|npm\s+publish|pnpm\s+publish|gh\s+(?:issue|pr|release|api)\s+(?:create|edit|close|merge|comment|delete)|curl\b[^|\\n]*(?:-[^-\\s]*x|--request)\s+(?:post|put|patch|delete))\b/.test(
      command
    )
  ) {
    return 'publish';
  }
  if (
    /\b(?:apply_patch|git\s+(?:add|commit|reset|checkout|switch|rebase|merge|cherry-pick)|rm|mv|cp|mkdir|touch|install|unlink)\b/.test(
      command
    )
  ) {
    return 'mutate';
  }
  if (/\b(?:prettier|eslint)\b.*(?:--write|--fix)\b/.test(command)) return 'format';
  if (
    /\b(?:vitest|jest|playwright|pytest|cargo\s+test|go\s+test|pnpm\s+(?:run\s+)?test)\b/.test(
      command
    )
  ) {
    return 'test';
  }
  if (
    /\b(?:tsc|vite\s+build|cargo\s+build|go\s+build|pnpm\s+(?:run\s+)?(?:build|typecheck|lint))\b/.test(
      command
    )
  ) {
    return 'build';
  }
  if (
    /^(?:\s*(?:pwd|ls|cat|head|tail|sed|rg|grep|find|stat|wc|which|command\s+-v|git\s+(?:status|diff|log|show|rev-parse)|gh\s+(?:issue|pr|release|run)\s+(?:view|list|status))\b)/.test(
      command
    )
  ) {
    return 'inspect';
  }
  return 'unclassified';
}

function commandText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(' ');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'script', 'input']) {
    const candidate = commandText(record[key]);
    if (candidate) return candidate;
  }
  return '';
}

function executionTreePolicy(
  policy: AgentBudgetPolicy | undefined,
  scope: ExecutionTreeBudgetPolicy['scope'],
  scopeId: string,
  fallbackName: string,
  identitySuffix = ''
): ExecutionTreeBudgetPolicy | undefined {
  if (
    !policy ||
    policy.enabled === false ||
    !policy.limits ||
    Object.keys(policy.limits).length === 0
  ) {
    return undefined;
  }
  const identity = `${scope}:${scopeId}:${identitySuffix}`;
  return {
    id: `budget_${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`,
    scope,
    scopeId,
    name: policy.name?.trim() || fallbackName,
    limits: { ...policy.limits },
    hardAction: policy.hardAction ?? 'pause',
  };
}

function mergeExecutionTreeBudgetPolicies(
  policies: ExecutionTreeBudgetPolicy[]
): ExecutionTreeBudgetPolicy[] {
  const merged = new Map<string, ExecutionTreeBudgetPolicy>();
  for (const policy of policies) {
    const current = merged.get(policy.id);
    if (!current) {
      merged.set(policy.id, policy);
      continue;
    }
    const limits = { ...current.limits };
    for (const [metric, limit] of Object.entries(policy.limits)) {
      const currentLimit = limits[metric as keyof typeof limits];
      limits[metric as keyof typeof limits] =
        currentLimit === undefined ? limit : Math.min(currentLimit, limit);
    }
    merged.set(policy.id, { ...current, limits });
  }
  return [...merged.values()];
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

function workspaceConversationCursor(
  conversation: ConversationLifecycleRecord
): string | undefined {
  const conversationId = conversation.conversationId ?? conversation.parentConversationId;
  const turnId = conversation.conversationId
    ? conversation.currentTurnId
    : (conversation.currentTurnId ?? conversation.forkTurnId);
  const itemId = conversation.lastItemId;
  if (!conversationId && !turnId && !itemId) return undefined;
  const cursor = JSON.stringify({
    schemaVersion: 'provider-conversation-cursor/v1',
    ...(conversationId ? { conversationId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId } : {}),
  });
  if (cursor.length > 2_048) {
    throw new ConflictError('Provider conversation cursor exceeds the checkpoint integrity bound.');
  }
  return cursor;
}

function parseProviderConversationCursor(value: string): ProviderConversationCursor {
  if (!value || value.length > 2_048) {
    throw new ConflictError('Provider conversation cursor exceeds the checkpoint integrity bound.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ConflictError('Provider conversation cursor is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConflictError('Provider conversation cursor is not an object.');
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    record.schemaVersion !== 'provider-conversation-cursor/v1' ||
    keys.some((key) => !['schemaVersion', 'conversationId', 'turnId', 'itemId'].includes(key)) ||
    typeof record.conversationId !== 'string' ||
    !record.conversationId.trim() ||
    record.conversationId.length > 1_024 ||
    (record.turnId !== undefined &&
      (typeof record.turnId !== 'string' ||
        !record.turnId.trim() ||
        record.turnId.length > 1_024)) ||
    (record.itemId !== undefined &&
      (typeof record.itemId !== 'string' || !record.itemId.trim() || record.itemId.length > 1_024))
  ) {
    throw new ConflictError('Provider conversation cursor is invalid or unsupported.');
  }
  return {
    conversationId: record.conversationId,
    ...(typeof record.turnId === 'string' ? { turnId: record.turnId } : {}),
    ...(typeof record.itemId === 'string' ? { itemId: record.itemId } : {}),
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

function admissionReleaseReason(
  status: TaskCompletionStatus | undefined,
  success?: boolean
): AdmissionReservationRelease['reason'] {
  if (status === 'success' || success === true) return 'completed';
  return status === 'interrupted' ? 'interrupted' : 'failed';
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
