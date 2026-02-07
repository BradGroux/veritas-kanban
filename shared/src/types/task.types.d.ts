export type TaskType = string;
export type TaskStatus = 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
/** Built-in agent types. Custom agents use any string slug. */
export type BuiltInAgentType = 'claude-code' | 'amp' | 'copilot' | 'gemini' | 'veritas';
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
}
export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  created: string;
}
export interface VerificationStep {
  id: string;
  description: string;
  checked: boolean;
  checkedAt?: string;
}
export interface TimeEntry {
  id: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  description?: string;
  manual?: boolean;
}
export interface TimeTracking {
  entries: TimeEntry[];
  totalSeconds: number;
  isRunning: boolean;
  activeEntryId?: string;
}
export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}
export interface Attachment {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploaded: string;
}
export type DeliverableType = 'document' | 'code' | 'report' | 'artifact' | 'other';
export type DeliverableStatus = 'pending' | 'attached' | 'reviewed' | 'accepted';
export interface Deliverable {
  id: string;
  title: string;
  type: DeliverableType;
  path?: string;
  status: DeliverableStatus;
  agent?: string;
  created: string;
  description?: string;
}
export interface AttachmentLimits {
  maxFileSize: number;
  maxFilesPerTask: number;
  maxTotalSize: number;
}
export declare const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits;
export declare const ALLOWED_MIME_TYPES: string[];
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
  agent?: AgentType | 'auto';
  agents?: AgentType[];
  git?: TaskGit;
  github?: TaskGitHub;
  attempt?: TaskAttempt;
  attempts?: TaskAttempt[];
  reviewComments?: ReviewComment[];
  review?: ReviewState;
  subtasks?: Subtask[];
  autoCompleteOnSubtasks?: boolean;
  verificationSteps?: VerificationStep[];
  blockedBy?: string[];
  blockedReason?: BlockedReason;
  automation?: {
    sessionKey?: string;
    spawnedAt?: string;
    completedAt?: string;
    result?: string;
  };
  timeTracking?: TimeTracking;
  comments?: Comment[];
  attachments?: Attachment[];
  deliverables?: Deliverable[];
  position?: number;
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
  actualCost?: number;
  lessonsLearned?: string;
  lessonTags?: string[];
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
export interface CreateTaskInput {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  project?: string;
  sprint?: string;
  agent?: AgentType | 'auto';
  agents?: AgentType[];
  subtasks?: Subtask[];
  blockedBy?: string[];
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
  review?: ReviewState;
  subtasks?: Subtask[];
  autoCompleteOnSubtasks?: boolean;
  verificationSteps?: VerificationStep[];
  blockedBy?: string[];
  blockedReason?: BlockedReason | null;
  automation?: {
    sessionKey?: string;
    spawnedAt?: string;
    completedAt?: string;
    result?: string;
  };
  timeTracking?: TimeTracking;
  comments?: Comment[];
  attachments?: Attachment[];
  deliverables?: Deliverable[];
  position?: number;
  lessonsLearned?: string;
  lessonTags?: string[];
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
