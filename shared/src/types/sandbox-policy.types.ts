import type { SkillCapabilityId } from './skill-capability.types.js';

export type SandboxPolicyEnforcement = 'required' | 'advisory';
export type SandboxNetworkDefault = 'allow' | 'deny';
export type SandboxCredentialMode = 'none' | 'brokered' | 'env-passthrough';
export type SandboxPolicyDecision = 'allow' | 'warn' | 'block';
export type SandboxPolicyRuleStatus = 'supported' | 'unsupported' | 'advisory';
export const RUN_EGRESS_POLICY_SCHEMA_VERSION = 'run-egress-policy/v1' as const;
export const RUN_EGRESS_DECISION_SCHEMA_VERSION = 'run-egress-decision/v1' as const;
export const RUN_EGRESS_GATEWAY_EVIDENCE_SCHEMA_VERSION = 'run-egress-gateway-evidence/v1' as const;
export type FilesystemSandboxBackendId = 'codex-sandbox' | 'provider-native' | 'none';
export type FilesystemSandboxBackendState = 'available' | 'native' | 'unavailable';
export type SandboxProviderCapabilityId =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'filesystem.deny-paths'
  | 'filesystem.dotfile-masking'
  | 'filesystem.protected-metadata'
  | 'filesystem.descendants'
  | 'filesystem.run-scoped-temp'
  | 'filesystem.cleanup'
  | 'network.disable'
  | 'network.allowlist'
  | 'network.block-private'
  | 'network.block-metadata'
  | 'environment.allowlist'
  | 'credential.broker';

export interface SandboxFilesystemRules {
  readPaths: string[];
  writePaths: string[];
  deniedPaths: string[];
  dotfileMasking: boolean;
  localOnlyHandles: boolean;
}

export interface SandboxNetworkRules {
  defaultEgress: SandboxNetworkDefault;
  allowedHosts: string[];
  /** Explicit deny rules take precedence over allow rules. Defaults to empty for legacy presets. */
  deniedHosts?: string[];
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  blockPrivateNetwork: boolean;
  blockMetadataEndpoints: boolean;
  blockLoopback: boolean;
  /** Allows a blocked request to enter the scoped run-approval flow. */
  allowApprovals?: boolean;
  /** Dangerous compatibility override required before an allow rule may use `*`. */
  dangerouslyAllowGlobalWildcard?: boolean;
}

export type RunEgressProtocol = 'http' | 'https' | 'ws' | 'wss' | 'socks';
export type RunEgressHostRuleKind = 'any' | 'exact' | 'subdomain';

export interface RunEgressHostRule {
  kind: RunEgressHostRuleKind;
  value: string;
}

export interface RunEgressPolicy {
  schemaVersion: typeof RUN_EGRESS_POLICY_SCHEMA_VERSION;
  policyHash: string;
  defaultEgress: SandboxNetworkDefault;
  allowedHosts: RunEgressHostRule[];
  deniedHosts: RunEgressHostRule[];
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  blockPrivateNetwork: boolean;
  blockMetadataEndpoints: boolean;
  blockLoopback: boolean;
  allowApprovals: boolean;
  tlsInspection: 'disabled';
}

export interface RunEgressDecisionInput {
  protocol: RunEgressProtocol;
  host: string;
  port: number;
  method?: string;
  /** Path only. Query strings and fragments must be removed before evaluation. */
  path?: string;
  resolvedAddresses?: string[];
  tlsInspected?: boolean;
}

export type RunEgressDecisionReason =
  | 'allowed-by-default'
  | 'allowed-by-host-rule'
  | 'allowed-by-approval'
  | 'default-deny'
  | 'denied-host'
  | 'method-not-allowed'
  | 'path-not-allowed'
  | 'tls-inspection-required'
  | 'private-network-blocked'
  | 'loopback-blocked'
  | 'metadata-endpoint-blocked'
  | 'invalid-destination';

