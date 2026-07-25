import {
  PHASE_AUTHORITY_DIMENSIONS,
  PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION,
  type PhaseAuthority,
  type PhaseAuthorityDimension,
  type PhaseAuthorityEnforcement,
  type PhaseAuthorityEnforcementState,
  type PhaseAuthoritySource,
  type PhaseCapabilityCompilerSources,
  type PhaseCapabilityEvidence,
  type PhaseCapabilityProfile,
  type PhaseName,
  type ProviderRuntimeCapabilityId,
  type ProviderRuntimeManifest,
  type RunLaunchFilesystemSandboxEvidence,
  type RunLaunchManifestOriginScope,
  type RunLaunchPhaseAuthority,
  type RunLaunchPhaseSourceReference,
  type SandboxPolicyDryRunResult,
  type SandboxPolicyPreset,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import {
  phaseCapabilityEvidenceSchema,
  phaseCapabilityProfileSchema,
} from '../schemas/phase-capability-schemas.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
  verifyPhaseCapabilityEvidenceDigest,
} from './phase-capability-service.js';

const WILDCARD_AUTHORITY = authority(
  Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, ['*']])
  ) as Partial<PhaseAuthority>
);
const ENFORCED = enforcement('enforced');
const DISABLED_PLAN_ARTIFACT = {
  mode: 'disabled',
  owner: 'veritas-kanban',
  maximumPaths: 0,
  transport: 'harness-api',
  shellRedirection: false,
  indirectWrites: false,
} as const;
const EXACT_PLAN_ARTIFACT = {
  mode: 'harness-exact-path',
  owner: 'veritas-kanban',
  maximumPaths: 1,
  transport: 'harness-api',
  shellRedirection: false,
  indirectWrites: false,
} as const;

export interface PhaseLaunchParentSnapshot {
  attemptId: string;
  manifestDigest?: string;
  evidence?: PhaseCapabilityEvidence;
}

export interface PhaseLaunchExecutionEnforcement {
  commandExecute?: PhaseAuthorityEnforcementState;
  externalAction?: PhaseAuthorityEnforcementState;
  planArtifactWrite?: PhaseAuthorityEnforcementState;
}

export interface PhaseLaunchAuthorityCompileInput {
  requestedPhase?: PhaseName;
  parent?: PhaseLaunchParentSnapshot;
  agentProfile?: {
    id: string;
    version?: string | number;
  };
  sandboxPolicy: SandboxPolicyDryRunResult;
  providerRuntimeManifest: ProviderRuntimeManifest;
  filesystemSandbox?: RunLaunchFilesystemSandboxEvidence;
  selectedHost: string;
  toolCatalogId?: string;
  executionEnforcement?: PhaseLaunchExecutionEnforcement;
}

/**
 * Compiles phase authority from launch-time evidence without mutating attempts
 * or inferring provider features from provider names.
 */
export class PhaseLaunchAuthorityService {
  compile(input: PhaseLaunchAuthorityCompileInput): RunLaunchPhaseAuthority {
    const parentEvidence = verifiedParentEvidence(input.parent);
    const profile = resolvePhaseProfile(input.requestedPhase, parentEvidence);
    const desired = desiredAuthority(profile, parentEvidence);
    const explicitPhase = Boolean(profile);
    const sources = {
      parent: parentSource(input.parent, parentEvidence),
      agentProfile: agentProfileSource(input.agentProfile),
      sandbox: sandboxSource(input, desired),
      toolCatalog: toolCatalogSource(input, desired, explicitPhase),
      launchPolicy: launchPolicySource(input),
    } satisfies PhaseCapabilityCompilerSources;
    const evidence = compilePhaseCapabilityAuthority({
      ...(profile ? { profile } : {}),
      sources,
    });

    return {
      evidence,
      sourceReferences: [
        referenceFor(
          sources.parent,
          input.parent ? 'parent' : 'system-default',
          input.parent,
          parentEvidence
        ),
        referenceFor(sources.agentProfile, input.agentProfile ? 'agent-profile' : 'system-default'),
        referenceFor(sources.sandbox, 'run'),
        referenceFor(sources.toolCatalog, input.toolCatalogId ? 'run' : 'system-default'),
        referenceFor(sources.launchPolicy, 'provider'),
      ],
    };
  }

