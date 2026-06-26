import type { TaskPriority } from './task.types.js';

export type CeremonyKind = 'design_review' | 'failure_retrospective';
export type CeremonyStatus = 'pending' | 'completed' | 'cancelled';
export type CeremonyEnforcementMode = 'off' | 'warn' | 'block';
export type CeremonyParticipantRole =
  | 'coordinator'
  | 'implementer'
  | 'reviewer'
  | 'security-owner'
  | 'qa-owner'
  | 'human-approver';
export type CeremonyArtifactKind =
  | 'decision-packet'
  | 'risk-list'
  | 'retrospective'
  | 'action-items'
  | 'github-issues';

export interface CeremonyTarget {
  taskId?: string;
  runId?: string;
  workflowId?: string;
  prUrl?: string;
  ciUrl?: string;
}

export interface CeremonyParticipant {
  role: CeremonyParticipantRole;
  name?: string;
  agent?: string;
}

export interface CeremonyArtifact {
  kind: CeremonyArtifactKind;
  title: string;
  body: string;
  url?: string;
  createdAt: string;
}

export interface CeremonyActionItem {
  title: string;
  assignee?: string;
  priority?: TaskPriority;
  dueAt?: string;
  taskId?: string;
  issueUrl?: string;
  createdAt: string;
}

export interface CeremonyRequirement {
  id: string;
  kind: CeremonyKind;
  status: CeremonyStatus;
  enforcementMode: CeremonyEnforcementMode;
  title: string;
  reason: string;
  target: CeremonyTarget;
  trigger: string;
  dueAt?: string;
  participants: CeremonyParticipant[];
  requiredArtifacts: CeremonyArtifactKind[];
  artifacts: CeremonyArtifact[];
  actionItems: CeremonyActionItem[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedBy?: string;
}

export interface CreateCeremonyRequirementInput {
  kind: CeremonyKind;
  enforcementMode?: CeremonyEnforcementMode;
  title?: string;
  reason: string;
  target: CeremonyTarget;
  trigger: string;
  dueAt?: string;
  participants?: CeremonyParticipant[];
  requiredArtifacts?: CeremonyArtifactKind[];
}

export interface CompleteCeremonyRequirementInput {
  completedBy: string;
  artifacts?: Array<Omit<CeremonyArtifact, 'createdAt'> & { createdAt?: string }>;
  actionItems?: Array<Omit<CeremonyActionItem, 'createdAt'> & { createdAt?: string }>;
}

export interface CeremonyEvaluationResult {
  allowed: boolean;
  mode: CeremonyEnforcementMode;
  pending: CeremonyRequirement[];
  warnings: string[];
  blockedReasons: string[];
}
