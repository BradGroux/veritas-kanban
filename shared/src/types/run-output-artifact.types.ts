export const RUN_OUTPUT_ARTIFACT_SCHEMA_VERSION = 'run-output-artifact/v1' as const;
export const RUN_OUTPUT_PREVIEW_SCHEMA_VERSION = 'run-output-preview/v1' as const;

export const RUN_OUTPUT_SOURCE_KINDS = [
  'tool-result',
  'command-output',
  'mcp-result',
  'provider-payload',
  'run-event',
] as const;

export const RUN_OUTPUT_CONTENT_CLASSES = [
  'text',
  'json',
  'binary',
  'compressed',
  'invalid-utf8',
] as const;

export const RUN_OUTPUT_TRUNCATION_REASONS = [
  'inline-limit',
  'model-limit',
  'event-limit',
  'websocket-limit',
  'log-limit',
  'content-policy',
] as const;

export const RUN_OUTPUT_ARTIFACT_STATES = [
  'available',
  'quarantined',
  'expired',
  'deleted',
] as const;

export const RUN_OUTPUT_QUERY_OPERATIONS = [
  'metadata',
  'byte-range',
  'line-range',
  'json-path',
  'download',
] as const;

export type RunOutputSourceKind = (typeof RUN_OUTPUT_SOURCE_KINDS)[number];
export type RunOutputContentClass = (typeof RUN_OUTPUT_CONTENT_CLASSES)[number];
export type RunOutputTruncationReason = (typeof RUN_OUTPUT_TRUNCATION_REASONS)[number];
export type RunOutputArtifactState = (typeof RUN_OUTPUT_ARTIFACT_STATES)[number];
export type RunOutputQueryOperation = (typeof RUN_OUTPUT_QUERY_OPERATIONS)[number];
export type RunOutputRedactionState = 'none' | 'redacted' | 'quarantined' | 'dropped';

export interface RunOutputArtifactSource {
  kind: RunOutputSourceKind;
  name?: string;
  eventId?: string;
  toolCallId?: string;
  commandId?: string;
}

export interface RunOutputArtifactScope {
  workspaceId: string;
  taskId: string;
  runId: string;
  attemptId: string;
  turnId?: string;
}

export interface RunOutputArtifactRedaction {
  state: RunOutputRedactionState;
  fields: string[];
  validatedAt: string;
}

export interface RunOutputArtifactRetention {
  createdAt: string;
  expiresAt: string;
  activeLeaseUntil?: string;
}

export interface RunOutputArtifactReference {
  artifactId: string;
  state: RunOutputArtifactState;
  operations: RunOutputQueryOperation[];
}

export interface RunOutputArtifactMetadata {
  schemaVersion: typeof RUN_OUTPUT_ARTIFACT_SCHEMA_VERSION;
  id: string;
  scope: RunOutputArtifactScope;
  source: RunOutputArtifactSource;
  mediaType: string;
  encoding: 'utf-8' | 'binary';
  contentClass: RunOutputContentClass;
  originalBytes: number;
  storedBytes: number;
  previewBytes: number;
  truncationReason: RunOutputTruncationReason;
  sha256: string;
  redaction: RunOutputArtifactRedaction;
  retention: RunOutputArtifactRetention;
  state: RunOutputArtifactState;
}

export interface RunOutputQueryHints {
  maxResultBytes: number;
  maxJsonDepth: number;
  operations: RunOutputQueryOperation[];
}

export interface RunOutputPreview {
  schemaVersion: typeof RUN_OUTPUT_PREVIEW_SCHEMA_VERSION;
  inline: boolean;
  content: string;
  mediaType: string;
  contentClass: RunOutputContentClass;
  originalBytes: number;
  previewBytes: number;
  truncated: boolean;
  truncationReason?: RunOutputTruncationReason;
  artifact?: RunOutputArtifactReference;
  queryHints?: RunOutputQueryHints;
}

export interface RunOutputSpillPolicy {
  schemaVersion: 'run-output-spill-policy/v1';
  inlineBytes: number;
  maxQueryBytes: number;
  maxJsonDepth: number;
  retentionSeconds: number;
  activeLeaseSeconds: number;
  allowBinaryPersistence: boolean;
  allowCompressedPersistence: boolean;
}
