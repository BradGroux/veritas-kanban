/**
 * Diff, conflicts, and GitHub API endpoints.
 */
import { API_BASE, apiFetch } from './helpers';

export const diffApi = {
  getSummary: async (taskId: string): Promise<DiffSummary> => {
    return apiFetch<DiffSummary>(`${API_BASE}/diff/${taskId}`);
  },

  getFileDiff: async (taskId: string, filePath: string): Promise<FileDiff> => {
    return apiFetch<FileDiff>(
      `${API_BASE}/diff/${taskId}/file?path=${encodeURIComponent(filePath)}`
    );
  },

  getFullDiff: async (taskId: string): Promise<FileDiff[]> => {
    return apiFetch<FileDiff[]>(`${API_BASE}/diff/${taskId}/full`);
  },

  runCodexReview: async (
    taskId: string,
    input: CodexReviewInput = {}
  ): Promise<CodexReviewResult> => {
    return apiFetch<CodexReviewResult>(`${API_BASE}/diff/${taskId}/codex-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },
};

export const conflictsApi = {
  getStatus: async (taskId: string): Promise<ConflictStatus> => {
    return apiFetch<ConflictStatus>(`${API_BASE}/conflicts/${taskId}`);
  },

  getFile: async (taskId: string, filePath: string): Promise<ConflictFile> => {
    return apiFetch<ConflictFile>(
      `${API_BASE}/conflicts/${taskId}/file?path=${encodeURIComponent(filePath)}`
    );
  },

  resolve: async (
    taskId: string,
    filePath: string,
    resolution: 'ours' | 'theirs' | 'manual',
    manualContent?: string
  ): Promise<ResolveResult> => {
    return apiFetch<ResolveResult>(
      `${API_BASE}/conflicts/${taskId}/resolve?path=${encodeURIComponent(filePath)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, manualContent }),
      }
    );
  },

  abort: async (taskId: string): Promise<{ success: boolean }> => {
    return apiFetch<{ success: boolean }>(`${API_BASE}/conflicts/${taskId}/abort`, {
      method: 'POST',
    });
  },

  continue: async (
    taskId: string,
    message?: string
  ): Promise<{ success: boolean; error?: string }> => {
    return apiFetch<{ success: boolean; error?: string }>(
      `${API_BASE}/conflicts/${taskId}/continue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      }
    );
  },
};

export const githubApi = {
  getStatus: async (): Promise<GitHubStatus> => {
    return apiFetch<GitHubStatus>(`${API_BASE}/github/status`);
  },

  createPR: async (input: CreatePRInput): Promise<PRInfo> => {
    return apiFetch<PRInfo>(`${API_BASE}/github/pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  delegateCodexCloud: async (
    input: CodexCloudDelegationInput
  ): Promise<CodexCloudDelegationResult> => {
    return apiFetch<CodexCloudDelegationResult>(`${API_BASE}/github/codex/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  openPR: async (taskId: string): Promise<void> => {
    return apiFetch<void>(`${API_BASE}/github/pr/${taskId}/open`, {
      method: 'POST',
    });
  },
};

// Diff types
export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  oldPath?: string;
}

export interface DiffSummary {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'delete';
  content: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  language: string;
  additions: number;
  deletions: number;
}

// Conflict types
export interface ConflictStatus {
  hasConflicts: boolean;
  conflictingFiles: string[];
  rebaseInProgress: boolean;
  mergeInProgress: boolean;
}

export interface ConflictMarker {
  startLine: number;
  separatorLine: number;
  endLine: number;
  oursLines: string[];
  theirsLines: string[];
}

export interface ConflictFile {
  path: string;
  content: string;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
  markers: ConflictMarker[];
}

export interface ResolveResult {
  success: boolean;
  remainingConflicts: string[];
}

// GitHub types
export interface GitHubStatus {
  installed: boolean;
  authenticated: boolean;
  user?: string;
}

export interface PRInfo {
  url: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  headBranch: string;
  baseBranch: string;
}

export interface CreatePRInput {
  taskId: string;
  title?: string;
  body?: string;
  targetBranch?: string;
  draft?: boolean;
}

export interface CodexReviewInput {
  model?: string;
  instructions?: string;
  save?: boolean;
}

export interface CodexReviewFinding {
  file: string;
  line: number;
  severity: 'high' | 'medium' | 'low' | 'nit';
  title: string;
  message: string;
}

export interface CodexReviewResult {
  taskId: string;
  attemptId: string;
  decision: 'approved' | 'changes-requested' | 'rejected';
  summary: string;
  findings: CodexReviewFinding[];
  comments: Array<{
    id: string;
    file: string;
    line: number;
    content: string;
    created: string;
  }>;
  threadId?: string;
}

export type CodexCloudTarget = 'issue' | 'issue-comment' | 'pr-comment';

export interface CodexCloudDelegationInput {
  taskId: string;
  target?: CodexCloudTarget;
  title?: string;
  prompt?: string;
  model?: string;
}

export interface CodexCloudDelegationResult {
  taskId: string;
  attemptId: string;
  target: CodexCloudTarget;
  url: string;
  number?: number;
  repo: string;
  prompt: string;
}
