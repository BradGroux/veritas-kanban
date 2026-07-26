import { z } from 'zod';
import {
  WORKSPACE_CHECKPOINT_BOUNDARIES,
  WORKSPACE_CHECKPOINT_EXCLUSION_REASONS,
  WORKSPACE_CHECKPOINT_SCHEMA_VERSION,
  type WorkspaceCheckpoint,
} from '@veritas-kanban/shared';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._:-]+$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const opaqueReferenceSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => value.trim().length > 0 && !value.includes('\0'), {
    message: 'Checkpoint references must contain non-whitespace text and no NUL bytes.',
  });
const relativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.includes('\0') &&
      !value.includes('\\') &&
      !value.startsWith('/') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split('/').includes('..'),
    {
      message: 'Checkpoint file paths must be safe relative paths with no NUL bytes.',
    }
  );

export const WorkspaceCheckpointSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_CHECKPOINT_SCHEMA_VERSION),
    id: identifierSchema,
    workspaceId: identifierSchema,
    taskId: identifierSchema,
    attemptId: identifierSchema,
    boundary: z.enum(WORKSPACE_CHECKPOINT_BOUNDARIES),
    operationIdDigest: digestSchema,
    captureRequestDigest: digestSchema,
    worktreeRootDigest: digestSchema,
    worktreeManifestId: opaqueReferenceSchema.optional(),
    parentCheckpointId: opaqueReferenceSchema.optional(),
    turnId: opaqueReferenceSchema.optional(),
    conversationCursor: opaqueReferenceSchema.optional(),
    git: z
      .object({
        head: z
          .string()
          .regex(/^[a-f0-9]{40,64}$/)
          .nullable(),
        branch: z.string().trim().min(1).max(500).nullable(),
        indexDigest: digestSchema,
        indexBlobDigest: digestSchema,
        indexBytes: z.number().int().nonnegative(),
        statusDigest: digestSchema,
        dirty: z.boolean(),
      })
      .strict(),
    policy: z
      .object({
        ignoredFiles: z.literal('excluded'),
        sensitiveFiles: z.literal('excluded'),
        binaryFiles: z.literal('excluded'),
        symlinks: z.literal('excluded'),
        maxFiles: z.number().int().min(1).max(100_000),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(4 * 1_024 * 1_024 * 1_024),
        maxFileBytes: z
          .number()
          .int()
          .min(1)
          .max(512 * 1_024 * 1_024),
        maxExclusions: z.number().int().min(1).max(100_000),
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            path: relativePathSchema,
            source: z.enum(['tracked', 'untracked']),
            state: z.enum(['present', 'absent']),
            mode: z.number().int().nonnegative().max(0o7777).optional(),
            size: z.number().int().nonnegative(),
            contentDigest: digestSchema.optional(),
            blobDigest: digestSchema.optional(),
          })
          .strict()
      )
      .max(100_000),
    exclusions: z
      .array(
        z
          .object({
            path: relativePathSchema,
            source: z.enum(['tracked', 'untracked']),
            reason: z.enum(WORKSPACE_CHECKPOINT_EXCLUSION_REASONS),
            size: z.number().int().nonnegative().optional(),
          })
          .strict()
      )
      .max(100_000),
    excludedCount: z.number().int().nonnegative(),
    exclusionsTruncated: z.boolean(),
    fileCount: z.number().int().nonnegative(),
    contentBytes: z.number().int().nonnegative(),
    storedBytes: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    digest: digestSchema,
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (checkpoint.fileCount !== checkpoint.files.length) {
      context.addIssue({
        code: 'custom',
        path: ['fileCount'],
        message: 'Checkpoint fileCount must match the file inventory.',
      });
    }
    if (checkpoint.excludedCount < checkpoint.exclusions.length) {
      context.addIssue({
        code: 'custom',
        path: ['excludedCount'],
        message: 'Checkpoint excludedCount cannot be below the retained exclusions.',
      });
    }
    if (
      checkpoint.exclusionsTruncated !==
      checkpoint.excludedCount > checkpoint.exclusions.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['exclusionsTruncated'],
        message: 'Checkpoint truncation evidence must match the exclusion counts.',
      });
    }
    if (
      checkpoint.fileCount > checkpoint.policy.maxFiles ||
      checkpoint.contentBytes > checkpoint.policy.maxBytes
    ) {
      context.addIssue({
        code: 'custom',
        path: ['policy'],
        message: 'Checkpoint inventory must remain within its recorded policy bounds.',
      });
    }
    for (const [index, file] of checkpoint.files.entries()) {
      if (
        file.state === 'present' &&
        (!file.contentDigest || !file.blobDigest || file.mode === undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['files', index],
          message: 'Present checkpoint files require mode and content-addressed blob evidence.',
        });
      }
      if (
        file.state === 'present' &&
        (file.contentDigest !== file.blobDigest || file.size > checkpoint.policy.maxFileBytes)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['files', index],
          message: 'Checkpoint content evidence must match and remain within its file bound.',
        });
      }
      if (
        file.state === 'absent' &&
        (file.contentDigest || file.blobDigest || file.mode !== undefined || file.size !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['files', index],
          message: 'Absent checkpoint files cannot include content evidence.',
        });
      }
    }
  });

export function parseWorkspaceCheckpoint(value: unknown): WorkspaceCheckpoint {
  return WorkspaceCheckpointSchema.parse(value) as WorkspaceCheckpoint;
}
