import { z } from 'zod';

/**
 * Task ID format validation
 * Production format: task_YYYYMMDD_XXXXXX (date + 6-char nanoid)
 * Examples: task_20260128_abc123, task_20260115_x7Y2pQ
 * Also accepts legacy/test formats for backward compatibility
 */
export const TaskIdSchema = z
  .string()
  .min(5)
  .refine(
    (id) => /^task_(\d{8}_[a-zA-Z0-9_-]{1,20}|[a-zA-Z0-9_-]+)$/.test(id),
    'Invalid task ID format. Expected: task_YYYYMMDD_XXXXXX'
  );

/**
 * Path params with taskId
 */
export const TaskIdParamsSchema = z.object({
  taskId: TaskIdSchema,
});

/**
 * Positive integer, with optional min/max
 */
export function positiveInt(opts?: { min?: number; max?: number }) {
  let schema = z.coerce.number().int().positive();
  if (opts?.min !== undefined) schema = schema.min(opts.min);
  if (opts?.max !== undefined) schema = schema.max(opts.max);
  return schema;
}

/**
 * Optional positive integer with default
 */
export function optionalPositiveInt(defaultValue: number, opts?: { min?: number; max?: number }) {
  return z.preprocess(
    (val) => (val === undefined || val === '' ? defaultValue : val),
    positiveInt(opts)
  );
}

/**
 * Non-empty string
 */
export const nonEmptyString = z.string().min(1, 'Value cannot be empty');

/**
 * ISO date string validation
 */
export const isoDateString = z
  .string()
  .datetime({ offset: true })
  .or(
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/, 'Invalid ISO date format')
  );

/**
 * Optional ISO date string
 */
export const optionalIsoDate = isoDateString.optional();

/**
 * File path validation (basic safety check)
 */
export const filePathSchema = z
  .string()
  .min(1, 'File path required')
  .refine((path) => !path.includes('..') && !path.startsWith('/'), 'Path traversal not allowed');

/**
 * Telemetry event types (matching shared types)
 */
export const TelemetryEventTypeSchema = z.enum([
  'task.created',
  'task.status_changed',
  'task.archived',
  'task.restored',
  'run.started',
  'run.completed',
  'run.error',
  'run.tokens',
]);

export type ValidTelemetryEventType = z.infer<typeof TelemetryEventTypeSchema>;

/**
 * Metrics period validation
 */
export const MetricsPeriodSchema = z.enum([
  'today',
  '24h',
  '3d',
  '7d',
  '30d',
  '3m',
  '6m',
  '12m',
  'wtd',
  'mtd',
  'ytd',
  'all',
  'custom',
]);

export type ValidMetricsPeriod = z.infer<typeof MetricsPeriodSchema>;
