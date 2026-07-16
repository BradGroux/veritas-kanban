import type { SandboxProviderCapabilityId } from './sandbox-policy.types.js';

export const PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION = 'provider-runtime-manifest/v1' as const;

export const PROVIDER_RUNTIME_PROBE_REVISION = 3 as const;

export const KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS = [
  'run.start',
  'run.stop',
  'run.status',
  'run.logs',
  'run.complete',
  'run.streaming',
  'run.structured-events',
  'run.follow-up',
  'run.steer',
  'run.interrupt',
  'run.resume',
  'run.fork',
  'run.reattach',
  'run.approvals',
  'run.elicitation',
  'tool.calls',
  'tool.parallel',
  'tool.mcp',
  'output.structured',
  'usage.tokens',
  'artifact.write',
  'workspace.worktrees',
  'filesystem.read',
  'filesystem.write',
  'filesystem.deny-paths',
  'filesystem.dotfile-masking',
  'network.disable',
  'network.allowlist',
  'network.block-private',
  'network.block-metadata',
  'environment.allowlist',
  'credential.broker',
] as const;

export type KnownProviderRuntimeCapabilityId =
  (typeof KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS)[number];

export type ProviderRuntimeCapabilityId =
  KnownProviderRuntimeCapabilityId | SandboxProviderCapabilityId | (string & {});

export type ProviderRuntimeCapabilityState = 'supported' | 'advisory' | 'unsupported' | 'unknown';

export type ProviderRuntimeEvidenceSource = 'runtime-probe' | 'contract-test' | 'host-enforced';

export type ProviderRuntimeProbeState = 'ready' | 'degraded' | 'failed';

export interface ProviderRuntimeCapabilityEvidence {
  id: ProviderRuntimeCapabilityId;
  state: ProviderRuntimeCapabilityState;
  source: ProviderRuntimeEvidenceSource;
  reason: string;
}

export interface ProviderRuntimeProbeEvidence {
  state: ProviderRuntimeProbeState;
  probedAt: string;
  source: string;
  diagnostics: string[];
}

/**
 * Immutable, evidence-backed snapshot of one provider adapter's runtime posture.
 *
 * `digest` is a SHA-256 of the canonical manifest payload excluding the digest
 * itself. Consumers can therefore prove that the snapshot persisted with a run
 * is the exact posture used for launch decisions.
 */
export interface ProviderRuntimeManifest {
  schemaVersion: typeof PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION;
  /** Positive revision used to interpret probe evidence within the v1 contract. */
  probeRevision: number;
  provider: string;
  adapter: string;
  protocolVersion: string;
  providerVersion: string;
  providerBuild?: string;
  models: string[];
  capabilities: ProviderRuntimeCapabilityEvidence[];
  probe: ProviderRuntimeProbeEvidence;
  digest: string;
}

export interface ProviderRuntimeCapabilityAssessment {
  id: ProviderRuntimeCapabilityId;
  state: ProviderRuntimeCapabilityState;
  satisfied: boolean;
  advisory: boolean;
  reason: string;
}

export interface ProviderRuntimeManifestAssessment {
  manifestDigest: string;
  provider: string;
  adapter: string;
  providerVersion: string;
  models: string[];
  probeState: ProviderRuntimeProbeState;
  compatible: boolean;
  advisory: boolean;
  capabilities: ProviderRuntimeCapabilityAssessment[];
  reasons: string[];
  warnings: string[];
}

export interface ProviderRuntimeSelection {
  requiredCapabilities: ProviderRuntimeCapabilityId[];
  compatible: boolean;
  selectedManifest?: ProviderRuntimeManifestAssessment;
  candidates: ProviderRuntimeManifestAssessment[];
  reason: string;
}

export interface ProviderRuntimeRouteCandidate {
  agent: string;
  model?: string;
  available: boolean;
  selected: boolean;
  reason: string;
  selection: ProviderRuntimeSelection;
}

export const PROVIDER_RUNTIME_CONTROL_ACTIONS = [
  'start',
  'status',
  'logs',
  'complete',
  'stop',
  'interrupt',
  'message',
  'resume',
  'reattach',
  'approvals',
  'tool-calls',
  'mcp',
  'structured-output',
  'token-usage',
  'artifacts',
] as const;

export type ProviderRuntimeControlAction = (typeof PROVIDER_RUNTIME_CONTROL_ACTIONS)[number];

export interface ProviderRuntimeControlAssessment {
  action: ProviderRuntimeControlAction;
  label: string;
  capabilityId: ProviderRuntimeCapabilityId;
  state: ProviderRuntimeCapabilityState;
  available: boolean;
  advisory: boolean;
  reason: string;
  remediation?: string;
}

export interface ProviderRuntimeControlSet {
  manifestDigest?: string;
  provider?: string;
  providerVersion?: string;
  probeState?: ProviderRuntimeProbeState;
  controls: ProviderRuntimeControlAssessment[];
}

export function findProviderRuntimeCapability(
  manifest: ProviderRuntimeManifest,
  capabilityId: ProviderRuntimeCapabilityId
): ProviderRuntimeCapabilityEvidence | undefined {
  return manifest.capabilities.find((capability) => capability.id === capabilityId);
}
