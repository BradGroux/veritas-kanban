import {
  PHASE_AUTHORITY_DIMENSIONS,
  PHASE_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
  PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION,
  type EffectivePhasePlanArtifact,
  type PhaseAuthority,
  type PhaseAuthorityDimension,
  type PhaseAuthorityEvaluation,
  type PhaseCapabilityBlocker,
  type PhaseCapabilityCompilerInput,
  type PhaseCapabilityEvidence,
  type PhaseCapabilityProfile,
} from '@veritas-kanban/shared';
import {
  phaseCapabilityCompilerInputSchema,
  phaseCapabilityEvidenceSchema,
  phaseCapabilityProfileSchema,
} from '../schemas/phase-capability-schemas.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';

const EMPTY_AUTHORITY = emptyAuthority();

const ALL_DIMENSIONS = [...PHASE_AUTHORITY_DIMENSIONS];
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

const BUILT_IN_PHASE_CAPABILITY_PROFILES = [
  profile({
    id: 'builtin-explore',
    phase: 'explore',
    name: 'Explore',
    description: 'Inspect the workspace without mutation, task credentials, or external changes.',
    authority: authority({
      'filesystem.read': ['<workspace>'],
      'command.execute': ['inspect'],
      'network.egress': [],
      'external.action': ['read'],
    }),
  }),
  profile({
    id: 'builtin-plan',
    phase: 'plan',
    name: 'Plan',
    description:
      'Inspect and plan without general workspace mutation; an optional plan artifact uses one harness-owned path.',
    authority: authority({
      'filesystem.read': ['<workspace>'],
      'command.execute': ['inspect'],
      'network.egress': [],
      'external.action': ['read'],
      'artifact.plan.write': ['harness-exact-path'],
    }),
    planArtifactPolicy: EXACT_PLAN_ARTIFACT,
  }),
  profile({
    id: 'builtin-implement',
    phase: 'implement',
    name: 'Implement',
    description:
      'Modify the workspace and run implementation commands without publishing external changes.',
    authority: authority({
      'filesystem.read': ['<workspace>'],
      'filesystem.write': ['<workspace>'],
      'command.execute': ['inspect', 'build', 'test', 'format', 'mutate'],
      'network.egress': ['*'],
      'credential.access': ['*'],
      'external.action': ['read'],
    }),
  }),
  profile({
    id: 'builtin-verify',
    phase: 'verify',
    name: 'Verify',
    description:
      'Run bounded build and test commands while keeping credentials and external mutations disabled.',
    authority: authority({
      'filesystem.read': ['<workspace>'],
      'filesystem.write': ['<workspace>'],
      'command.execute': ['inspect', 'build', 'test'],
      'network.egress': ['*'],
      'external.action': ['read'],
    }),
  }),
  profile({
    id: 'builtin-publish',
    phase: 'publish',
    name: 'Publish',
    description:
      'Allow separately bounded workspace, command, network, credential, and external publication authority.',
    authority: authority({
      'filesystem.read': ['<workspace>'],
      'filesystem.write': ['<workspace>'],
      'command.execute': ['inspect', 'build', 'test', 'publish'],
      'network.egress': ['*'],
      'credential.access': ['*'],
      'external.action': ['read', 'mutate'],
    }),
    approvalRequiredDimensions: ['credential.access', 'external.action'],
  }),
] satisfies PhaseCapabilityProfile[];

export function listBuiltInPhaseCapabilityProfiles(): PhaseCapabilityProfile[] {
  return BUILT_IN_PHASE_CAPABILITY_PROFILES.map((candidate) => structuredClone(candidate));
}

export function getBuiltInPhaseCapabilityProfile(
  phase: PhaseCapabilityProfile['phase']
): PhaseCapabilityProfile {
  const candidate = BUILT_IN_PHASE_CAPABILITY_PROFILES.find(
    (profileCandidate) => profileCandidate.phase === phase
  );
  if (!candidate) throw new Error(`Unknown built-in phase: ${phase}`);
  return structuredClone(candidate);
}

/**
 * Compile a monotonic authority intersection. This function is pure: it does
 * not read configuration, mutate attempts, or infer provider capabilities.
 */
