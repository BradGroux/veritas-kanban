// Config Types

import type { AgentType, TaskPriority, TaskStatus } from './task.types.js';
import type { TelemetryConfig } from './telemetry.types.js';
import type { WatcherContinuationSettings } from './watcher-policy.types.js';
import type { SandboxPolicyPreset } from './sandbox-policy.types.js';
import type { AgentBudgetPolicy } from './agent-budget.types.js';
import type { AgentProfilePackage } from './agent-profile-package.types.js';
import type { TeamRosterManifest } from './team-roster.types.js';
import type { HarnessSupportProfile } from './provider-runtime.types.js';
import type {
  WorkspaceCapabilityManifest,
  WorkspaceDelegationRecord,
} from './workspace-capability.types.js';

export interface DevServerConfig {
  command: string; // e.g., "pnpm dev" or "npm run dev"
  port?: number; // Expected port (auto-detected if not specified)
  readyPattern?: string; // Regex pattern to detect when server is ready
}

export interface RepoConfig {
  name: string;
  path: string;
  defaultBranch: string;
  devServer?: DevServerConfig;
}

export interface AgentConfig {
  type: AgentType;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  provider?: AgentProvider;
  model?: string;
  sandboxPresetId?: string;
  budget?: AgentBudgetPolicy;
  /** System-normalized harness support contract. */
  supportProfile?: HarnessSupportProfile;
}

export type AgentProvider =
  | 'openclaw'
  | 'codex-cli'
  | 'codex-sdk'
  | 'codex-cloud'
  | 'hermes-cli'
  | 'ollama-local'
  | 'ollama-cloud'
  | 'lm-studio-local'
  | 'custom';

export const EXECUTABLE_AGENT_PROVIDERS = [
  'openclaw',
  'codex-cli',
  'codex-sdk',
  'hermes-cli',
] as const satisfies readonly AgentProvider[];

export type ExecutableAgentProvider = (typeof EXECUTABLE_AGENT_PROVIDERS)[number];

// ============ Agent Routing Types ============

/** Criteria for matching a task to a routing rule */
export interface RoutingMatchCriteria {
  type?: string | string[]; // Task type(s) — e.g. "code", "bug", "docs"
  priority?: TaskPriority | TaskPriority[]; // Task priority(ies)
  project?: string | string[]; // Project slug(s)
  /** Min subtask count to consider "complex" */
  minSubtasks?: number;
}

/** A single routing rule: match criteria → agent selection */
export interface RoutingRule {
  id: string; // Unique rule ID for CRUD
  name: string; // Human-readable name
  match: RoutingMatchCriteria; // Conditions to match
  agent: AgentType; // Primary agent to use
  model?: string; // Optional model override (e.g. "opus", "sonnet")
  fallback?: AgentType; // Fallback agent if primary fails
  enabled: boolean; // Can disable without deleting
}

/** Top-level routing configuration */
export interface AgentRoutingConfig {
  enabled: boolean; // Master toggle for routing engine
  rules: RoutingRule[]; // Ordered list — first match wins
  defaultAgent: AgentType; // Fallback when no rules match
  defaultModel?: string; // Default model for the default agent
  fallbackOnFailure: boolean; // Auto-retry with fallback on failure
  maxRetries: number; // Max retries before giving up (0-3)
}

/** Result from the routing engine */
export interface RoutingResult {
  agent: AgentType;
  model?: string;
  fallback?: AgentType;
  rule?: string; // ID of matched rule (undefined = default)
  reason: string; // Human-readable explanation
  runtimeSelection?: import('./provider-runtime.types.js').ProviderRuntimeSelection;
  runtimeCandidates?: import('./provider-runtime.types.js').ProviderRuntimeRouteCandidate[];
}

