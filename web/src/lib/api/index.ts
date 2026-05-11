/**
 * API module barrel export.
 * Assembles the full `api` object and re-exports all types for backwards compatibility.
 */

// Import API sections
import { tasksApi } from './tasks';
import { backlogApi } from './backlog';
import { settingsApi, configApi } from './config';
import { agentApi, registryApi, worktreeApi, previewApi } from './agent';
import { diffApi, conflictsApi, githubApi } from './diff';
import { templatesApi, taskTypesApi, sprintsApi, activityApi, attachmentsApi } from './entities';
import { timeApi, statusHistoryApi } from './time';
import { chatApi } from './chat';
import { decisionsApi } from './decisions';
import { scoringApi } from './scoring';
import { searchApi } from './search';

// Assemble the full API object (matches original structure exactly)
export const api = {
  tasks: tasksApi,
  backlog: backlogApi,
  settings: settingsApi,
  config: configApi,
  worktree: worktreeApi,
  agent: agentApi,
  registry: registryApi,
  diff: diffApi,
  templates: templatesApi,
  taskTypes: taskTypesApi,
  sprints: sprintsApi,
  activity: activityApi,
  attachments: attachmentsApi,
  conflicts: conflictsApi,
  github: githubApi,
  preview: previewApi,
  time: timeApi,
  statusHistory: statusHistoryApi,
  chat: chatApi,
  decisions: decisionsApi,
  scoring: scoringApi,
  search: searchApi,
};

export type {
  SearchBackend,
  SearchCollection,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from './search';

// Re-export managed list helper
export { managedList } from './managed-list';

// Re-export all types from each module
export type { ArchiveSuggestion } from './tasks';
export type { BacklogListResponse, BacklogFilterOptions } from './backlog';
export type { CodexHealthStatus } from './config';

export type {
  AgentStatus,
  AgentStatusResponse,
  AgentOutput,
  GlobalAgentStatus,
  ActiveAgentInfo,
  WorktreeInfo,
  PreviewServer,
} from './agent';

export type {
  FileChange,
  DiffSummary,
  DiffHunk,
  DiffLine,
  FileDiff,
  CodexReviewInput,
  CodexReviewFinding,
  CodexReviewResult,
  ConflictStatus,
  ConflictMarker,
  ConflictFile,
  ResolveResult,
  GitHubStatus,
  PRInfo,
  CreatePRInput,
  CodexCloudTarget,
  CodexCloudDelegationInput,
  CodexCloudDelegationResult,
} from './diff';

export type {
  ActivityType,
  Activity,
  ActivityFilters,
  ActivityFilterOptions,
  AttachmentUploadResponse,
  TaskContext,
} from './entities';

export type {
  TimeSummary,
  AgentStatusState,
  StatusHistoryEntry,
  StatusPeriod,
  DailySummary,
} from './time';

export type {
  DecisionRecord,
  DecisionWithChain,
  DecisionListFilters,
} from '@veritas-kanban/shared';
