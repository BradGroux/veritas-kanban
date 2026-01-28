// Task Types

export type TaskType = string;
export type TaskStatus = 'todo' | 'in-progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export type AgentType = 'claude-code' | 'amp' | 'copilot' | 'gemini' | 'veritas';
export type AttemptStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface TaskGit {
  repo: string;
  branch: string;
  baseBranch: string;
  worktreePath?: string;
  prUrl?: string;
  prNumber?: number;
}

export interface TaskAttempt {
  id: string;
  agent: AgentType;
  status: AttemptStatus;
  started?: string;
  ended?: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  created: string;
}

export interface TimeEntry {
  id: string;
  startTime: string;
  endTime?: string;       // Undefined if timer is running
  duration?: number;      // Duration in seconds (calculated when stopped)
  description?: string;   // Optional note for the entry
  manual?: boolean;       // True if manually entered
}

export interface TimeTracking {
  entries: TimeEntry[];
  totalSeconds: number;   // Total tracked time in seconds
  isRunning: boolean;     // Is timer currently running
  activeEntryId?: string; // ID of the currently running entry
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface Attachment {
  id: string;
  filename: string;          // Sanitized filename stored on disk
  originalName: string;      // Original filename from upload
  mimeType: string;
  size: number;              // File size in bytes
  uploaded: string;          // ISO timestamp
}

export interface AttachmentLimits {
  maxFileSize: number;       // Max size per file in bytes
  maxFilesPerTask: number;   // Max number of attachments per task
  maxTotalSize: number;      // Max total size for all attachments per task
}

// Default attachment limits
export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxFileSize: 10 * 1024 * 1024,      // 10MB per file
  maxFilesPerTask: 20,                 // 20 files per task
  maxTotalSize: 50 * 1024 * 1024,     // 50MB total per task
};

// Allowed MIME types for attachments
export const ALLOWED_MIME_TYPES = [
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  
  // Code & Config
  'application/json',
  'application/xml',
  'text/xml',
  'application/yaml',
  'text/yaml',
];

export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  project?: string;
  sprint?: string;
  created: string;
  updated: string;

  // Code task specific
  git?: TaskGit;

  // Current attempt
  attempt?: TaskAttempt;

  // Attempt history
  attempts?: TaskAttempt[];

  // Review comments (for code tasks)
  reviewComments?: ReviewComment[];

  // Review state
  review?: ReviewState;

  // Subtasks
  subtasks?: Subtask[];
  autoCompleteOnSubtasks?: boolean; // Auto-complete parent when all subtasks done

  // Dependencies
  blockedBy?: string[]; // Array of task IDs that block this task

  // Automation task specific (for veritas sub-agent)
  automation?: {
    sessionKey?: string;    // Clawdbot session key
    spawnedAt?: string;     // When sub-agent was spawned
    completedAt?: string;   // When sub-agent finished
    result?: string;        // Result summary from sub-agent
  };

  // Time tracking
  timeTracking?: TimeTracking;

  // Comments
  comments?: Comment[];

  // Attachments
  attachments?: Attachment[];

  // Position within column (for drag-and-drop ordering)
  position?: number;
}

export interface ReviewComment {
  id: string;
  file: string;
  line: number;
  content: string;
  created: string;
}

export type ReviewDecision = 'approved' | 'changes-requested' | 'rejected';

export interface ReviewState {
  decision?: ReviewDecision;
  decidedAt?: string;
  summary?: string;
}

// API Types

export interface CreateTaskInput {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  project?: string;
  sprint?: string;
  subtasks?: Subtask[];  // Can be provided when creating from a template
  blockedBy?: string[];  // Can be provided when creating from a blueprint
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  project?: string;
  sprint?: string;
  git?: Partial<TaskGit>;
  attempt?: TaskAttempt;
  reviewComments?: ReviewComment[];
  review?: ReviewState;
  subtasks?: Subtask[];
  autoCompleteOnSubtasks?: boolean;
  blockedBy?: string[];
  automation?: {
    sessionKey?: string;
    spawnedAt?: string;
    completedAt?: string;
    result?: string;
  };
  timeTracking?: TimeTracking;
  comments?: Comment[];
  attachments?: Attachment[];
  position?: number;
}

export interface TaskFilters {
  status?: TaskStatus | TaskStatus[];
  type?: TaskType | TaskType[];
  project?: string;
  search?: string;
}

// Config Types

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

// WebSocket Message Types

export type WSMessageType = 
  | 'agent:output'
  | 'agent:status'
  | 'agent:complete'
  | 'task:updated'
  | 'error';

export interface WSMessage {
  type: WSMessageType;
  taskId?: string;
  attemptId?: string;
  data: unknown;
  timestamp: string;
}

export interface AgentOutputMessage extends WSMessage {
  type: 'agent:output';
  data: {
    stream: 'stdout' | 'stderr';
    content: string;
  };
}

