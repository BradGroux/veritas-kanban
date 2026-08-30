import { z } from 'zod';
import { normalizeSafeHref } from '@veritas-kanban/shared';

const PrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const WorkProductKindSchema = z.enum([
  'text',
  'markdown',
  'summary',
  'checklist',
  'report',
  'table',
  'dashboard',
  'file',
]);

export const WorkProductStatusSchema = z.enum(['active', 'archived']);

export const WorkProductChangeTypeSchema = z.enum(['refine', 'regenerate', 'restore', 'manual']);

const RedactionSchema = z.object({
  level: z.enum(['none', 'standard', 'strict']).optional(),
  containsSensitiveContent: z.boolean().optional(),
  sensitiveFields: z.array(z.string().min(1).max(100)).max(50).optional(),
  notes: z.array(z.string().max(500)).max(20).optional(),
  exportDefault: z.enum(['redacted', 'full']).optional(),
});

const SourceLinkSchema = z.object({
  label: z.string().min(1).max(120),
  href: z
    .string()
    .min(1)
    .max(1000)
    .transform((href, ctx) => {
      const normalized = normalizeSafeHref(href);
      if (!normalized) {
        ctx.addIssue({
          code: 'custom',
          message: 'source link href must use an allowed URL scheme',
        });
        return z.NEVER;
      }
      return normalized;
    }),
  type: z.enum(['task', 'run', 'file', 'url', 'pr', 'other']).optional(),
});

const RenderBaseSchema = {
  schemaVersion: z.literal(1),
};

const ArtifactMediaTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(
    /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;[^\r\n]*)?$/,
    'media type must be a valid MIME type without control characters'
  )
  .refine(
    (value) =>
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127;
      }),
    'media type cannot contain control characters'
  );

const ArtifactSafeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^/\\]+$/, 'safe name cannot contain path separators')
  .refine(
    (value) =>
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127;
      }),
    'safe name cannot contain control characters'
  )
  .refine((value) => value !== '.' && value !== '..', 'safe name must identify a file');

export const WorkProductArtifactMetadataSchema = z
  .object({
    schemaVersion: z.literal('work-product-artifact/v1'),
    id: z.string().regex(/^wpa_[A-Za-z0-9_-]{20,40}$/),
    productId: z.string().regex(/^wp_[A-Za-z0-9_-]{20,64}$/),
    version: z.number().int().positive(),
    workspaceId: z.string().trim().min(1).max(240),
    taskId: z.string().trim().min(1).max(240),
    runId: z.string().trim().min(1).max(240),
    attemptId: z.string().trim().min(1).max(240),
    producingEventId: z.string().trim().min(1).max(240),
    requestIdDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    launchManifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    mediaType: ArtifactMediaTypeSchema,
    byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    safeName: ArtifactSafeNameSchema,
    state: z.enum(['available', 'quarantined', 'deleted']),
    quarantineReason: z
      .enum(['content-policy', 'secret-validation', 'integrity-mismatch'])
      .optional(),
    redaction: z
      .object({
        state: z.enum(['none', 'redacted', 'quarantined']),
        reason: z.string().trim().min(1).max(1_000).optional(),
      })
      .strict(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const WorkProductRenderSchema = z.discriminatedUnion('kind', [
  z.object({
    ...RenderBaseSchema,
    kind: z.literal('text'),
    text: z.string().max(500_000),
  }),
  z.object({
    ...RenderBaseSchema,
    kind: z.literal('markdown'),
    markdown: z.string().max(500_000),
  }),
  z.object({
    ...RenderBaseSchema,
    kind: z.literal('summary'),
    summary: z.string().max(100_000),
    keyPoints: z.array(z.string().max(2000)).max(200).optional(),
    sections: z
      .array(
        z.object({
          heading: z.string().min(1).max(200),
          body: z.string().max(50_000),
        })
      )
      .max(200)
      .optional(),
  }),
  z.object({
    ...RenderBaseSchema,
    kind: z.literal('checklist'),
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(120),
          label: z.string().min(1).max(1000),
          checked: z.boolean(),
          notes: z.string().max(5000).optional(),
        })
      )
      .max(1000),
  }),
  z.object({
    ...RenderBaseSchema,
    kind: z.literal('report'),
    summary: z.string().max(100_000),
    sections: z
      .array(
        z.object({
          heading: z.string().min(1).max(200),
          body: z.string().max(100_000),
        })
      )
      .max(200),
  }),
  z.object({
    ...RenderBaseSchema,
    kind: z.literal('table'),
    columns: z
      .array(
        z.object({
          key: z.string().min(1).max(120),
          label: z.string().min(1).max(200),
          type: z.enum(['text', 'number', 'boolean', 'date']).optional(),
        })
      )
      .min(1)
      .max(100),
    rows: z.array(z.record(z.string(), PrimitiveSchema)).max(5000),
  }),
  z.object({
    ...RenderBaseSchema,
    kind: z.literal('dashboard'),
    widgets: z
      .array(
        z.object({
          id: z.string().min(1).max(120),
          title: z.string().min(1).max(200),
          value: PrimitiveSchema.optional(),
          description: z.string().max(5000).optional(),
          tone: z.enum(['neutral', 'good', 'warning', 'critical']).optional(),
        })
      )
      .max(200),
  }),
  z.object({
    ...RenderBaseSchema,
    kind: z.literal('file'),
    artifact: WorkProductArtifactMetadataSchema,
  }),
]);

