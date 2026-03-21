import { z } from 'zod';

const policyIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'Policy id must be lowercase kebab/snake case');

const scopeSchema = z.object({
  agents: z.array(z.string().min(1)).optional().default([]),
  projects: z.array(z.string().min(1)).optional().default([]),
  actionTypes: z.array(z.string().min(1)).optional().default([]),
});

export const policyTypeSchema = z.enum([
  'risk-threshold',
  'require-approval',
  'block-action-type',
  'rate-limit',
  'webhook-check',
]);

export const responseActionSchema = z.enum(['block', 'warn', 'require-approval']);

const riskThresholdConfigSchema = z.object({
  threshold: z.number().min(0).max(100),
  comparator: z.enum(['gte', 'gt', 'lte', 'lt']).optional().default('gte'),
});

const requireApprovalConfigSchema = z.object({
  reason: z.string().max(500).optional(),
  approvers: z.array(z.string().min(1)).max(20).optional().default([]),
});

const blockActionTypeConfigSchema = z.object({
  actionTypes: z.array(z.string().min(1)).min(1).max(50),
});

const rateLimitConfigSchema = z.object({
  maxAttempts: z.number().int().positive().max(10000),
  windowMs: z.number().int().positive().max(86_400_000),
  scopeKey: z.enum(['agent', 'project', 'action-type', 'global']).optional().default('global'),
});

const webhookCheckConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).optional().default('POST'),
  timeoutMs: z.number().int().positive().max(60_000).optional().default(5_000),
  expectedStatus: z.number().int().min(100).max(599).optional().default(200),
  expectedBodyContains: z.string().optional(),
  sendContext: z.boolean().optional().default(true),
  triggerOn: z.enum(['success', 'failure']).optional().default('failure'),
});

const policyBaseSchema = z.object({
  id: policyIdSchema,
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  scope: scopeSchema.default({ agents: [], projects: [], actionTypes: [] }),
  responseAction: responseActionSchema,
  description: z.string().max(500).optional(),
  preset: z.enum(['strict', 'balanced', 'permissive']).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const policySchema = z.discriminatedUnion('type', [
  policyBaseSchema.extend({
    type: z.literal('risk-threshold'),
    config: riskThresholdConfigSchema,
  }),
  policyBaseSchema.extend({
    type: z.literal('require-approval'),
    config: requireApprovalConfigSchema,
  }),
  policyBaseSchema.extend({
    type: z.literal('block-action-type'),
    config: blockActionTypeConfigSchema,
  }),
  policyBaseSchema.extend({
    type: z.literal('rate-limit'),
    config: rateLimitConfigSchema,
  }),
  policyBaseSchema.extend({
    type: z.literal('webhook-check'),
    config: webhookCheckConfigSchema,
  }),
]);

export const policyParamsSchema = z.object({
  id: policyIdSchema,
});

export const policyEvaluationSchema = z.object({
  agent: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  actionType: z.string().min(1),
  riskScore: z.number().min(0).max(100).optional(),
  preview: z.boolean().optional().default(false),
  metadata: z.record(z.unknown()).optional(),
});

export type PolicyInput = z.infer<typeof policySchema>;
export type PolicyEvaluationInput = z.infer<typeof policyEvaluationSchema>;
export type PolicyParams = z.infer<typeof policyParamsSchema>;