export function compilePhaseCapabilityAuthority(
  input: PhaseCapabilityCompilerInput
): PhaseCapabilityEvidence {
  const parsed = phaseCapabilityCompilerInputSchema.parse(input) as PhaseCapabilityCompilerInput;
  const sources = Object.values(parsed.sources);
  const identity = parsed.profile
    ? {
        mode: 'profile' as const,
        phase: parsed.profile.phase,
        profileId: parsed.profile.id,
        profileVersion: parsed.profile.version,
      }
    : {
        mode: 'legacy' as const,
        phase: 'legacy' as const,
      };
  const requestedAuthority = parsed.profile
    ? cloneAuthority(parsed.profile.authority)
    : authority({
        'filesystem.read': ['*'],
        'filesystem.write': ['*'],
        'command.execute': ['*'],
        'network.egress': ['*'],
        'credential.access': ['*'],
        'external.action': ['*'],
      });
  const requiredDimensions = parsed.profile ? [...parsed.profile.requiredDimensions] : [];
  const approvalRequiredDimensions = parsed.profile
    ? [...parsed.profile.approvalRequiredDimensions]
    : [];
  const blockers: PhaseCapabilityBlocker[] = [];
  const warnings: string[] = [];

  let planArtifact: EffectivePhasePlanArtifact | undefined;
  if (parsed.planArtifact) {
    if (parsed.profile?.planArtifactPolicy.mode !== 'harness-exact-path') {
      requestedAuthority['artifact.plan.write'] = [];
      blockers.push({
        code: 'plan-artifact-not-allowed',
        dimension: 'artifact.plan.write',
        message: 'The selected phase profile does not allow a plan-artifact exception.',
      });
    } else if (!isSafeExactArtifactPath(parsed.planArtifact.exactPath)) {
      blockers.push({
        code: 'plan-artifact-path-invalid',
        dimension: 'artifact.plan.write',
        message:
          'The plan artifact must be one normalized repository-relative path without traversal, control characters, backslashes, or shell syntax.',
      });
    } else {
      planArtifact = {
        exactPath: parsed.planArtifact.exactPath,
        owner: 'veritas-kanban',
        transport: 'harness-api',
        shellRedirection: false,
        indirectWrites: false,
      };
      if (!requiredDimensions.includes('artifact.plan.write')) {
        requiredDimensions.push('artifact.plan.write');
      }
    }
  } else {
    requestedAuthority['artifact.plan.write'] = [];
  }

  const effectiveAuthority = cloneAuthority(EMPTY_AUTHORITY);
  const evaluations: PhaseAuthorityEvaluation[] = [];
  for (const dimension of PHASE_AUTHORITY_DIMENSIONS) {
    const requestedScopes = requestedAuthority[dimension];
    let effectiveScopes = [...requestedScopes];
    const limitingSourceIds: string[] = [];
    const required = requiredDimensions.includes(dimension);
    let enforcementBlocked = false;

    for (const source of sources) {
      const enforcement = source.enforcement[dimension];
      if (enforcement !== 'enforced') {
        effectiveScopes = [];
        limitingSourceIds.push(source.id);
        if (required) {
          enforcementBlocked = true;
          blockers.push({
            code:
              enforcement === 'unsupported'
                ? 'required-authority-unsupported'
                : 'required-authority-unenforceable',
            dimension,
            sourceId: source.id,
            message:
              enforcement === 'unsupported'
                ? `${source.id} does not support required ${dimension} enforcement.`
                : `${source.id} cannot enforce required ${dimension} authority.`,
          });
        }
        continue;
      }

      const next = intersectScopes(effectiveScopes, source.authority[dimension]);
      if (!sameScopes(effectiveScopes, next)) limitingSourceIds.push(source.id);
      effectiveScopes = next;
    }

    if (
      required &&
      requestedScopes.length > 0 &&
      effectiveScopes.length === 0 &&
      !enforcementBlocked
    ) {
      blockers.push({
        code: 'required-authority-denied',
        dimension,
        message: `The authority intersection denies every requested ${dimension} scope.`,
      });
    }

    if (!required && requestedScopes.length > 0 && effectiveScopes.length === 0) {
      warnings.push(`Optional ${dimension} authority was removed by the effective intersection.`);
    }

    effectiveAuthority[dimension] = effectiveScopes;
    evaluations.push({
      dimension,
      requestedScopes: [...requestedScopes],
      effectiveScopes: [...effectiveScopes],
      required,
      limitingSourceIds: [...new Set(limitingSourceIds)].sort(),
    });
  }

  if (planArtifact) {
    if (effectiveAuthority['artifact.plan.write'].length === 0) {
      planArtifact = undefined;
    } else {
      effectiveAuthority['artifact.plan.write'] = [planArtifact.exactPath];
      const evaluation = evaluations.find(
        (candidate) => candidate.dimension === 'artifact.plan.write'
      );
      if (evaluation) evaluation.effectiveScopes = [planArtifact.exactPath];
    }
  }
  if (parsed.planArtifact && !planArtifact) {
    effectiveAuthority['artifact.plan.write'] = [];
    const evaluation = evaluations.find(
      (candidate) => candidate.dimension === 'artifact.plan.write'
    );
    if (evaluation) {
      evaluation.effectiveScopes = [];
      evaluation.limitingSourceIds = [
        ...new Set([...evaluation.limitingSourceIds, 'phase-compiler']),
      ].sort();
    }
  }

  if (!parsed.profile) {
    warnings.push(
      'Legacy mode applies no phase profile; existing parent, agent, sandbox, tool, and launch policies remain authoritative.'
    );
  }

  const narrowed = evaluations.some((evaluation) => {
    if (
      evaluation.dimension === 'artifact.plan.write' &&
      planArtifact &&
      sameScopes(evaluation.requestedScopes, ['harness-exact-path']) &&
      sameScopes(evaluation.effectiveScopes, [planArtifact.exactPath])
    ) {
      return false;
    }
    return !sameScopes(evaluation.requestedScopes, evaluation.effectiveScopes);
  });
  const payload: Omit<PhaseCapabilityEvidence, 'digest'> = {
    schemaVersion: PHASE_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
    status: blockers.length > 0 ? 'blocked' : narrowed ? 'narrowed' : 'allowed',
    identity,
    requestedAuthority,
    effectiveAuthority,
    requiredDimensions: sortDimensions(requiredDimensions),
    approvalRequiredDimensions: sortDimensions(approvalRequiredDimensions),
    evaluations,
    blockers: blockers.sort(compareBlockers),
    warnings: [...new Set(warnings)].sort(),
    ...(planArtifact ? { planArtifact } : {}),
  };
  return phaseCapabilityEvidenceSchema.parse({
    ...payload,
    digest: digestRunLaunchValue(payload),
  }) as PhaseCapabilityEvidence;
}

