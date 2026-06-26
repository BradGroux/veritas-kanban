import type { TaskPriority, TaskStatus, TaskType } from './task.types.js';

export type WorkspaceCapabilityFormat = 'json' | 'yaml';
export type WorkspaceDelegationTargetType = 'task' | 'github-issue';
export type WorkspaceDelegationStatus = 'created' | 'linked' | 'blocked' | 'closed';

export interface WorkspaceCapabilityDescriptor {
  id: string;
  name: string;
  description?: string;
  acceptedTaskTypes: TaskType[];
  defaultLabels?: string[];
  defaultProject?: string;
  defaultPriority?: TaskPriority;
  defaultTaskType?: TaskType;
  triageOwner?: string;
  requiredContextFields?: string[];
  intakeTargets?: WorkspaceDelegationTargetType[];
}

export interface WorkspaceCapabilityContact {
  label?: string;
  url?: string;
  email?: string;
}

export interface WorkspaceCapabilityManifestMetadata {
  source?: string;
  importedAt?: string;
  updatedAt?: string;
}

export interface WorkspaceCapabilityManifest {
  id: string;
  schemaVersion: 'workspace-capability/v1';
  workspaceId: string;
  name: string;
  description?: string;
  boardUrl?: string;
  repositoryUrl?: string;
  safeContact?: WorkspaceCapabilityContact;
  enabled: boolean;
  capabilities: WorkspaceCapabilityDescriptor[];
  defaultLabels?: string[];
  defaultProject?: string;
  defaultPriority?: TaskPriority;
  triageOwner?: string;
  trustedSourceWorkspaceIds?: string[];
  metadata?: WorkspaceCapabilityManifestMetadata;
}

export interface WorkspaceCapabilityValidationIssue {
  path: string;
  message: string;
}

export interface WorkspaceCapabilityValidationResult {
  valid: boolean;
  manifest?: WorkspaceCapabilityManifest;
  issues: WorkspaceCapabilityValidationIssue[];
}

export interface WorkspaceCapabilityExportResult {
  id: string;
  format: WorkspaceCapabilityFormat;
  content: string;
}

export interface WorkspaceCapabilityRegistrationResult {
  manifest: WorkspaceCapabilityManifest;
  created: boolean;
}

export interface WorkspaceCapabilityDiscoveryResult {
  local: WorkspaceCapabilityManifest | null;
  trusted: WorkspaceCapabilityManifest[];
}

export interface WorkspaceDelegationSource {
  workspaceId: string;
  workspaceName?: string;
  taskId?: string;
  taskUrl?: string;
  repository?: string;
  issueUrl?: string;
}

export interface WorkspaceDelegatedWorkTarget {
  type: WorkspaceDelegationTargetType;
  workspaceId: string;
  workspaceName?: string;
  taskId?: string;
  issueNumber?: number;
  url?: string;
}

export interface TaskDelegatedWorkLink {
  id: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  targetType: WorkspaceDelegationTargetType;
  capabilityId: string;
  targetId?: string;
  targetUrl?: string;
  status: WorkspaceDelegationStatus;
  latestState?: TaskStatus | string;
  requestedAt: string;
  updatedAt: string;
}

export interface WorkspaceDelegationRecord {
  id: string;
  capabilityId: string;
  title: string;
  status: WorkspaceDelegationStatus;
  latestState?: TaskStatus | string;
  labels: string[];
  source: WorkspaceDelegationSource;
  target: WorkspaceDelegatedWorkTarget;
  requestedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDelegatedWorkIntakeInput {
  source: WorkspaceDelegationSource;
  capabilityId: string;
  title: string;
  context: string;
  contextFields?: Record<string, string>;
  labels?: string[];
  priority?: TaskPriority;
  project?: string;
  type?: TaskType;
  requestedBy?: string;
  backlinkUrl?: string;
  createAs?: WorkspaceDelegationTargetType;
}

export interface WorkspaceDelegatedWorkIntakeResult {
  record: WorkspaceDelegationRecord;
  taskId?: string;
  taskUrl?: string;
}