  /**
   * Narrows the concrete sandbox preset before the provider launch is built.
   * Legacy launches are returned unchanged.
   */
  narrowSandboxPreset(
    preset: SandboxPolicyPreset,
    requestedPhase?: PhaseName,
    parent?: PhaseLaunchParentSnapshot
  ): SandboxPolicyPreset {
    const parentEvidence = verifiedParentEvidence(parent);
    const profile = resolvePhaseProfile(requestedPhase, parentEvidence);
    if (!profile) return structuredClone(preset);

    const desired = desiredAuthority(profile, parentEvidence);
    const narrowed = structuredClone(preset);
    narrowed.filesystem.readPaths = narrowScopes(
      narrowed.filesystem.readPaths,
      desired['filesystem.read']
    );
    narrowed.filesystem.writePaths = narrowScopes(
      narrowed.filesystem.writePaths,
      desired['filesystem.write']
    );

    const network = desired['network.egress'];
    if (network.length === 0) {
      narrowed.network.defaultEgress = 'deny';
      narrowed.network.allowedHosts = [];
      narrowed.network.allowedMethods = [];
      narrowed.network.allowedPathPrefixes = [];
      narrowed.network.blockPrivateNetwork = true;
      narrowed.network.blockMetadataEndpoints = true;
      narrowed.network.blockLoopback = true;
    } else if (!network.includes('*')) {
      narrowed.network.defaultEgress = 'deny';
      narrowed.network.allowedHosts = narrowScopes(narrowed.network.allowedHosts, network);
    }

    const credentials = desired['credential.access'];
    if (credentials.length === 0) {
      narrowed.credentials.mode = 'none';
      narrowed.credentials.brokerRefs = [];
    } else if (!credentials.includes('*')) {
      narrowed.credentials.brokerRefs = narrowScopes(narrowed.credentials.brokerRefs, credentials);
      if (narrowed.credentials.brokerRefs.length === 0) narrowed.credentials.mode = 'none';
    }
    return narrowed;
  }

  assertEnforceable(phase: RunLaunchPhaseAuthority): void {
    if (phase.evidence.status !== 'blocked') return;
    throw new ConflictError('The effective phase authority cannot be enforced.', {
      phaseEvidenceDigest: phase.evidence.digest,
      phase: phase.evidence.identity,
      blockers: phase.evidence.blockers,
    });
  }
}

function resolvePhaseProfile(
  requestedPhase: PhaseName | undefined,
  parentEvidence: PhaseCapabilityEvidence | undefined
): PhaseCapabilityProfile | undefined {
  if (requestedPhase) return getBuiltInPhaseCapabilityProfile(requestedPhase);
  if (parentEvidence?.identity.mode !== 'profile') return undefined;

  const requestedArtifact = parentEvidence.requestedAuthority['artifact.plan.write'];
  return phaseCapabilityProfileSchema.parse({
    schemaVersion: PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION,
    id: parentEvidence.identity.profileId,
    version: parentEvidence.identity.profileVersion,
    phase: parentEvidence.identity.phase,
    name: `Inherited ${parentEvidence.identity.phase}`,
    description: 'Inherited from the exact parent phase evidence snapshot.',
    authority: parentEvidence.requestedAuthority,
    requiredDimensions: parentEvidence.requiredDimensions,
    approvalRequiredDimensions: parentEvidence.approvalRequiredDimensions,
    planArtifactPolicy: requestedArtifact.includes('harness-exact-path')
      ? EXACT_PLAN_ARTIFACT
      : DISABLED_PLAN_ARTIFACT,
  }) as PhaseCapabilityProfile;
}

function desiredAuthority(
  profile: PhaseCapabilityProfile | undefined,
  parentEvidence: PhaseCapabilityEvidence | undefined
): PhaseAuthority {
  const requested = profile?.authority ?? WILDCARD_AUTHORITY;
  if (!parentEvidence) return cloneAuthority(requested);
  return intersectAuthority(requested, parentEvidence.effectiveAuthority);
}

function parentSource(
  parent: PhaseLaunchParentSnapshot | undefined,
  evidence: PhaseCapabilityEvidence | undefined
): PhaseCapabilityCompilerSources['parent'] {
  return {
    id: parent ? `parent:${safeId(parent.attemptId)}` : 'parent:none',
    kind: 'parent',
    authority: evidence
      ? cloneAuthority(evidence.effectiveAuthority)
      : cloneAuthority(WILDCARD_AUTHORITY),
    enforcement: { ...ENFORCED },
  };
}

