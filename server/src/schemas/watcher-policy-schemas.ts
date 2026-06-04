import { z } from 'zod';

export const watcherRiskClassSchema = z.enum([
  'destructive_command',
  'credential_reference',
  'recent_test_failure',
  'provider_error',
  'policy_violation',
]);

export const watcherContinuationEvaluationSchema = z
  .object({
    runId: z.string().min(1).max(200).optional(),
    taskId: z.string().min(1).max(200).optional(),
    project: z.string().min(1).max(160).optional(),
    agent: z.string().min(1).max(120).optional(),
    prompt: z.string().max(20000).optional(),
    command: z.string().max(4000).optional(),
    toolName: z.string().max(160).optional(),
    continuationCount: z.number().int().min(0).max(10000).optional(),
    monthlySpendUsd: z.number().min(0).max(1000000).optional(),
    hasRecentTestFailures: z.boolean().optional(),
    recentProviderErrors: z.number().int().min(0).max(10000).optional(),
    policyViolations: z.array(z.string().min(1).max(200)).max(100).optional(),
    riskHints: z.array(watcherRiskClassSchema).max(20).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
