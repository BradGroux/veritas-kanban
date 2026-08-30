import { z } from 'zod';
import {
  RUN_FILE_MEDIA_CLASSES,
  RUN_FILE_PROVENANCE_OPERATIONS,
  RUN_FILE_PROVENANCE_ROOTS,
  RUN_FILE_PROVENANCE_SCHEMA_VERSION,
  RUN_FILE_PROVENANCE_SOURCES,
  type RunFileProvenanceRecord,
  type RunFileProvenanceGap,
} from '@veritas-kanban/shared';

const identifier = z.string().trim().min(1).max(160);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const safePath = z.string().trim().min(1).max(2_000);

export const RunFileProvenanceRecordSchema: z.ZodType<RunFileProvenanceRecord> = z
  .object({
    schemaVersion: z.literal(RUN_FILE_PROVENANCE_SCHEMA_VERSION),
    id: z.string().regex(/^runfile_[a-f0-9]{32}$/),
    scope: z
      .object({
        workspaceId: identifier,
        taskId: identifier,
        rootObjectiveId: identifier,
        executionNodeId: identifier,
        runId: identifier,
        attemptId: identifier,
        workflowStepId: identifier.nullable(),
      })
      .strict(),
    source: z.enum(RUN_FILE_PROVENANCE_SOURCES),
    operation: z.enum(RUN_FILE_PROVENANCE_OPERATIONS),
    producer: z
      .object({
        eventId: identifier,
        eventSequence: z.number().int().positive(),
        toolCallId: identifier.nullable(),
        commandId: identifier.nullable(),
        attachmentId: identifier.nullable(),
        connectorTarget: z.string().trim().min(1).max(500).nullable(),
        sourceUrl: z.string().trim().min(1).max(2_000).nullable(),
        safeMetadata: z.record(z.string().min(1).max(100), z.string().max(500)),
      })
      .strict(),
    location: z
      .object({
        root: z.enum(RUN_FILE_PROVENANCE_ROOTS),
        relativePath: safePath,
        normalizedPath: safePath,
        caseFoldedPath: safePath,
      })
      .strict(),
    content: z
      .object({
        sha256: digest,
        byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        mediaType: z.string().trim().min(1).max(240),
        mediaClass: z.enum(RUN_FILE_MEDIA_CLASSES),
      })
      .strict(),
    predecessorId: z
      .string()
      .regex(/^runfile_[a-f0-9]{32}$/)
      .nullable(),
    previousPath: safePath.nullable(),
    capturedAt: z.iso.datetime({ offset: true }),
    digest,
  })
  .strict();

export const RunFileProvenanceGapSchema: z.ZodType<RunFileProvenanceGap> = z
  .object({
    code: z.enum([
      'unsupported-provider-path',
      'unsupported-tool-path',
      'link-identity-uncertified',
      'path-collision',
      'causal-event-missing',
      'record-invalid',
    ]),
    message: z.string().trim().min(1).max(1_000),
    root: z.enum(RUN_FILE_PROVENANCE_ROOTS).optional(),
    relativePath: safePath.optional(),
    eventId: identifier.optional(),
    eventSequence: z.number().int().positive().optional(),
  })
  .strict();

export const RunFileProvenanceReadQuerySchema = z
  .object({
    attemptId: identifier,
    root: z.enum(RUN_FILE_PROVENANCE_ROOTS),
    path: safePath,
    sha256: digest,
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const RunFileProvenanceListQuerySchema = z
  .object({
    attemptId: identifier,
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
