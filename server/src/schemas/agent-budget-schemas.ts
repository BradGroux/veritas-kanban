import { z } from 'zod';

export const AgentBudgetLimitsSchema = z
  .object({
    inputTokens: z.number().int().min(0).optional(),
    outputTokens: z.number().int().min(0).optional(),
    totalTokens: z.number().int().min(0).optional(),
    costUsd: z.number().min(0).optional(),
    toolCalls: z.number().int().min(0).optional(),
    runtimeSeconds: z.number().int().min(0).optional(),
    idleRuntimeSeconds: z.number().int().min(0).optional(),
    retries: z.number().int().min(0).optional(),
    fanOut: z.number().int().min(0).optional(),
  })
  .strict();

export const AgentBudgetPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    scope: z.enum(['workspace', 'agent', 'workflow', 'workflow-agent', 'run']).optional(),
    limits: AgentBudgetLimitsSchema.optional(),
    softThresholdPercent: z.number().min(1).max(99).optional(),
    hardAction: z.enum(['pause', 'require-approval', 'downgrade', 'cancel']).optional(),
    downgradeModel: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

export type AgentBudgetPolicyInput = z.infer<typeof AgentBudgetPolicySchema>;
