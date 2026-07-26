import { z } from 'zod';
import {
  RUN_OUTPUT_ARTIFACT_SCHEMA_VERSION,
  RUN_OUTPUT_ARTIFACT_STATES,
  RUN_OUTPUT_CONTENT_CLASSES,
  RUN_OUTPUT_PREVIEW_SCHEMA_VERSION,
  RUN_OUTPUT_QUERY_OPERATIONS,
  RUN_OUTPUT_SOURCE_KINDS,
  RUN_OUTPUT_TRUNCATION_REASONS,
  type RunOutputArtifactMetadata,
  type RunOutputPreview,
  type RunOutputSpillPolicy,
} from '@veritas-kanban/shared';

const IdentifierSchema = z.string().trim().min(1).max(240);
const TimestampSchema = z.string().datetime();
const ByteCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const RunOutputSpillPolicySchema: z.ZodType<RunOutputSpillPolicy> = z
  .object({
    schemaVersion: z.literal('run-output-spill-policy/v1'),
    inlineBytes: z.number().int().min(256).max(4 * 1024 * 1024),
    maxQueryBytes: z.number().int().min(256).max(4 * 1024 * 1024),
    maxJsonDepth: z.number().int().min(1).max(64),
    retentionSeconds: z.number().int().min(60).max(90 * 24 * 60 * 60),
    activeLeaseSeconds: z.number().int().min(0).max(7 * 24 * 60 * 60),
    allowBinaryPersistence: z.boolean(),
    allowCompressedPersistence: z.boolean(),
  })
  .strict();

export const RunOutputArtifactMetadataSchema: z.ZodType<RunOutputArtifactMetadata> = z
  .object({
    schemaVersion: z.literal(RUN_OUTPUT_ARTIFACT_SCHEMA_VERSION),
    id: z.string().regex(/^spill_[A-Za-z0-9_-]{20,40}$/),
    scope: z
      .object({
        workspaceId: IdentifierSchema,
        taskId: IdentifierSchema,
        runId: IdentifierSchema,
        attemptId: IdentifierSchema,
        turnId: IdentifierSchema.optional(),
      })
      .strict(),
    source: z
      .object({
        kind: z.enum(RUN_OUTPUT_SOURCE_KINDS),
        name: z.string().trim().min(1).max(240).optional(),
        eventId: IdentifierSchema.optional(),
        toolCallId: IdentifierSchema.optional(),
        commandId: IdentifierSchema.optional(),
      })
      .strict(),
    mediaType: z.string().trim().min(1).max(240),
    encoding: z.enum(['utf-8', 'binary']),
    contentClass: z.enum(RUN_OUTPUT_CONTENT_CLASSES),
    originalBytes: ByteCountSchema,
    storedBytes: ByteCountSchema,
    previewBytes: ByteCountSchema,
    truncationReason: z.enum(RUN_OUTPUT_TRUNCATION_REASONS),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    redaction: z
      .object({
        state: z.enum(['none', 'redacted', 'quarantined', 'dropped']),
        fields: z.array(z.string().min(1).max(512)).max(256),
        validatedAt: TimestampSchema,
      })
      .strict(),
    retention: z
      .object({
        createdAt: TimestampSchema,
        expiresAt: TimestampSchema,
        activeLeaseUntil: TimestampSchema.optional(),
      })
      .strict(),
    state: z.enum(RUN_OUTPUT_ARTIFACT_STATES),
  })
  .strict();

export const RunOutputPreviewSchema: z.ZodType<RunOutputPreview> = z
  .object({
    schemaVersion: z.literal(RUN_OUTPUT_PREVIEW_SCHEMA_VERSION),
    inline: z.boolean(),
    content: z.string(),
    mediaType: z.string().trim().min(1).max(240),
    contentClass: z.enum(RUN_OUTPUT_CONTENT_CLASSES),
    originalBytes: ByteCountSchema,
    previewBytes: ByteCountSchema,
    truncated: z.boolean(),
    truncationReason: z.enum(RUN_OUTPUT_TRUNCATION_REASONS).optional(),
    artifact: z
      .object({
        artifactId: z.string().regex(/^spill_[A-Za-z0-9_-]{20,40}$/),
        state: z.enum(RUN_OUTPUT_ARTIFACT_STATES),
        operations: z.array(z.enum(RUN_OUTPUT_QUERY_OPERATIONS)).min(1).max(5),
      })
      .strict()
      .optional(),
    queryHints: z
      .object({
        maxResultBytes: ByteCountSchema,
        maxJsonDepth: z.number().int().min(1).max(64),
        operations: z.array(z.enum(RUN_OUTPUT_QUERY_OPERATIONS)).min(1).max(5),
      })
      .strict()
      .optional(),
  })
  .strict();
