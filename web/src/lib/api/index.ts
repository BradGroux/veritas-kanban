/**
 * API module barrel export.
 * Assembles the full `api` object and re-exports all types for backwards compatibility.
 */

// Import API sections
import { tasksApi } from './tasks';
import { backlogApi } from './backlog';
import { settingsApi, configApi } from './config';
import { agentApi, agentHostApi, registryApi, worktreeApi, previewApi } from './agent';
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
import { digestApi } from './digest';
import { scheduledDeliverablesApi } from './deliverables';
import { evidenceApi } from './evidence';
import { timeBreakdownsApi } from './time-breakdowns';
import { sandboxPoliciesApi } from './sandbox-policies';
import { runSessionsApi } from './run-sessions';
import { workspaceCapabilitiesApi } from './workspace-capabilities';
import { schedulerApi } from './scheduler';
import { queueMonitorsApi } from './queue-monitors';

// Assemble the full API object (matches original structure exactly)
export const api = {
  tasks: tasksApi,
  backlog: backlogApi,
  settings: settingsApi,
  config: configApi,
  worktree: worktreeApi,
  agent: agentApi,
  agentHosts: agentHostApi,
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
  digest: digestApi,
  scheduledDeliverables: scheduledDeliverablesApi,
  evidence: evidenceApi,
  timeBreakdowns: timeBreakdownsApi,
  sandboxPolicies: sandboxPoliciesApi,
  runSessions: runSessionsApi,
  workspaceCapabilities: workspaceCapabilitiesApi,
  scheduler: schedulerApi,
  queueMonitors: queueMonitorsApi,
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
export type {
  AgentOperationsApproval,
  AgentOperationsDigest,
  AgentOperationsDigestFilters,
  AgentOperationsDigestGroup,
  AgentOperationsFailure,
  AgentOperationsQueueMonitorActivity,
  AgentOperationsMarkdown,
  AgentOperationsSourceLink,
} from './digest';
export type {
  DeliverableRunStatus,
  DeliverableSchedule,
  ScheduledDeliverable,
  ScheduledDeliverableCreateInput,
  ScheduledDeliverableRun,
  ScheduledDeliverableRunInput,
  ScheduledDeliverableRunSnapshot,
} from './deliverables';
export type {
  EvidenceTimelineCitation,
  EvidenceTimelineEvent,
  EvidenceTimelineEventSource,
  EvidenceTimelineEventType,
  EvidenceTimelineFilters,
  EvidenceTimelineRecap,
  EvidenceTimelineResponse,
  EvidenceTimelineSourceLink,
} from './evidence';
export type {
  TimeBreakdownBlock,
  TimeBreakdownBlockKind,
  TimeBreakdownConfidence,
  TimeBreakdownFilters,
  TimeBreakdownGroup,
  TimeBreakdownPreset,
  TimeBreakdownResponse,
  TimeBreakdownSource,
  TimeBreakdownTotals,
} from './time-breakdowns';

// Re-export managed list helper
export { managedList } from './managed-list';

// Re-export all types from each module
export type { ArchiveSuggestion } from './tasks';
export type { BacklogListResponse, BacklogFilterOptions } from './backlog';
export type {
  CodexHealthStatus,
  ContextProviderBoundary,
  ContextProviderHealth,
  ContextProviderHealthResponse,
  ContextProviderPostureStatus,
  ContextProviderRisk,
  ContextProviderState,
} from './config';

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
  DecisionReviewSession,
  DecisionWithChain,
  DecisionListFilters,
  RunSessionEvent,
  RunSessionFork,
  RunSessionShare,
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
