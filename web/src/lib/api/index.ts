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
import { governanceTracesApi } from './governance-traces';
import { scoringApi } from './scoring';
import { searchApi } from './search';
import { identityApi } from './identity';
import { workProductsApi } from './work-products';
import { tracesApi } from './traces';
import { maintenanceApi } from './maintenance';
import { skillCapabilitiesApi } from './skill-capabilities';
import { skillSecurityApi } from './skill-security';
import { integrationsApi } from './integrations';

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
  governanceTraces: governanceTracesApi,
  scoring: scoringApi,
  search: searchApi,
  identity: identityApi,
  workProducts: workProductsApi,
  traces: tracesApi,
  maintenance: maintenanceApi,
  integrations: integrationsApi,
  skillCapabilities: skillCapabilitiesApi,
  skillSecurity: skillSecurityApi,
};

export type {
  SearchBackend,
  SearchCollection,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SearchResultAction,
  SearchTarget,
} from './search';

export type { WorkProductExportFormat, WorkProductExportOptions } from './work-products';
export type { TraceStatus } from './traces';
export type { SqlitePortabilityReport } from './maintenance';
export type {
  OutboundDeliveryAttempt,
  OutboundDeliveryStatus,
  OutboundEndpointRecord,
  OutboundEndpointType,
} from './integrations';

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

export type {
  IdentityProfile,
  IdentityUser,
  WorkspaceIdentity,
  WorkspaceInvitation,
  WorkspaceMembership,
  WorkspaceRole,
  CreateInvitationInput,
  CreateInvitationResult,
} from './identity';