/** Default routing config */
export const DEFAULT_ROUTING_CONFIG: AgentRoutingConfig = {
  enabled: true,
  rules: [
    {
      id: 'code-high',
      name: 'High-priority code → OpenAI Codex',
      match: { type: 'code', priority: 'high' },
      agent: 'codex',
      fallback: 'claude-code',
      enabled: true,
    },
    {
      id: 'code-default',
      name: 'Code tasks → OpenAI Codex',
      match: { type: 'code' },
      agent: 'codex',
      fallback: 'amp',
      enabled: true,
    },
    {
      id: 'bug-high',
      name: 'High-priority bugs → OpenAI Codex',
      match: { type: 'bug', priority: 'high' },
      agent: 'codex',
      fallback: 'claude-code',
      enabled: true,
    },
    {
      id: 'docs',
      name: 'Documentation → OpenAI Codex',
      match: { type: 'docs' },
      agent: 'codex',
      enabled: true,
    },
    {
      id: 'review',
      name: 'Code review → OpenAI Codex',
      match: { type: 'review' },
      agent: 'codex',
      enabled: true,
    },
  ],
  defaultAgent: 'codex',
  fallbackOnFailure: true,
  maxRetries: 1,
};

// ============ Coolify Integration Types ============

/** Configuration for an individual Coolify-hosted service */
export interface CoolifyServiceConfig {
  url: string;
  apiKey?: string;
  /** Additional API URL (e.g., OpenPanel has separate dashboard + API URLs) */
  apiUrl?: string;
  /** Client ID for services that use client-based auth (e.g., OpenPanel) */
  clientId?: string;
}

/** All Coolify services that VK can integrate with */
export interface CoolifyServicesConfig {
  supabase?: CoolifyServiceConfig;
  openpanel?: CoolifyServiceConfig;
  n8n?: CoolifyServiceConfig;
  plane?: CoolifyServiceConfig;
  appsmith?: CoolifyServiceConfig;
}

/** Top-level Coolify configuration */
export interface CoolifyConfig {
  services: CoolifyServicesConfig;
}

export interface AppConfig {
  repos: RepoConfig[];
  agents: AgentConfig[];
  defaultAgent: AgentType;
  agentRouting?: AgentRoutingConfig;
  telemetry?: TelemetryConfig;
  features?: FeatureSettings;
  coolify?: CoolifyConfig;
  sandboxPolicyPresets?: SandboxPolicyPreset[];
  defaultSandboxPresetId?: string;
  agentProfiles?: AgentProfilePackage[];
  teamRoster?: TeamRosterManifest;
  workspaceCapability?: WorkspaceCapabilityManifest;
  trustedWorkspaceCapabilities?: WorkspaceCapabilityManifest[];
  workspaceDelegations?: WorkspaceDelegationRecord[];
}

// ============ Feature Settings Types ============

/** Individual dashboard widget visibility */
export interface DashboardWidgetSettings {
  showTokenUsage: boolean;
  showRunDuration: boolean;
  showAgentComparison: boolean;
  showStatusTimeline: boolean;
  showCostPerTask: boolean;
  showAgentUtilization: boolean;
  showWallTime: boolean;
  showSessionMetrics: boolean;
  showActivityClock: boolean;
  showWhereTimeWent: boolean;
  showHourlyActivity: boolean;
  showTrendsCharts: boolean;
}

/** General user settings */
export interface GeneralSettings {
  humanDisplayName: string; // Display name for human user in Squad Chat (default: "Human")
}

export type ProductModeId =
  | 'board-only'
  | 'agent-ready'
  | 'solo-coding'
  | 'pm-orchestration'
  | 'qa-review'
  | 'research'
  | 'operations'
  | 'advanced'
  | 'custom';

export interface ProductModeSettings {
  selectedMode: ProductModeId;
  lastSelectedAt?: string;
  dismissedHints: string[];
}

export interface BoardSavedViewFilters {
  search: string;
  project: string | null;
  type: string | null;
  agent: string | null;
}

export interface BoardSavedView {
  id: string;
  name: string;
  filters: BoardSavedViewFilters;
  createdAt: string;
  updatedAt: string;
}

export interface BoardColumnConfig {
  id: TaskStatus;
  title: string;
}

