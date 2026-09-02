import { z } from 'zod';
import { BOARD_COLUMN_ID_PATTERN } from '@veritas-kanban/shared';

export const MAX_TASK_REORDER_ITEMS = 1_000;

/**
 * POST /api/tasks/reorder - Reorder tasks within a column
 */
export const ReorderTasksBodySchema = z.object({
  orderedIds: z
    .array(z.string().min(1))
    .min(1, 'orderedIds must be a non-empty array of task IDs')
    .max(MAX_TASK_REORDER_ITEMS, `orderedIds cannot exceed ${MAX_TASK_REORDER_ITEMS} task IDs`),
});

export type ReorderTasksBody = z.infer<typeof ReorderTasksBodySchema>;

/**
 * POST /api/tasks/:id/move - Atomically move one task on the board.
 */
export const MoveTaskBodySchema = z.object({
  operationId: z.string().uuid(),
  sourceStatus: z.string().min(1).max(50).regex(BOARD_COLUMN_ID_PATTERN),
  sourcePosition: z.number().finite().nullable(),
  destinationStatus: z.string().min(1).max(50).regex(BOARD_COLUMN_ID_PATTERN),
  destinationIndex: z.number().int().min(0).max(MAX_TASK_REORDER_ITEMS),
  expectedRevision: z.number().int().min(0).optional(),
});

export type MoveTaskBody = z.infer<typeof MoveTaskBodySchema>;

/**
 * POST /api/tasks/:id/apply-template - Apply template to existing task
 */
export const ApplyTemplateBodySchema = z.object({
  templateId: z.string().min(1, 'Template ID is required'),
  templateName: z.string().optional(),
  fieldsChanged: z.array(z.string()).optional(),
});

export type ApplyTemplateBody = z.infer<typeof ApplyTemplateBodySchema>;
