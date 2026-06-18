import { z } from 'zod';
import { nonEmptyString, optionalIsoDate } from './common.js';

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : Number(value)),
    z.number().min(min).max(max).optional()
  );

const DecisionIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid decision id format');

const AssumptionSchema = z.union([
  nonEmptyString,
  z.object({
    text: nonEmptyString,
  }),
]);

export const createDecisionSchema = z.object({
  inputContext: nonEmptyString,
  outputAction: nonEmptyString,
  assumptions: z.array(AssumptionSchema).default([]),
  confidenceLevel: z.number().int().min(0).max(100),
  riskScore: z.number().min(0).max(100),
  parentDecisionId: DecisionIdSchema.optional(),
  agentId: nonEmptyString,
  taskId: nonEmptyString,
  timestamp: optionalIsoDate,
});

export const decisionListQuerySchema = z.object({
  agent: z.string().min(1).optional(),
  startTime: optionalIsoDate,
  endTime: optionalIsoDate,
  minConfidence: optionalNumber(0, 100),
  maxConfidence: optionalNumber(0, 100),
  minRisk: optionalNumber(0, 100),
  maxRisk: optionalNumber(0, 100),
});

export const decisionIdParamsSchema = z.object({
  id: DecisionIdSchema,
});

export const assumptionParamsSchema = z.object({
  id: DecisionIdSchema,
  idx: z.coerce.number().int().min(0),
});

export const updateAssumptionSchema = z.object({
  status: z.enum(['validated', 'invalidated']),
  note: z.string().trim().min(1).max(500).optional(),
});

const DecisionReviewSessionIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid decision review session id format');

const StringListSchema = z.array(z.string().trim().min(1).max(5000)).max(100).default([]);

export const decisionReviewParticipantSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  agentId: z.string().trim().min(1).max(120).optional(),
  profileId: z.string().trim().min(1).max(120).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().min(1).max(200).optional(),
});

export const createDecisionReviewSessionSchema = z.object({
  taskId: nonEmptyString,
  title: z.string().trim().min(1).max(240),
  prompt: z.string().trim().min(1).max(100_000),
  context: z.string().trim().min(1).max(250_000),
  sourceType: z
    .enum(['task', 'work-product', 'workflow-gate', 'adr', 'command-center'])
    .default('task'),
  sourceId: z.string().trim().min(1).max(200).optional(),
  templateId: z.string().trim().min(1).max(120).optional(),
  contextLimit: z.number().int().min(1_000).max(500_000).optional(),
  rounds: z.number().int().min(1).max(5).default(1),
  participants: z.array(decisionReviewParticipantSchema).min(2).max(12),
});

export const decisionReviewListQuerySchema = z.object({
  taskId: z.string().min(1).max(200).optional(),
  status: z.enum(['collecting', 'critiquing', 'synthesized', 'canceled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const decisionReviewSessionParamsSchema = z.object({
  sessionId: DecisionReviewSessionIdSchema,
});

export const recordDecisionReviewTurnSchema = z.object({
  participantId: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(100_000).optional(),
  response: z.string().trim().min(1).max(250_000),
  provider: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  agentId: z.string().trim().min(1).max(120).optional(),
  profileId: z.string().trim().min(1).max(120).optional(),
});

export const recordDecisionReviewCritiqueSchema = recordDecisionReviewTurnSchema.extend({
  round: z.number().int().min(1).max(5),
  critiquesParticipantIds: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
});

export const finalizeDecisionReviewSessionSchema = z.object({
  recommendation: z.string().trim().min(1).max(100_000),
  dissentingViews: StringListSchema,
  assumptions: StringListSchema,
  risks: StringListSchema,
  validationPlan: StringListSchema,
  followUpTasks: StringListSchema,
  confidenceLevel: z.number().int().min(0).max(100).default(70),
  riskScore: z.number().int().min(0).max(100).default(50),
  summary: z.string().trim().min(1).max(100_000).optional(),
  attachWorkProduct: z.boolean().default(true),
});

export type CreateDecisionSchema = z.infer<typeof createDecisionSchema>;
export type DecisionListQuerySchema = z.infer<typeof decisionListQuerySchema>;
export type DecisionIdParams = z.infer<typeof decisionIdParamsSchema>;
export type AssumptionParams = z.infer<typeof assumptionParamsSchema>;
export type UpdateAssumptionSchema = z.infer<typeof updateAssumptionSchema>;
export type CreateDecisionReviewSessionSchema = z.infer<typeof createDecisionReviewSessionSchema>;
export type DecisionReviewListQuerySchema = z.infer<typeof decisionReviewListQuerySchema>;
export type DecisionReviewSessionParams = z.infer<typeof decisionReviewSessionParamsSchema>;
export type RecordDecisionReviewTurnSchema = z.infer<typeof recordDecisionReviewTurnSchema>;
export type RecordDecisionReviewCritiqueSchema = z.infer<typeof recordDecisionReviewCritiqueSchema>;
export type FinalizeDecisionReviewSessionSchema = z.infer<
  typeof finalizeDecisionReviewSessionSchema
>;
