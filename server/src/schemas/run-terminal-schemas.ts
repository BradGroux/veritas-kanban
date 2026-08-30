import { z } from 'zod';
import {
  RUN_TERMINAL_HANDLE_SCHEMA_VERSION,
  RUN_TERMINAL_MODES,
  RUN_TERMINAL_START_MODES,
  RUN_TERMINAL_STATES,
} from '@veritas-kanban/shared';

const environmentKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

const terminalIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const RunTerminalExecuteRequestSchema = z
  .object({
    requestId: terminalIdentifierSchema,
    command: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !/[\r\n\0]/.test(value), {
        message: 'Terminal command contains a forbidden control character.',
      }),
    args: z.array(z.string().max(1_000)).max(128),
    mode: z.enum(RUN_TERMINAL_MODES),
    startMode: z.enum(RUN_TERMINAL_START_MODES),
    cwd: z.string().trim().min(1).max(1_000).optional(),
    environmentKeys: z
      .array(environmentKeySchema)
      .max(128)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: 'Terminal environment keys must be unique.',
      }),
  })
  .strict();

export const RunTerminalScopeParamsSchema = z
  .object({
    taskId: terminalIdentifierSchema,
    attemptId: terminalIdentifierSchema,
  })
  .strict();

export const RunTerminalHandleParamsSchema = RunTerminalScopeParamsSchema.extend({
  handleId: terminalIdentifierSchema,
}).strict();

export const RunTerminalOutputQuerySchema = z
  .object({
    afterCursor: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(200).default(200),
  })
  .strict();

export const RunTerminalWaitRequestSchema = z
  .object({
    timeoutMs: z.number().int().min(0).max(300_000),
  })
  .strict();

export const RunTerminalWaitManyRequestSchema = z
  .object({
    handleIds: z
      .array(terminalIdentifierSchema)
      .min(1)
      .max(64)
      .refine((handleIds) => new Set(handleIds).size === handleIds.length, {
        message: 'Terminal handle IDs must be unique.',
      }),
    timeoutMs: z.number().int().min(0).max(300_000),
  })
  .strict();

const RunTerminalOutputMetadataSchema = z
  .object({
    nextCursor: z.number().int().nonnegative(),
    retainedFromCursor: z.number().int().positive(),
    observedBytes: z.number().int().nonnegative(),
    retainedBytes: z.number().int().nonnegative(),
    droppedBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    volumeCircuitTripped: z.boolean(),
  })
  .strict();

const RunTerminalCapabilityPostureSchema = z
  .object({
    pipe: z.enum(['enforced', 'unsupported']),
    pty: z.enum(['enforced', 'unsupported']),
    interactiveStdin: z.enum(['enforced', 'unsupported']),
    restartReattachment: z.enum(['enforced', 'unsupported']),
  })
  .strict();

export const RunTerminalHandleSchema = z
  .object({
    schemaVersion: z.literal(RUN_TERMINAL_HANDLE_SCHEMA_VERSION),
    id: z.string().trim().min(1).max(200),
    workspaceId: z.string().trim().min(1).max(200),
    taskId: z.string().trim().min(1).max(200),
    attemptId: z.string().trim().min(1).max(200),
    launchManifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    requestId: terminalIdentifierSchema,
    requestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    fileExecutionEvidenceDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    mode: z.enum(RUN_TERMINAL_MODES),
    startMode: z.enum(RUN_TERMINAL_START_MODES),
    state: z.enum(RUN_TERMINAL_STATES),
    commandId: z.string().trim().min(1).max(200),
    processId: z.number().int().positive().optional(),
    processGroupId: z.number().int().positive().optional(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    exitCode: z.number().int().optional(),
    signal: z.string().max(100).optional(),
    failure: z.string().max(1_000).optional(),
    output: RunTerminalOutputMetadataSchema,
    capabilities: RunTerminalCapabilityPostureSchema,
  })
  .strict();
