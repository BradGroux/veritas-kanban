import { z } from 'zod';

export const DocumentTypeSchema = z.enum([
  'readme',
  'api-docs',
  'runbook',
  'architecture',
  'sop',
  'guide',
  'other',
]);

export const CreateTrackedDocumentSchema = z.object({
  title: z.string().min(1),
  path: z.string().min(1),
  project: z.string().optional(),
  type: DocumentTypeSchema.optional(),
  lastReviewedAt: z.string().datetime().optional(),
  lastReviewedBy: z.string().optional(),
  maxAgeDays: z.number().int().min(1).max(365).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const UpdateTrackedDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  project: z.string().optional(),
  type: DocumentTypeSchema.optional(),
  lastReviewedAt: z.string().datetime().optional(),
  lastReviewedBy: z.string().optional(),
  maxAgeDays: z.number().int().min(1).max(365).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const ReviewDocumentSchema = z.object({
  reviewer: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
});

export const AcknowledgeAlertSchema = z.object({
  acknowledgedBy: z.string().optional(),
});

export const DocAlertSeveritySchema = z.enum(['info', 'warning', 'critical']);
