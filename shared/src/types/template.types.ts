// Template Types

import type { TaskType, TaskPriority, AgentType } from './task.types.js';

/** Subtask template for pre-defined subtask lists */
export interface SubtaskTemplate {
  title: string; // Supports variables: "Review {{project}} PR"
  order: number;
  acceptanceCriteria?: string[]; // Supports variables in each criterion
}

/** Blueprint task for multi-task template creation */
export interface BlueprintTask {
  refId: string; // Local reference for dependency wiring
  title: string; // Supports variables
  taskDefaults: {
    type?: TaskType;
    priority?: TaskPriority;
    project?: string;
    descriptionTemplate?: string;
    agent?: AgentType;
  };
  subtaskTemplates?: SubtaskTemplate[];
  blockedByRefs?: string[]; // References to other BlueprintTask.refIds
}

export type TemplateReviewStatus = 'draft' | 'active' | 'archived';

export interface TemplateProvenanceLink {
  type: 'run' | 'workflow' | 'task' | 'issue' | 'timeline' | 'artifact';
  id: string;
  label?: string;
  url?: string;
  path?: string;
}

export interface LaunchTemplateSessionMetadata {
  agent?: AgentType;
  model?: string;
  provider?: string;
  hostId?: string;
  hostName?: string;
  cwd?: string;
  project?: string;
  sandbox?: string;
  mode?: 'fresh' | 'reuse';
  context?: 'minimal' | 'full' | 'custom';
  cleanup?: 'delete' | 'keep';
  timeout?: number;
  includeOutputsFrom?: string[];
}

export interface LaunchTemplateMetadata {
  status: TemplateReviewStatus;
  distilledFromRunId?: string;
  sourceWorkflowId?: string;
  sourceTaskId?: string;
  promptTemplate?: string;
  contextRequirements?: string[];
  session?: LaunchTemplateSessionMetadata;
  verificationGates?: string[];
  expectedArtifacts?: string[];
  knownGotchas?: string[];
  reasonCodes?: string[];
  confidence?: number;
  provenance?: TemplateProvenanceLink[];
  inheritsProjectDefaults?: boolean;
  reviewedAt?: string;
  reviewedBy?: string;
}

export type LaunchRecommendationKind = 'template' | 'agent' | 'model' | 'host';

export interface LaunchRecommendation {
  id: string;
  kind: LaunchRecommendationKind;
  label: string;
  detail: string;
  confidence: number;
  reasonCodes: string[];
  provenance: TemplateProvenanceLink[];
  templateId?: string;
  templateStatus?: TemplateReviewStatus;
  agent?: AgentType;
  model?: string;
  hostId?: string;
  hostName?: string;
  overrides?: Record<string, unknown>;
}

export interface LaunchRecommendationsResponse {
  generatedAt: string;
  context: {
    workflowId?: string;
    taskId?: string;
    project?: string;
    taskType?: string;
    cwd?: string;
    verificationGates: string[];
  };
  recommendations: LaunchRecommendation[];
}

export interface DistillTemplateFromRunInput {
  runId: string;
  name?: string;
}

/** Task template with enhanced features */
export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string; // Template category: "sprint", "bug", "feature", etc.
  version: number; // Schema version for migration (0 = legacy, 1 = enhanced)

  taskDefaults: {
    type?: TaskType;
    priority?: TaskPriority;
    project?: string;
    descriptionTemplate?: string;
    agent?: AgentType; // NEW in v1: preferred agent
  };

  // NEW in v1: Pre-defined subtasks
  subtaskTemplates?: SubtaskTemplate[];

  // NEW in v1: For multi-task blueprints
  blueprint?: BlueprintTask[];

  launch?: LaunchTemplateMetadata;

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
  launch?: LaunchTemplateMetadata;
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
  launch?: LaunchTemplateMetadata;
}
