export const WORKSPACE_CHECKPOINT_SCHEMA_VERSION = 'workspace-checkpoint/v1' as const;
export const WORKSPACE_CHECKPOINT_DIFF_SCHEMA_VERSION = 'workspace-checkpoint-diff/v1' as const;
export const WORKSPACE_CHECKPOINT_CURRENT_STATE_SCHEMA_VERSION =
  'workspace-checkpoint-current-state/v1' as const;
export const WORKSPACE_CHECKPOINT_REWIND_PREVIEW_SCHEMA_VERSION =
  'workspace-checkpoint-rewind-preview/v1' as const;
export const WORKSPACE_CHECKPOINT_REWIND_TRANSACTION_SCHEMA_VERSION =
  'workspace-checkpoint-rewind-transaction/v1' as const;
export const WORKSPACE_CHECKPOINT_RETENTION_RESULT_SCHEMA_VERSION =
  'workspace-checkpoint-retention-result/v1' as const;

export const WORKSPACE_CHECKPOINT_BOUNDARIES = [
  'before-user-turn',
  'before-compaction',
  'before-retry',
  'before-provider-handoff',
  'manual',
] as const;

export const WORKSPACE_CHECKPOINT_EXCLUSION_REASONS = [
  'sensitive',
  'binary',
  'too-large',
  'symlink',
  'unsupported-file',
  'file-limit',
  'byte-limit',
  'read-failed',
] as const;

export type WorkspaceCheckpointBoundary = (typeof WORKSPACE_CHECKPOINT_BOUNDARIES)[number];
export type WorkspaceCheckpointExclusionReason =
  (typeof WORKSPACE_CHECKPOINT_EXCLUSION_REASONS)[number];
export type WorkspaceCheckpointFileSource = 'tracked' | 'untracked';
export type WorkspaceCheckpointFileState = 'present' | 'absent';

export interface WorkspaceCheckpointPolicy {
  ignoredFiles: 'excluded';
  sensitiveFiles: 'excluded';
  binaryFiles: 'excluded';
  symlinks: 'excluded';
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  maxExclusions: number;
}

export interface WorkspaceCheckpointFile {
  path: string;
  source: WorkspaceCheckpointFileSource;
  state: WorkspaceCheckpointFileState;
  mode?: number;
  size: number;
  contentDigest?: string;
  blobDigest?: string;
}

export interface WorkspaceCheckpointExclusion {
  path: string;
  source: WorkspaceCheckpointFileSource;
  reason: WorkspaceCheckpointExclusionReason;
  size?: number;
}

export interface WorkspaceCheckpointGitState {
  head: string | null;
  branch: string | null;
  indexDigest: string;
  indexBlobDigest: string;
  indexBytes: number;
  statusDigest: string;
  dirty: boolean;
}

export interface WorkspaceCheckpoint {
  schemaVersion: typeof WORKSPACE_CHECKPOINT_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  boundary: WorkspaceCheckpointBoundary;
  operationIdDigest: string;
  captureRequestDigest: string;
  worktreeRootDigest: string;
  worktreeManifestId?: string;
  parentCheckpointId?: string;
  turnId?: string;
  conversationCursor?: string;
  git: WorkspaceCheckpointGitState;
  policy: WorkspaceCheckpointPolicy;
  files: WorkspaceCheckpointFile[];
  exclusions: WorkspaceCheckpointExclusion[];
  excludedCount: number;
  exclusionsTruncated: boolean;
  fileCount: number;
  contentBytes: number;
  storedBytes: number;
  createdAt: string;
  digest: string;
}

export type WorkspaceCheckpointDiffLineKind = 'context' | 'addition' | 'deletion';
export type WorkspaceCheckpointFileChangeKind = 'added' | 'modified' | 'deleted' | 'mode-changed';
export type WorkspaceCheckpointAttributionSource =
  'agent-tool' | 'operator' | 'external' | 'unknown';
export type WorkspaceCheckpointAttributionConfidence = 'high' | 'ambiguous' | 'none';
export type WorkspaceCheckpointAttributionBasis =
  | 'provider-file-event'
  | 'write-tool-event'
  | 'operator-file-event'
  | 'filesystem-file-event'
  | 'hunk-range-event'
  | 'mixed-file-evidence'
  | 'mixed-hunk-evidence'
  | 'no-file-evidence'
  | 'no-hunk-evidence';

export interface WorkspaceCheckpointHunkAttribution {
  source: WorkspaceCheckpointAttributionSource;
  confidence: WorkspaceCheckpointAttributionConfidence;
  basis: WorkspaceCheckpointAttributionBasis;
  scope: 'checkpoint-file-window' | 'checkpoint-hunk-window';
  evidenceEventIds: string[];
  provider?: string;
  agent?: string;
  tool?: string;
}

export interface WorkspaceCheckpointDiffLine {
  kind: WorkspaceCheckpointDiffLineKind;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface WorkspaceCheckpointDiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: WorkspaceCheckpointDiffLine[];
  attribution?: WorkspaceCheckpointHunkAttribution;
}

export interface WorkspaceCheckpointFileDiff {
  path: string;
  kind: WorkspaceCheckpointFileChangeKind;
  source: WorkspaceCheckpointFileSource;
  fromState: WorkspaceCheckpointFileState;
  toState: WorkspaceCheckpointFileState;
  fromMode?: number;
  toMode?: number;
  fromContentDigest?: string;
  toContentDigest?: string;
  additions: number;
  deletions: number;
  hunks: WorkspaceCheckpointDiffHunk[];
  attribution?: WorkspaceCheckpointHunkAttribution;
}