export interface RunEgressDecision {
  schemaVersion: typeof RUN_EGRESS_DECISION_SCHEMA_VERSION;
  decision: 'allow' | 'block';
  reason: RunEgressDecisionReason;
  policyHash: string;
  protocol: RunEgressProtocol;
  hostKey: string;
  port: number;
  method?: string;
  matchedRule?: RunEgressHostRule;
  blockedAddressClass?: 'private' | 'loopback' | 'link-local' | 'metadata';
  approvalEligible: boolean;
  /** Durable approval correlated to this decision without exposing the destination URL. */
  approvalId?: string;
  /** Original blocking reason when a scoped approval changed the transport decision. */
  policyReason?: Exclude<
    RunEgressDecisionReason,
    'allowed-by-default' | 'allowed-by-host-rule' | 'allowed-by-approval'
  >;
}

export interface RunEgressGatewayEvidence {
  schemaVersion: typeof RUN_EGRESS_GATEWAY_EVIDENCE_SCHEMA_VERSION;
  gatewayId: string;
  runKey: string;
  attributionKey: string;
  policyHash: string;
  state: 'enforced' | 'stopped';
  protocols: Array<'http' | 'connect' | 'ws' | 'socks5'>;
  proxyEnvironmentKeys: Array<
    | 'HTTP_PROXY'
    | 'HTTPS_PROXY'
    | 'ALL_PROXY'
    | 'http_proxy'
    | 'https_proxy'
    | 'all_proxy'
    | 'NO_PROXY'
    | 'no_proxy'
  >;
  startedAt: string;
  stoppedAt?: string;
}

export interface SandboxEnvironmentRules {
  passthrough: string[];
  redactDisplay: boolean;
}

export interface SandboxCredentialRules {
  mode: SandboxCredentialMode;
  brokerRefs: string[];
}

export interface SandboxPolicyPreset {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  builtIn?: boolean;
  enforcement: SandboxPolicyEnforcement;
  requiredCapabilities: SkillCapabilityId[];
  filesystem: SandboxFilesystemRules;
  network: SandboxNetworkRules;
  environment: SandboxEnvironmentRules;
  credentials: SandboxCredentialRules;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxProviderCapabilities {
  provider?: string;
  supported: SandboxProviderCapabilityId[];
  advisory?: SandboxProviderCapabilityId[];
}

export interface FilesystemSandboxBackendStatus {
  backend: FilesystemSandboxBackendId;
  state: FilesystemSandboxBackendState;
  capabilityVersion: string;
  backendVersion?: string;
  backendExecutableDigest?: string;
  platformBackend:
    'seatbelt' | 'landlock-bubblewrap' | 'restricted-token' | 'provider-native' | 'none';
  supported: SandboxProviderCapabilityId[];
  reason: string;
}

export interface SandboxPolicyEvaluationInput {
  presetId?: string;
  preset?: SandboxPolicyPreset;
  provider?: string;
  workspacePath?: string;
  requiredCapabilities?: SkillCapabilityId[];
  providerRuntimeManifestDigest?: string;
  /** Internal launch-time snapshot. Never accepted from public dry-run callers. */
  providerRuntimeManifest?: import('./provider-runtime.types.js').ProviderRuntimeManifest;
}

export interface SandboxPolicyDryRunRequest extends Omit<
  SandboxPolicyEvaluationInput,
  'providerRuntimeManifestDigest' | 'providerRuntimeManifest'
> {
  providerRuntimeManifestDigest: string;
}

export interface SandboxPolicyRuleEvaluation {
  id: string;
  label: string;
  capability: SandboxProviderCapabilityId;
  status: SandboxPolicyRuleStatus;
  detail: string;
}

export interface SandboxPolicyDryRunResult {
  decision: SandboxPolicyDecision;
  preset: SandboxPolicyPreset;
  provider?: string;
  effective: {
    sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
    networkAccessEnabled: boolean;
    envPassthrough: string[];
    credentialRefs: string[];
    filesystemBackend: FilesystemSandboxBackendStatus;
    /** Compiled harness-owned policy. Provider launch injection lands with the gateway runtime. */
    networkPolicy?: RunEgressPolicy;
  };
  evaluations: SandboxPolicyRuleEvaluation[];
  unsupportedRules: SandboxPolicyRuleEvaluation[];
  warnings: string[];
  remediation?: string;
}
