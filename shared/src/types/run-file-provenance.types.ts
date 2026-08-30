export const RUN_FILE_PROVENANCE_SCHEMA_VERSION = 'run-file-provenance/v1' as const;
export const RUN_FILE_PROVENANCE_RESPONSE_SCHEMA_VERSION =
  'run-file-provenance-response/v1' as const;
export const RUN_FILE_PROVENANCE_APPROVAL_EVIDENCE_SCHEMA_VERSION =
  'run-file-provenance-approval-evidence/v1' as const;

export const RUN_FILE_PROVENANCE_SOURCES = [
  'repository-baseline',
  'agent-created',
  'command-created',
  'tool-created',
  'attachment-derived',
  'connector-derived',
  'downloaded-external',
  'operator-provided',
  'unknown',
] as const;

export const RUN_FILE_PROVENANCE_OPERATIONS = [
  'create',
  'modify',
  'replace',
  'rename',
  'copy',
  'extract',
  'download',
] as const;

export const RUN_FILE_PROVENANCE_ROOTS = ['worktree', 'run-artifact'] as const;
export const RUN_FILE_MEDIA_CLASSES = [
  'text',
  'json',
  'image',
  'audio',
  'video',
  'archive',
  'executable',
  'binary',
  'unknown',
] as const;

export type RunFileProvenanceSource = (typeof RUN_FILE_PROVENANCE_SOURCES)[number];
export type RunFileProvenanceOperation = (typeof RUN_FILE_PROVENANCE_OPERATIONS)[number];
export type RunFileProvenanceRoot = (typeof RUN_FILE_PROVENANCE_ROOTS)[number];
export type RunFileMediaClass = (typeof RUN_FILE_MEDIA_CLASSES)[number];

export interface RunFileProvenanceScope {
  workspaceId: string;
  taskId: string;
  rootObjectiveId: string;
  executionNodeId: string;
  runId: string;
  attemptId: string;
  workflowStepId: string | null;
}

export interface RunFileProvenanceProducer {
  eventId: string;
  eventSequence: number;
  toolCallId: string | null;
  commandId: string | null;
  attachmentId: string | null;
  connectorTarget: string | null;
  sourceUrl: string | null;
  safeMetadata: Record<string, string>;
}

export interface RunFileProvenanceLocation {
  root: RunFileProvenanceRoot;
  relativePath: string;
  normalizedPath: string;
  caseFoldedPath: string;
}

export interface RunFileProvenanceContent {
  sha256: string;
  byteSize: number;
  mediaType: string;
  mediaClass: RunFileMediaClass;
}

export interface RunFileProvenanceRecord {
  schemaVersion: typeof RUN_FILE_PROVENANCE_SCHEMA_VERSION;
  id: string;
  scope: RunFileProvenanceScope;
  source: RunFileProvenanceSource;
  operation: RunFileProvenanceOperation;
  producer: RunFileProvenanceProducer;
  location: RunFileProvenanceLocation;
  content: RunFileProvenanceContent;
  predecessorId: string | null;
  previousPath: string | null;
  capturedAt: string;
  digest: string;
}

export interface RunFileProvenanceGap {
  code:
    | 'unsupported-provider-path'
    | 'unsupported-tool-path'
    | 'link-identity-uncertified'
    | 'path-collision'
    | 'causal-event-missing'
    | 'record-invalid';
  message: string;
  root?: RunFileProvenanceRoot;
  relativePath?: string;
  eventId?: string;
  eventSequence?: number;
}

export interface RunFileProvenanceQuery {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  root: RunFileProvenanceRoot;
  relativePath: string;
  sha256: string;
  limit?: number;
}

export interface RunFileProvenanceResponse {
  schemaVersion: typeof RUN_FILE_PROVENANCE_RESPONSE_SCHEMA_VERSION;
  status: 'exact' | 'stale' | 'unknown' | 'gap';
  query: RunFileProvenanceQuery;
  current: RunFileProvenanceRecord | null;
  chain: RunFileProvenanceRecord[];
  gaps: RunFileProvenanceGap[];
  generatedAt: string;
}

export interface RunFileProvenanceListResponse {
  schemaVersion: typeof RUN_FILE_PROVENANCE_RESPONSE_SCHEMA_VERSION;
  taskId: string;
  attemptId: string;
  records: RunFileProvenanceRecord[];
  gaps: RunFileProvenanceGap[];
  generatedAt: string;
}

export interface RunFileProvenanceApprovalEvidence {
  schemaVersion: typeof RUN_FILE_PROVENANCE_APPROVAL_EVIDENCE_SCHEMA_VERSION;
  status: RunFileProvenanceResponse['status'];
  query: RunFileProvenanceQuery;
  currentRecordId: string | null;
  currentRecordDigest: string | null;
  chainDigests: string[];
  gapCodes: RunFileProvenanceGap['code'][];
  generatedAt: string;
  digest: string;
}
