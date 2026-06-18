import type { AgentType, AttemptStatus, TaskPriority } from './task.types.js';

export type RunSessionPermission = 'view' | 'edit' | 'fork';
export type RunSessionShareStatus = 'active' | 'revoked' | 'expired';
export type RunSessionSourceType = 'task-agent' | 'workflow-run';
export type RunSessionEventType =
  | 'share.created'
  | 'share.updated'
  | 'share.revoked'
  | 'message.sent'
  | 'approval.responded'
  | 'fork.created';

export interface RunSessionActor {
  id: string;
  label?: string;
  type?: 'user' | 'agent' | 'service' | 'device' | 'localhost-bypass';
  authMethod?: string;
  clientMode?: string;
  workspaceId?: string;
}

export interface RunSessionSnapshot {
  running: boolean;
  taskTitle?: string;
  attemptId?: string;
  attemptStatus?: AttemptStatus;
  agent?: AgentType;
  provider?: string;
  model?: string;
  startedAt?: string;
  worktreePath?: string;
  changedFiles?: number;
  artifactCount?: number;
  blocker?: string;
}

export interface RunSessionShare {
  id: string;
  workspaceId: string;
  taskId: string;
  sourceType: RunSessionSourceType;
  sourceId: string;
  permission: RunSessionPermission;
  status: RunSessionShareStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: RunSessionActor;
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: RunSessionActor;
  revokedReason?: string;
  actorLabel?: string;
  stablePath: string;
  mobileSafeApprovalClasses: string[];
  snapshot: RunSessionSnapshot;
  forkedTaskIds: string[];
}

export interface CreateRunSessionShareInput {
  taskId: string;
  permission: RunSessionPermission;
  expiresAt?: string;
  actorLabel?: string;
  mobileSafeApprovalClasses?: string[];
}

export interface UpdateRunSessionShareInput {
  permission?: RunSessionPermission;
  expiresAt?: string | null;
  actorLabel?: string;
  mobileSafeApprovalClasses?: string[];
}

export interface RunSessionShareListFilters {
  taskId?: string;
  status?: RunSessionShareStatus;
}

export interface SendRunSessionMessageInput {
  message: string;
}

export interface RunSessionApprovalResponseInput {
  actionClass: string;
  response: 'approved' | 'rejected';
  note?: string;
}

export interface ForkRunSessionInput {
  title?: string;
  priority?: TaskPriority;
  reason?: string;
}

export interface RunSessionFork {
  id: string;
  shareId: string;
  parentTaskId: string;
  parentAttemptId?: string;
  forkTaskId: string;
  createdAt: string;
  createdBy: RunSessionActor;
  reason?: string;
}

export interface RunSessionEvent {
  id: string;
  shareId: string;
  taskId: string;
  attemptId?: string;
  type: RunSessionEventType;
  actor: RunSessionActor;
  createdAt: string;
  message?: string;
  actionClass?: string;
  approvalResponse?: 'approved' | 'rejected';
  forkTaskId?: string;
  metadata?: Record<string, unknown>;
}
