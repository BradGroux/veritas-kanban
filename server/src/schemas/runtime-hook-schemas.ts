import { z } from 'zod';
import {
  RUNTIME_HOOK_EVENT_IDS,
  RUNTIME_HOOK_SCHEMA_VERSION,
  isBlockingRuntimeHookEvent,
  type RuntimeHookDefinition,
  type RuntimeHookDryRunResult,
  type RuntimeHookEnvelope,
  type RuntimeHookOutcome,
} from '@veritas-kanban/shared';

const MAX_METADATA_BYTES = 16 * 1024;
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const metadataValue = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
const scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z
    .object({
      kind: z.enum(['workspace', 'profile', 'workflow', 'run']),
      id: identifier,
    })
    .strict(),
]);

export const RuntimeHookDefinitionSchema: z.ZodType<RuntimeHookDefinition> = z
  .object({
    schemaVersion: z.literal(RUNTIME_HOOK_SCHEMA_VERSION),
    id: identifier,
    event: z.enum(RUNTIME_HOOK_EVENT_IDS),
    handlerId: identifier,
    scope,
    enabled: z.boolean(),
    order: z.number().int().min(-1000).max(1000),
    timeoutMs: z.number().int().min(10).max(5000),
    failurePolicy: z.enum(['fail-open', 'fail-closed']),
  })
  .strict()
  .superRefine((definition, context) => {
    if (!isBlockingRuntimeHookEvent(definition.event) && definition.failurePolicy !== 'fail-open') {
      context.addIssue({
        code: 'custom',
        path: ['failurePolicy'],
        message: 'Passive post-events must use fail-open policy.',
      });
    }
  });

export const RuntimeHookEnvelopeSchema: z.ZodType<RuntimeHookEnvelope> = z
  .object({
    schemaVersion: z.literal(RUNTIME_HOOK_SCHEMA_VERSION),
    eventId: identifier,
    event: z.enum(RUNTIME_HOOK_EVENT_IDS),
    occurredAt: z.string().datetime(),
    scope: z
      .object({
        workspaceId: identifier.optional(),
        profileId: identifier.optional(),
        workflowId: identifier.optional(),
        runId: identifier.optional(),
      })
      .strict(),
    references: z
      .object({
        sourceEventId: identifier,
        taskId: identifier.optional(),
        attemptId: identifier.optional(),
        toolCallId: identifier.optional(),
        approvalId: identifier.optional(),
        workflowId: identifier.optional(),
        externalEventId: identifier.optional(),
      })
      .strict(),
    metadata: z.record(z.string().min(1).max(80), metadataValue),
  })
  .strict()
  .superRefine((envelope, context) => {
    const credentialKey = Object.keys(envelope.metadata).find((key) =>
      /(?:api.?key|authorization|credential|password|secret|token)/i.test(key)
    );
    if (credentialKey) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', credentialKey],
        message: 'Runtime hook metadata cannot contain credential fields.',
      });
    }
    if (Buffer.byteLength(JSON.stringify(envelope.metadata), 'utf8') > MAX_METADATA_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: `Runtime hook metadata cannot exceed ${MAX_METADATA_BYTES} bytes.`,
      });
    }
  });

export const RuntimeHookOutcomeSchema: z.ZodType<RuntimeHookOutcome> = z
  .object({
    schemaVersion: z.literal(RUNTIME_HOOK_SCHEMA_VERSION),
    eventId: identifier,
    sourceEventId: identifier,
    hookId: identifier,
    handlerId: identifier,
    event: z.enum(RUNTIME_HOOK_EVENT_IDS),
    order: z.number().int().min(-1000).max(1000),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    disposition: z.enum([
      'allowed',
      'denied',
      'failed-open',
      'failed-closed',
      'timed-out',
      'reentrant',
      'missing-handler',
      'invalid-post-decision',
    ]),
    blocking: z.boolean(),
    diagnostic: z.string().max(1000).optional(),
    evidence: z
      .object({
        kind: z.literal('run-event'),
        eventId: identifier,
        sequence: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const RuntimeHookDryRunResultSchema: z.ZodType<RuntimeHookDryRunResult> = z
  .object({
    schemaVersion: z.literal(RUNTIME_HOOK_SCHEMA_VERSION),
    eventId: identifier,
    event: z.enum(RUNTIME_HOOK_EVENT_IDS),
    effectiveHooks: z.array(
      z
        .object({
          hookId: identifier,
          handlerId: identifier,
          scope,
          order: z.number().int().min(-1000).max(1000),
          blocking: z.boolean(),
          handlerRegistered: z.boolean(),
          blocker: z.string().max(1000).optional(),
        })
        .strict()
    ),
    wouldBlock: z.boolean(),
    blockers: z.array(z.string().max(1000)),
  })
  .strict();
