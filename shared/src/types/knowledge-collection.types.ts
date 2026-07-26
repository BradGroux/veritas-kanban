export const KNOWLEDGE_COLLECTION_SCHEMA_VERSION = 'knowledge-collection/v1' as const;
export const KNOWLEDGE_COLLECTION_DEFINITION_SCHEMA_VERSION =
  'knowledge-collection-definition/v1' as const;
export const KNOWLEDGE_SOURCE_SCHEMA_VERSION = 'knowledge-source/v1' as const;
export const KNOWLEDGE_PAGE_SCHEMA_VERSION = 'knowledge-page/v1' as const;
export const KNOWLEDGE_PAGE_REVISION_SCHEMA_VERSION = 'knowledge-page-revision/v1' as const;
export const KNOWLEDGE_INGESTION_PROPOSAL_SCHEMA_VERSION =
  'knowledge-ingestion-proposal/v1' as const;
export const KNOWLEDGE_ACTIVITY_ENTRY_SCHEMA_VERSION = 'knowledge-activity-entry/v1' as const;
export const KNOWLEDGE_INTEGRITY_REPORT_SCHEMA_VERSION = 'knowledge-integrity-report/v1' as const;

export const KNOWLEDGE_CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'restricted',
] as const;
export type KnowledgeClassification = (typeof KNOWLEDGE_CLASSIFICATIONS)[number];

export const KNOWLEDGE_ACCESS_ROLES = ['admin', 'read-only', 'agent'] as const;
export type KnowledgeAccessRole = (typeof KNOWLEDGE_ACCESS_ROLES)[number];

export interface KnowledgeLaunchContext {
  taskId: string;
  attemptId: string;
  launchManifestDigest: string;
}

export interface KnowledgeCollectionAccessPolicy {
  readRoles: KnowledgeAccessRole[];
  writeRoles: KnowledgeAccessRole[];
  maxSourceClassification: KnowledgeClassification;
  exportPolicy: 'allowed' | 'redacted-only' | 'forbidden';
}

export interface KnowledgeCollectionDefinition {
  schemaVersion: typeof KNOWLEDGE_COLLECTION_DEFINITION_SCHEMA_VERSION;
  version: number;
  pageKinds: string[];
  requiredMetadata: string[];
  naming: 'stable-id';
  links: 'bidirectional';
  ingestion: 'review-required';
  maxPageVersions: number;
}

export interface KnowledgeCollection {
  schemaVersion: typeof KNOWLEDGE_COLLECTION_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description?: string;
  definition: KnowledgeCollectionDefinition;
  accessPolicy: KnowledgeCollectionAccessPolicy;
  version: number;
  operationIdDigest: string;
  requestDigest: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  digest: string;
}

export type KnowledgeSourceStorage = 'content-addressed-blob' | 'content-addressed-reference';

export interface KnowledgeSource {
  schemaVersion: typeof KNOWLEDGE_SOURCE_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  collectionId: string;
  sourceKey: string;
  revision: number;
  uri: string;
  mediaType: string;
  title?: string;
  owner: string;
  classification: KnowledgeClassification;
  storage: KnowledgeSourceStorage;
  contentHash: string;
  contentBytes: number;
  blobDigest?: string;
  supersedesSourceId?: string;
  operationIdDigest: string;
  requestDigest: string;
  capturedAt: string;
  createdBy: string;
  digest: string;
}

export interface CreateKnowledgeCollectionInput {
  operationId: string;
  slug: string;
  name: string;
  description?: string;
  definition: KnowledgeCollectionDefinition;
  accessPolicy: KnowledgeCollectionAccessPolicy;
}

interface RegisterKnowledgeSourceInputBase {
  operationId: string;
  sourceKey: string;
  uri: string;
  mediaType: string;
  title?: string;
  owner: string;
  classification: KnowledgeClassification;
  capturedAt?: string;
}

export interface RegisterInlineKnowledgeSourceInput extends RegisterKnowledgeSourceInputBase {
  storage: 'content-addressed-blob';
  content: string;
}

export interface RegisterReferencedKnowledgeSourceInput extends RegisterKnowledgeSourceInputBase {
  storage: 'content-addressed-reference';
  contentHash: string;
  contentBytes: number;
}

export type RegisterKnowledgeSourceInput =
  RegisterInlineKnowledgeSourceInput | RegisterReferencedKnowledgeSourceInput;

export type KnowledgePageReviewState = 'draft' | 'review-required' | 'approved' | 'rejected';

export type KnowledgeCitationLocator =
  | {
      kind: 'line-range';
      startLine: number;
      endLine: number;
    }
  | {
      kind: 'heading';
      heading: string;
      occurrence?: number;
    }
  | {
      kind: 'json-pointer';
      pointer: string;
    }
  | {
      kind: 'excerpt-hash';
      excerptHash: string;
    }
  | {
      kind: 'time-range';
      startMs: number;
      endMs: number;
    };

