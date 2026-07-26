import { z } from 'zod';
import {
  DURABLE_GOAL_CONTINUATION_MODES,
  DURABLE_GOAL_CONTINUATION_STATES,
  DURABLE_GOAL_SCHEMA_VERSION,
  DURABLE_GOAL_STATES,
  type DurableGoalRecord,
} from '@veritas-kanban/shared';

const IdentifierSchema = z.string().trim().min(1).max(240);
const IsoTimestampSchema = z.string().datetime();
const BoundedTextSchema = z.string().trim().min(1).max(4_000);

export const DurableGoalBudgetLimitsSchema = z
  .object({
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    totalTokens: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    toolCalls: z.number().nonnegative().optional(),
    runtimeSeconds: z.number().nonnegative().optional(),
    idleRuntimeSeconds: z.number().nonnegative().optional(),
    retries: z.number().nonnegative().optional(),
    fanOut: z.number().nonnegative().optional(),
  })
  .strict();

const BudgetUsageSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
    toolCalls: z.number().nonnegative(),
    runtimeSeconds: z.number().nonnegative(),
    idleRuntimeSeconds: z.number().nonnegative(),
    retries: z.number().nonnegative(),
    fanOut: z.number().nonnegative(),
  })
  .strict();

export const DurableGoalUsageEventSchema = z
  .object({
    id: IdentifierSchema,
    taskId: IdentifierSchema,
    attemptId: IdentifierSchema.optional(),
    usage: BudgetUsageSchema,
    recordedAt: IsoTimestampSchema,
  })
  .strict();

