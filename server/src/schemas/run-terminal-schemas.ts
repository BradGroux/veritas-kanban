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

export const RunTerminalExecuteRequestSchema = z
  .object({
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
    environmentKeys: z.array(environmentKeySchema).max(128),
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
