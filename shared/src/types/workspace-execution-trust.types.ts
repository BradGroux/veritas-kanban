export const WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION = 'workspace-execution-trust/v1' as const;
export const WORKSPACE_EXECUTION_TRUST_INVENTORY_SCHEMA_VERSION =
  'workspace-execution-trust-inventory/v1' as const;
export const WORKSPACE_EXECUTION_TRUST_DECISION_SCHEMA_VERSION =
  'workspace-execution-trust-decision/v1' as const;
export const WORKSPACE_EXECUTION_TRUST_POLICY_VERSION = 1 as const;

export type WorkspaceExecutionTrustPosture =
  'declarative-only' | 'model-influencing' | 'executable';

export type WorkspaceExecutionTrustComponentKind =
  | 'agent-instruction'
  | 'provider-instruction'
  | 'provider-configuration'
  | 'tool-server-configuration'
  | 'runtime-hook'
  | 'language-server-configuration'
  | 'workflow-configuration'
  | 'extension-configuration'
  | 'agent-definition'
  | 'skill-definition'
  | 'project-trust-policy'
  | 'unknown-executable';

export type WorkspaceExecutionTrustComponentScope =
  'workspace-root' | 'workspace-descendant' | 'git-common-directory';

export type WorkspaceExecutionTrustDecisionMode = 'trusted' | 'restricted' | 'denied' | 'revoked';

export type WorkspaceExecutionTrustStatus = 'trusted' | 'restricted' | 'untrusted' | 'not-required';

export type WorkspaceExecutionTrustProjectMaximum = 'trusted' | 'restricted' | 'denied';

export interface WorkspaceExecutionTrustIdentity {
  schemaVersion: typeof WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION;
  digest: string;
  canonicalWorkspacePathDigest: string;
  canonicalRepositoryRootDigest: string;
  gitCommonDirectoryDigest: string;
  remoteIdentityDigest: string;
}

export interface WorkspaceExecutionTrustInventoryEntry {
  id: string;
  relativePath: string;
  canonicalPathDigest: string;
  scope: WorkspaceExecutionTrustComponentScope;
  kind: WorkspaceExecutionTrustComponentKind;
  posture: WorkspaceExecutionTrustPosture;
  sourceFingerprint: string;
  byteLength: number;
  symbolicLink: boolean;
  requestedCapabilities: string[];
}

export interface WorkspaceExecutionTrustProjectPolicy {
  maximumTrust: WorkspaceExecutionTrustProjectMaximum;
  sourceFingerprint?: string;
  valid: boolean;
  diagnostic?: string;
}

export interface WorkspaceExecutionTrustInventory {
  schemaVersion: typeof WORKSPACE_EXECUTION_TRUST_INVENTORY_SCHEMA_VERSION;
  digest: string;
  scannerRevision: number;
  scannedAt: string;
  identity: WorkspaceExecutionTrustIdentity;
  entries: WorkspaceExecutionTrustInventoryEntry[];
  projectPolicy: WorkspaceExecutionTrustProjectPolicy;
}

export interface WorkspaceExecutionTrustDecision {
  schemaVersion: typeof WORKSPACE_EXECUTION_TRUST_DECISION_SCHEMA_VERSION;
  id: string;
  identityDigest: string;
  inventoryDigest: string;
  mode: WorkspaceExecutionTrustDecisionMode;
  actor: string;
  reason: string;
  policyVersion: typeof WORKSPACE_EXECUTION_TRUST_POLICY_VERSION;
  createdAt: string;
  expiresAt?: string;
  supersedesDecisionId?: string;
}

export interface WorkspaceExecutionTrustRestrictionCheck {
  id: string;
  satisfied: boolean;
  detail: string;
}

export interface WorkspaceExecutionTrustEvaluation {
  schemaVersion: typeof WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION;
  status: WorkspaceExecutionTrustStatus;
  source: string;
  requiresExplicitDecision: boolean;
  identity: WorkspaceExecutionTrustIdentity;
  inventory: WorkspaceExecutionTrustInventory;
  decision?: WorkspaceExecutionTrustDecision;
  restrictionChecks: WorkspaceExecutionTrustRestrictionCheck[];
}

export interface WorkspaceExecutionTrustScanResult {
  inventory: WorkspaceExecutionTrustInventory;
  currentDecision?: WorkspaceExecutionTrustDecision;
}

export interface WorkspaceExecutionTrustDecisionInput {
  inventoryDigest: string;
  mode: Exclude<WorkspaceExecutionTrustDecisionMode, 'revoked'>;
  reason: string;
  expiresAt?: string;
}

export interface WorkspaceExecutionTrustRevokeInput {
  inventoryDigest: string;
  reason: string;
}