export interface AgentStatusMessage extends WSMessage {
  type: 'agent:status';
  data: {
    status: AttemptStatus;
    exitCode?: number;
  };
}

// ============ Telemetry Types ============

export type TelemetryEventType =
  | 'task.created'
  | 'task.status_changed'
  | 'task.archived'
  | 'task.restored'
  | 'run.started'
  | 'run.completed'
  | 'run.error'
  | 'run.tokens';

/** Base telemetry event - all events extend this */
export interface TelemetryEvent {
  id: string;
  type: TelemetryEventType;
  timestamp: string;
  taskId?: string;
  project?: string;
}

/** Task lifecycle events */
export interface TaskTelemetryEvent extends TelemetryEvent {
  type: 'task.created' | 'task.status_changed' | 'task.archived' | 'task.restored';
  taskId: string;
  status?: TaskStatus;
  previousStatus?: TaskStatus;
}

/** Agent run events */
export interface RunTelemetryEvent extends TelemetryEvent {
  type: 'run.started' | 'run.completed' | 'run.error';
  taskId: string;
  attemptId: string;
  agent: AgentType;
  durationMs?: number;
  exitCode?: number;
  success?: boolean;
  error?: string;
}

/** Token usage events */
export interface TokenTelemetryEvent extends TelemetryEvent {
  type: 'run.tokens';
  taskId: string;
  attemptId: string;
  agent: AgentType;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model?: string;
}

/** Union type for all telemetry events */
export type AnyTelemetryEvent = TaskTelemetryEvent | RunTelemetryEvent | TokenTelemetryEvent;

/** Telemetry configuration */
export interface TelemetryConfig {
  enabled: boolean;
  retention: number; // Days to retain events
  traces?: boolean;  // Optional trace collection (future)
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

/** Query options for fetching events */
export interface TelemetryQueryOptions {
  type?: TelemetryEventType | TelemetryEventType[];
  since?: string;  // ISO timestamp
  until?: string;  // ISO timestamp
  taskId?: string;
  project?: string;
  limit?: number;
}

// ============ Managed List Types ============

/** Base interface for managed list items */
export interface ManagedListItem {
  id: string;
  label: string;
  order: number;
  isDefault?: boolean;
  isHidden?: boolean;
  created: string;
  updated: string;
}

/** Configuration options for ManagedListService */
export interface ManagedListServiceOptions {
  filename: string;
  configDir: string;
  defaults: ManagedListItem[];
}

/** Task type configuration with icon and color */
export interface TaskTypeConfig extends ManagedListItem {
  icon: string;    // Lucide icon name (e.g., "Code", "Search")
  color?: string;  // Tailwind border color class (e.g., "border-l-violet-500")
}

/** Project configuration with description and badge color */
export interface ProjectConfig extends ManagedListItem {
  description?: string;
  color?: string;  // Tailwind bg color class for badges (e.g., "bg-blue-500/20")
}

/** Sprint configuration */
export interface SprintConfig extends ManagedListItem {
  description?: string;
}

// ============ Template Types ============

/** Subtask template for pre-defined subtask lists */
export interface SubtaskTemplate {
  title: string;              // Supports variables: "Review {{project}} PR"
  order: number;
}

/** Blueprint task for multi-task template creation */
export interface BlueprintTask {
  refId: string;              // Local reference for dependency wiring
  title: string;              // Supports variables
  taskDefaults: {
    type?: TaskType;
    priority?: TaskPriority;
    project?: string;
    descriptionTemplate?: string;
    agent?: AgentType;
  };
  subtaskTemplates?: SubtaskTemplate[];
  blockedByRefs?: string[];   // References to other BlueprintTask.refIds
}

/** Task template with enhanced features */
export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;          // Template category: "sprint", "bug", "feature", etc.
  version: number;            // Schema version for migration (0 = legacy, 1 = enhanced)

  taskDefaults: {
    type?: TaskType;
    priority?: TaskPriority;
    project?: string;
    descriptionTemplate?: string;
    agent?: AgentType;         // NEW in v1: preferred agent
  };

  // NEW in v1: Pre-defined subtasks
  subtaskTemplates?: SubtaskTemplate[];

  // NEW in v1: For multi-task blueprints
  blueprint?: BlueprintTask[];

  created: string;
  updated: string;
}

/** Input for creating a new template */
export interface CreateTemplateInput {
  name: string;
  description?: string;
  category?: string;
  taskDefaults: {
    type?: TaskType;
    priority?: TaskPriority;
    project?: string;
    descriptionTemplate?: string;
    agent?: AgentType;
  };
  subtaskTemplates?: SubtaskTemplate[];
  blueprint?: BlueprintTask[];
}

/** Input for updating an existing template */
export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  category?: string;
  taskDefaults?: {
    type?: TaskType;
    priority?: TaskPriority;
    project?: string;
    descriptionTemplate?: string;
    agent?: AgentType;
  };
  subtaskTemplates?: SubtaskTemplate[];
  blueprint?: BlueprintTask[];
}
