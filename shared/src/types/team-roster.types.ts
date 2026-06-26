import type { AgentType, TaskPriority, TaskType } from './task.types.js';

export type TeamRosterFormat = 'json' | 'yaml';
export type TeamRosterMemberStatus = 'enabled' | 'disabled';

export interface TeamRosterMember {
  id: string;
  displayName: string;
  role: string;
  agent: AgentType;
  profileId?: string;
  status: TeamRosterMemberStatus;
  capabilities: string[];
  defaultTaskTypes?: TaskType[];
  ownedPaths?: string[];
  projects?: string[];
  fallbackMemberId?: string;
  reviewerMemberIds?: string[];
}

export interface TeamRosterRouteMatch {
  type?: TaskType | TaskType[];
  priority?: TaskPriority | TaskPriority[];
  project?: string | string[];
  path?: string | string[];
  capability?: string | string[];
  minSubtasks?: number;
}

export interface TeamRosterRouteRule {
  id: string;
  name: string;
  enabled: boolean;
  match: TeamRosterRouteMatch;
  memberId: string;
  fallbackMemberId?: string;
  reviewerMemberIds?: string[];
  risk?: 'normal' | 'review' | 'security' | 'human';
}

export interface TeamRosterManifestMetadata {
  source?: string;
  importedAt?: string;
  updatedAt?: string;
}

export interface TeamRosterManifest {
  id: string;
  schemaVersion: 'team-roster/v1';
  workspaceId: string;
  name: string;
  description?: string;
  enabled: boolean;
  coordinatorMemberId?: string;
  members: TeamRosterMember[];
  routingRules: TeamRosterRouteRule[];
  metadata?: TeamRosterManifestMetadata;
}

export interface TeamRosterValidationIssue {
  path: string;
  message: string;
}

export interface TeamRosterValidationResult {
  valid: boolean;
  roster?: TeamRosterManifest;
  issues: TeamRosterValidationIssue[];
}

export interface TeamRosterExportResult {
  id: string;
  format: TeamRosterFormat;
  content: string;
}

export interface TeamRosterRoutePreviewInput {
  type?: TaskType;
  priority?: TaskPriority;
  project?: string;
  path?: string;
  capabilities?: string[];
  subtaskCount?: number;
}

export interface TeamRosterRoutePreview {
  matched: boolean;
  ruleId?: string;
  reason: string;
  member?: TeamRosterMember;
  fallbackMember?: TeamRosterMember;
  reviewerMembers: TeamRosterMember[];
  agent?: AgentType;
  profileId?: string;
  issues: TeamRosterValidationIssue[];
}
