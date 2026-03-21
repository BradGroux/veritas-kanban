import { z } from 'zod';
import { nonEmptyString } from './common.js';

export const DriftMetricSchema = z.enum([
  'action_frequency',
  'duration',
  'cost',
  'token_usage',
  'risk_score',
  'success_rate',
]);

export const DriftSeveritySchema = z.enum(['critical', 'warning', 'info']);

export const DriftAlertsQuerySchema = z.object({
  agentId: z.string().optional(),
  metric: DriftMetricSchema.optional(),
  severity: DriftSeveritySchema.optional(),
  acknowledged: z.coerce.boolean().optional(),
});

export const DriftAlertParamsSchema = z.object({
  id: nonEmptyString,
});

export const DriftBaselinesQuerySchema = z.object({
  agentId: z.string().optional(),
  metric: DriftMetricSchema.optional(),
});

export const DriftBaselineResetSchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  metric: DriftMetricSchema.optional(),
});

export const DriftAnalyzeSchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
});

export type DriftAlertsQuery = z.infer<typeof DriftAlertsQuerySchema>;
export type DriftAlertParams = z.infer<typeof DriftAlertParamsSchema>;
export type DriftBaselinesQuery = z.infer<typeof DriftBaselinesQuerySchema>;
export type DriftBaselineReset = z.infer<typeof DriftBaselineResetSchema>;
export type DriftAnalyzeInput = z.infer<typeof DriftAnalyzeSchema>;
