import { randomUUID } from 'node:crypto';
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  DURABLE_GOAL_CONTINUATION_MODES,
  DURABLE_GOAL_STATES,
  type DurableGoalRecord,
} from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { clawdbotAgentService } from '../services/clawdbot-agent-service.js';
import { getDurableGoalService } from '../services/durable-goal-service.js';

const router: RouterType = Router();
const IdentifierSchema = z.string().trim().min(1).max(240);
const BoundedTextSchema = z.string().trim().min(1).max(4_000);
const VerificationKindSchema = z.enum([
  'test',
  'build',
  'artifact',
  'operator',
  'external',
  'other',
]);

const paramsSchema = z.object({
  goalId: z.string().regex(/^goal_[A-Za-z0-9_-]{12,64}$/),
});

const listQuerySchema = z
  .object({
    state: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : Array.isArray(value) ? value : value.split(',')
      )
      .pipe(z.array(z.enum(DURABLE_GOAL_STATES)).max(DURABLE_GOAL_STATES.length).optional()),
    rootTaskId: IdentifierSchema.optional(),
    rootWorkflowId: IdentifierSchema.optional(),
    limit: z.coerce.number().int().min(1).max(1_000).default(100),
  })
  .strict();

const completionRequirementSchema = z
  .object({
    id: IdentifierSchema,
    description: BoundedTextSchema,
    required: z.boolean().default(true),
    verificationKind: VerificationKindSchema,
  })
  .strict();

const createSchema = z
  .object({
    objective: z.string().trim().min(1).max(50_000),
    constraints: z.array(BoundedTextSchema).max(200).default([]),
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
    continuation: z
      .object({
        mode: z.enum(DURABLE_GOAL_CONTINUATION_MODES),
        maxTurns: z.number().int().positive().max(100_000).optional(),
        maxRollovers: z.number().int().nonnegative().max(10_000).optional(),
        compactAfterTokens: z.number().int().positive().optional(),
        requireApprovalForRollover: z.boolean().optional(),
      })
      .strict(),
    budgets: z
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
      .strict()
      .optional(),
    completionRequirements: z.array(completionRequirementSchema).min(1).max(200),
  })
  .strict();

const transitionSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    state: z.enum(DURABLE_GOAL_STATES),
    reason: z.string().trim().min(8).max(4_000),
    blocker: z
      .object({
        id: IdentifierSchema.optional(),
        code: IdentifierSchema,
        summary: BoundedTextSchema,
        attempts: z.number().int().nonnegative().default(0),
        nextSafeAction: BoundedTextSchema,
        requiredAuthority: BoundedTextSchema.optional(),
        externalStateChange: BoundedTextSchema.optional(),
      })
      .strict()
      .optional(),
    completionEvidence: z
      .array(
        z
          .object({
            requirementId: IdentifierSchema,
            evidenceId: IdentifierSchema,
            summary: BoundedTextSchema,
          })
          .strict()
      )
      .max(200)
      .optional(),
  })
  .strict();

const runLinkSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    taskId: IdentifierSchema,
    attemptId: IdentifierSchema.optional(),
    workflowRunId: IdentifierSchema.optional(),
    conversationId: IdentifierSchema.optional(),
    parentAttemptId: IdentifierSchema.optional(),
  })
  .strict();

const rolloverSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
  })
  .strict();

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed.', error.issues);
    }
    throw error;
  }
}

function actorFromRequest(req: AuthenticatedRequest) {
  const auth = req.auth;
  return {
    id:
      auth?.userId ||
      auth?.tokenName ||
      auth?.keyName ||
      auth?.clientId ||
      auth?.deviceId ||
      auth?.role ||
      'operator',
    workspaceId: auth?.workspaceId || 'local',
  };
}

async function requireWorkspaceGoal(
  goalId: string,
  workspaceId: string
): Promise<DurableGoalRecord> {
  const goal = await getDurableGoalService().get(goalId);
  if (goal.workspaceId !== workspaceId) throw new NotFoundError('Durable goal not found.');
  return goal;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseOrThrow(listQuerySchema, req.query);
    const actor = actorFromRequest(req);
    res.json({
      generatedAt: new Date().toISOString(),
      goals: await getDurableGoalService().list({
        workspaceId: actor.workspaceId,
        states: query.state,
        rootTaskId: query.rootTaskId,
        rootWorkflowId: query.rootWorkflowId,
        limit: query.limit,
      }),
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(createSchema, req.body);
    const actor = actorFromRequest(req);
    res.status(201).json(
      await getDurableGoalService().create({
        ...input,
        workspaceId: actor.workspaceId,
      })
    );
  })
);

router.get(
  '/:goalId',
  asyncHandler(async (req, res) => {
    const { goalId } = parseOrThrow(paramsSchema, req.params);
    const actor = actorFromRequest(req);
    res.json(await requireWorkspaceGoal(goalId, actor.workspaceId));
  })
);

router.post(
  '/:goalId/transition',
  asyncHandler(async (req, res) => {
    const { goalId } = parseOrThrow(paramsSchema, req.params);
    const input = parseOrThrow(transitionSchema, req.body);
    const actor = actorFromRequest(req);
    await requireWorkspaceGoal(goalId, actor.workspaceId);
    const recordedAt = new Date().toISOString();
    res.json(
      await getDurableGoalService().transition(goalId, {
        expectedRevision: input.expectedRevision,
        to: input.state,
        actorId: actor.id,
        reason: input.reason,
        blocker: input.blocker
          ? {
              ...input.blocker,
              id: input.blocker.id ?? `blocker-${randomUUID()}`,
              recordedAt,
            }
          : undefined,
        completionEvidence: input.completionEvidence?.map((evidence) => ({
          ...evidence,
          verifier: actor.id,
          verifiedAt: recordedAt,
        })),
      })
    );
  })
);

router.post(
  '/:goalId/runs',
  asyncHandler(async (req, res) => {
    const { goalId } = parseOrThrow(paramsSchema, req.params);
    const input = parseOrThrow(runLinkSchema, req.body);
    const actor = actorFromRequest(req);
    await requireWorkspaceGoal(goalId, actor.workspaceId);
    res.json(
      await getDurableGoalService().linkRun(goalId, {
        expectedRevision: input.expectedRevision,
        run: {
          taskId: input.taskId,
          attemptId: input.attemptId,
          workflowRunId: input.workflowRunId,
          conversationId: input.conversationId,
          parentAttemptId: input.parentAttemptId,
        },
      })
    );
  })
);

router.post(
  '/:goalId/rollover',
  asyncHandler(async (req, res) => {
    const { goalId } = parseOrThrow(paramsSchema, req.params);
    const input = parseOrThrow(rolloverSchema, req.body);
    const actor = actorFromRequest(req);
    await requireWorkspaceGoal(goalId, actor.workspaceId);
    res
      .status(201)
      .json(
        await clawdbotAgentService.rolloverDurableGoal(goalId, input.expectedRevision, actor.id)
      );
  })
);

export { router as goalRoutes };
