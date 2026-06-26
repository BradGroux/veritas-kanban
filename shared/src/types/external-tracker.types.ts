import type { Task, TaskPriority, TaskStatus, TaskType } from './task.types.js';

export type ExternalTrackerProvider = 'mock';

export type ExternalTrackerFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'identity'
  | 'picklist'
  | 'tags'
  | 'url';

export type ExternalTrackerPathKind = 'project' | 'area' | 'iteration' | 'team';

export type ExternalTrackerConnectionStatus = 'connected' | 'disconnected' | 'needs-auth';

export interface ExternalTrackerConnectionInput {
  provider: ExternalTrackerProvider;
  displayName?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  token?: string;
}

export interface ExternalTrackerConnectionRecord {
  provider: ExternalTrackerProvider;
  displayName: string;
  status: ExternalTrackerConnectionStatus;
  baseUrl?: string;
  organization?: string;
  project?: string;
  hasCredential: boolean;
  credentialRedacted: boolean;
  updatedAt: string;
  updatedBy?: string;
}

export interface ExternalTrackerWorkItemType {
  id: string;
  name: string;
  description?: string;
}

export interface ExternalTrackerField {
  id: string;
  name: string;
  type: ExternalTrackerFieldType;
  required: boolean;
  readOnly?: boolean;
  description?: string;
  allowedValues?: Array<string | number | boolean>;
  supportedWorkItemTypes?: string[];
}

export interface ExternalTrackerPlanningPath {
  id: string;
  name: string;
  path: string;
  kind: ExternalTrackerPathKind;
}

export interface ExternalTrackerSchema {
  provider: ExternalTrackerProvider;
  providerLabel: string;
  schemaVersion: string;
  introspectedAt: string;
  workItemTypes: ExternalTrackerWorkItemType[];
  fields: ExternalTrackerField[];
  projects: ExternalTrackerPlanningPath[];
  areaPaths: ExternalTrackerPlanningPath[];
  iterationPaths: ExternalTrackerPlanningPath[];
  teams: ExternalTrackerPlanningPath[];
  priorities: Array<string | number>;
  states: string[];
  tags: string[];
  assignees: string[];
  capabilities: {
    canCreate: boolean;
    canUpdate: boolean;
    requiresApproval: boolean;
    supportsDryRun: boolean;
  };
  connectionPosture: {
    status: ExternalTrackerConnectionStatus;
    hasCredential: boolean;
    credentialRedacted: boolean;
  };
}

export type VeritasTaskMappingField =
  | 'id'
  | 'title'
  | 'description'
  | 'type'
  | 'status'
  | 'priority'
  | 'project'
  | 'sprint'
  | 'github.url'
  | 'literal';

export interface ExternalTrackerFieldMapping {
  trackerFieldId: string;
  source: VeritasTaskMappingField;
  literalValue?: string;
  required?: boolean;
}

export interface ExternalTrackerValueMappings {
  priority?: Partial<Record<TaskPriority, string | number>>;
  status?: Partial<Record<TaskStatus, string>>;
  type?: Partial<Record<TaskType, string>>;
}

export interface ExternalTrackerMappingProfile {
  id: string;
  name: string;
  provider: ExternalTrackerProvider;
  enabled: boolean;
  workspaceId?: string;
  project?: string;
  defaultWorkItemType: string;
  defaultProjectPath?: string;
  defaultAreaPath?: string;
  defaultTeamPath?: string;
  defaultIterationPath?: string;
  fieldMappings: ExternalTrackerFieldMapping[];
  valueMappings?: ExternalTrackerValueMappings;
  backlinkFieldId?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface ExternalTrackerMappingProfileInput {
  id?: string;
  name: string;
  provider: ExternalTrackerProvider;
  enabled?: boolean;
  workspaceId?: string;
  project?: string;
  defaultWorkItemType: string;
  defaultProjectPath?: string;
  defaultAreaPath?: string;
  defaultTeamPath?: string;
  defaultIterationPath?: string;
  fieldMappings: ExternalTrackerFieldMapping[];
  valueMappings?: ExternalTrackerValueMappings;
  backlinkFieldId?: string;
}

export interface ExternalTrackerValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  fieldId?: string;
  path?: string;
}

export interface ExternalTrackerValidationResult {
  valid: boolean;
  errors: ExternalTrackerValidationIssue[];
  warnings: ExternalTrackerValidationIssue[];
}

export interface ExternalTrackerMappedPayload {
  provider: ExternalTrackerProvider;
  workItemType: string;
  projectPath?: string;
  areaPath?: string;
  teamPath?: string;
  iterationPath?: string;
  fields: Record<string, string | number | boolean | string[] | null>;
  backlinkUrl: string;
}

export interface ExternalTrackerDryRunCreateInput {
  profileId: string;
  taskId?: string;
  task?: Task;
}

export interface ExternalTrackerDryRunCreateResult {
  externalWrite: false;
  profile: ExternalTrackerMappingProfile;
  schema: ExternalTrackerSchema;
  payload: ExternalTrackerMappedPayload;
  validation: ExternalTrackerValidationResult;
}

export interface ExternalWorkItemLink {
  id: string;
  provider: ExternalTrackerProvider;
  profileId: string;
  externalId: string;
  externalUrl: string;
  workItemType: string;
  status: string;
  title: string;
  backlinkUrl: string;
  createdAt: string;
  createdBy: string;
  lastSyncAt?: string;
}

export interface ExternalTrackerCreateWorkItemInput extends ExternalTrackerDryRunCreateInput {
  approvedBy: string;
}

export interface ExternalTrackerCreateWorkItemResult {
  externalWrite: true;
  link: ExternalWorkItemLink;
  profile: ExternalTrackerMappingProfile;
  schema: ExternalTrackerSchema;
  payload: ExternalTrackerMappedPayload;
  validation: ExternalTrackerValidationResult;
}

export interface ExternalTrackerSyncAudit {
  id: string;
  provider: ExternalTrackerProvider;
  profileId: string;
  operation: 'dry-run-create' | 'create' | 'validate';
  status: 'success' | 'failed' | 'blocked';
  taskId?: string;
  externalId?: string;
  workItemType?: string;
  validation: ExternalTrackerValidationResult;
  actor: string;
  createdAt: string;
}
