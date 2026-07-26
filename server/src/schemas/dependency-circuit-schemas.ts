import { z } from 'zod';
import {
  DEPENDENCY_CIRCUIT_POLICY_SCHEMA_VERSION,
  DEPENDENCY_KINDS,
  type DependencyCircuitPolicy,
  type DependencyIdentity,
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
