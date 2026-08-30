import type {
  RunFileProvenanceResponse,
  RunFileProvenanceRoot,
  RunFileProvenanceSource,
} from './run-file-provenance.types.js';

export const RUN_FILE_EXECUTION_POLICY_SCHEMA_VERSION = 'run-file-execution-policy/v1' as const;
export const RUN_FILE_EXECUTION_EVIDENCE_SCHEMA_VERSION =
  'run-file-execution-approval-evidence/v1' as const;

export const RUN_FILE_EXECUTION_POLICY_DECISIONS = [
  'standard-approval',
  'human-approval',
  'deny',
] as const;
export const RUN_FILE_EXECUTION_REFERENCE_KINDS = [
  'direct-executable',
  'interpreter-script',
  'loader-input',
  'archive-input',
  'configuration-input',
  'load-path',
] as const;

export type RunFileExecutionPolicyDecision = (typeof RUN_FILE_EXECUTION_POLICY_DECISIONS)[number];
export type RunFileExecutionReferenceKind = (typeof RUN_FILE_EXECUTION_REFERENCE_KINDS)[number];

export interface RunFileExecutionProjectPolicy {
  schemaVersion: typeof RUN_FILE_EXECUTION_POLICY_SCHEMA_VERSION;
  agentCreated: RunFileExecutionPolicyDecision;
  commandCreated: RunFileExecutionPolicyDecision;
  toolCreated: RunFileExecutionPolicyDecision;
}

export interface RunFileExecutionReferenceEvidence {
  kind: RunFileExecutionReferenceKind;
  root: RunFileProvenanceRoot;
  relativePath: string;
  contentSha256: string;
  byteSize: number;
  source: RunFileProvenanceSource;
  provenanceStatus: RunFileProvenanceResponse['status'] | 'launch-baseline';
  provenanceRecordId: string | null;
  provenanceRecordDigest: string | null;
  provenanceEvidenceDigest: string;
  decision: RunFileExecutionPolicyDecision;
}

export interface RunFileExecutionApprovalEvidence {
  schemaVersion: typeof RUN_FILE_EXECUTION_EVIDENCE_SCHEMA_VERSION;
  workspaceId: string;
  taskId: string;
  rootObjectiveId: string;
  executionNodeId: string;
  runId: string;
  attemptId: string;
  workflowStepId: string | null;
  terminalRequestId: string;
  terminalRequestDigest: string;
  commandId: string;
  launchManifestDigest: string;
  phaseEvidenceDigest: string | null;
  policy: RunFileExecutionProjectPolicy;
  references: RunFileExecutionReferenceEvidence[];
  decision: RunFileExecutionPolicyDecision;
  reasonCode:
    | 'no-referenced-files'
    | 'baseline-only'
    | 'run-produced-file'
    | 'external-or-unknown-file'
    | 'project-policy-deny'
    | 'unsupported-file-identity';
  digest: string;
}

export const DEFAULT_RUN_FILE_EXECUTION_PROJECT_POLICY: RunFileExecutionProjectPolicy = {
  schemaVersion: RUN_FILE_EXECUTION_POLICY_SCHEMA_VERSION,
  agentCreated: 'standard-approval',
  commandCreated: 'standard-approval',
  toolCreated: 'standard-approval',
};
