import type { AgentPolicy } from './policy.types.js';

export type ReflectionCandidateCategory = 'session' | 'agent' | 'team' | 'policy' | 'template';
export type ReflectionCandidateStatus = 'pending' | 'accepted' | 'rejected' | 'deleted';
export type ReflectionSourceKind =
  | 'task-run'
  | 'chat-message'
  | 'error'
  | 'user-correction'
  | 'review-feedback'
  | 'task-observation';
export type ReflectionPromotionTarget =
  'task-lesson' | 'memory' | 'team' | 'decision' | 'profile' | 'template' | 'policy';
export type ReflectionProposedScope = 'task' | 'workspace' | 'team' | 'global';

export interface ReflectionSourceLink {
  kind: ReflectionSourceKind;
  taskId?: string;
  runId?: string;
  eventIds?: string[];
  messageId?: string;
  errorId?: string;
  observationId?: string;
  reviewId?: string;
  url?: string;
}

export interface ReflectionEvidence {
  kind: ReflectionSourceKind | 'note';
  title: string;
  content: string;
  url?: string;
}

export interface ReflectionAppliedTarget {
  kind: ReflectionPromotionTarget | 'manual-review';
  id?: string;
  title?: string;
  appliedAt: string;
  appliedBy: string;
}

export interface ReflectionRedactionSummary {
  redacted: boolean;
  notes: string[];
}

export interface ReflectionRetrievalAttribution {
  taskId: string;
  attemptId: string;
  workspaceId: string;
  relevanceScore: number;
  retrievedAt: string;
}

export type ReflectionTypedPromotionInput =
  | {
      target: 'memory';
      workspaceId: string;
    }
  | {
      target: 'team';
      rosterId: string;
      memberId: string;
      capabilitiesToAdd: string[];
    }
  | {
      target: 'profile';
      profileId: string;
      capabilitiesToAdd: string[];
    }
  | {
      target: 'template';
      templateId: string;
    }
  | {
      target: 'decision';
      agentId: string;
      taskId: string;
      confidenceLevel: number;
      riskScore: number;
      parentDecisionId?: string;
    }
  | {
      target: 'policy';
      policy: AgentPolicy;
    };

export interface ReflectionCandidate {
  id: string;
  idempotencyKey?: string;
  status: ReflectionCandidateStatus;
  category: ReflectionCandidateCategory;
  promotionTarget: ReflectionPromotionTarget;
  confidence: number;
  source: ReflectionSourceLink;
  summary: string;
  previousApproach: string;
  correction: string;
  nextAttempt: string;
  proposedScope?: ReflectionProposedScope;
  rationale?: string;
  applicability?: string;
  contradictionIds?: string[];
  evidence: ReflectionEvidence[];
  tags: string[];
  duplicateKey: string;
  duplicateOf?: string;
  duplicateCount: number;
  appliedTargets: ReflectionAppliedTarget[];
  redaction: ReflectionRedactionSummary;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewerNote?: string;
  rejectionReason?: string;
  deletedAt?: string;
  deletedBy?: string;
  deleteReason?: string;
  mergedInto?: string;
  retrievalCount?: number;
  lastRetrievedAt?: string;
  retrievals?: ReflectionRetrievalAttribution[];
}

export interface ReflectionDuplicateGroup {
  duplicateKey: string;
  candidateIds: string[];
  representativeId: string;
  statusCounts: Partial<Record<ReflectionCandidateStatus, number>>;
}

export interface ReflectionListResponse {
  candidates: ReflectionCandidate[];
  duplicateGroups: ReflectionDuplicateGroup[];
  total: number;
}

export interface CreateReflectionCandidateInput {
  idempotencyKey?: string;
  category: ReflectionCandidateCategory;
  promotionTarget?: ReflectionPromotionTarget;
  confidence?: number;
  source: ReflectionSourceLink;
  summary: string;
  previousApproach: string;
  correction: string;
  nextAttempt: string;
  proposedScope?: ReflectionProposedScope;
  rationale?: string;
  applicability?: string;
  contradictionIds?: string[];
  evidence?: ReflectionEvidence[];
  tags?: string[];
  duplicateKey?: string;
  createdBy?: string;
}

export interface AcceptReflectionCandidateInput {
  reviewedBy: string;
  promotionTarget?: ReflectionPromotionTarget;
  promotion?: ReflectionTypedPromotionInput;
  reviewerNote?: string;
}

export interface RejectReflectionCandidateInput {
  reviewedBy: string;
  reason: string;
}

export interface DeleteReflectionCandidateInput {
  deletedBy: string;
  reason?: string;
}

export interface MergeReflectionCandidateInput {
  mergedBy: string;
}
