import { z } from 'zod';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  PHASE_AUTHORITY_SOURCE_KINDS,
  PHASE_CAPABILITY_EVIDENCE_SCHEMA_VERSION,
  PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION,
  PHASE_NAMES,
  PHASE_TRANSITION_INTENT_SCHEMA_VERSION,
} from '@veritas-kanban/shared';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/i);
const safeTextSchema = z.string().trim().min(1).max(4_096);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const authorityScopeSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (scope) => !hasControlCharacters(scope),
    'Authority scopes cannot contain control characters'
  );
const authorityScopesSchema = z
  .array(authorityScopeSchema)
  .max(256)
  .refine((scopes) => new Set(scopes).size === scopes.length, 'Authority scopes must be unique')
  .refine(
    (scopes) => !scopes.includes('*') || scopes.length === 1,
    'Wildcard authority cannot be combined with exact scopes'
  );
const effectivePlanArtifactPathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(isSafeExactArtifactPath, 'Effective plan artifacts require one safe exact path');

export const phaseNameSchema = z.enum(PHASE_NAMES);
export const phaseAuthorityDimensionSchema = z.enum(PHASE_AUTHORITY_DIMENSIONS);
export const phaseAuthoritySourceKindSchema = z.enum(PHASE_AUTHORITY_SOURCE_KINDS);
export const phaseAuthorityEnforcementStateSchema = z.enum([
  'enforced',
  'unenforceable',
  'unsupported',
]);

export const phaseAuthoritySchema = z
  .object({
    'filesystem.read': authorityScopesSchema,
    'filesystem.write': authorityScopesSchema,
    'command.execute': authorityScopesSchema,
    'network.egress': authorityScopesSchema,
    'credential.access': authorityScopesSchema,
    'external.action': authorityScopesSchema,
    'artifact.plan.write': authorityScopesSchema,
  })
  .strict();

export const phaseAuthorityEnforcementSchema = z
  .object({
    'filesystem.read': phaseAuthorityEnforcementStateSchema,
    'filesystem.write': phaseAuthorityEnforcementStateSchema,
    'command.execute': phaseAuthorityEnforcementStateSchema,
    'network.egress': phaseAuthorityEnforcementStateSchema,
    'credential.access': phaseAuthorityEnforcementStateSchema,
    'external.action': phaseAuthorityEnforcementStateSchema,
    'artifact.plan.write': phaseAuthorityEnforcementStateSchema,
  })
  .strict();

export const phaseAuthoritySourceSchema = z
  .object({
    id: identifierSchema,
    kind: phaseAuthoritySourceKindSchema,
    authority: phaseAuthoritySchema,
    enforcement: phaseAuthorityEnforcementSchema,
  })
  .strict();

const phasePlanArtifactPolicySchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('disabled'),
      owner: z.literal('veritas-kanban'),
      maximumPaths: z.literal(0),
      transport: z.literal('harness-api'),
      shellRedirection: z.literal(false),
      indirectWrites: z.literal(false),
    })
    .strict(),
  z
    .object({
      mode: z.literal('harness-exact-path'),
      owner: z.literal('veritas-kanban'),
      maximumPaths: z.literal(1),
      transport: z.literal('harness-api'),
      shellRedirection: z.literal(false),
      indirectWrites: z.literal(false),
    })
    .strict(),
]);

export const phaseCapabilityProfileSchema = z
  .object({
    schemaVersion: z.literal(PHASE_CAPABILITY_PROFILE_SCHEMA_VERSION),
    id: identifierSchema,
    version: z.number().int().positive().max(10_000),
    phase: phaseNameSchema,
    name: z.string().trim().min(1).max(160),
    description: safeTextSchema,
    builtIn: z.boolean().optional(),
    authority: phaseAuthoritySchema,
    requiredDimensions: z
      .array(phaseAuthorityDimensionSchema)
      .max(PHASE_AUTHORITY_DIMENSIONS.length)
      .refine(
        (dimensions) => new Set(dimensions).size === dimensions.length,
        'Required authority dimensions must be unique'
      ),
    approvalRequiredDimensions: z
      .array(phaseAuthorityDimensionSchema)
      .max(PHASE_AUTHORITY_DIMENSIONS.length)
      .refine(
        (dimensions) => new Set(dimensions).size === dimensions.length,
        'Approval-required authority dimensions must be unique'
      ),
    planArtifactPolicy: phasePlanArtifactPolicySchema,
  })
  .strict()
  .superRefine((profile, context) => {
    const artifactScopes = profile.authority['artifact.plan.write'];
    if (profile.planArtifactPolicy.mode === 'disabled' && artifactScopes.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authority', 'artifact.plan.write'],
        message: 'Disabled plan-artifact policy cannot grant artifact write authority',
      });
    }
    if (
      profile.planArtifactPolicy.mode === 'harness-exact-path' &&
      (artifactScopes.length !== 1 || artifactScopes[0] !== 'harness-exact-path')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['authority', 'artifact.plan.write'],
        message: 'Plan-artifact authority must use only the harness-exact-path scope',
      });
    }
  });

