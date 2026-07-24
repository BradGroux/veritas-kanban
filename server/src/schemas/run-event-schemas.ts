import { z } from 'zod';
import {
  EXECUTABLE_AGENT_PROVIDERS,
  RUN_EVENT_KINDS,
  RUN_EVENT_SCHEMA_VERSION,
  type RunEventEnvelope,
  type RunEventJsonValue,
} from '@veritas-kanban/shared';

const IdentifierSchema = z.string().trim().min(1).max(160);
const IsoTimestampSchema = z.string().datetime();

const JsonValueSchema: z.ZodType<RunEventJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

const NamespacedRunEventKindSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/,
    'Unknown run event kinds must be lower-case namespaced identifiers'
  );

export const RunEventKindSchema = z.union([z.enum(RUN_EVENT_KINDS), NamespacedRunEventKindSchema]);

export const RunEventEnvelopeSchema: z.ZodType<RunEventEnvelope> = z
  .object({
    schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION),
    eventId: z.string().regex(/^runevt_[A-Za-z0-9_-]{12,32}$/),
    taskId: IdentifierSchema,
    runId: IdentifierSchema,
    attemptId: IdentifierSchema,
    turnId: IdentifierSchema.optional(),
    itemId: IdentifierSchema.optional(),
    providerEventId: IdentifierSchema.optional(),
    parentEventId: IdentifierSchema.optional(),
    causalEventId: IdentifierSchema.optional(),
    sequence: z.number().int().positive(),
    providerTimestamp: IsoTimestampSchema.optional(),
    receivedAt: IsoTimestampSchema,
    kind: RunEventKindSchema,
    source: z
      .object({
        provider: z.enum([...EXECUTABLE_AGENT_PROVIDERS, 'operator', 'system']),
        adapter: IdentifierSchema,
        agent: IdentifierSchema.optional(),
        model: z.string().trim().min(1).max(240).optional(),
      })
      .strict(),
    redaction: z
      .object({
        status: z.enum(['none', 'redacted', 'dropped']),
        fields: z.array(z.string().min(1).max(240)).max(256),
        originalBytes: z.number().int().nonnegative(),
        persistedBytes: z.number().int().nonnegative(),
      })
      .strict(),
    payload: z.record(z.string(), JsonValueSchema),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    dedupeKey: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const RunEventQuerySchema = z
  .object({
    attemptId: IdentifierSchema,
    afterSequence: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();
