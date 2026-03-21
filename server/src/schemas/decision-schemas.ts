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

export type CreateDecisionSchema = z.infer<typeof createDecisionSchema>;
export type DecisionListQuerySchema = z.infer<typeof decisionListQuerySchema>;
export type DecisionIdParams = z.infer<typeof decisionIdParamsSchema>;
export type AssumptionParams = z.infer<typeof assumptionParamsSchema>;
export type UpdateAssumptionSchema = z.infer<typeof updateAssumptionSchema>;
