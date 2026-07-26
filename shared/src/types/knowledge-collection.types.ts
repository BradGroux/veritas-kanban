export const KNOWLEDGE_COLLECTION_SCHEMA_VERSION = 'knowledge-collection/v1' as const;
export const KNOWLEDGE_COLLECTION_DEFINITION_SCHEMA_VERSION =
  'knowledge-collection-definition/v1' as const;
export const KNOWLEDGE_SOURCE_SCHEMA_VERSION = 'knowledge-source/v1' as const;
export const KNOWLEDGE_PAGE_SCHEMA_VERSION = 'knowledge-page/v1' as const;
export const KNOWLEDGE_PAGE_REVISION_SCHEMA_VERSION = 'knowledge-page-revision/v1' as const;

export const KNOWLEDGE_CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'restricted',
] as const;
export type KnowledgeClassification = (typeof KNOWLEDGE_CLASSIFICATIONS)[number];

export const KNOWLEDGE_ACCESS_ROLES = ['admin', 'read-only', 'agent'] as const;
export type KnowledgeAccessRole = (typeof KNOWLEDGE_ACCESS_ROLES)[number];

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

export interface KnowledgePageClaim {
  id: string;
  claimKey: string;
  text: string;
  citations: KnowledgeClaimCitation[];
  confidence: number;
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