export interface KnowledgeClaimCitation {
  sourceId: string;
  locator?: KnowledgeCitationLocator;
  excerptHash?: string;
}

export const KNOWLEDGE_CLAIM_STATES = [
  'active',
  'needs-review',
  'disputed',
  'superseded',
  'retracted',
] as const;
export type KnowledgeClaimState = (typeof KNOWLEDGE_CLAIM_STATES)[number];

export interface KnowledgeClaimTransition {
  from: KnowledgeClaimState;
  to: KnowledgeClaimState;
  reason: string;
  evidenceSourceIds: string[];
  actorId: string;
  at: string;
  operationIdDigest: string;
  requestDigest: string;
  digest: string;
}

export interface KnowledgePageClaim {
  id: string;
  claimKey: string;
  text: string;
  citations: KnowledgeClaimCitation[];
  confidence: number;
  lifecycleState?: KnowledgeClaimState;
  transitions?: KnowledgeClaimTransition[];
}

export interface KnowledgePageRevision {
  schemaVersion: typeof KNOWLEDGE_PAGE_REVISION_SCHEMA_VERSION;
  version: number;
  title: string;
  pageKind: string;
  aliases: string[];
  tags: string[];
  metadata: Record<string, string>;
  markdown: string;
  contentHash: string;
  claims: KnowledgePageClaim[];
  outgoingPageIds: string[];
  backlinkPageIds: string[];
  reviewState: KnowledgePageReviewState;
  confidence: number;
  operationIdDigest: string;
  requestDigest: string;
  updatedBy: string;
  updatedAt: string;
  digest: string;
}

export interface KnowledgePage {
  schemaVersion: typeof KNOWLEDGE_PAGE_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  collectionId: string;
  stableKey: string;
  current: KnowledgePageRevision;
  history: KnowledgePageRevision[];
  createdBy: string;
  createdAt: string;
  digest: string;
}

export interface KnowledgePageClaimInput {
  claimKey: string;
  text: string;
  citations: KnowledgeClaimCitation[];
  confidence: number;
}

export interface UpsertKnowledgePageCandidate {
  stableKey: string;
  title: string;
  pageKind: string;
  aliases?: string[];
  tags?: string[];
  metadata: Record<string, string>;
  markdown: string;
  claims: KnowledgePageClaimInput[];
  links?: string[];
  reviewState: KnowledgePageReviewState;
  confidence: number;
}

export interface UpsertKnowledgePagesInput {
  operationId: string;
  pages: UpsertKnowledgePageCandidate[];
}

export interface TransitionKnowledgeClaimInput {
  operationId: string;
  expectedPageDigest: string;
  expectedState: KnowledgeClaimState;
  to: KnowledgeClaimState;
  reason: string;
  evidenceSourceIds?: string[];
}

export interface KnowledgePageExpectedState {
  id: string;
  digest: string | null;
}

export interface KnowledgeIngestionPageChange {
  pageId: string;
  stableKey: string;
  action: 'create' | 'revise' | 'backlink-update';
  beforeDigest: string | null;
  afterDigest: string;
  beforeVersion: number | null;
  afterVersion: number;
}

export interface KnowledgeIngestionIndexChange {
  pageId: string;
  action: 'upsert';
  beforeContentHash: string | null;
  afterContentHash: string;
}

export interface KnowledgeIngestionContradiction {
  id: string;
  pageIdentity: string;
  claimKey?: string;
  description: string;
  severity: 'info' | 'warning' | 'blocking';
  sourceIds: string[];
  detectedBy: 'extractor' | 'stable-claim-diff';
}

export interface KnowledgeIngestionActivityChange {
  type: 'knowledge.ingestion.applied';
  sourceIds: string[];
  pageIds: string[];
}

export interface KnowledgeIngestionProposalTransition {
  from: 'dry-run' | 'applied';
  to: 'applied' | 'reversed';
  fromProposalDigest: string;
  actorId: string;
  at: string;
  digest: string;
}

export interface KnowledgeIngestionBeforePage {
  pageId: string;
  page: KnowledgePage | null;
}

