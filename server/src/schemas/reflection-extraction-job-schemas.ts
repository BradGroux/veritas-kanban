import { z } from 'zod';
import {
  REFLECTION_EXTRACTION_JOB_SCHEMA_VERSION,
  REFLECTION_EXTRACTION_JOB_STATES,
  type ReflectionExtractionJob,
} from '@veritas-kanban/shared';

const IdentifierSchema = z.string().trim().min(1).max(240);
const TimestampSchema = z.string().datetime();
const BoundedSummarySchema = z.string().trim().min(1).max(2_000);

export const ReflectionExtractionJobSchema: z.ZodType<ReflectionExtractionJob> = z
  .object({
    schemaVersion: z.literal(REFLECTION_EXTRACTION_JOB_SCHEMA_VERSION),
    id: z.string().regex(/^reflection_job_[a-f0-9]{32}$/),
    workspaceId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
    source: z
      .object({
        taskId: IdentifierSchema,
        attemptId: IdentifierSchema,
        completionId: IdentifierSchema,
        completionDigest: IdentifierSchema,
        runEventId: IdentifierSchema.optional(),
      })
      .strict(),
    state: z.enum(REFLECTION_EXTRACTION_JOB_STATES),
    revision: z.number().int().positive(),
    attemptCount: z.number().int().nonnegative().max(20),
    maxAttempts: z.number().int().positive().max(20),
    availableAt: TimestampSchema,
    lease: z
      .object({
        ownerId: IdentifierSchema,
        acquiredAt: TimestampSchema,
        expiresAt: TimestampSchema,
      })
      .strict()
      .optional(),
    candidateIds: z.array(IdentifierSchema).max(100),
    failures: z
      .array(
        z
          .object({
            attempt: z.number().int().positive().max(20),
            code: IdentifierSchema,
            summary: BoundedSummarySchema,
            failedAt: TimestampSchema,
            retryAt: TimestampSchema.optional(),
          })
          .strict()
      )
      .max(20),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.attemptCount > job.maxAttempts) {
      context.addIssue({
        code: 'custom',
        path: ['attemptCount'],
        message: 'Extraction job attempts cannot exceed maxAttempts.',
      });
    }
    if ((job.state === 'leased') !== Boolean(job.lease)) {
      context.addIssue({
        code: 'custom',
        path: ['lease'],
        message: 'Only leased extraction jobs may retain a lease.',
      });
    }
    if (job.state === 'leased' && job.attemptCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['attemptCount'],
        message: 'A leased extraction job must have at least one attempt.',
      });
    }
    if ((job.state === 'completed') !== Boolean(job.completedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Only completed extraction jobs may have completedAt.',
      });
    }
    if (new Set(job.candidateIds).size !== job.candidateIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['candidateIds'],
        message: 'Extraction candidate IDs must be unique.',
      });
    }
    for (const [index, failure] of job.failures.entries()) {
      if (failure.attempt > job.attemptCount) {
        context.addIssue({
          code: 'custom',
          path: ['failures', index, 'attempt'],
          message: 'Extraction failures cannot reference a future attempt.',
        });
      }
    }
  });
