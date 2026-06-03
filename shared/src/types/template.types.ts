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
