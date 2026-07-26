import { z } from 'zod';
import {
  PROGRESS_WATCHDOG_ACTION_SCHEMA_VERSION,
  PROGRESS_WATCHDOG_FINDING_SCHEMA_VERSION,
  PROGRESS_WATCHDOG_OVERRIDE_SCHEMA_VERSION,
  PROGRESS_WATCHDOG_POLICY_SCHEMA_VERSION,
} from '@veritas-kanban/shared';

const actionSchema = z.enum([
  'warn',
  'steer',
  'require-observation',
  'retry',
  'fallback',
  'pause',
  'cancel',
]);
const progressSignalSchema = z.enum([
  'workspace-delta',
  'artifact',
  'verification-passed',
  'task-transition',
  'goal-transition',
  'external-evidence',
  'operator-input',
]);
const identifierSchema = z.string().trim().min(1).max(160);
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const findingIdSchema = z.string().regex(/^watchdog_[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/);
const isoTimestampSchema = z.string().datetime();

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
    noProgressTotalTokens: z.number().int().min(1).max(1_000_000_000),
    noProgressCostUsd: z.number().positive().max(1_000_000),
    highConfidenceMultiplier: z.number().int().min(2).max(20),
    progressSignals: z.array(progressSignalSchema).min(1).max(7),
    expectedRepetitionAllowedKinds: z.array(z.string().trim().min(1).max(160)).min(1).max(64),
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
    if (new Set(policy.progressSignals).size !== policy.progressSignals.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['progressSignals'],
        message: 'progressSignals must not contain duplicates',
      });
    }
    if (
      new Set(policy.expectedRepetitionAllowedKinds).size !==
      policy.expectedRepetitionAllowedKinds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedRepetitionAllowedKinds'],
        message: 'expectedRepetitionAllowedKinds must not contain duplicates',
      });
    }
  });

export const ProgressWatchdogFindingSchema = z
  .object({
    schemaVersion: z.literal(PROGRESS_WATCHDOG_FINDING_SCHEMA_VERSION),
    id: findingIdSchema,
    taskId: identifierSchema,
    attemptId: identifierSchema,
    turnId: identifierSchema.optional(),
    detector: z.enum([
      'identical-repetition',
      'multi-step-cycle',
      'failed-file-edit',
      'no-durable-progress',
    ]),
    confidence: z.enum(['low', 'medium', 'high']),
    policyVersion: z.number().int().min(1),
    evidenceEventIds: z.array(identifierSchema).min(1).max(100),
    fingerprintHashes: z.array(hashSchema).max(24),
    suppressedEventIds: z.array(identifierSchema).max(100),
    progressSignals: z.array(progressSignalSchema).max(7),
    action: actionSchema,
    recoveryBudgetRemaining: z
      .object({
        turn: z.number().int().nonnegative(),
        run: z.number().int().nonnegative(),
      })
      .strict(),
    createdAt: isoTimestampSchema,
  })
  .strict();

export const ProgressWatchdogActionOutcomeSchema = z
  .object({
    schemaVersion: z.literal(PROGRESS_WATCHDOG_ACTION_SCHEMA_VERSION),
    findingId: findingIdSchema,
    taskId: identifierSchema,
    attemptId: identifierSchema,
    turnId: identifierSchema.optional(),
    action: actionSchema,
    status: z.enum(['executed', 'operator-required', 'failed']),
    diagnostic: z.string().trim().min(1).max(1_000),
    recordedAt: isoTimestampSchema,
  })
  .strict();

export const ProgressWatchdogOverrideRecordSchema = z
  .object({
    schemaVersion: z.literal(PROGRESS_WATCHDOG_OVERRIDE_SCHEMA_VERSION),
    findingId: findingIdSchema,
    taskId: identifierSchema,
    attemptId: identifierSchema,
    resolution: z.enum(['acknowledge', 'continue', 'cancel']),
    status: z.enum(['requested', 'completed', 'failed']),
    actor: identifierSchema,
    reason: z.string().trim().min(8).max(1_000),
    requestedAt: isoTimestampSchema,
    completedAt: isoTimestampSchema.optional(),
    launchedAttemptId: identifierSchema.optional(),
    diagnostic: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const ProgressWatchdogOverrideInputSchema = z
  .object({
    attemptId: identifierSchema,
    resolution: z.enum(['acknowledge', 'continue', 'cancel']),
    reason: z.string().trim().min(8).max(1_000),
  })
  .strict();
