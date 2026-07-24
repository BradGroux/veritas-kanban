import type {
  HarnessSupportInvalidationKey,
  HarnessSupportStatus,
  HarnessSupportTier,
  HarnessTransport,
  ProviderRuntimeCapabilityEvidence,
} from './provider-runtime.types.js';

export const HARNESS_COMPATIBILITY_MATRIX_SCHEMA_VERSION =
  'harness-compatibility-matrix/v1' as const;

export type HarnessSourceAvailability = 'open-source' | 'partial-source';

export type HarnessCertificationInvalidationKey =
  HarnessSupportInvalidationKey | 'protocol-version' | 'capability-digest' | 'fixture-revision';

export interface HarnessCompatibilityEvidence {
  kind: 'source' | 'release' | 'documentation' | 'fixture';
  label: string;
  url?: string;
  path?: string;
  revision?: string;
}

export interface HarnessCompatibilityCertification {
  fixtureSet: string;
  fixtureRevision: number;
  capabilityDigest: string;
  status: 'not-run' | 'passed' | 'failed' | 'stale';
  invalidatedBy: HarnessCertificationInvalidationKey[];
  deterministicEvidence: HarnessCompatibilityEvidence[];
  credentialSmokePolicy: 'supplemental-only';
}

export interface HarnessCompatibilityGuide {
  documentationUrl: string;
  installation: string;
  authentication: string;
  configuration: string;
  permissions: string;
  mcp: string;
  worktree: string;
  upgrade: string;
  degradedState: string;
  troubleshooting: string;
}

export interface HarnessCompatibilityRecord {
  agentType: string;
  profileId: string;
  displayName: string;
  adapterId: string;
  transport: HarnessTransport;
  protocolVersion: string;
  platforms: Array<'darwin' | 'linux' | 'win32'>;
  testedVersions: string[];
  testedBuilds: string[];
  reviewedAt: string;
  sourceAvailability: HarnessSourceAvailability;
  evidence: HarnessCompatibilityEvidence[];
  capabilities: ProviderRuntimeCapabilityEvidence[];
  certification: HarnessCompatibilityCertification;
  limitations: string[];
  guide: HarnessCompatibilityGuide;
  supportStatus?: HarnessSupportStatus;
}

export interface HarnessCompatibilityMatrix {
  schemaVersion: typeof HARNESS_COMPATIBILITY_MATRIX_SCHEMA_VERSION;
  generatedAt: string;
  probeRevision: number;
  digest: string;
  tierDefinitions: Record<HarnessSupportTier, string>;
  records: HarnessCompatibilityRecord[];
  supportStatuses: HarnessSupportStatus[];
}
