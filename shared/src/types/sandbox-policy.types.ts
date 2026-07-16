import type { SkillCapabilityId } from './skill-capability.types.js';

export type SandboxPolicyEnforcement = 'required' | 'advisory';
export type SandboxNetworkDefault = 'allow' | 'deny';
export type SandboxCredentialMode = 'none' | 'brokered' | 'env-passthrough';
export type SandboxPolicyDecision = 'allow' | 'warn' | 'block';
export type SandboxPolicyRuleStatus = 'supported' | 'unsupported' | 'advisory';
export type SandboxProviderCapabilityId =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'filesystem.deny-paths'
  | 'filesystem.dotfile-masking'
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
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  blockPrivateNetwork: boolean;
  blockMetadataEndpoints: boolean;
  blockLoopback: boolean;
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
  };
  evaluations: SandboxPolicyRuleEvaluation[];
  unsupportedRules: SandboxPolicyRuleEvaluation[];
  warnings: string[];
  remediation?: string;
}
