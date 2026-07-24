export const TASK_ENVELOPE_SCHEMA_VERSION = 'task-envelope/v1' as const;
export const COMPLETION_RESULT_SCHEMA_VERSION = 'completion-result/v1' as const;

export const TASK_COMMIT_POLICIES = ['forbidden', 'allowed', 'required'] as const;
export type TaskCommitPolicy = (typeof TASK_COMMIT_POLICIES)[number];

/** Optional task-level defaults. Run-level values take precedence at launch. */
export interface TaskExecutionPolicy {
  commitPolicy?: TaskCommitPolicy;
  allowedSideEffects?: TaskAllowedSideEffect[];
  expectedOutputs?: TaskExpectedOutput[];
}

export const TASK_COMPLETION_STATUSES = [
  'success',
  'blocked',
  'failed',
  'interrupted',
  'partial',
] as const;
export type TaskCompletionStatus = (typeof TASK_COMPLETION_STATUSES)[number];

export const TASK_TERMINAL_SOURCES = [
  'process',
  'stream',
  'callback',
  'remote-session',
  'operator-interruption',
] as const;
export type TaskTerminalSource = (typeof TASK_TERMINAL_SOURCES)[number];

export const TASK_SIDE_EFFECT_KINDS = [
  'filesystem-write',
  'process-execute',
  'network-egress',
  'git-commit',
  'external-write',
  'artifact-write',
  'task-mutate',
] as const;
export type TaskSideEffectKind = (typeof TASK_SIDE_EFFECT_KINDS)[number];

export const TASK_EXPECTED_OUTPUT_KINDS = ['text', 'file', 'artifact', 'commit', 'other'] as const;
export type TaskExpectedOutputKind = (typeof TASK_EXPECTED_OUTPUT_KINDS)[number];

export const TASK_EVIDENCE_KINDS = [
  'provider-output',
  'process-exit',
  'stream-event',
  'callback',
  'verification',
  'file-change',
  'artifact',
  'commit',
  'other',
] as const;
export type TaskEvidenceKind = (typeof TASK_EVIDENCE_KINDS)[number];

export const TASK_EVIDENCE_SOURCES = ['provider', 'harness'] as const;
export type TaskEvidenceSource = (typeof TASK_EVIDENCE_SOURCES)[number];

export const TASK_VERIFICATION_STATUSES = ['passed', 'failed', 'skipped', 'unknown'] as const;
export type TaskVerificationStatus = (typeof TASK_VERIFICATION_STATUSES)[number];

export const TASK_CHANGED_FILE_STATUSES = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'untracked',
] as const;
export type TaskChangedFileStatus = (typeof TASK_CHANGED_FILE_STATUSES)[number];

export const TASK_ARTIFACT_KINDS = ['file', 'log', 'report', 'url', 'other'] as const;
export type TaskArtifactKind = (typeof TASK_ARTIFACT_KINDS)[number];

export const TASK_CONTINUATION_KINDS = ['thread', 'session', 'run', 'other'] as const;
export type TaskContinuationKind = (typeof TASK_CONTINUATION_KINDS)[number];

export interface TaskLaunchBaselineFile {
  path: string;
  status: TaskChangedFileStatus;
  /** Git object ID for the staged index entry, or null when no index entry exists. */
  indexBlobHash: string | null;
  /** SHA-256 of the worktree entry bytes, or null when the entry does not exist/is not a file. */
  worktreeSha256: string | null;
}

export interface TaskLaunchBaseline {
  capturedAt: string;
  headSha: string;
  dirty: boolean;
  files: TaskLaunchBaselineFile[];
  /**
   * Commits reachable from another launch-time ref but not from `headSha`.
   * Missing only on legacy v1 envelopes; completion then fails closed if HEAD moves.
   */
  preexistingCommitShas?: string[];
}

