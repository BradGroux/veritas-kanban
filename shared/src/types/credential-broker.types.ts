export const CREDENTIAL_DEFINITION_SCHEMA_VERSION = 'credential-definition/v1' as const;
export const CREDENTIAL_LEASE_SCHEMA_VERSION = 'credential-lease/v1' as const;
export const CREDENTIAL_BROKER_AUDIT_SCHEMA_VERSION = 'credential-broker-audit/v1' as const;

export type CredentialDispatchType = 'http' | 'tool' | 'mcp';
export type CredentialApprovalPosture = 'not-required' | 'required';
export type CredentialLeaseState = 'active' | 'exhausted' | 'expired' | 'revoked' | 'blocked';
export type CredentialLeaseTerminalReason =
  | 'run-completed'
  | 'run-failed'
  | 'run-interrupted'
  | 'run-cancelled'
  | 'run-missing'
  | 'run-binding-changed'
  | 'definition-disabled'
  | 'definition-changed'
  | 'source-unavailable'
  | 'expired'
  | 'operator-revoked';

export type CredentialSecretSourceReference =
  | {
      kind: 'environment';
      reference: string;
    }
  | {
      kind: 'external';
      provider: string;
      reference: string;
    };

export interface CredentialScope {
  dispatchTypes: CredentialDispatchType[];
  hosts: string[];
  tools: string[];
  destinations: string[];
  methods: string[];
  actions: string[];
  pathPrefixes: string[];
}

export interface CredentialLeasePolicy {
  ttlSeconds: number;
  maxUses: number;
  renewable: boolean;
}

export interface CredentialDefinitionInput {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  source: CredentialSecretSourceReference;
  scope: CredentialScope;
  lease: CredentialLeasePolicy;
  approval: CredentialApprovalPosture;
}

export interface CredentialDefinition extends CredentialDefinitionInput {
  schemaVersion: typeof CREDENTIAL_DEFINITION_SCHEMA_VERSION;
  digest: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialAction {
  dispatchType: CredentialDispatchType;
  host?: string;
  tool?: string;
  destination?: string;
  method?: string;
  action?: string;
  path?: string;
  argumentsDigest: string;
}

export interface CredentialRunBinding {
  taskId: string;
  attemptId: string;
  status: 'running' | 'terminal';
  runLaunchManifestDigest: string;
  credentialReferences: string[];
}

export interface CredentialLease {
  schemaVersion: typeof CREDENTIAL_LEASE_SCHEMA_VERSION;
  id: string;
  handleHash: string;
  definitionId: string;
  definitionDigest: string;
  taskId: string;
  attemptId: string;
  runLaunchManifestDigest: string;
  scopeDigest: string;
  actionFingerprint: string;
  approvalId?: string;
  state: CredentialLeaseState;
  issuedAt: string;
  expiresAt: string;
  updatedAt: string;
  uses: number;
  maxUses: number;
  operations: CredentialLeaseOperation[];
  revokedAt?: string;
  terminalReason?: CredentialLeaseTerminalReason;
}

export interface CredentialLeaseOperation {
  id: string;
  type: 'use' | 'refresh';
  occurredAt: string;
}

export interface IssuedCredentialLease {
  handle: string;
  placeholder: string;
  lease: CredentialLease;
}

export type CredentialBrokerAuditEventType =
  | 'definition-created'
  | 'definition-updated'
  | 'definition-deleted'
  | 'issue'
  | 'use'
  | 'denial'
  | 'refresh'
  | 'revoke'
  | 'expire'
  | 'reconcile';

export interface CredentialBrokerAuditEvent {
  schemaVersion: typeof CREDENTIAL_BROKER_AUDIT_SCHEMA_VERSION;
  id: string;
  type: CredentialBrokerAuditEventType;
  occurredAt: string;
  decision: 'allowed' | 'denied' | 'recorded';
  definitionId?: string;
  definitionDigest?: string;
  leaseId?: string;
  taskId?: string;
  attemptId?: string;
  runLaunchManifestDigest?: string;
  scopeDigest?: string;
  actionFingerprint?: string;
  operationId?: string;
  reason: string;
}

export interface CredentialLeaseIssueRequest {
  definitionId: string;
  taskId: string;
  attemptId: string;
  runLaunchManifestDigest: string;
  action: CredentialAction;
}

export interface CredentialLeaseUseRequest {
  handle: string;
  operationId: string;
  taskId: string;
  attemptId: string;
  runLaunchManifestDigest: string;
  action: CredentialAction;
}

export interface CredentialRunRevocationRequest {
  taskId: string;
  attemptId: string;
  runLaunchManifestDigest?: string;
  reason: CredentialLeaseTerminalReason;
}

export interface CredentialBrokerReconciliationResult {
  active: number;
  revoked: number;
  expired: number;
  blocked: number;
}
