import { z } from 'zod';
import { RUN_TERMINAL_MODES, RUN_TERMINAL_START_MODES } from '@veritas-kanban/shared';

const environmentKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const RunTerminalExecuteRequestSchema = z
  .object({
    command: z.string().trim().min(1).max(500).refine((value) => !/[\r\n\0]/.test(value), {
      message: 'Terminal command contains a forbidden control character.',
    }),
    args: z.array(z.string().max(1_000)).max(128),
    mode: z.enum(RUN_TERMINAL_MODES),
    startMode: z.enum(RUN_TERMINAL_START_MODES),
    cwd: z.string().trim().min(1).max(1_000).optional(),
    environmentKeys: z.array(environmentKeySchema).max(128),
  })
  .strict();
