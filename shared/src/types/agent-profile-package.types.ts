import type { AgentBudgetPolicy } from './agent-budget.types.js';
import type { AgentProvider, AgentConfig } from './config.types.js';
import type { AgentType, TaskType } from './task.types.js';

export type AgentProfilePackageFormat = 'json' | 'yaml';

export type AgentProfilePermissionLevel = 'intern' | 'specialist' | 'lead';

export interface AgentProfileRuntime {
  agent: AgentType;
  provider?: AgentProvider;
  model?: string;
  fallbackAgent?: AgentType;
}

export interface AgentProfileInstructions {
  prompt?: string;
  promptFile?: string;
  files?: string[];
}

export interface AgentProfileTools {
  allowed?: string[];
  mcpServers?: string[];
}

export interface AgentProfilePermissions {
  level?: AgentProfilePermissionLevel;
  required?: string[];
}

export interface AgentProfilePolicyBundle {
  sandboxPresetId?: string;
  budget?: AgentBudgetPolicy;
  toolPolicyIds?: string[];
}

export interface AgentProfileWorkflowEntrypoint {
  id?: string;
  entrypoint?: string;
}

export interface AgentProfileHealthCheck {
  id: string;
  label: string;
  command?: string;
  required?: boolean;
}

export interface AgentProfileHealth {
  checks?: AgentProfileHealthCheck[];
  readiness?: string[];
}

export interface AgentProfilePackageMetadata {
  source?: string;
  importedAt?: string;
  updatedAt?: string;
}

export interface AgentProfilePackage {
  id: string;
  schemaVersion: 'agent-profile-package/v1';
  version: string;
  displayName: string;
  role: string;
  description?: string;
  enabled: boolean;
  capabilities: string[];
  defaultTaskTypes: TaskType[];
  runtime: AgentProfileRuntime;
  instructions?: AgentProfileInstructions;
  tools?: AgentProfileTools;
  permissions?: AgentProfilePermissions;
  policy?: AgentProfilePolicyBundle;
  workflow?: AgentProfileWorkflowEntrypoint;
  health?: AgentProfileHealth;
  metadata?: AgentProfilePackageMetadata;
}

export interface AgentProfilePackageSummary {
  id: string;
  version: string;
  displayName: string;
  role: string;
  description?: string;
  enabled: boolean;
  capabilities: string[];
  defaultTaskTypes: TaskType[];
  runtime: AgentProfileRuntime;
  policy?: AgentProfilePolicyBundle;
  workflow?: AgentProfileWorkflowEntrypoint;
  metadata?: AgentProfilePackageMetadata;
}

export interface AgentProfileValidationIssue {
  path: string;
  message: string;
}

export interface AgentProfileValidationResult {
  valid: boolean;
  profile?: AgentProfilePackage;
  issues: AgentProfileValidationIssue[];
}

export interface AgentProfileExportResult {
  id: string;
  format: AgentProfilePackageFormat;
  content: string;
}

export interface AgentProfileLaunchMetadata {
  id: string;
  displayName: string;
  version: string;
  role: string;
  capabilities: string[];
  defaultTaskTypes: TaskType[];
  agent: AgentType;
  provider?: AgentProvider;
  model?: string;
  sandboxPresetId?: string;
  workflowId?: string;
}

export interface AgentProfileResolvedLaunch {
  profile: AgentProfilePackage;
  agentConfig?: AgentConfig;
  agent: AgentType;
  model?: string;
  sandboxPresetId?: string;
  budget?: AgentBudgetPolicy;
  instructions?: string;
  metadata: AgentProfileLaunchMetadata;
}