/** Board display settings */
export interface BoardSettings {
  columns: BoardColumnConfig[];
  defaultStatus: TaskStatus;
  showDashboard: boolean;
  showArchiveSuggestions: boolean;
  cardDensity: 'normal' | 'compact';
  showPriorityIndicators: boolean;
  showProjectBadges: boolean;
  showSprintBadges: boolean;
  enableDragAndDrop: boolean;
  showDoneMetrics: boolean;
  savedViews: BoardSavedView[];
  defaultSavedViewId: string | null;
  dashboardWidgets: DashboardWidgetSettings;
}

/** Task behavior settings */
export interface TaskBehaviorSettings {
  enableTimeTracking: boolean;
  enableSubtaskAutoComplete: boolean;
  enableDependencies: boolean;
  enableAttachments: boolean;
  attachmentMaxFileSize: number; // bytes
  attachmentMaxPerTask: number;
  attachmentMaxTotalSize: number; // bytes
  enableComments: boolean;
  defaultPriority: TaskPriority;
  autoSaveDelayMs: number; // Debounce delay for auto-save (ms), default 500
  requireDeliverableForDone: boolean; // If true, tasks can't move to 'done' without at least one deliverable
}

/** Markdown settings */
export interface MarkdownSettings {
  enableMarkdown: boolean;
  enableCodeHighlighting: boolean;
}

/** Agent & git settings */
export interface AgentBehaviorSettings {
  timeoutMinutes: number; // 5-480
  autoCommitOnComplete: boolean;
  autoCleanupWorktrees: boolean;
  enablePreview: boolean;
}

/** Telemetry & activity settings */
export interface TelemetryFeatureSettings {
  enabled: boolean;
  retentionDays: number; // 7-365
  enableTraces: boolean;
  enableActivityTracking: boolean;
}

/** Notification settings */
export interface NotificationSettings {
  enabled: boolean;
  onTaskComplete: boolean;
  onAgentFailure: boolean;
  onReviewNeeded: boolean;
  channel: string; // Teams channel ID
  webhookUrl?: string; // Optional: Teams webhook URL for immediate delivery
  webhookUrlConfigured?: boolean; // Response metadata when URL value is redacted
  webhookUrlRedacted?: boolean; // True when webhookUrl was omitted from a response
}

/** Archive settings */
export interface ArchiveSettings {
  autoArchiveEnabled: boolean;
  autoArchiveAfterDays: number;
}

/** Budget tracking settings */
export interface BudgetSettings {
  enabled: boolean;
  monthlyTokenLimit: number; // Monthly token budget (0 = no limit)
  monthlyCostLimit: number; // Monthly cost budget in dollars (0 = no limit)
  warningThreshold: number; // Percentage threshold for warning (0-100, default 80)
  defaultRunBudget?: AgentBudgetPolicy;
}

/** Structural enforcement toggles (all on by default). */
export interface EnforcementSettings {
  squadChat: boolean; // Auto-post task lifecycle events to squad chat
  reviewGate: boolean; // Require 4x10 review scores before completion
  closingComments: boolean; // Require deliverable summary in review comments before completion
  autoTelemetry: boolean; // Emit run.started/run.completed on status changes
  autoTimeTracking: boolean; // Auto-start/stop timers on status changes
  orchestratorDelegation: boolean; // Warn when orchestrator does implementation work instead of delegating
  orchestratorAgent?: string; // The designated orchestrator agent name (e.g. "veritas")
  ceremonyDesignReview: 'off' | 'warn' | 'block'; // Require design review ceremonies for risky/multi-agent tasks
  ceremonyFailureRetrospective: 'off' | 'warn' | 'block'; // Require retrospectives after blocked or failed runs
}

/** Individual hook configuration */
export interface HookConfig {
  enabled: boolean;
  webhook?: string; // URL to POST event payload
  webhookConfigured?: boolean; // Response metadata when webhook value is redacted
  webhookRedacted?: boolean; // True when webhook was omitted from a response
  notify?: boolean; // Send notification to configured channel
  logActivity?: boolean; // Record in activity log (default: true)
}