function agentProfileSource(
  profile: PhaseLaunchAuthorityCompileInput['agentProfile']
): PhaseCapabilityCompilerSources['agentProfile'] {
  return {
    id: profile ? `agent-profile:${safeId(profile.id)}` : 'agent-profile:none',
    kind: 'agent-profile',
    authority: cloneAuthority(WILDCARD_AUTHORITY),
    enforcement: { ...ENFORCED },
  };
}

function sandboxSource(
  input: PhaseLaunchAuthorityCompileInput,
  desired: PhaseAuthority
): PhaseCapabilityCompilerSources['sandbox'] {
  const preset = input.sandboxPolicy.preset;
  const effective = input.sandboxPolicy.effective;
  const credentialScopes =
    preset.credentials.mode === 'none'
      ? []
      : preset.credentials.mode === 'brokered'
        ? [...effective.credentialRefs]
        : preset.environment.passthrough
            .filter(isCredentialEnvironmentKey)
            .map((key) => `env:${key}`);
  const networkScopes = !effective.networkAccessEnabled
    ? []
    : preset.network.defaultEgress === 'allow'
      ? ['*']
      : [...preset.network.allowedHosts];
  const sandboxAuthority = authority({
    'filesystem.read': [...preset.filesystem.readPaths],
    'filesystem.write':
      effective.sandboxMode === 'read-only' ? [] : [...preset.filesystem.writePaths],
    'command.execute': ['*'],
    'network.egress': networkScopes,
    'credential.access': credentialScopes,
    'external.action': ['*'],
    'artifact.plan.write': ['*'],
  });

  return {
    id: `sandbox:${safeId(preset.id)}`,
    kind: 'sandbox',
    authority: sandboxAuthority,
    enforcement: {
      'filesystem.read': filesystemEnforcement(input, desired['filesystem.read'], false),
      'filesystem.write': filesystemEnforcement(input, desired['filesystem.write'], true),
      'command.execute': 'enforced',
      'network.egress': networkEnforcement(
        input.providerRuntimeManifest,
        desired['network.egress']
      ),
      'credential.access': credentialEnforcement(
        input.providerRuntimeManifest,
        preset.credentials.mode,
        desired['credential.access']
      ),
      'external.action': 'enforced',
      'artifact.plan.write': 'enforced',
    },
  };
}

function toolCatalogSource(
  input: PhaseLaunchAuthorityCompileInput,
  desired: PhaseAuthority,
  explicitPhase: boolean
): PhaseCapabilityCompilerSources['toolCatalog'] {
  const configured = input.executionEnforcement;
  return {
    id: input.toolCatalogId ? 'tool-catalog:run' : 'tool-catalog:none',
    kind: 'tool-catalog',
    authority: cloneAuthority(WILDCARD_AUTHORITY),
    enforcement: {
      ...ENFORCED,
      'command.execute': configured?.commandExecute ?? (explicitPhase ? 'unsupported' : 'enforced'),
      'external.action': configured?.externalAction ?? (explicitPhase ? 'unsupported' : 'enforced'),
      'artifact.plan.write':
        desired['artifact.plan.write'].length === 0
          ? 'enforced'
          : (configured?.planArtifactWrite ?? (explicitPhase ? 'unsupported' : 'enforced')),
    },
  };
}

function launchPolicySource(
  input: PhaseLaunchAuthorityCompileInput
): PhaseCapabilityCompilerSources['launchPolicy'] {
  return {
    id: `launch-policy:${safeId(input.providerRuntimeManifest.provider)}:${safeId(input.selectedHost)}`,
    kind: 'launch-policy',
    authority: cloneAuthority(WILDCARD_AUTHORITY),
    enforcement: { ...ENFORCED },
  };
}

function referenceFor(
  source: PhaseAuthoritySource,
  originScope: RunLaunchManifestOriginScope,
  parent?: PhaseLaunchParentSnapshot,
  parentEvidence?: PhaseCapabilityEvidence
): RunLaunchPhaseSourceReference {
  return {
    sourceId: source.id,
    kind: source.kind,
    originScope,
    sourceDigest: digestRunLaunchValue(source),
    ...(parent
      ? {
          parentAttemptId: parent.attemptId,
          ...(parent.manifestDigest ? { parentManifestDigest: parent.manifestDigest } : {}),
          ...(parentEvidence ? { parentEvidenceDigest: parentEvidence.digest } : {}),
        }
      : {}),
  };
}

