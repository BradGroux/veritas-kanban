import { z } from 'zod';
import { WORKTREE_MANIFEST_SCHEMA_VERSION, type WorktreeManifest } from '@veritas-kanban/shared';

const identifierSchema = z.string().trim().min(1).max(240);
const pathSchema = z.string().trim().min(1).max(4096);
const timestampSchema = z.iso.datetime();
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const cleanupReasonCodeSchema = z.enum([
  'active-run',
  'active-lease',
  'dirty',
  'untracked',
  'unpushed',
  'unmerged',
  'external-hold',
  'manifest-mismatch',
  'worktree-missing',
  'branch-mismatch',
  'inspection-failed',
]);

export const WorktreeManifestSchema = z
  .object({
    schemaVersion: z.literal(WORKTREE_MANIFEST_SCHEMA_VERSION),
    id: identifierSchema,
    revision: z.number().int().min(0),
    taskId: identifierSchema,
    repository: z
      .object({
        name: identifierSchema,
        rootPath: pathSchema,
        commonGitDir: pathSchema,
        originFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict(),
    path: pathSchema,
    branch: identifierSchema,
    base: z
      .object({
        branch: identifierSchema,
        commit: gitCommitSchema,
        source: z.enum(['remote', 'local-stale', 'legacy-adopted']),
        resolvedAt: timestampSchema,
        fetchedAt: timestampSchema.optional(),
        fetchError: z.string().trim().min(1).max(2000).optional(),
        staleBaseAcknowledgement: z
          .object({
            reason: z.string().trim().min(1).max(1000),
            acknowledgedAt: timestampSchema,
            actor: identifierSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    lease: z
      .object({
        id: identifierSchema,
        ownerTaskId: identifierSchema,
        ownerAttemptId: identifierSchema.optional(),
        acquiredAt: timestampSchema,
        expiresAt: timestampSchema,
      })
      .strict(),
    lifecycle: z
      .object({
        creation: z.enum(['planned', 'creating', 'ready', 'failed']),
        integration: z.enum(['idle', 'preparing', 'merging', 'pushing', 'integrated', 'failed']),
        cleanup: z.enum(['active', 'blocked', 'removing', 'removed', 'failed']),
      })
      .strict(),
    rebase: z
      .object({
        state: z.enum(['idle', 'rebasing', 'failed']),
        targetBase: z
          .object({
            branch: identifierSchema,
            commit: gitCommitSchema,
            source: z.enum(['remote', 'local-stale', 'legacy-adopted']),
            resolvedAt: timestampSchema,
            fetchedAt: timestampSchema.optional(),
            fetchError: z.string().trim().min(1).max(2000).optional(),
            staleBaseAcknowledgement: z
              .object({
                reason: z.string().trim().min(1).max(1000),
                acknowledgedAt: timestampSchema,
                actor: identifierSchema.optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        startedAt: timestampSchema.optional(),
        completedAt: timestampSchema.optional(),
      })
      .strict(),
    integration: z
      .object({
        worktreePath: pathSchema.optional(),
        baseCommit: gitCommitSchema.optional(),
        integrationHead: gitCommitSchema.optional(),
        targetCommit: gitCommitSchema.optional(),
        startedAt: timestampSchema.optional(),
        completedAt: timestampSchema.optional(),
      })
      .strict(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    removedAt: timestampSchema.optional(),
    lastError: z
      .object({
        operation: z.enum([
          'create',
          'task-update',
          'rebase',
          'integration-prepare',
          'integration-merge',
          'integration-push',
          'cleanup',
        ]),
        code: identifierSchema,
        message: z.string().trim().min(1).max(2000),
        at: timestampSchema,
        recoverable: z.boolean(),
      })
      .strict()
      .optional(),
    overrides: z
      .array(
        z
          .object({
            operation: z.literal('cleanup'),
            reason: z.string().trim().min(1).max(1000),
            actor: identifierSchema.optional(),
            recordedAt: timestampSchema,
            bypassedReasons: z.array(cleanupReasonCodeSchema).max(32),
          })
          .strict()
      )
      .max(100),
  })
  .strict();

export function parseWorktreeManifest(value: unknown): WorktreeManifest {
  return WorktreeManifestSchema.parse(value) as WorktreeManifest;
}