export const CreateWorkProductBodySchema = z
  .object({
    kind: WorkProductKindSchema,
    title: z.string().min(1).max(240),
    render: WorkProductRenderSchema,
    taskId: z.string().min(1).max(200).optional(),
    sourceRunId: z.string().min(1).max(200).optional(),
    agent: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(100).optional(),
    workspaceId: z.string().min(1).max(100).optional(),
    redaction: RedactionSchema.optional(),
    sourceLinks: z.array(SourceLinkSchema).max(50).optional(),
    metadata: z.record(z.string(), PrimitiveSchema).optional(),
    changeSummary: z.string().max(1000).optional(),
  })
  .refine((body) => body.kind === body.render.kind, {
    message: 'kind must match render.kind',
    path: ['render', 'kind'],
  })
  .refine((body) => body.kind !== 'file', {
    message: 'file work products must use the governed artifact registration endpoint',
    path: ['kind'],
  });

export const UpdateWorkProductBodySchema = z
  .object({
    title: z.string().min(1).max(240).optional(),
    render: WorkProductRenderSchema.optional(),
    status: WorkProductStatusSchema.optional(),
    taskId: z.string().min(1).max(200).optional(),
    sourceRunId: z.string().min(1).max(200).optional(),
    agent: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(100).optional(),
    redaction: RedactionSchema.optional(),
    sourceLinks: z.array(SourceLinkSchema).max(50).optional(),
    metadata: z.record(z.string(), PrimitiveSchema).optional(),
    changeType: WorkProductChangeTypeSchema.optional(),
    changeSummary: z.string().max(1000).optional(),
  })
  .refine((body) => !body.render || !body.render.kind || body.render.kind.length > 0, {
    message: 'render.kind is required when render is provided',
    path: ['render', 'kind'],
  })
  .refine((body) => body.render?.kind !== 'file', {
    message: 'file work product versions must use the governed artifact registration endpoint',
    path: ['render', 'kind'],
  });

export const WorkProductListQuerySchema = z.object({
  taskId: z.string().min(1).max(200).optional(),
  sourceRunId: z.string().min(1).max(200).optional(),
  agent: z.string().min(1).max(100).optional(),
  kind: WorkProductKindSchema.optional(),
  status: WorkProductStatusSchema.optional(),
  q: z.string().trim().min(1).max(500).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  view: z.enum(['full', 'preview']).optional(),
});

export const WorkProductExportQuerySchema = z.object({
  format: z.enum(['markdown', 'json']).optional(),
  redacted: z.enum(['true', 'false']).optional(),
});

export const RegisterWorkProductArtifactBodySchema = z
  .object({
    taskId: z.string().trim().min(1).max(240),
    runId: z.string().trim().min(1).max(240),
    attemptId: z.string().trim().min(1).max(240),
    requestId: z.string().trim().min(1).max(240),
    producingEventId: z.string().trim().min(1).max(240),
    relativePath: z.string().trim().min(1).max(1_000),
    title: z.string().trim().min(1).max(240),
    mediaType: ArtifactMediaTypeSchema,
    workProductId: z
      .string()
      .regex(/^wp_[A-Za-z0-9_-]{20,64}$/)
      .optional(),
  })
  .strict();

export const WorkProductArtifactVersionQuerySchema = z
  .object({
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const WorkProductArtifactPurgeQuerySchema = z
  .object({
    confirm: z.string().regex(/^wp_[A-Za-z0-9_-]{20,64}$/),
  })
  .strict();