/** Task lifecycle hooks settings */
export interface HooksSettings {
  enabled: boolean;
  onCreated?: HookConfig;
  onStarted?: HookConfig;
  onBlocked?: HookConfig;
  onCompleted?: HookConfig;
  onArchived?: HookConfig;
}

/** Shared resources registry settings */
export interface SharedResourcesSettings {
  enabled: boolean;
  maxResources: number;
  allowedTypes: Array<'prompt' | 'guideline' | 'skill' | 'config' | 'template'>;
}

/** Documentation freshness tracking settings */
export interface DocFreshnessSettings {
  enabled: boolean;
  defaultMaxAgeDays: number;
  alertOnStale: boolean;
  autoCreateReviewTasks: boolean;
  staleScanIntervalHours: number;
}

/** Delegation settings — allow an agent to approve tasks temporarily */
export interface DelegationSettings {
  enabled: boolean;
  delegateAgent: string; // Agent ID that can approve
  expires: string; // ISO timestamp when delegation ends
  scope: DelegationScope;
  excludePriorities?: TaskPriority[]; // e.g., exclude 'critical'
  excludeTags?: string[]; // Exclude tasks with these tags
  createdAt: string;
  createdBy: string; // Who set up the delegation
}

export interface DelegationScope {
  type: 'all' | 'project' | 'priority';
  projectIds?: string[];
  priorities?: TaskPriority[];
}

/** Squad webhook settings */
export interface SquadWebhookSettings {
  enabled: boolean;
  mode: 'webhook' | 'openclaw'; // 'webhook' = generic HTTP POST, 'openclaw' = gateway wake
  // Generic webhook fields:
  url?: string; // Where to POST notifications
  urlConfigured?: boolean; // Response metadata when URL value is redacted
  urlRedacted?: boolean; // True when url was omitted from a response
  secret?: string; // Optional HMAC signing secret for verification
  secretConfigured?: boolean; // Response metadata for secret posture
  secretRedacted?: boolean; // True when secret was omitted from a response
  notifyOnHuman: boolean; // Fire webhook when human posts (default: true)
  notifyOnAgent: boolean; // Fire webhook when agent posts (default: false)
  // OpenClaw fields:
  openclawGatewayUrl?: string; // e.g., "http://127.0.0.1:18789"
  openclawGatewayUrlConfigured?: boolean; // Response metadata when URL value is redacted
  openclawGatewayUrlRedacted?: boolean; // True when openclawGatewayUrl was omitted from a response
  openclawGatewayToken?: string; // Auth token
  openclawGatewayTokenConfigured?: boolean; // Response metadata for token posture
  openclawGatewayTokenRedacted?: boolean; // True when token was omitted from a response
}

/** Watcher continuation policy settings. Disabled by default. */
export type { WatcherContinuationSettings } from './watcher-policy.types.js';

/** All feature settings combined */
export interface FeatureSettings {
  general: GeneralSettings;
  productMode: ProductModeSettings;
  board: BoardSettings;
  tasks: TaskBehaviorSettings;
  markdown: MarkdownSettings;
  agents: AgentBehaviorSettings;
  telemetry: TelemetryFeatureSettings;
  notifications: NotificationSettings;
  archive: ArchiveSettings;
  budget: BudgetSettings;
  enforcement: EnforcementSettings;
  hooks: HooksSettings;
  sharedResources: SharedResourcesSettings;
  docFreshness: DocFreshnessSettings;
  squadWebhook: SquadWebhookSettings;
  watcherContinuations: WatcherContinuationSettings;
}

