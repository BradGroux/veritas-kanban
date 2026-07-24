import type { ExecutableAgentProvider } from './config.types.js';
import type { RunEventJsonValue } from './run-event.types.js';

export const RUN_APPROVAL_SCHEMA_VERSION = 'run-approval/v1' as const;

export const RUN_APPROVAL_ACTION_CLASSES = [
  'tool',
  'shell',
  'filesystem',
  'network',
  'budget',
  'workflow',
  'elicitation',
] as const;

export type RunApprovalActionClass = (typeof RUN_APPROVAL_ACTION_CLASSES)[number];
export type RunApprovalRequestKind = 'approval' | 'elicitation';
export type RunApprovalRiskClass = 'low' | 'medium' | 'high' | 'critical';
export type RunApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type RunApprovalDecision = Extract<RunApprovalStatus, 'approved' | 'rejected'>;

export interface RunApprovalActor {
  id: string;
  label?: string;
  type?: 'user' | 'agent' | 'service' | 'device' | 'localhost-bypass';
  authMethod?: string;
  authenticatedAt?: string;
  clientMode?: string;
  workspaceId: string;
}

export interface RunApprovalResolution {
  decision: Exclude<RunApprovalStatus, 'pending'>;
  actor: RunApprovalActor;
  decidedAt: string;
  note?: string;
  responseData?: Record<string, RunEventJsonValue>;
}

export interface RunApprovalRequest {
  schemaVersion: typeof RUN_APPROVAL_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  taskId: string;
  attemptId: string;
  provider: ExecutableAgentProvider;
  agentId: string;
  requestKind: RunApprovalRequestKind;
  actionClass: RunApprovalActionClass;
  action: string;
  actionHash: string;
  details?: string;
  resourceScope: string[];
  workingDirectory?: string;
  riskClass: RunApprovalRiskClass;
  policyReason?: string;
  evidenceRevision: string;
  providerRequestId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  mobileSafe: boolean;
  status: RunApprovalStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  resolution?: RunApprovalResolution;
}

export interface RunApprovalListQuery {
  workspaceId: string;
  status?: RunApprovalStatus;
  taskId?: string;
  attemptId?: string;
  agentId?: string;
}

export interface RunApprovalDecisionInput {
  decision: RunApprovalDecision;
  expectedRevision: number;
  expectedActionHash: string;
  note?: string;
  responseData?: Record<string, RunEventJsonValue>;
}

export interface RunApprovalTransitionInput {
  id: string;
  expectedRevision: number;
  expectedActionHash: string;
  status: Exclude<RunApprovalStatus, 'pending'>;
  resolution: RunApprovalResolution;
}

export interface RunApprovalTransitionResult {
  request?: RunApprovalRequest;
  transitioned: boolean;
  reason?: 'not-found' | 'stale-revision' | 'action-changed' | 'already-resolved';
}
