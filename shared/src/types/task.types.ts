// Task Types

export type TaskType = string;
export type TaskStatus = 'todo' | 'in-progress' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export type AgentType = 'claude-code' | 'amp' | 'copilot' | 'gemini' | 'veritas';
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

  // Blocked reason (why the task is in blocked status)
  blockedReason?: BlockedReason;

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
  blockedReason?: BlockedReason | null; // null to clear
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