export interface KnowledgeIngestionProposal {
  schemaVersion: typeof KNOWLEDGE_INGESTION_PROPOSAL_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  collectionId: string;
  state: 'dry-run' | 'applied' | 'reversed';
  revision: number;
  sourceIds: string[];
  expectedPages: KnowledgePageExpectedState[];
  beforePages: KnowledgeIngestionBeforePage[];
  afterPages: KnowledgePage[];
  pageChanges: KnowledgeIngestionPageChange[];
  indexChanges: KnowledgeIngestionIndexChange[];
  contradictions: KnowledgeIngestionContradiction[];
  activityChanges: KnowledgeIngestionActivityChange[];
  queryPromotion?: {
    query: string;
    evidenceDigest: string;
    selectedResultIds: string[];
    launchContext?: KnowledgeLaunchContext;
  };
  operationIdDigest: string;
  requestDigest: string;
  previewDigest: string;
  proposedBy: string;
  proposedAt: string;
  transitions: KnowledgeIngestionProposalTransition[];
  digest: string;
}

export interface KnowledgeActivityEntry {
  schemaVersion: typeof KNOWLEDGE_ACTIVITY_ENTRY_SCHEMA_VERSION;
  id: string;
  workspaceId: string;
  collectionId: string;
  proposalId: string;
  type: 'knowledge.ingestion.applied' | 'knowledge.ingestion.reversed';
  sourceIds: string[];
  pageIds: string[];
  actorId: string;
  createdAt: string;
  digest: string;
}

export interface KnowledgeIngestionContradictionInput {
  pageIdentity: string;
  claimKey?: string;
  description: string;
  severity: 'info' | 'warning' | 'blocking';
  sourceIds: string[];
}

export interface CreateKnowledgeIngestionProposalInput {
  operationId: string;
  sourceIds: string[];
  pages: UpsertKnowledgePageCandidate[];
  contradictions?: KnowledgeIngestionContradictionInput[];
}

export interface TransitionKnowledgeIngestionProposalInput {
  proposalDigest: string;
}

export interface SearchKnowledgeCollectionInput {
  query: string;
  limit?: number;
  scope?: 'all' | 'raw-sources' | 'derived-pages';
  backend?: 'auto' | 'qmd' | 'keyword';
}

export interface KnowledgeSearchResult {
  id: string;
  kind: 'raw-source' | 'derived-page';
  backend: 'qmd' | 'keyword';
  title: string;
  snippet: string;
  score: number;
  sourceId?: string;
  pageId?: string;
  stableKey?: string;
  classification: KnowledgeClassification;
  citations: KnowledgeClaimCitation[];
}

export interface KnowledgeSearchResponse {
  query: string;
  backend: 'qmd' | 'keyword';
  degraded: boolean;
  reason?: string;
  launchContext?: KnowledgeLaunchContext;
  results: KnowledgeSearchResult[];
  evidenceDigest: string;
}

export const KNOWLEDGE_INTEGRITY_FINDING_KINDS = [
  'broken-link',
  'backlink-drift',
  'orphan-page',
  'duplicate-identity',
  'invalid-page-kind',
  'missing-metadata',
  'uncited-claim',
  'inaccessible-source',
  'changed-source-hash',
  'invalid-citation-locator',
  'stale-page',
  'stale-source',
  'missing-canonical-page',
  'unanswered-question',
] as const;
export type KnowledgeIntegrityFindingKind = (typeof KNOWLEDGE_INTEGRITY_FINDING_KINDS)[number];
export type KnowledgeIntegritySeverity = 'info' | 'warning' | 'error';

export interface KnowledgeFreshnessRule {
  target: 'page-kind' | 'source-media-type';
  match: string;
  maxAgeDays: number;
}

export interface RunKnowledgeIntegrityLintInput {
  asOf?: string;
  freshnessRules?: KnowledgeFreshnessRule[];
  includeResearchCandidates?: boolean;
}

export interface KnowledgeIntegrityFinding {
  id: string;
  kind: KnowledgeIntegrityFindingKind;
  severity: KnowledgeIntegritySeverity;
  message: string;
  pageId?: string;
  sourceId?: string;
  claimId?: string;
  relatedIds: string[];
  digest: string;
}

export interface KnowledgeIntegrityReport {
  schemaVersion: typeof KNOWLEDGE_INTEGRITY_REPORT_SCHEMA_VERSION;
  workspaceId: string;
  collectionId: string;
  asOf: string;
  launchContext?: KnowledgeLaunchContext;
  inspected: {
    pages: number;
    sources: number;
    claims: number;
  };
  findings: KnowledgeIntegrityFinding[];
  findingCounts: Record<KnowledgeIntegritySeverity, number>;
  reportDigest: string;
}

export interface CreateKnowledgeQueryPromotionInput {
  operationId: string;
  evidence: KnowledgeSearchResponse;
  selectedResultIds: string[];
  pages: UpsertKnowledgePageCandidate[];
  contradictions?: KnowledgeIngestionContradictionInput[];
}

export interface CreateKnowledgeCitedExportInput {
  title: string;
  evidence: KnowledgeSearchResponse;
  selectedResultIds: string[];
  redaction?: 'none' | 'standard' | 'strict';
}
