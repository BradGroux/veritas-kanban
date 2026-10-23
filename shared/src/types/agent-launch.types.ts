import type { AgentType, AttemptStatus } from './task.types.js';
import type { ExecutableAgentProvider } from './config.types.js';
import type {
  ProviderRuntimeManifest,
  HarnessSupportStatus,
  ProviderRuntimeControlSet,
} from './provider-runtime.types.js';
import type { TaskEnvelope } from './task-envelope.types.js';
import type {
  RunLaunchManifest,
  RunLaunchManifestDriftResult,
} from './run-launch-manifest.types.js';
import type { RunRecoveryRecord } from './run-recovery.types.js';
import type { PhaseCapabilityEvidence } from './phase-capability.types.js';
import type { ConversationLifecycleRecord } from './conversation-lifecycle.types.js';
import type { ExecutionTreeIdentity } from './execution-tree-budget.types.js';
import type { RunTerminalHandle } from './run-terminal.types.js';

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
