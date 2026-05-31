import { z } from 'zod';

const RedactionSchema = z.object({
  level: z.enum(['none', 'standard', 'strict']).optional(),
  containsSensitiveContent: z.boolean().optional(),
  notes: z.array(z.string().max(500)).max(20).optional(),
});

/**
 * POST /api/tasks/:id/deliverables - Add a deliverable
 */
export const AddDeliverableBodySchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['document', 'code', 'report', 'artifact', 'other']),
  path: z.string().max(500).optional(),
  description: z.string().max(1000).optional(),
  agent: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  sourceRunId: z.string().max(200).optional(),
  redaction: RedactionSchema.optional(),
});

export type AddDeliverableBody = z.infer<typeof AddDeliverableBodySchema>;

/**
 * PATCH /api/tasks/:id/deliverables/:deliverableId - Update a deliverable
 */
export const UpdateDeliverableBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.enum(['document', 'code', 'report', 'artifact', 'other']).optional(),
  path: z.string().max(500).optional(),
  status: z.enum(['pending', 'attached', 'reviewed', 'accepted']).optional(),
  description: z.string().max(1000).optional(),
  agent: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  sourceRunId: z.string().max(200).optional(),
  redaction: RedactionSchema.optional(),
});

export type UpdateDeliverableBody = z.infer<typeof UpdateDeliverableBodySchema>;
