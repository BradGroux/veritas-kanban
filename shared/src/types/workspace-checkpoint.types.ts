export const WORKSPACE_CHECKPOINT_SCHEMA_VERSION = 'workspace-checkpoint/v1' as const;

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