export interface WorkspaceCheckpointDiff {
  schemaVersion: typeof WORKSPACE_CHECKPOINT_DIFF_SCHEMA_VERSION;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  fromCheckpoint: Pick<WorkspaceCheckpoint, 'id' | 'boundary' | 'createdAt' | 'digest'>;
  toCheckpoint: Pick<WorkspaceCheckpoint, 'id' | 'boundary' | 'createdAt' | 'digest'>;
  directParent: true;
  git: {
    headChanged: boolean;
    branchChanged: boolean;
    indexChanged: boolean;
    statusChanged: boolean;
  };
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  attribution?: {
    evidenceComplete: boolean;
    fromEventSequence?: number;
    toEventSequence?: number;
    eventsConsidered: number;
  };
  files: WorkspaceCheckpointFileDiff[];
}

export type WorkspaceCheckpointCurrentFileState =
  'present' | 'absent' | 'symlink' | 'unsupported' | 'too-large' | 'unreadable';

export interface WorkspaceCheckpointCurrentFile {
  path: string;
  state: WorkspaceCheckpointCurrentFileState;
  mode?: number;
  size?: number;
  contentDigest?: string;
}

export interface WorkspaceCheckpointCurrentState {
  schemaVersion: typeof WORKSPACE_CHECKPOINT_CURRENT_STATE_SCHEMA_VERSION;
  worktreeRootDigest: string;
  git: {
    head: string | null;
    branch: string | null;
    indexDigest: string;
    statusDigest: string;
    dirty: boolean;
  };
  files: WorkspaceCheckpointCurrentFile[];
  inspectedAt: string;
  digest: string;
}

export type WorkspaceCheckpointRewindAction = 'delete' | 'restore' | 'restore-mode';
export type WorkspaceCheckpointRewindConflictKind =
  | 'worktree-root-changed'
  | 'head-diverged'
  | 'branch-diverged'
  | 'index-diverged'
  | 'status-diverged'
  | 'git-history-change'
  | 'index-posture-change'
  | 'conversation-cursor-unavailable'
  | 'file-diverged'
  | 'file-unreadable'
  | 'excluded-path-overlap'
  | 'inventory-incomplete'
  | 'attribution-ambiguous';

export interface WorkspaceCheckpointRewindConflict {
  kind: WorkspaceCheckpointRewindConflictKind;
  message: string;
  path?: string;
  expected?: string | null;
  actual?: string | null;
}

export interface WorkspaceCheckpointRewindFilePreview {
  path: string;
  action: WorkspaceCheckpointRewindAction;
  estimatedDiscardedBytes: number;
  attribution?: WorkspaceCheckpointHunkAttribution;
  conflicts: WorkspaceCheckpointRewindConflict[];
}

export interface WorkspaceCheckpointRewindPreview {
  schemaVersion: typeof WORKSPACE_CHECKPOINT_REWIND_PREVIEW_SCHEMA_VERSION;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  targetCheckpointId: string;
  descendantCheckpointId: string;
  ownership: {
    manifestId: string;
    leaseId: string;
    ownerAttemptId: string;
    verifiedAt: string;
  };
  current: WorkspaceCheckpointCurrentState;
  checkpointDiff: WorkspaceCheckpointDiff;
  git: {
    headWillChange: boolean;
    branchWillChange: boolean;
    indexWillChange: boolean;
  };
  conversation: {
    cursorWillChange: boolean;
    targetCursorAvailable: boolean;
  };
  files: WorkspaceCheckpointRewindFilePreview[];
  exclusions: {
    targetCount: number;
    descendantCount: number;
    overlappingPaths: string[];
    inventoryIncomplete: boolean;
  };
  conflicts: WorkspaceCheckpointRewindConflict[];
  estimatedDataLossBytes: number;
  safeForAutomaticRewind: boolean;
  evidenceDigest: string;
  digest: string;
}

export type WorkspaceCheckpointRewindTransactionState =
  'prepared' | 'applying' | 'committed' | 'rolling-back' | 'rolled-back';

export interface WorkspaceCheckpointRewindTransaction {
  schemaVersion: typeof WORKSPACE_CHECKPOINT_REWIND_TRANSACTION_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  operationIdDigest: string;
  requestDigest: string;
  previewDigest: string;
  previewEvidenceDigest: string;
  expectedCurrentDigest: string;
  targetCheckpointId: string;
  targetCheckpointDigest: string;
  descendantCheckpointId: string;
  descendantCheckpointDigest: string;
  worktreeRootDigest: string;
  state: WorkspaceCheckpointRewindTransactionState;
  affectedPaths: string[];
  restoredPathCount: number;
  recoveryCheckpointId: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  digest: string;
}

export interface WorkspaceCheckpointRetentionResult {
  schemaVersion: typeof WORKSPACE_CHECKPOINT_RETENTION_RESULT_SCHEMA_VERSION;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  activeRun: boolean;
  preservedCheckpointIds: string[];
  removedCheckpointIds: string[];
  reclaimedMetadataBytes: number;
  logicalContentBytesDereferenced: number;
  contentBlobGcDeferred: true;
  completedAt: string;
}
