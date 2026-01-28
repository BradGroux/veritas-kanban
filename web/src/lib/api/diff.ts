/**
 * Diff, conflicts, and GitHub API endpoints.
 */
import { API_BASE, handleResponse } from './helpers';

export const diffApi = {
  getSummary: async (taskId: string): Promise<DiffSummary> => {
    const response = await fetch(`${API_BASE}/diff/${taskId}`);
    return handleResponse<DiffSummary>(response);
  },

  getFileDiff: async (taskId: string, filePath: string): Promise<FileDiff> => {
    const response = await fetch(
      `${API_BASE}/diff/${taskId}/file?path=${encodeURIComponent(filePath)}`
    );
    return handleResponse<FileDiff>(response);
  },

  getFullDiff: async (taskId: string): Promise<FileDiff[]> => {
    const response = await fetch(`${API_BASE}/diff/${taskId}/full`);
    return handleResponse<FileDiff[]>(response);
  },
};

export const conflictsApi = {
  getStatus: async (taskId: string): Promise<ConflictStatus> => {
    const response = await fetch(`${API_BASE}/conflicts/${taskId}`);
    return handleResponse<ConflictStatus>(response);
  },

  getFile: async (taskId: string, filePath: string): Promise<ConflictFile> => {
    const response = await fetch(
      `${API_BASE}/conflicts/${taskId}/file?path=${encodeURIComponent(filePath)}`
    );
    return handleResponse<ConflictFile>(response);
  },

  resolve: async (
    taskId: string,
    filePath: string,
    resolution: 'ours' | 'theirs' | 'manual',
    manualContent?: string
  ): Promise<ResolveResult> => {
    const response = await fetch(
      `${API_BASE}/conflicts/${taskId}/resolve?path=${encodeURIComponent(filePath)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, manualContent }),
      }
    );
    return handleResponse<ResolveResult>(response);
  },

  abort: async (taskId: string): Promise<{ success: boolean }> => {
    const response = await fetch(`${API_BASE}/conflicts/${taskId}/abort`, {
      method: 'POST',
    });
    return handleResponse<{ success: boolean }>(response);
  },

  continue: async (
    taskId: string,
    message?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const response = await fetch(`${API_BASE}/conflicts/${taskId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return handleResponse<{ success: boolean; error?: string }>(response);
  },
};

export const githubApi = {
  getStatus: async (): Promise<GitHubStatus> => {
    const response = await fetch(`${API_BASE}/github/status`);
    return handleResponse<GitHubStatus>(response);
  },

  createPR: async (input: CreatePRInput): Promise<PRInfo> => {
    const response = await fetch(`${API_BASE}/github/pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handleResponse<PRInfo>(response);
  },

  openPR: async (taskId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/github/pr/${taskId}/open`, {
      method: 'POST',
    });
    return handleResponse<void>(response);
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
