import { z } from 'zod';

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
 * POST /api/tasks/:id/apply-template - Apply template to existing task
 */
export const ApplyTemplateBodySchema = z.object({
  templateId: z.string().min(1, 'Template ID is required'),
  templateName: z.string().optional(),
  fieldsChanged: z.array(z.string()).optional(),
});

export type ApplyTemplateBody = z.infer<typeof ApplyTemplateBodySchema>;
