import { z } from 'zod';

export const runSessionPermissionSchema = z.enum(['view', 'edit', 'fork']);
export const runSessionStatusSchema = z.enum(['active', 'revoked', 'expired']);

const mobileSafeApprovalClassSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i, 'Invalid approval class');

export const createRunSessionShareSchema = z.object({
  taskId: z.string().min(1).max(120),
  permission: runSessionPermissionSchema.default('view'),
  expiresAt: z.string().datetime().optional(),
  actorLabel: z.string().trim().min(1).max(120).optional(),
  mobileSafeApprovalClasses: z.array(mobileSafeApprovalClassSchema).max(20).optional(),
});

export const runSessionShareListQuerySchema = z.object({
  taskId: z.string().min(1).max(120).optional(),
  status: runSessionStatusSchema.optional(),
});

export const runSessionShareParamsSchema = z.object({
  shareId: z.string().min(1).max(120),
});

export const updateRunSessionShareSchema = z.object({
  permission: runSessionPermissionSchema.optional(),
  expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  actorLabel: z.string().trim().min(1).max(120).optional(),
  mobileSafeApprovalClasses: z.array(mobileSafeApprovalClassSchema).max(20).optional(),
});

export const revokeRunSessionShareSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const sendRunSessionMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
});

export const runSessionApprovalResponseSchema = z.object({
  actionClass: mobileSafeApprovalClassSchema,
  response: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
});

export const forkRunSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  reason: z.string().trim().max(1000).optional(),
});

export type CreateRunSessionShareBody = z.infer<typeof createRunSessionShareSchema>;
export type RunSessionShareListQuery = z.infer<typeof runSessionShareListQuerySchema>;
export type RunSessionShareParams = z.infer<typeof runSessionShareParamsSchema>;
export type UpdateRunSessionShareBody = z.infer<typeof updateRunSessionShareSchema>;
export type RevokeRunSessionShareBody = z.infer<typeof revokeRunSessionShareSchema>;
export type SendRunSessionMessageBody = z.infer<typeof sendRunSessionMessageSchema>;
export type RunSessionApprovalResponseBody = z.infer<typeof runSessionApprovalResponseSchema>;
export type ForkRunSessionBody = z.infer<typeof forkRunSessionSchema>;