/** Default feature settings — matches current app behavior */
export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  general: {
    humanDisplayName: 'Human',
  },
  productMode: {
    selectedMode: 'advanced',
    dismissedHints: [],
  },
  board: {
    columns: [
      { id: 'todo', title: 'To Do' },
      { id: 'in-progress', title: 'In Progress' },
      { id: 'blocked', title: 'Blocked' },
      { id: 'done', title: 'Done' },
    ],
    defaultStatus: 'todo',
    showDashboard: true,
    showArchiveSuggestions: true,
    cardDensity: 'normal',
    showPriorityIndicators: true,
    showProjectBadges: true,
    showSprintBadges: true,
    enableDragAndDrop: true,
    showDoneMetrics: true,
    savedViews: [],
    defaultSavedViewId: null,
    dashboardWidgets: {
      showTokenUsage: true,
      showRunDuration: true,
      showAgentComparison: true,
      showStatusTimeline: true,
      showCostPerTask: true,
      showAgentUtilization: true,
      showWallTime: true,
      showSessionMetrics: true,
      showActivityClock: true,
      showWhereTimeWent: true,
      showHourlyActivity: true,
      showTrendsCharts: true,
    },
  },
  tasks: {
    enableTimeTracking: true,
    enableSubtaskAutoComplete: true,
    enableDependencies: true,
    enableAttachments: true,
    attachmentMaxFileSize: 10 * 1024 * 1024, // 10MB
    attachmentMaxPerTask: 20,
    attachmentMaxTotalSize: 50 * 1024 * 1024, // 50MB
    enableComments: true,
    defaultPriority: 'medium',
    autoSaveDelayMs: 500,
    requireDeliverableForDone: false,
  },
  markdown: {
    enableMarkdown: true,
    enableCodeHighlighting: true,
  },
  agents: {
    timeoutMinutes: 30,
    autoCommitOnComplete: false,
    autoCleanupWorktrees: false,
    enablePreview: true,
  },
  telemetry: {
    enabled: true,
    retentionDays: 90,
    enableTraces: false,
    enableActivityTracking: true,
  },
  notifications: {
    enabled: false,
    onTaskComplete: true,
    onAgentFailure: true,
    onReviewNeeded: true,
    channel: '',
  },
  archive: {
    autoArchiveEnabled: false,
    autoArchiveAfterDays: 30,
  },
  budget: {
    enabled: true,
    monthlyTokenLimit: 0, // 0 = no limit
    monthlyCostLimit: 0, // 0 = no limit (dollars)
    warningThreshold: 80, // Warn at 80% of budget
    defaultRunBudget: {
      enabled: false,
      name: 'Workspace default run budget',
      scope: 'workspace',
      limits: {},
      softThresholdPercent: 80,
      hardAction: 'require-approval',
    },
  },
  enforcement: {
    squadChat: false,
    reviewGate: false,
    closingComments: false,
    autoTelemetry: false,
    autoTimeTracking: false,
    orchestratorDelegation: false,
    orchestratorAgent: '',
    ceremonyDesignReview: 'off',
    ceremonyFailureRetrospective: 'off',
  },
  hooks: {
    enabled: false, // Disabled by default
    // Individual hooks unconfigured by default
  },
  sharedResources: {
    enabled: false,
    maxResources: 250,
    allowedTypes: ['prompt', 'guideline', 'skill', 'config', 'template'],
  },
  docFreshness: {
    enabled: false,
    defaultMaxAgeDays: 30,
    alertOnStale: true,
    autoCreateReviewTasks: false,
    staleScanIntervalHours: 24,
  },
  squadWebhook: {
    enabled: false, // Disabled by default
    mode: 'webhook', // Default to generic webhook mode
    url: '',
    notifyOnHuman: true,
    notifyOnAgent: false,
    openclawGatewayUrl: '',
    openclawGatewayToken: '',
  },
  watcherContinuations: {
    enabled: false,
    globalKillSwitch: true,
    defaultMode: 'ask_always',
    maxContinuationsPerRun: 3,
    spendCapUsd: 5,
    riskClasses: [
      'destructive_command',
      'credential_reference',
      'recent_test_failure',
      'provider_error',
      'policy_violation',
    ],
    dispatchDenyPatterns: [],
    policies: [],
  },
};
