// Task Types

export type TaskType = string;
export type TaskStatus = 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

/** Run mode controls the review/QA strategy for a task. */
export type RunMode = 'strategy' | 'eng-review' | 'paranoid-review' | 'qa';

/** QA gate state — tracks whether a QA review is required and whether it has passed. */
export interface QaGateState {
  required: boolean;
  passed: boolean;
  passedAt?: string; // ISO timestamp when QA was approved
  passedBy?: string; // Who approved (e.g. 'human', agent slug, user name)
}
/** Built-in agent types. Custom agents use any string slug. */
export type BuiltInAgentType = 'claude-code' | 'amp' | 'copilot' | 'gemini' | 'codex' | 'veritas';
export type AgentType = BuiltInAgentType | (string & {});
export type AttemptStatus = 'pending' | 'running' | 'complete' | 'failed';
export type BlockedCategory = 'waiting-on-feedback' | 'technical-snag' | 'prerequisite' | 'other';

export interface BlockedReason {
  category: BlockedCategory;
  note?: string;
}

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
  provider?: string;
  model?: string;
  threadId?: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  created: string;
  acceptanceCriteria?: string[];
  criteriaChecked?: boolean[];
}

export interface VerificationStep {
  id: string;
  description: string;
  checked: boolean;
  checkedAt?: string; // ISO timestamp when checked
}

export interface TimeEntry {
  id: string;
  startTime: string;
  endTime?: string; // Undefined if timer is running
  duration?: number; // Duration in seconds (calculated when stopped)
  description?: string; // Optional note for the entry
  manual?: boolean; // True if manually entered
}

export interface TimeTracking {
  entries: TimeEntry[];
  totalSeconds: number; // Total tracked time in seconds
  isRunning: boolean; // Is timer currently running
  activeEntryId?: string; // ID of the currently running entry
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export type ObservationType = 'decision' | 'blocker' | 'insight' | 'context';

export interface Observation {
  id: string;
  type: ObservationType;
  content: string;
  score: number; // 1-10 importance
  timestamp: string;
  agent?: string; // Which agent recorded this
}

export interface Attachment {
  id: string;
  filename: string; // Sanitized filename stored on disk
  originalName: string; // Original filename from upload
  mimeType: string;
  size: number; // File size in bytes
  uploaded: string; // ISO timestamp
}

export type DeliverableType = 'document' | 'code' | 'report' | 'artifact' | 'other';
export type DeliverableStatus = 'pending' | 'attached' | 'reviewed' | 'accepted';

export interface Deliverable {
  id: string;
  title: string;
  type: DeliverableType;
  path?: string; // File path or URL
  status: DeliverableStatus;
  agent?: string; // Who produced it
  created: string; // ISO timestamp
  description?: string;
}

export interface AttachmentLimits {
  maxFileSize: number; // Max size per file in bytes
  maxFilesPerTask: number; // Max number of attachments per task
  maxTotalSize: number; // Max total size for all attachments per task
}

// Default attachment limits
export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxFileSize: 10 * 1024 * 1024, // 10MB per file
  maxFilesPerTask: 20, // 20 files per task
  maxTotalSize: 50 * 1024 * 1024, // 50MB total per task
};

