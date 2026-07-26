import { z } from 'zod';
import {
  DEPENDENCY_CIRCUIT_POLICY_SCHEMA_VERSION,
  DEPENDENCY_CIRCUIT_SCHEMA_VERSION,
  DEPENDENCY_CIRCUIT_STATES,
  DEPENDENCY_CIRCUIT_STATE_SCHEMA_VERSION,
  DEPENDENCY_KINDS,
  DEPENDENCY_OUTCOMES,
  DEPENDENCY_RETRY_BUDGET_KINDS,
  DEPENDENCY_ROUTE_NO_MATCH_ACTIONS,
  type DependencyCircuitPolicy,
  type DependencyCircuitPersistedState,
  type DependencyCircuitReason,
  type DependencyCircuitSample,
  type DependencyCircuitSnapshot,
  type DependencyIdentity,
  type DependencyRetryBudgetPolicy,
  type DependencyRetryBudgetUsage,
  type DependencyRoutePolicy,
} from '@veritas-kanban/shared';

const IdentifierSchema = z.string().trim().min(1).max(240);

export const DependencyIdentitySchema: z.ZodType<DependencyIdentity> = z
  .object({
    kind: z.enum(DEPENDENCY_KINDS),
    id: IdentifierSchema.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    workspaceId: IdentifierSchema.optional(),
    provider: IdentifierSchema.optional(),
    model: IdentifierSchema.optional(),
    hostId: IdentifierSchema.optional(),
  })
  .strict();

export const DependencyCircuitPolicySchema: z.ZodType<DependencyCircuitPolicy> = z
  .object({
    schemaVersion: z.literal(DEPENDENCY_CIRCUIT_POLICY_SCHEMA_VERSION),
    minimumSamples: z.number().int().min(1).max(100_000),
    rollingWindowMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1_000),
    failureRateThreshold: z.number().min(0.01).max(1),
    slowCallDurationMs: z.number().int().min(1).max(60 * 60 * 1_000),
    slowCallRateThreshold: z.number().min(0.01).max(1),
    openDurationMs: z.number().int().min(100).max(60 * 60 * 1_000),
    openDurationJitterRatio: z.number().min(0).max(0.5),
    halfOpenMaxConcurrent: z.number().int().min(1).max(1_000),
    probeSuccessThreshold: z.number().int().min(1).max(10_000),
  })
  .strict();

const TimestampSchema = z.string().datetime({ offset: true });

const DependencyCircuitReasonSchema: z.ZodType<DependencyCircuitReason> = z
  .object({
    code: z.enum([
      'failure-rate',
      'slow-call-rate',
      'probe-failed',
      'operator-reset',
      'probe-window-opened',
      'probe-succeeded',
    ]),
    observedAt: TimestampSchema,
    sampleCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    slowCallCount: z.number().int().nonnegative(),
    failureRate: z.number().min(0).max(1),
    slowCallRate: z.number().min(0).max(1),
  })
  .strict();

export const DependencyCircuitSnapshotSchema: z.ZodType<DependencyCircuitSnapshot> = z
  .object({
    schemaVersion: z.literal(DEPENDENCY_CIRCUIT_SCHEMA_VERSION),
    key: z.string().trim().min(1).max(2_000),
    dependency: DependencyIdentitySchema,
    policy: DependencyCircuitPolicySchema,
    state: z.enum(DEPENDENCY_CIRCUIT_STATES),
    reason: DependencyCircuitReasonSchema.optional(),
    sampleCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    slowCallCount: z.number().int().nonnegative(),
    failureRate: z.number().min(0).max(1),
    slowCallRate: z.number().min(0).max(1),
    openedAt: TimestampSchema.optional(),
    nextProbeAt: TimestampSchema.optional(),
    halfOpenInFlight: z.number().int().nonnegative(),
    halfOpenSuccesses: z.number().int().nonnegative(),
    lastOutcome: z.enum(DEPENDENCY_OUTCOMES).optional(),
    lastOutcomeAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema,
  })
  .strict();

const DependencyCircuitSampleSchema: z.ZodType<DependencyCircuitSample> = z
  .object({
    occurredAt: TimestampSchema,
    outcome: z.enum(DEPENDENCY_OUTCOMES),
    durationMs: z.number().finite().nonnegative(),
  })
  .strict();

export const DependencyCircuitPersistedStateSchema: z.ZodType<DependencyCircuitPersistedState> = z
  .object({
    schemaVersion: z.literal(DEPENDENCY_CIRCUIT_STATE_SCHEMA_VERSION),
    snapshot: DependencyCircuitSnapshotSchema,
    samples: z.array(DependencyCircuitSampleSchema).max(100_000),
    capturedAt: TimestampSchema,
  })
  .strict();

export const DependencyRoutePolicySchema: z.ZodType<DependencyRoutePolicy> = z
  .object({
    allowFallback: z.boolean(),
    noMatchAction: z.enum(DEPENDENCY_ROUTE_NO_MATCH_ACTIONS),
  })
  .strict();

const retryBudgetShape = Object.fromEntries(
  DEPENDENCY_RETRY_BUDGET_KINDS.map((kind) => [
    kind,
    z.number().int().min(0).max(1_000_000),
  ])
) as Record<(typeof DEPENDENCY_RETRY_BUDGET_KINDS)[number], z.ZodNumber>;

export const DependencyRetryBudgetPolicySchema: z.ZodType<DependencyRetryBudgetPolicy> = z
  .object({
    limits: z.object(retryBudgetShape).strict(),
  })
  .strict();

export const DependencyRetryBudgetUsageSchema: z.ZodType<DependencyRetryBudgetUsage> = z
  .object({
    used: z.object(retryBudgetShape).strict(),
  })
  .strict();
