// Config Types

import type { AgentType, TaskPriority } from './task.types.js';
import type { TelemetryConfig } from './telemetry.types.js';

export interface DevServerConfig {
  command: string;      // e.g., "pnpm dev" or "npm run dev"
  port?: number;        // Expected port (auto-detected if not specified)
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
}

export interface AppConfig {
  repos: RepoConfig[];
  agents: AgentConfig[];
  defaultAgent: AgentType;
  telemetry?: TelemetryConfig;
  features?: FeatureSettings;
}

// ============ Feature Settings Types ============

/** Board display settings */
export interface BoardSettings {
  showDashboard: boolean;
  showArchiveSuggestions: boolean;
  cardDensity: 'normal' | 'compact';
  showPriorityIndicators: boolean;
  showProjectBadges: boolean;
  showSprintBadges: boolean;
  enableDragAndDrop: boolean;
}

/** Task behavior settings */
export interface TaskBehaviorSettings {
  enableTimeTracking: boolean;
  enableSubtaskAutoComplete: boolean;
  enableDependencies: boolean;
  enableAttachments: boolean;
  attachmentMaxFileSize: number;    // bytes
  attachmentMaxPerTask: number;
  attachmentMaxTotalSize: number;   // bytes
  enableComments: boolean;
  defaultPriority: TaskPriority;
}

/** Agent & git settings */
export interface AgentBehaviorSettings {
  timeoutMinutes: number;           // 5-480
  autoCommitOnComplete: boolean;
  autoCleanupWorktrees: boolean;
  enablePreview: boolean;
}

/** Telemetry & activity settings */
export interface TelemetryFeatureSettings {
  enabled: boolean;
  retentionDays: number;            // 7-365
  enableTraces: boolean;
  enableActivityTracking: boolean;
}

/** Notification settings */
export interface NotificationSettings {
  enabled: boolean;
  onTaskComplete: boolean;
  onAgentFailure: boolean;
  onReviewNeeded: boolean;
  channel: string;                  // Teams channel ID
  webhookUrl?: string;              // Optional: Teams webhook URL for immediate delivery
}

/** Archive settings */
export interface ArchiveSettings {
  autoArchiveEnabled: boolean;
  autoArchiveAfterDays: number;
}

/** All feature settings combined */
export interface FeatureSettings {
  board: BoardSettings;
  tasks: TaskBehaviorSettings;
  agents: AgentBehaviorSettings;
  telemetry: TelemetryFeatureSettings;
  notifications: NotificationSettings;
  archive: ArchiveSettings;
}

/** Default feature settings — matches current app behavior */
export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  board: {
    showDashboard: true,
    showArchiveSuggestions: true,
    cardDensity: 'normal',
    showPriorityIndicators: true,
    showProjectBadges: true,
    showSprintBadges: true,
    enableDragAndDrop: true,
  },
  tasks: {
    enableTimeTracking: true,
    enableSubtaskAutoComplete: true,
    enableDependencies: true,
    enableAttachments: true,
    attachmentMaxFileSize: 10 * 1024 * 1024,    // 10MB
    attachmentMaxPerTask: 20,
    attachmentMaxTotalSize: 50 * 1024 * 1024,   // 50MB
    enableComments: true,
    defaultPriority: 'medium',
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
};
