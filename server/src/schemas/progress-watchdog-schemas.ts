import { z } from 'zod';
import { PROGRESS_WATCHDOG_POLICY_SCHEMA_VERSION } from '@veritas-kanban/shared';

const actionSchema = z.enum([
  'warn',
  'steer',
  'require-observation',
  'retry',
  'fallback',
  'pause',
  'cancel',
]);

export const ProgressWatchdogPolicySchema = z
  .object({
    schemaVersion: z.literal(PROGRESS_WATCHDOG_POLICY_SCHEMA_VERSION),
    version: z.number().int().min(1).max(1_000_000),
    enabled: z.boolean(),
    windowEvents: z.number().int().min(4).max(500),
    identicalRepetitionThreshold: z.number().int().min(2).max(100),
    cycleMaxLength: z.number().int().min(2).max(12),
    cycleRepetitionThreshold: z.number().int().min(2).max(20),
    failedEditThreshold: z.number().int().min(2).max(100),
    noProgressEventThreshold: z.number().int().min(2).max(500),
    noProgressSeconds: z.number().int().min(1).max(86_400),
    maxExpectedRepetitionLeaseSeconds: z.number().int().min(1).max(86_400),
    recovery: z
      .object({
        lowConfidenceAction: z.literal('warn'),
        mediumConfidenceAction: z.enum(['warn', 'steer', 'require-observation']),
        highConfidenceAction: actionSchema,
        maxAutomatedActionsPerTurn: z.number().int().min(0).max(100),
        maxAutomatedActionsPerRun: z.number().int().min(0).max(1_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.windowEvents < policy.identicalRepetitionThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEvents'],
        message: 'windowEvents must cover the identical repetition threshold',
      });
    }
    if (policy.windowEvents < policy.cycleMaxLength * policy.cycleRepetitionThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEvents'],
        message: 'windowEvents must cover the configured cycle window',
      });
    }
  });
