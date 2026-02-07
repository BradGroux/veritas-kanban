/**
 * Broadcast Validation Schemas
 *
 * Zod schemas for broadcast endpoints.
 */

import { z } from 'zod';

/** Valid broadcast priority levels */
export const broadcastPrioritySchema = z.enum(['info', 'action-required', 'urgent']);

/** Schema for creating a new broadcast */
export const createBroadcastSchema = z.object({
  message: z.string().min(1, 'Message is required').max(5000, 'Message too long'),
  priority: broadcastPrioritySchema.optional().default('info'),
  from: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

/** Schema for marking a broadcast as read */
export const markReadSchema = z.object({
  agent: z.string().min(1, 'Agent name is required').max(100),
});

/** Schema for GET /api/broadcasts query parameters */
export const getBroadcastsQuerySchema = z.object({
  since: z.string().datetime().optional(),
  unread: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  agent: z.string().optional(),
  priority: broadcastPrioritySchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().positive().max(1000).optional()),
});