export interface TaskEnvelopeSubject {
  id: string;
  title: string;
  objective: string;
  background: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

export interface TaskEnvelopeAttempt {
  id: string;
  createdAt: string;
}

export interface TaskEnvelopeWorkspace {
  workspaceId: string;
  worktreeId: string;
  worktreeManifestId?: string;
  ownershipLeaseId?: string;
  ownershipAttemptId?: string;
  repo: string;
  branch: string;
  baseBranch: string;
  resolvedBaseCommit?: string;
  baseResolutionSource?: import('./worktree-manifest.types.js').WorktreeBaseSource;
  worktreePath: string;
  baseline: TaskLaunchBaseline;
}

export interface TaskAllowedSideEffect {
  kind: TaskSideEffectKind;
  scope: string;
}

export interface TaskExpectedOutput {
  id: string;
  kind: TaskExpectedOutputKind;
  description: string;
  required: boolean;
}

export interface TaskVerificationGate {
  id: string;
  description: string;
  required: boolean;
  evidenceRequired: boolean;
}

export interface TaskEvidenceRequirement {
  id: string;
  kind: TaskEvidenceKind;
  description: string;
  required: boolean;
}

export interface TaskLaunchManifestReference {
  schemaVersion: string;
  digest: string;
  provider: string;
  adapter: string;
  protocolVersion: string;
}

export interface TaskCompletionContract {
  schemaVersion: typeof COMPLETION_RESULT_SCHEMA_VERSION;
  evidenceRequirements: TaskEvidenceRequirement[];
}

/** Immutable, provider-neutral input captured before an agent run starts. */
export interface TaskEnvelope {
  schemaVersion: typeof TASK_ENVELOPE_SCHEMA_VERSION;
  digest: string;
  subject: TaskEnvelopeSubject;
  attempt: TaskEnvelopeAttempt;
  workspace: TaskEnvelopeWorkspace;
  commitPolicy: TaskCommitPolicy;
  allowedSideEffects: TaskAllowedSideEffect[];
  expectedOutputs: TaskExpectedOutput[];
  verificationGates: TaskVerificationGate[];
  launchManifest: TaskLaunchManifestReference;
  completionContract: TaskCompletionContract;
}

export interface TaskCompletionBlocker {
  code: string;
  summary: string;
  detail: string;
  retryable: boolean;
}

export interface TaskCompletionEvidence {
  id: string;
  kind: TaskEvidenceKind;
  source: TaskEvidenceSource;
  summary: string;
  reference: string | null;
  requirementIds: string[];
  verified: boolean;
}

export interface TaskCompletionVerification {
  gateId: string;
  status: TaskVerificationStatus;
  summary: string;
  evidenceIds: string[];
}

export interface TaskCompletionChangedFile {
  path: string;
  status: TaskChangedFileStatus;
  previousPath: string | null;
  verified: boolean;
}

export interface TaskCompletionArtifact {
  id: string;
  kind: TaskArtifactKind;
  name: string;
  reference: string;
  mediaType: string | null;
  sha256: string | null;
  verified: boolean;
}

export interface TaskCompletionSideEffect {
  kind: TaskSideEffectKind;
  description: string;
  target: string | null;
  authorized: boolean;
  verified: boolean;
}

export interface TaskContinuationHandle {
  provider: string;
  kind: TaskContinuationKind;
  reference: string;
}

/** Normalized terminal result returned by every provider transport. */
export interface CompletionResult {
  schemaVersion: typeof COMPLETION_RESULT_SCHEMA_VERSION;
  digest: string;
  idempotencyKey: string;
  completedAt: string;
  terminalSource: TaskTerminalSource;
  taskEnvelopeSchemaVersion: typeof TASK_ENVELOPE_SCHEMA_VERSION;
  taskEnvelopeDigest: string;
  taskId: string;
  attemptId: string;
  providerRuntimeManifestDigest: string;
  status: TaskCompletionStatus;
  summary: string;
  error: string | null;
  blockers: TaskCompletionBlocker[];
  evidence: TaskCompletionEvidence[];
  changedFiles: TaskCompletionChangedFile[];
  artifacts: TaskCompletionArtifact[];
  verification: TaskCompletionVerification[];
  sideEffects: TaskCompletionSideEffect[];
  continuation: TaskContinuationHandle | null;
}