function filesystemEnforcement(
  input: PhaseLaunchAuthorityCompileInput,
  desiredScopes: string[],
  write: boolean
): PhaseAuthorityEnforcementState {
  const boundaryState =
    input.filesystemSandbox?.state ??
    (input.sandboxPolicy.effective.filesystemBackend.state === 'available'
      ? 'enforced'
      : input.sandboxPolicy.effective.filesystemBackend.state);
  if (boundaryState !== 'enforced' && boundaryState !== 'native') {
    return boundaryState === 'advisory' ? 'unenforceable' : 'unsupported';
  }
  if (write && desiredScopes.length === 0) {
    return runtimeCapabilityState(input.providerRuntimeManifest, 'filesystem.read');
  }
  return runtimeCapabilityState(
    input.providerRuntimeManifest,
    write ? 'filesystem.write' : 'filesystem.read'
  );
}

function networkEnforcement(
  manifest: ProviderRuntimeManifest,
  desiredScopes: string[]
): PhaseAuthorityEnforcementState {
  if (desiredScopes.includes('*')) return 'enforced';
  return runtimeCapabilityState(
    manifest,
    desiredScopes.length === 0 ? 'network.disable' : 'network.allowlist'
  );
}

function credentialEnforcement(
  manifest: ProviderRuntimeManifest,
  mode: SandboxPolicyPreset['credentials']['mode'],
  desiredScopes: string[]
): PhaseAuthorityEnforcementState {
  if (desiredScopes.length === 0 || desiredScopes.includes('*')) return 'enforced';
  return runtimeCapabilityState(
    manifest,
    mode === 'brokered' ? 'credential.broker' : 'environment.allowlist'
  );
}

function runtimeCapabilityState(
  manifest: ProviderRuntimeManifest,
  capabilityId: ProviderRuntimeCapabilityId
): PhaseAuthorityEnforcementState {
  const state = manifest.capabilities.find((capability) => capability.id === capabilityId)?.state;
  if (state === 'supported') return 'enforced';
  if (state === 'advisory') return 'unenforceable';
  return 'unsupported';
}

function verifiedParentEvidence(
  parent: PhaseLaunchParentSnapshot | undefined
): PhaseCapabilityEvidence | undefined {
  if (!parent?.evidence) return undefined;
  const evidence = phaseCapabilityEvidenceSchema.parse(parent.evidence) as PhaseCapabilityEvidence;
  if (!verifyPhaseCapabilityEvidenceDigest(evidence)) {
    throw new ConflictError('Parent phase evidence digest does not match its content.', {
      parentAttemptId: parent.attemptId,
      parentEvidenceDigest: evidence.digest,
    });
  }
  if (evidence.status === 'blocked') {
    throw new ConflictError('Blocked parent phase evidence cannot authorize a descendant.', {
      parentAttemptId: parent.attemptId,
      parentEvidenceDigest: evidence.digest,
    });
  }
  return evidence;
}

function authority(overrides: Partial<PhaseAuthority> = {}): PhaseAuthority {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, [...(overrides[dimension] ?? [])]])
  ) as PhaseAuthority;
}

function enforcement(state: PhaseAuthorityEnforcementState): PhaseAuthorityEnforcement {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, state])
  ) as PhaseAuthorityEnforcement;
}

function cloneAuthority(value: PhaseAuthority): PhaseAuthority {
  return authority(value);
}

function intersectAuthority(left: PhaseAuthority, right: PhaseAuthority): PhaseAuthority {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [
      dimension,
      intersectScopes(left[dimension], right[dimension]),
    ])
  ) as PhaseAuthority;
}

function intersectScopes(left: string[], right: string[]): string[] {
  if (left.length === 0 || right.length === 0) return [];
  if (left.includes('*')) return [...right];
  if (right.includes('*')) return [...left];
  const rightScopes = new Set(right);
  return left.filter((scope) => rightScopes.has(scope));
}

function narrowScopes(configured: string[], ceiling: string[]): string[] {
  if (ceiling.includes('*')) return [...configured];
  return intersectScopes(configured, ceiling);
}

function isCredentialEnvironmentKey(key: string): boolean {
  return /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|ACCESS_KEY)$/i.test(key);
}

function safeId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._:/-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/i, '')
    .slice(0, 120);
  return normalized || 'unknown';
}

export function phaseAuthorityHasScope(
  authorityValue: PhaseAuthority,
  dimension: PhaseAuthorityDimension,
  scope: string
): boolean {
  const scopes = authorityValue[dimension];
  return scopes.includes('*') || scopes.includes(scope);
}
