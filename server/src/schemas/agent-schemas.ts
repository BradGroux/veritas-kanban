import { z } from 'zod';

const AgentTypeSchema = z.string().min(1).max(50);

/**
 * POST /api/agents/:taskId/start - Start agent on task
 */
export const StartAgentBodySchema = z.object({
  agent: AgentTypeSchema.optional(),
});

export type StartAgentBody = z.infer<typeof StartAgentBodySchema>;

/**
 * POST /api/agents/:taskId/complete - Agent completion callback
 */
export const CompleteAgentBodySchema = z.object({
  success: z.boolean(),
  summary: z.string().optional(),
  error: z.string().optional(),
});

export type CompleteAgentBody = z.infer<typeof CompleteAgentBodySchema>;

/**
 * POST /api/agents/:taskId/tokens - Report token usage
 */
export const ReportTokensBodySchema = z.object({
  attemptId: z.string().optional(),
  inputTokens: z.number({ message: 'inputTokens is required' }).int().nonnegative(),
  outputTokens: z.number({ message: 'outputTokens is required' }).int().nonnegative(),
  totalTokens: z.number().int().nonnegative().optional(),
  model: z.string().optional(),
  agent: AgentTypeSchema.optional(),
});

export type ReportTokensBody = z.infer<typeof ReportTokensBodySchema>;
