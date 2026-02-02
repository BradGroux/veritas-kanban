import { z } from 'zod';
import { MetricsPeriodSchema } from './common.js';

/**
 * GET /api/metrics/* query params
 */
export const MetricsQuerySchema = z.object({
  period: MetricsPeriodSchema.default('7d'),
  project: z.string().optional(),
  from: z.string().optional(), // ISO date string for custom period start
  to: z.string().optional(), // ISO date string for custom period end
});

/**
 * GET /api/metrics/tasks - query params
 */
export const TaskMetricsQuerySchema = z.object({
  project: z.string().optional(),
  period: MetricsPeriodSchema.default('all'),
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * GET /api/metrics/budget - query params for budget metrics
 */
export const BudgetMetricsQuerySchema = z.object({
  project: z.string().optional(),
  tokenBudget: z.coerce.number().int().min(0).default(0),
  costBudget: z.coerce.number().min(0).default(0),
  warningThreshold: z.coerce.number().min(0).max(100).default(80),
});

/**
 * GET /api/metrics/agents/comparison - query params for agent comparison
 */
export const AgentComparisonQuerySchema = z.object({
  period: MetricsPeriodSchema.default('7d'),
  project: z.string().optional(),
  minRuns: z.coerce.number().int().min(1).default(3), // Minimum runs required for comparison
});

/**
 * GET /api/metrics/velocity - query params for sprint velocity
 */
export const VelocityQuerySchema = z.object({
  project: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10), // Number of sprints to return
});

export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;
export type TaskMetricsQuery = z.infer<typeof TaskMetricsQuerySchema>;
export type BudgetMetricsQuery = z.infer<typeof BudgetMetricsQuerySchema>;
export type AgentComparisonQuery = z.infer<typeof AgentComparisonQuerySchema>;
export type VelocityQuery = z.infer<typeof VelocityQuerySchema>;