export const DurableGoalContinuationAttemptSchema = z
  .object({
    id: IdentifierSchema,
    sourceTaskId: IdentifierSchema,
    sourceAttemptId: IdentifierSchema,
    state: z.enum(DURABLE_GOAL_CONTINUATION_STATES),
    admissionIdempotencyKey: IdentifierSchema,
    message: z.string().trim().min(1).max(50_000),
    resultAttemptId: IdentifierSchema.optional(),
    queueId: IdentifierSchema.optional(),
    errorCode: IdentifierSchema.optional(),
    errorSummary: BoundedTextSchema.optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const DurableGoalRunLinkSchema = z
  .object({
    taskId: IdentifierSchema,
    attemptId: IdentifierSchema.optional(),
    workflowRunId: IdentifierSchema.optional(),
    conversationId: IdentifierSchema.optional(),
    parentAttemptId: IdentifierSchema.optional(),
    linkedAt: IsoTimestampSchema,
  })
  .strict();

export const DurableGoalCompletionRequirementSchema = z
  .object({
    id: IdentifierSchema,
    description: BoundedTextSchema,
    required: z.boolean(),
    verificationKind: z.enum(['test', 'build', 'artifact', 'operator', 'external', 'other']),
  })
  .strict();

export const DurableGoalCompletionEvidenceSchema = z
  .object({
    requirementId: IdentifierSchema,
    evidenceId: IdentifierSchema,
    summary: BoundedTextSchema,
    verifier: IdentifierSchema,
    verifiedAt: IsoTimestampSchema,
  })
  .strict();

export const DurableGoalRecordSchema: z.ZodType<DurableGoalRecord> = z
  .object({
    schemaVersion: z.literal(DURABLE_GOAL_SCHEMA_VERSION),
    id: z.string().regex(/^goal_[A-Za-z0-9_-]{12,64}$/),
    workspaceId: IdentifierSchema,
    objective: z.string().trim().min(1).max(50_000),
    constraints: z.array(BoundedTextSchema).max(200),
    acceptanceCriteria: z.array(BoundedTextSchema).min(1).max(200),
    root: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('task'), taskId: IdentifierSchema }).strict(),
      z
        .object({
          kind: z.literal('workflow'),
          workflowId: IdentifierSchema,
          taskId: IdentifierSchema.optional(),
        })
        .strict(),
    ]),
    state: z.enum(DURABLE_GOAL_STATES),
    revision: z.number().int().positive(),
    continuation: z
      .object({
        mode: z.enum(DURABLE_GOAL_CONTINUATION_MODES),
        maxTurns: z.number().int().positive().max(100_000).optional(),
        maxRollovers: z.number().int().nonnegative().max(10_000).optional(),
        compactAfterTokens: z.number().int().positive().optional(),
        requireApprovalForRollover: z.boolean().optional(),
      })
      .strict(),
    budgets: DurableGoalBudgetLimitsSchema.optional(),
    usage: BudgetUsageSchema,
    usageEvents: z.array(DurableGoalUsageEventSchema).max(10_000).default([]),
    currentRun: DurableGoalRunLinkSchema.optional(),
    continuationChain: z.array(DurableGoalRunLinkSchema).max(10_000),
    continuationAttempts: z.array(DurableGoalContinuationAttemptSchema).max(10_000).default([]),
    blockers: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            code: IdentifierSchema,
            summary: BoundedTextSchema,
            attempts: z.number().int().nonnegative(),
            nextSafeAction: BoundedTextSchema,
            requiredAuthority: BoundedTextSchema.optional(),
            externalStateChange: BoundedTextSchema.optional(),
            recordedAt: IsoTimestampSchema,
          })
          .strict()
      )
      .max(1_000),
    completionRequirements: z.array(DurableGoalCompletionRequirementSchema).min(1).max(200),
    completionEvidence: z.array(DurableGoalCompletionEvidenceSchema).max(1_000),
    transitions: z
      .array(
        z
          .object({
            revision: z.number().int().positive(),
            from: z.enum(DURABLE_GOAL_STATES),
            to: z.enum(DURABLE_GOAL_STATES),
            actorId: IdentifierSchema,
            reason: BoundedTextSchema,
            recordedAt: IsoTimestampSchema,
          })
          .strict()
      )
      .max(10_000),
    terminalReason: BoundedTextSchema.optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const requirementIds = new Set<string>();
    for (const [index, requirement] of record.completionRequirements.entries()) {
      if (requirementIds.has(requirement.id)) {
        context.addIssue({
          code: 'custom',
          path: ['completionRequirements', index, 'id'],
          message: 'Completion requirement IDs must be unique.',
        });
      }
      requirementIds.add(requirement.id);
    }
    if (!record.completionRequirements.some((requirement) => requirement.required)) {
      context.addIssue({
        code: 'custom',
        path: ['completionRequirements'],
        message: 'Durable goals require at least one evidence-gated completion requirement.',
      });
    }

    const evidenceIds = new Set<string>();
    const evidencedRequirements = new Set<string>();
    for (const [index, evidence] of record.completionEvidence.entries()) {
      if (!requirementIds.has(evidence.requirementId)) {
        context.addIssue({
          code: 'custom',
          path: ['completionEvidence', index, 'requirementId'],
          message: 'Completion evidence must reference a configured requirement.',
        });
      }
      if (evidenceIds.has(evidence.evidenceId)) {
        context.addIssue({
          code: 'custom',
          path: ['completionEvidence', index, 'evidenceId'],
          message: 'Completion evidence IDs must be unique.',
        });
      }
      evidenceIds.add(evidence.evidenceId);
      evidencedRequirements.add(evidence.requirementId);
    }

    const usageEventIds = new Set<string>();
    for (const [index, event] of record.usageEvents.entries()) {
      if (usageEventIds.has(event.id)) {
        context.addIssue({
          code: 'custom',
          path: ['usageEvents', index, 'id'],
          message: 'Durable goal usage event IDs must be unique.',
        });
      }
      usageEventIds.add(event.id);
    }

    const continuationIds = new Set<string>();
    const continuationAdmissionKeys = new Set<string>();
    for (const [index, continuation] of record.continuationAttempts.entries()) {
      if (continuationIds.has(continuation.id)) {
        context.addIssue({
          code: 'custom',
          path: ['continuationAttempts', index, 'id'],
          message: 'Durable goal continuation attempt IDs must be unique.',
        });
      }
      if (continuationAdmissionKeys.has(continuation.admissionIdempotencyKey)) {
        context.addIssue({
          code: 'custom',
          path: ['continuationAttempts', index, 'admissionIdempotencyKey'],
          message: 'Durable goal continuation admission keys must be unique.',
        });
      }
      continuationIds.add(continuation.id);
      continuationAdmissionKeys.add(continuation.admissionIdempotencyKey);
    }

    if (record.state === 'complete') {
      for (const [index, requirement] of record.completionRequirements.entries()) {
        if (requirement.required && !evidencedRequirements.has(requirement.id)) {
          context.addIssue({
            code: 'custom',
            path: ['completionRequirements', index],
            message: 'Required completion evidence is missing.',
          });
        }
      }
    }

    const terminal = ['complete', 'cancelled', 'failed'].includes(record.state);
    if (terminal !== Boolean(record.terminalReason)) {
      context.addIssue({
        code: 'custom',
        path: ['terminalReason'],
        message: 'Terminal goal states require a terminal reason, and active states must omit it.',
      });
    }
    if (record.state === 'blocked' && record.blockers.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['blockers'],
        message: 'Blocked goals must preserve an actionable blocker.',
      });
    }
    const lastTransition = record.transitions.at(-1);
    if (
      lastTransition &&
      (lastTransition.revision > record.revision || lastTransition.to !== record.state)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transitions'],
        message: 'The latest transition must precede the current revision and match its state.',
      });
    }
  });