export function calculatePhaseCapabilityEvidenceDigest(evidence: PhaseCapabilityEvidence): string {
  const { digest: _digest, ...payload } = evidence;
  return digestRunLaunchValue(payload);
}

export function verifyPhaseCapabilityEvidenceDigest(evidence: PhaseCapabilityEvidence): boolean {
  return evidence.digest === calculatePhaseCapabilityEvidenceDigest(evidence);
}

function profile(
  input: Pick<PhaseCapabilityProfile, 'id' | 'phase' | 'name' | 'description' | 'authority'> & {
    planArtifactPolicy?: PhaseCapabilityProfile['planArtifactPolicy'];
    approvalRequiredDimensions?: PhaseAuthorityDimension[];
  }
): PhaseCapabilityProfile {
  return phaseCapabilityProfileSchema.parse({
    schemaVersion: PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION,
    id: input.id,
    version: 1,
    phase: input.phase,
    name: input.name,
    description: input.description,
    builtIn: true,
    authority: input.authority,
    requiredDimensions: ALL_DIMENSIONS,
    approvalRequiredDimensions: input.approvalRequiredDimensions ?? [],
    planArtifactPolicy: input.planArtifactPolicy ?? DISABLED_PLAN_ARTIFACT,
  }) as PhaseCapabilityProfile;
}

function authority(overrides: Partial<PhaseAuthority>): PhaseAuthority {
  const value = emptyAuthority();
  for (const dimension of PHASE_AUTHORITY_DIMENSIONS) {
    if (overrides[dimension]) value[dimension] = [...overrides[dimension]];
  }
  return value;
}

function emptyAuthority(): PhaseAuthority {
  const value = {} as PhaseAuthority;
  for (const dimension of PHASE_AUTHORITY_DIMENSIONS) value[dimension] = [];
  return value;
}

function cloneAuthority(value: PhaseAuthority): PhaseAuthority {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, [...value[dimension]]])
  ) as PhaseAuthority;
}

function intersectScopes(left: string[], right: string[]): string[] {
  if (left.length === 0 || right.length === 0) return [];
  if (left[0] === '*') return [...right];
  if (right[0] === '*') return [...left];
  const rightScopes = new Set(right);
  return left.filter((scope) => rightScopes.has(scope));
}

function sameScopes(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((scope, index) => scope === right[index]);
}

function sortDimensions(dimensions: PhaseAuthorityDimension[]): PhaseAuthorityDimension[] {
  const requested = new Set(dimensions);
  return PHASE_AUTHORITY_DIMENSIONS.filter((dimension) => requested.has(dimension));
}

function compareBlockers(left: PhaseCapabilityBlocker, right: PhaseCapabilityBlocker): number {
  return (
    (left.dimension ?? '').localeCompare(right.dimension ?? '') ||
    (left.sourceId ?? '').localeCompare(right.sourceId ?? '') ||
    left.code.localeCompare(right.code)
  );
}

function isSafeExactArtifactPath(value: string): boolean {
  if (
    value !== value.trim() ||
    value.startsWith('/') ||
    /^[a-z]:/i.test(value) ||
    value.includes('\\') ||
    hasControlCharacters(value) ||
    /[<>|;&`$]/.test(value)
  ) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments.length > 0 &&
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