// Allowed MIME types for attachments
export const ALLOWED_MIME_TYPES = [
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

/** Cross-reference linking a kanban task to a GitHub Issue */
export interface TaskGitHub {
  issueNumber: number;
  repo: string;
}

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

  // Agent assignment — "auto" uses routing engine, or a specific agent slug
  agent?: AgentType | 'auto';
  // Multi-agent assignment — multiple agents collaborating on a task
  agents?: AgentType[];

  // Code task specific
  git?: TaskGit;

  // GitHub Issue cross-reference
  github?: TaskGitHub;

  // Current attempt
  attempt?: TaskAttempt;

  // Attempt history
  attempts?: TaskAttempt[];

  // Review comments (for code tasks)
  reviewComments?: ReviewComment[];

  // Review scores (4x10 gate)
  reviewScores?: [number, number, number, number];

  // Review state
  review?: ReviewState;

  // Subtasks
  subtasks?: Subtask[];
  autoCompleteOnSubtasks?: boolean; // Auto-complete parent when all subtasks done

  // Verification checklist (done criteria)
  verificationSteps?: VerificationStep[];

  // Dependencies (new bidirectional graph)
  dependencies?: {
    depends_on?: string[]; // task IDs this task depends on
    blocks?: string[]; // task IDs this task blocks
  };

  // Legacy blockedBy field (kept for backward compatibility)
  blockedBy?: string[]; // Array of task IDs that block this task

  // Blocked reason (why the task is in blocked status)
  blockedReason?: BlockedReason;

  // Automation task specific (for veritas sub-agent)
  automation?: {
    sessionKey?: string; // Clawdbot session key
    spawnedAt?: string; // When sub-agent was spawned
    completedAt?: string; // When sub-agent finished
    result?: string; // Result summary from sub-agent
  };

  // Time tracking
  timeTracking?: TimeTracking;

  // Comments
  comments?: Comment[];

  // Observations (task context, decisions, blockers, insights)
  observations?: Observation[];

  // Attachments
  attachments?: Attachment[];

  // Deliverables
  deliverables?: Deliverable[];

  // Position within column (for drag-and-drop ordering)
  position?: number;

  // Cost prediction and tracking
  costPrediction?: {
    estimatedCost: number;
    confidence: 'low' | 'medium' | 'high';
    sampleSize: number;
    factors: {
      baseCost: number;
      typeMultiplier: number;
      priorityMultiplier: number;
      complexityMultiplier: number;
      projectAdjustment: number;
    };
    predictedAt: string;
  };
  actualCost?: number; // Actual cost after completion (from telemetry)

  // Lessons learned (captured after task completion)
  lessonsLearned?: string; // Markdown content
  lessonTags?: string[]; // Categorization tags

  // Crash-recovery checkpointing (for sub-agents)
  checkpoint?: {
    step: number; // Which step the agent was on
    state: Record<string, any>; // Agent state (sanitized — no secrets)
    timestamp: string; // ISO timestamp when checkpoint was saved
    resumeCount?: number; // How many times this task has been resumed
  };

  // Run mode — controls the review/QA strategy for the task
  runMode?: RunMode | null;

  // QA gate — requires a QA pass before the task can move to Done
  qaGate?: QaGateState | null;
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
  agent?: AgentType | 'auto'; // Pre-assign an agent (or "auto" for routing engine)
  agents?: AgentType[]; // Multi-agent assignment
  subtasks?: Subtask[]; // Can be provided when creating from a template
  blockedBy?: string[]; // Can be provided when creating from a blueprint
  reviewScores?: [number, number, number, number]; // Optional 4x10 scores
  reviewComments?: ReviewComment[]; // Optional review comments
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  project?: string;
  sprint?: string;
  agent?: AgentType | 'auto';
  agents?: AgentType[];
  git?: Partial<TaskGit>;
  github?: TaskGitHub;
  attempt?: TaskAttempt;
  reviewComments?: ReviewComment[];
  reviewScores?: [number, number, number, number];
  review?: ReviewState;
  subtasks?: Subtask[];
  autoCompleteOnSubtasks?: boolean;
  verificationSteps?: VerificationStep[];
  dependencies?: {
    depends_on?: string[];
    blocks?: string[];
  };
  blockedBy?: string[];
  blockedReason?: BlockedReason | null; // null to clear
  automation?: {
    sessionKey?: string;
    spawnedAt?: string;
    completedAt?: string;
    result?: string;
  };
  timeTracking?: TimeTracking;
  comments?: Comment[];
  observations?: Observation[];
  attachments?: Attachment[];
  deliverables?: Deliverable[];
  position?: number;
  lessonsLearned?: string;
  lessonTags?: string[];
  checkpoint?: {
    step: number;
    state: Record<string, any>;
    timestamp: string;
    resumeCount?: number;
  };
  runMode?: RunMode | null;
  qaGate?: QaGateState | null;
}

export interface TaskFilters {
  status?: TaskStatus | TaskStatus[];
  type?: TaskType | TaskType[];
  project?: string;
  search?: string;
}

/**
 * Lightweight task representation for board/list views.
 * Returned when `?view=summary` is used on GET /api/tasks.
 */
export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  project?: string;
  sprint?: string;
  agent?: AgentType | 'auto';
  created: string;
  updated: string;
  subtasks?: Subtask[];
  verificationSteps?: VerificationStep[];
  dependencies?: {
    depends_on?: string[];
    blocks?: string[];
  };
  blockedBy?: string[];
  blockedReason?: BlockedReason;
  position?: number;
  attachmentCount?: number;
  deliverableCount?: number;
  github?: TaskGitHub;
  timeTracking?: {
    totalSeconds: number;
    isRunning: boolean;
  };
  attempt?: TaskAttempt;
  checkpoint?: {
    step: number;
    timestamp: string;
    resumeCount?: number;
  };
}

/**
 * Paginated response envelope for GET /api/tasks.
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
