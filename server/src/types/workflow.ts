/**
 * Workflow Engine Types — Veritas Kanban v3.0
 * Phase 1: Core Engine
 *
 * Architecture: /Users/bradgroux/Projects/veritas-kanban/docs/WORKFLOW_ENGINE_ARCHITECTURE.md
 */

// ==================== Workflow Definition Types ====================

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  description: string;
  config?: WorkflowConfig;
  agents: WorkflowAgent[];
  steps: WorkflowStep[];
  variables?: Record<string, unknown>;
  schemas?: Record<string, unknown>;
}

export interface WorkflowConfig {
  timeout?: number; // seconds
  fresh_session_default?: boolean;
  progress_file?: string;
  telemetry_tags?: string[];
}

export interface WorkflowAgent {
  id: string;
  name: string;
  role: string; // maps to toolPolicy
  model?: string; // default model for this agent
  description: string;
  tools?: string[]; // Phase 2: Tool restrictions (#110)
}

export type StepType = 'agent' | 'loop' | 'gate' | 'parallel';

export interface WorkflowStep {
  id: string;
  name: string;
  agent?: string; // agent ID (required for type=agent|loop)
  type: StepType;
  fresh_session?: boolean;
  session?: 'fresh' | 'reuse'; // Phase 2: Session management (#111)
  input?: string; // Jinja2 template
  output?: StepOutput;
  acceptance_criteria?: string[];
  on_fail?: FailurePolicy;
  timeout?: number;

  // Loop-specific config
  loop?: LoopConfig;

  // Gate-specific config
  condition?: string; // Jinja2 expression evaluating to boolean
  on_false?: EscalationPolicy;
}

export interface StepOutput {
  file: string; // Filename in step-outputs/
  schema?: string; // Schema ID for validation
}

export interface FailurePolicy {
  retry?: number;
  retry_delay_ms?: number; // Phase 2: Delay between retries (#113)
  retry_step?: string; // Retry a different step ID
  escalate_to?: 'human' | `agent:${string}` | 'skip';
  escalate_message?: string;
  on_exhausted?: EscalationPolicy;
}

export interface EscalationPolicy {
  escalate_to: 'human' | `agent:${string}` | 'skip';
  escalate_message?: string;
}

export interface LoopConfig {
  over: string; // Jinja2 expression returning array
  item_var?: string; // Variable name for current item (default: "item")
  index_var?: string; // Variable name for loop index (default: "index")
  completion: 'all_done' | 'any_done' | 'first_success';
  fresh_session_per_iteration?: boolean;
  verify_each?: boolean;
  verify_step?: string; // Step ID to run after each iteration
  max_iterations?: number;
}

// ==================== Workflow Run Types ====================

export type WorkflowRunStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';
export type StepRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowRun {
  id: string; // run_<timestamp>_<nanoid>
  workflowId: string;
  workflowVersion: number;
  taskId?: string; // Optional task association
  status: WorkflowRunStatus;
  currentStep?: string; // Current step ID
  context: Record<string, unknown>; // Shared context across steps
  startedAt: string;
  completedAt?: string;
  lastCheckpoint?: string; // Phase 2: Last state persistence timestamp (#113)
  error?: string;
  steps: StepRun[];
}

export interface StepRun {
  stepId: string;
  status: StepRunStatus;
  agent?: string;
  sessionKey?: string; // OpenClaw session key
  startedAt?: string;
  completedAt?: string;
  duration?: number; // seconds
  retries: number;
  output?: string; // Path to output file
  error?: string;

  // Loop-specific state
  loopState?: {
    totalIterations: number;
    currentIteration: number;
    completedIterations: number;
    failedIterations: number;
  };
}

// ==================== Step Execution Types ====================

export interface StepExecutionResult {
  output: unknown; // Parsed output (for context passing)
  outputPath: string; // Path to output file
}

// ==================== RBAC & Audit Types ====================

export type WorkflowPermission = 'view' | 'create' | 'edit' | 'delete' | 'execute';

export interface WorkflowACL {
  workflowId: string;
  owner: string; // User ID or 'system'
  editors: string[]; // Users who can edit
  viewers: string[]; // Users who can view
  executors: string[]; // Users who can trigger runs
  isPublic: boolean; // Anyone can view/execute
}

export interface WorkflowAuditEvent {
  timestamp: string;
  userId: string;
  action: 'create' | 'edit' | 'delete' | 'run';
  workflowId: string;
  workflowVersion?: number;
  changes?: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
  runId?: string;
}

// ==================== Validation Error Types ====================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
