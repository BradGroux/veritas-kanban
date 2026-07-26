export const REFLECTION_CONSOLIDATION_SCHEMA_VERSION =
  'reflection-consolidation-proposal/v1' as const;

export type ReflectionMemoryDomainKind =
  'workspace-memory' | 'team' | 'profile' | 'template' | 'decision' | 'policy';

export interface ReflectionMemoryDomain {
  kind: ReflectionMemoryDomainKind;
  id: string;
  workspaceId: string;
}

export type ReflectionConsolidationProposalState =
  'proposed' | 'accepted' | 'rejected' | 'applied' | 'superseded';

export interface ReflectionConsolidationCluster {
  clusterKey: string;
  representativeId: string;
  candidateIds: string[];
  contradictionIds: string[];
}

export type ReflectionConsolidationDiffOperation =
  'merge-review' | 'contradiction-review' | 'decay-review' | 'promotion-review';

export interface ReflectionConsolidationDiffEntry {
  operation: ReflectionConsolidationDiffOperation;
  path: string;
  candidateIds: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
}

export interface ReflectionConsolidationProposal {
  schemaVersion: typeof REFLECTION_CONSOLIDATION_SCHEMA_VERSION;
  id: string;
  domain: ReflectionMemoryDomain;
  state: ReflectionConsolidationProposalState;
  revision: number;
  sourceDigest: string;
  policy: ReflectionConsolidationPolicy;
  clusters: ReflectionConsolidationCluster[];
  diff: ReflectionConsolidationDiffEntry[];
  candidateIds: string[];
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewerNote?: string;
  supersedesProposalId?: string;
}

export interface ReflectionConsolidationPolicy {
  staleAfterDays: number;
  unusedAfterDays: number;
  minimumConfidence: number;
  maxCandidates: number;
}
