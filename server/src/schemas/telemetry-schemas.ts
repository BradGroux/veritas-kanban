import { z } from 'zod';
import { TaskIdSchema, TelemetryEventTypeSchema, optionalIsoDate } from './common.js';

/**
 * Comma-separated telemetry event types
 * Transforms "task.created,run.started" -> ['task.created', 'run.started']
 */
const telemetryTypesParam = z.string().transform((val, ctx) => {
  const types = val.split(',').map(t => t.trim()).filter(Boolean);
  const validTypes: z.infer<typeof TelemetryEventTypeSchema>[] = [];
  
  for (const type of types) {
    const result = TelemetryEventTypeSchema.safeParse(type);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid event type: "${type}". Valid types: ${TelemetryEventTypeSchema.options.join(', ')}`,
      });
      return z.NEVER;
    }
    validTypes.push(result.data);
  }
  
  return validTypes;
});

/**
 * GET /api/telemetry/events - query params
 */
export const TelemetryEventsQuerySchema = z.object({
  type: telemetryTypesParam.optional(),
  since: optionalIsoDate,
  until: optionalIsoDate,
  taskId: TaskIdSchema.optional(),
  project: z.string().optional(),
  limit: z.coerce.number().int().positive().max(10000).optional(),
});

/**
 * GET /api/telemetry/events/task/:taskId - path params
 */
export const TelemetryTaskParamsSchema = z.object({
  taskId: TaskIdSchema,
});

/**
 * GET /api/telemetry/count - query params
 */
export const TelemetryCountQuerySchema = z.object({
  type: telemetryTypesParam,
  since: optionalIsoDate,
  until: optionalIsoDate,
});

/**
 * POST /api/telemetry/events/bulk - request body
 */
export const TelemetryBulkQuerySchema = z.object({
  taskIds: z.array(TaskIdSchema).min(1).max(100),
});

export type TelemetryEventsQuery = z.infer<typeof TelemetryEventsQuerySchema>;
export type TelemetryTaskParams = z.infer<typeof TelemetryTaskParamsSchema>;
export type TelemetryCountQuery = z.infer<typeof TelemetryCountQuerySchema>;
export type TelemetryBulkQuery = z.infer<typeof TelemetryBulkQuerySchema>;

// ============ POST /api/telemetry/events - Event Ingestion Schemas ============

/** Base fields for all telemetry events (id/timestamp generated server-side) */
const BaseEventSchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
  project: z.string().optional(),
});

/** run.started event payload */
const RunStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('run.started'),
  agent: z.string().min(1, 'agent is required'),
  model: z.string().optional(),
  sessionKey: z.string().optional(),
});

/** run.completed event payload */
const RunCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal('run.completed'),
  agent: z.string().min(1, 'agent is required'),
  success: z.boolean(),
  durationMs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

/** run.error event payload */
const RunErrorEventSchema = BaseEventSchema.extend({
  type: z.literal('run.error'),
  agent: z.string().min(1, 'agent is required'),
  error: z.string().min(1, 'error is required'),
  stackTrace: z.string().optional(),
});

/** run.tokens event payload */
const RunTokensEventSchema = BaseEventSchema.extend({
  type: z.literal('run.tokens'),
  agent: z.string().min(1, 'agent is required'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheTokens: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  model: z.string().optional(),
});

/** Discriminated union of all valid event types for ingestion */
export const TelemetryEventIngestionSchema = z.discriminatedUnion('type', [
  RunStartedEventSchema,
  RunCompletedEventSchema,
  RunErrorEventSchema,
  RunTokensEventSchema,
]);

export type TelemetryEventIngestion = z.infer<typeof TelemetryEventIngestionSchema>;

// ============ GET /api/telemetry/export - Export Schemas ============

/**
 * Valid export formats
 */
export const ExportFormatSchema = z.enum(['csv', 'json']);

/**
 * GET /api/telemetry/export - query params
 */
export const TelemetryExportQuerySchema = z.object({
  format: ExportFormatSchema.default('json'),
  taskId: TaskIdSchema.optional(),
  project: z.string().optional(),
  from: optionalIsoDate,
  to: optionalIsoDate,
});

export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export type TelemetryExportQuery = z.infer<typeof TelemetryExportQuerySchema>;
