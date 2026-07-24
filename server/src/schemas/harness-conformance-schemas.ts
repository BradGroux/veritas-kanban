import { z } from 'zod';
import {
  HARNESS_CONFORMANCE_SUITE_SCHEMA_VERSION,
  KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS,
} from '@veritas-kanban/shared';

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const boundedText = z.string().trim().min(1).max(2000);
const relativePath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.startsWith('/') && !value.includes('..'), {
    message: 'Conformance file paths must remain relative and cannot traverse.',
  });
const capabilityId = z.enum(KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS);
const capabilityState = z.enum(['supported', 'advisory', 'unsupported', 'unknown']);

export const harnessConformanceAssertionSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('outcome'), expected: z.enum(['passed', 'failed', 'blocked']) })
    .strict(),
  z
    .object({
      kind: z.literal('file'),
      path: relativePath,
      expected: z.enum(['created', 'modified', 'deleted', 'unchanged']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool'),
      name: identifier,
      expected: z.enum(['called', 'not-called', 'allowed', 'denied']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('approval'),
      expected: z.enum(['requested', 'approved', 'denied', 'not-requested']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('network'),
      host: z.string().trim().min(1).max(253),
      expected: z.enum(['allowed', 'denied', 'not-attempted']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('policy'),
      policyId: identifier,
      expected: z.enum(['allowed', 'denied', 'approval']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('completion'),
      expectedSchema: identifier,
      valid: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('capability'),
      capabilityId,
      expected: capabilityState,
    })
    .strict(),
]);

const combinationSchema = z
  .object({
    id: identifier,
    provider: identifier,
    model: z.string().trim().min(1).max(200).optional(),
    profileId: identifier,
    policyId: identifier.optional(),
    sandboxPresetId: identifier.optional(),
    mode: z.enum(['mock', 'local', 'credential-gated']),
  })
  .strict();

const scenarioSchema = z
  .object({
    id: identifier,
    objective: boundedText,
    repetitions: z.number().int().min(1).max(20),
    assertions: z.array(harnessConformanceAssertionSchema).min(1).max(100),
  })
  .strict();

export const harnessConformanceSuiteSchema = z
  .object({
    schemaVersion: z.literal(HARNESS_CONFORMANCE_SUITE_SCHEMA_VERSION),
    id: identifier,
    revision: z.number().int().positive(),
    objective: boundedText,
    fixture: z
      .object({
        id: identifier,
        revision: z.number().int().positive(),
        digest,
        repository: z.string().url().max(500).optional(),
        seed: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    combinations: z.array(combinationSchema).min(1).max(20),
    scenarios: z.array(scenarioSchema).min(1).max(50),
    capabilityClaims: z
      .array(
        z
          .object({
            profileId: identifier,
            capabilityId,
            scenarioIds: z.array(identifier).min(1).max(50),
          })
          .strict()
      )
      .max(200),
    baselines: z
      .array(
        z
          .object({
            revision: z.number().int().positive(),
            combinationId: identifier,
            scenarioId: identifier,
            minPassRate: z.number().min(0).max(1),
            maxMeanLatencyMs: z.number().nonnegative().optional(),
            maxLatencyStdDevMs: z.number().nonnegative().optional(),
            maxMeanTokens: z.number().nonnegative().optional(),
            maxMeanCostUsd: z.number().nonnegative().optional(),
          })
          .strict()
      )
      .max(1000),
  })
  .strict()
  .superRefine((suite, context) => {
    uniqueIds(suite.combinations, ['combinations'], context);
    uniqueIds(suite.scenarios, ['scenarios'], context);
    const combinationIds = new Set(suite.combinations.map((item) => item.id));
    const scenarios = new Map(suite.scenarios.map((item) => [item.id, item]));
    for (const [index, baseline] of suite.baselines.entries()) {
      if (!combinationIds.has(baseline.combinationId)) {
        context.addIssue({
          code: 'custom',
          path: ['baselines', index, 'combinationId'],
          message: 'Baseline references an unknown combination.',
        });
      }
      if (!scenarios.has(baseline.scenarioId)) {
        context.addIssue({
          code: 'custom',
          path: ['baselines', index, 'scenarioId'],
          message: 'Baseline references an unknown scenario.',
        });
      }
    }
    for (const [claimIndex, claim] of suite.capabilityClaims.entries()) {
      const profileExists = suite.combinations.some(
        (combination) => combination.profileId === claim.profileId
      );
      if (!profileExists) {
        context.addIssue({
          code: 'custom',
          path: ['capabilityClaims', claimIndex, 'profileId'],
          message: 'Capability claim references an unknown profile.',
        });
      }
      for (const [scenarioIndex, scenarioId] of claim.scenarioIds.entries()) {
        const scenario = scenarios.get(scenarioId);
        if (!scenario) {
          context.addIssue({
            code: 'custom',
            path: ['capabilityClaims', claimIndex, 'scenarioIds', scenarioIndex],
            message: 'Capability claim references an unknown scenario.',
          });
          continue;
        }
        if (
          !scenario.assertions.some(
            (assertion) =>
              assertion.kind === 'capability' && assertion.capabilityId === claim.capabilityId
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['capabilityClaims', claimIndex, 'scenarioIds', scenarioIndex],
            message: 'Claimed capability must have a matching scenario assertion.',
          });
        }
      }
    }
    const trialCount =
      suite.combinations.length *
      suite.scenarios.reduce((total, scenario) => total + scenario.repetitions, 0);
    if (trialCount > 500) {
      context.addIssue({
        code: 'custom',
        path: ['scenarios'],
        message: 'A conformance suite is limited to 500 total trials.',
      });
    }
  });

export const harnessConformanceObservationSchema = z
  .object({
    outcome: z.enum(['passed', 'failed', 'blocked']),
    durationMs: z
      .number()
      .nonnegative()
      .max(24 * 60 * 60 * 1000),
    tokens: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    retries: z.number().int().nonnegative().max(100).optional(),
    files: z
      .array(
        z
          .object({
            path: relativePath,
            state: z.enum(['created', 'modified', 'deleted', 'unchanged']),
          })
          .strict()
      )
      .max(2000)
      .optional(),
    tools: z
      .array(z.object({ name: identifier, outcome: z.enum(['allowed', 'denied']) }).strict())
      .max(2000)
      .optional(),
    approvals: z
      .array(z.object({ outcome: z.enum(['requested', 'approved', 'denied']) }).strict())
      .max(1000)
      .optional(),
    network: z
      .array(
        z
          .object({
            host: z.string().trim().min(1).max(253),
            decision: z.enum(['allowed', 'denied']),
          })
          .strict()
      )
      .max(1000)
      .optional(),
    policies: z
      .array(
        z
          .object({
            policyId: identifier,
            decision: z.enum(['allowed', 'denied', 'approval']),
          })
          .strict()
      )
      .max(1000)
      .optional(),
    completions: z
      .array(z.object({ schema: identifier, valid: z.boolean() }).strict())
      .max(100)
      .optional(),
    capabilities: z
      .array(z.object({ id: capabilityId, state: capabilityState }).strict())
      .max(KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS.length)
      .optional(),
    evidence: z
      .object({
        launchManifestDigest: digest,
        providerRuntimeManifestDigest: digest,
        taskId: identifier.optional(),
        attemptId: identifier.optional(),
        eventSequenceStart: z.number().int().nonnegative().optional(),
        eventSequenceEnd: z.number().int().nonnegative().optional(),
      })
      .strict(),
    failureClass: z
      .enum([
        'assertion',
        'fixture-reset',
        'provider-launch',
        'provider-timeout',
        'provider-crash',
        'policy-block',
        'malformed-output',
        'verification',
        'unknown',
      ])
      .optional(),
    diagnostic: z.string().max(8000).optional(),
  })
  .strict();

function uniqueIds(values: Array<{ id: string }>, path: string[], context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value.id)) {
      context.addIssue({
        code: 'custom',
        path: [...path, index, 'id'],
        message: 'IDs must be unique within the suite.',
      });
    }
    seen.add(value.id);
  }
}
