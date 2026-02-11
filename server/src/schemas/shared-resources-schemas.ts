import { z } from 'zod';

export const SharedResourceTypeSchema = z.enum([
  'prompt',
  'guideline',
  'skill',
  'config',
  'template',
]);

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
