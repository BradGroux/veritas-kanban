import { z } from 'zod';
import type { SharedResource } from '@veritas-kanban/shared';

export const SharedResourceTypeSchema = z.enum([
  'prompt',
  'guideline',
  'skill',
  'config',
  'template',
]);

// Validate the persisted interface without discarding fields from other versions.
export const SharedResourceRecordSchema: z.ZodType<SharedResource> = z
  .object({
    id: z.string(),
    name: z.string(),
    type: SharedResourceTypeSchema,
    content: z.string(),
    tags: z.array(z.string()),
    mountedIn: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.string().optional(),
    version: z.number(),
  })
  .passthrough();

export const SharedResourceRecordsSchema = z.array(SharedResourceRecordSchema);

export const SharedResourceCreateSchema = z.object({
  name: z.string().min(1).max(200),
  type: SharedResourceTypeSchema,
  content: z.string().min(1),
  tags: z.array(z.string().min(1).max(50)).optional(),
  mountedIn: z.array(z.string().min(1).max(100)).optional(),
  createdBy: z.string().min(1).max(100).optional(),
});

export const SharedResourceUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: SharedResourceTypeSchema.optional(),
  content: z.string().min(1).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
});

export const SharedResourceMountSchema = z.object({
  projectIds: z.array(z.string().min(1).max(100)).min(1),
});

export const SharedResourceListQuerySchema = z.object({
  type: SharedResourceTypeSchema.optional(),
  project: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});