export const phaseIdentitySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('legacy'), phase: z.literal('legacy') }).strict(),
  z
    .object({
      mode: z.literal('profile'),
      phase: phaseNameSchema,
      profileId: identifierSchema,
      profileVersion: z.number().int().positive().max(10_000),
    })
    .strict(),
]);

export const phaseTransitionIntentSchema = z
  .object({
    schemaVersion: z.literal(PHASE_TRANSITION_INTENT_SCHEMA_VERSION),
    from: phaseIdentitySchema,
    to: phaseIdentitySchema,
    actor: z.string().trim().min(1).max(240),
    reason: safeTextSchema,
    requestedAt: z.string().datetime({ offset: true }),
    parentEvidenceDigest: digestSchema.optional(),
  })
  .strict();

const sourceFor = (kind: (typeof PHASE_AUTHORITY_SOURCE_KINDS)[number]) =>
  phaseAuthoritySourceSchema.extend({ kind: z.literal(kind) });

export const phaseCapabilityCompilerInputSchema = z
  .object({
    profile: phaseCapabilityProfileSchema.optional(),
    sources: z
      .object({
        parent: sourceFor('parent'),
        agentProfile: sourceFor('agent-profile'),
        sandbox: sourceFor('sandbox'),
        toolCatalog: sourceFor('tool-catalog'),
        launchPolicy: sourceFor('launch-policy'),
      })
      .strict(),
    planArtifact: z
      .object({
        exactPath: z.string().min(1).max(4_096),
        owner: z.literal('veritas-kanban'),
        transport: z.literal('harness-api'),
      })
      .strict()
      .optional(),
  })
  .strict();

export const phaseCapabilityBlockerSchema = z
  .object({
    code: z.enum([
      'required-authority-denied',
      'required-authority-unsupported',
      'required-authority-unenforceable',
      'plan-artifact-not-allowed',
      'plan-artifact-path-invalid',
    ]),
    message: safeTextSchema,
    dimension: phaseAuthorityDimensionSchema.optional(),
    sourceId: identifierSchema.optional(),
  })
  .strict();

export const phaseCapabilityEvidenceSchema = z
  .object({
    schemaVersion: z.literal(PHASE_CAPABILITY_EVIDENCE_SCHEMA_VERSION),
    digest: digestSchema,
    status: z.enum(['allowed', 'narrowed', 'blocked']),
    identity: phaseIdentitySchema,
    requestedAuthority: phaseAuthoritySchema,
    effectiveAuthority: phaseAuthoritySchema,
    requiredDimensions: z.array(phaseAuthorityDimensionSchema),
    approvalRequiredDimensions: z.array(phaseAuthorityDimensionSchema),
    evaluations: z.array(
      z
        .object({
          dimension: phaseAuthorityDimensionSchema,
          requestedScopes: authorityScopesSchema,
          effectiveScopes: authorityScopesSchema,
          required: z.boolean(),
          limitingSourceIds: z.array(identifierSchema).max(16),
        })
        .strict()
    ),
    blockers: z.array(phaseCapabilityBlockerSchema),
    warnings: z.array(z.string().min(1).max(4_096)),
    planArtifact: z
      .object({
        exactPath: effectivePlanArtifactPathSchema,
        owner: z.literal('veritas-kanban'),
        transport: z.literal('harness-api'),
        shellRedirection: z.literal(false),
        indirectWrites: z.literal(false),
      })
      .strict()
      .optional(),
  })
  .strict();

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
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
