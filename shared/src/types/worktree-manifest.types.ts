export const WORKTREE_MANIFEST_SCHEMA_VERSION = 'worktree-manifest/v1' as const;

export type WorktreeBaseSource = 'remote' | 'local-stale' | 'legacy-adopted';
export type WorktreeCreationState = 'planned' | 'creating' | 'ready' | 'failed';
export type WorktreeIntegrationState =
  'idle' | 'preparing' | 'merging' | 'pushing' | 'integrated' | 'failed';
export type WorktreeCleanupState = 'active' | 'blocked' | 'removing' | 'removed' | 'failed';

export interface WorktreeStaleBaseAcknowledgement {
  reason: string;
  acknowledgedAt: string;
  actor?: string;
}

export interface WorktreeResolvedBase {
  branch: string;
  commit: string;
  source: WorktreeBaseSource;
  resolvedAt: string;
  fetchedAt?: string;
  fetchError?: string;
  staleBaseAcknowledgement?: WorktreeStaleBaseAcknowledgement;
}

export interface WorktreeRepositoryIdentity {
  name: string;
  rootPath: string;
  commonGitDir: string;
  originFingerprint: string;
}

export interface WorktreeOwnershipLease {
  id: string;
  ownerTaskId: string;
  ownerAttemptId?: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface WorktreeLifecycle {
  creation: WorktreeCreationState;
  integration: WorktreeIntegrationState;
  cleanup: WorktreeCleanupState;
}

export interface WorktreeRebaseEvidence {
  state: 'idle' | 'rebasing' | 'failed';
  targetBase?: WorktreeResolvedBase;
  startedAt?: string;
  completedAt?: string;
}

export interface WorktreeManifestError {
  operation:
    | 'create'
    | 'task-update'
    | 'rebase'
    | 'integration-prepare'
    | 'integration-merge'
    | 'integration-push'
    | 'cleanup';
  code: string;
  message: string;
  at: string;
  recoverable: boolean;
}

export interface WorktreeIntegrationEvidence {
  worktreePath?: string;
  baseCommit?: string;
  integrationHead?: string;
  targetCommit?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorktreeOverrideAudit {
  operation: 'cleanup';
  reason: string;
  actor?: string;
  recordedAt: string;
  bypassedReasons: WorktreeCleanupReasonCode[];
}

export interface WorktreeManifest {
  schemaVersion: typeof WORKTREE_MANIFEST_SCHEMA_VERSION;
  id: string;
  revision: number;
  taskId: string;
  repository: WorktreeRepositoryIdentity;
  path: string;
  branch: string;
  base: WorktreeResolvedBase;
  lease: WorktreeOwnershipLease;
  lifecycle: WorktreeLifecycle;
  rebase: WorktreeRebaseEvidence;
  integration: WorktreeIntegrationEvidence;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
  lastError?: WorktreeManifestError;
  overrides: WorktreeOverrideAudit[];
}

export type WorktreeCleanupReasonCode =
  | 'active-run'
  | 'active-lease'
  | 'dirty'
  | 'untracked'
  | 'unpushed'
  | 'unmerged'
  | 'external-hold'
  | 'manifest-mismatch'
  | 'worktree-missing'
  | 'branch-mismatch'
  | 'inspection-failed';

export interface WorktreeCleanupReason {
  code: WorktreeCleanupReasonCode;
  message: string;
  overrideable: boolean;
}

export interface WorktreeCleanupSnapshot {
  dirty: boolean;
  untrackedFiles: number;
  unpushedCommits: number;
  mergedIntoBase: boolean;
  externalHold: 'clear' | 'held' | 'unavailable';
}

export interface WorktreeCleanupPreview {
  taskId: string;
  manifestId: string;
  path: string;
  checkedAt: string;
  stale: boolean;
  eligible: boolean;
  requiresOverride: boolean;
  blockedReasons: WorktreeCleanupReason[];
  snapshot: WorktreeCleanupSnapshot;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  baseSource: WorktreeBaseSource;
  manifestId: string;
  manifest: WorktreeManifest;
  lifecycle: WorktreeLifecycle;
  remoteState: {
    stale: boolean;
    fetchedAt?: string;
    error?: string;
  };
  aheadBehind: {
    ahead: number;
    behind: number;
  };
  hasChanges: boolean;
  changedFiles: number;
  cleanupPreview: WorktreeCleanupPreview;
}

export interface WorktreeIntegrationResult {
  merged: true;
  targetCommit: string;
  manifest: WorktreeManifest;
}

export interface CreateWorktreeRequest {
  allowStaleBase?: boolean;
  staleBaseAcknowledgement?: {
    reason: string;
    actor?: string;
  };
  leaseSeconds?: number;
}

export interface DeleteWorktreeRequest {
  force?: boolean;
  reason?: string;
  actor?: string;
}
