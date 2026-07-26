export const WORKSPACE_CHECKPOINT_SCHEMA_VERSION = 'workspace-checkpoint/v1' as const;
export const WORKSPACE_CHECKPOINT_DIFF_SCHEMA_VERSION = 'workspace-checkpoint-diff/v1' as const;

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
  | 'mixed-file-evidence'
  | 'no-file-evidence';

export interface WorkspaceCheckpointHunkAttribution {
  source: WorkspaceCheckpointAttributionSource;
  confidence: WorkspaceCheckpointAttributionConfidence;
  basis: WorkspaceCheckpointAttributionBasis;
  scope: 'checkpoint-file-window';
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
