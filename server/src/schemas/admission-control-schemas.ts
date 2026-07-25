import { z } from 'zod';
import {
  ADMISSION_DECISION_OUTCOMES,
  ADMISSION_DECISION_SCHEMA_VERSION,
  ADMISSION_CONTROL_PROVIDER,
  ADMISSION_REQUEST_SCHEMA_VERSION,
  ADMISSION_RESERVATION_SCHEMA_VERSION,
  ADMISSION_RESERVATION_STATES,
  ADMISSION_SCOPES,
  EXECUTABLE_AGENT_PROVIDERS,
} from '@veritas-kanban/shared';

const identifier = z.string().trim().min(1).max(240);
const policyIdentifier = z.string().trim().min(1).max(256);
const admissionProvider = z.enum([...EXECUTABLE_AGENT_PROVIDERS, ADMISSION_CONTROL_PROVIDER]);

export const AdmissionCapacityRequestSchema = z
  .object({
    runSlots: z.number().int().min(1).max(10_000),
    processSlots: z.number().int().min(0).max(10_000),
    estimatedMemoryMb: z.number().int().min(0).max(100_000_000),
  })
  .strict();

export const AdmissionCapacityLimitSchema = z
  .object({
    concurrentRuns: z.number().int().min(0).max(10_000).optional(),
    processSlots: z.number().int().min(0).max(10_000).optional(),
    estimatedMemoryMb: z.number().int().min(0).max(100_000_000).optional(),
  })
  .strict();

export const AdmissionLimitPolicySchema = z
  .object({
    id: policyIdentifier,
    scope: z.enum(ADMISSION_SCOPES),
    scopeId: identifier,
    limits: AdmissionCapacityLimitSchema,
  })
  .strict();

export const AdmissionRequestSchema = z
  .object({
    schemaVersion: z.literal(ADMISSION_REQUEST_SCHEMA_VERSION),
    idempotencyKey: identifier,
    source: z.enum([
      'direct',
      'conversation',
      'recovery',
      'fallback',
      'scheduled',
      'watcher',
      'workflow',
      'child-agent',
    ]),
    taskId: identifier,
    rootTaskId: identifier,
    workspaceId: identifier,
    provider: admissionProvider,
    hostId: identifier,
    workflowRunId: identifier.optional(),
    workflowStepId: identifier.optional(),
    rootReservationId: identifier.optional(),
    requested: AdmissionCapacityRequestSchema,
    requestedAt: z.string().datetime(),
  })
  .strict();

export const AdmissionReservationLeaseSchema = z
  .object({
    ownerId: identifier,
    hostId: identifier,
    processId: z.number().int().nonnegative(),
    acquiredAt: z.string().datetime(),
    heartbeatAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const AdmissionReservationSchema = z
  .object({
    schemaVersion: z.literal(ADMISSION_RESERVATION_SCHEMA_VERSION),
    id: identifier,
    revision: z.number().int().positive(),
    state: z.enum(ADMISSION_RESERVATION_STATES),
    request: AdmissionRequestSchema,
    policies: z.array(AdmissionLimitPolicySchema).max(6),
    attemptId: identifier.optional(),
    lease: AdmissionReservationLeaseSchema,
    release: z
      .object({
        reason: z.enum([
          'start-failed',
          'completed',
          'failed',
          'cancelled',
          'interrupted',
          'reconciled',
        ]),
        idempotencyKey: identifier,
        releasedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.state === 'released' && !record.release) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Released admission reservations require release evidence.',
        path: ['release'],
      });
    }
    if (record.state !== 'released' && record.release) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only released admission reservations may contain release evidence.',
        path: ['release'],
      });
    }
  });

export const AdmissionDecisionSchema = z
  .object({
    schemaVersion: z.literal(ADMISSION_DECISION_SCHEMA_VERSION),
    outcome: z.enum(ADMISSION_DECISION_OUTCOMES),
    request: AdmissionRequestSchema,
    reservation: AdmissionReservationSchema.optional(),
    limitingPolicies: z.array(AdmissionLimitPolicySchema).max(6),
    retryAfterMs: z.number().int().min(250).max(60_000).optional(),
    reason: z.string().min(1).max(1_000),
    decidedAt: z.string().datetime(),
  })
  .strict();

export const AdmissionReservationListQuerySchema = z
  .object({
    workspaceId: identifier.optional(),
    taskId: identifier.optional(),
    rootTaskId: identifier.optional(),
    provider: admissionProvider.optional(),
    hostId: identifier.optional(),
    workflowRunId: identifier.optional(),
    workflowStepId: identifier.optional(),
    rootReservationId: identifier.optional(),
    states: z.array(z.enum(ADMISSION_RESERVATION_STATES)).max(3).optional(),
    limit: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();
