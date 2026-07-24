import { z } from 'zod';
import {
  COMPLETION_RESULT_SCHEMA_VERSION,
  TASK_ARTIFACT_KINDS,
  TASK_CHANGED_FILE_STATUSES,
  TASK_COMMIT_POLICIES,
  TASK_COMPLETION_STATUSES,
  TASK_CONTINUATION_KINDS,
  TASK_ENVELOPE_SCHEMA_VERSION,
  TASK_EVIDENCE_KINDS,
  TASK_EVIDENCE_SOURCES,
  TASK_EXPECTED_OUTPUT_KINDS,
  TASK_SIDE_EFFECT_KINDS,
  TASK_TERMINAL_SOURCES,
  TASK_VERIFICATION_STATUSES,
  type CompletionResult,
  type TaskEnvelope,
} from '@veritas-kanban/shared';
import { verifyTaskEnvelopeDigest } from '../utils/task-envelope-digest.js';
import { verifyCompletionResultDigest } from '../utils/completion-result-digest.js';

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const idSchema = z.string().trim().min(1).max(160);
const shortTextSchema = z.string().trim().min(1).max(500);
const textSchema = z.string().trim().min(1).max(20_000);
const pathSchema = z.string().trim().min(1).max(4096);
const isoDateSchema = z.string().datetime();

export const TaskCommitPolicySchema = z.enum(TASK_COMMIT_POLICIES);

export const TaskAllowedSideEffectSchema = z
  .object({
    kind: z.enum(TASK_SIDE_EFFECT_KINDS),
    scope: z.string().trim().min(1).max(4096),
  })
  .strict();

export const TaskExpectedOutputSchema = z
  .object({
    id: idSchema,
    kind: z.enum(TASK_EXPECTED_OUTPUT_KINDS),
    description: textSchema,
    required: z.boolean(),
  })
  .strict();

export const TaskExecutionPolicySchema = z
  .object({
    commitPolicy: TaskCommitPolicySchema.optional(),
    allowedSideEffects: z.array(TaskAllowedSideEffectSchema).max(32).optional(),
    expectedOutputs: z.array(TaskExpectedOutputSchema).max(64).optional(),
  })
  .strict();

export const TaskEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(TASK_ENVELOPE_SCHEMA_VERSION),
    digest: digestSchema,
    subject: z
      .object({
        id: idSchema,
        title: z.string().trim().min(1).max(500),
        objective: textSchema,
        background: z.array(z.string().trim().min(1).max(4000)).max(64),
        constraints: z.array(z.string().trim().min(1).max(4000)).max(128),
        acceptanceCriteria: z.array(z.string().trim().min(1).max(4000)).max(256),
      })
      .strict(),
    attempt: z
      .object({
        id: idSchema,
        createdAt: isoDateSchema,
      })
      .strict(),
    workspace: z
      .object({
        workspaceId: idSchema,
        worktreeId: idSchema,
        worktreeManifestId: idSchema.optional(),
        ownershipLeaseId: idSchema.optional(),
        ownershipAttemptId: idSchema.optional(),
        repo: shortTextSchema,
        branch: shortTextSchema,
        baseBranch: shortTextSchema,
        resolvedBaseCommit: z
          .string()
          .regex(/^[a-f0-9]{40,64}$/)
          .optional(),
        baseResolutionSource: z.enum(['remote', 'local-stale', 'legacy-adopted']).optional(),
        worktreePath: pathSchema,
        baseline: z
          .object({
            capturedAt: isoDateSchema,
            headSha: z.string().regex(/^[a-f0-9]{40,64}$/),
            dirty: z.boolean(),
            files: z
              .array(
                z
                  .object({
                    path: pathSchema,
                    status: z.enum(TASK_CHANGED_FILE_STATUSES),
                    indexBlobHash: z
                      .string()
                      .regex(/^[a-f0-9]{40,64}$/)
                      .nullable(),
                    worktreeSha256: z
                      .string()
                      .regex(/^[a-f0-9]{64}$/)
                      .nullable(),
                  })
                  .strict()
              )
              .max(1000),
            preexistingCommitShas: z
              .array(z.string().regex(/^[a-f0-9]{40,64}$/))
              .max(4096)
              .optional(),
          })
          .strict(),
      })
      .strict(),
    commitPolicy: TaskCommitPolicySchema,
    allowedSideEffects: z.array(TaskAllowedSideEffectSchema).max(32),
    expectedOutputs: z.array(TaskExpectedOutputSchema).max(64),
    verificationGates: z
      .array(
        z
          .object({
            id: idSchema,
            description: textSchema,
            required: z.boolean(),
            evidenceRequired: z.boolean(),
          })
          .strict()
      )
      .max(256),
    launchManifest: z
      .object({
        schemaVersion: idSchema,
        digest: digestSchema,
        provider: idSchema,
        adapter: idSchema,
        protocolVersion: idSchema,
      })
      .strict(),
    completionContract: z
      .object({
        schemaVersion: z.literal(COMPLETION_RESULT_SCHEMA_VERSION),
        evidenceRequirements: z
          .array(
            z
              .object({
                id: idSchema,
                kind: z.enum(TASK_EVIDENCE_KINDS),
                description: textSchema,
                required: z.boolean(),
              })
              .strict()
          )
          .max(128),
      })
      .strict(),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    if (!verifyTaskEnvelopeDigest(envelope)) {
      ctx.addIssue({
        code: 'custom',
        path: ['digest'],
        message: 'Task envelope digest does not match the canonical payload',
      });
    }
  });

export const CompletionResultSchema = z
  .object({
    schemaVersion: z.literal(COMPLETION_RESULT_SCHEMA_VERSION),
    digest: digestSchema,
    idempotencyKey: digestSchema,
    completedAt: isoDateSchema,
    terminalSource: z.enum(TASK_TERMINAL_SOURCES),
    taskEnvelopeSchemaVersion: z.literal(TASK_ENVELOPE_SCHEMA_VERSION),
    taskEnvelopeDigest: digestSchema,
    taskId: idSchema,
    attemptId: idSchema,
    providerRuntimeManifestDigest: digestSchema,
    status: z.enum(TASK_COMPLETION_STATUSES),
    summary: textSchema,
    error: z.string().trim().min(1).max(20_000).nullable(),
    blockers: z
      .array(
        z
          .object({
            code: idSchema,
            summary: shortTextSchema,
            detail: textSchema,
            retryable: z.boolean(),
          })
          .strict()
      )
      .max(64),
    evidence: z
      .array(
        z
          .object({
            id: idSchema,
            kind: z.enum(TASK_EVIDENCE_KINDS),
            source: z.enum(TASK_EVIDENCE_SOURCES),
            summary: textSchema,
            reference: z.string().trim().min(1).max(4096).nullable(),
            requirementIds: z.array(idSchema).max(64),
            verified: z.boolean(),
          })
          .strict()
      )
      .max(512),
    changedFiles: z
      .array(
        z
          .object({
            path: pathSchema,
            status: z.enum(TASK_CHANGED_FILE_STATUSES),
            previousPath: pathSchema.nullable(),
            verified: z.boolean(),
          })
          .strict()
      )
      .max(2000),
    artifacts: z
      .array(
        z
          .object({
            id: idSchema,
            kind: z.enum(TASK_ARTIFACT_KINDS),
            name: shortTextSchema,
            reference: z.string().trim().min(1).max(4096),
            mediaType: z.string().trim().min(1).max(200).nullable(),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            verified: z.boolean(),
          })
          .strict()
      )
      .max(256),
    verification: z
      .array(
        z
          .object({
            gateId: idSchema,
            status: z.enum(TASK_VERIFICATION_STATUSES),
            summary: textSchema,
            evidenceIds: z.array(idSchema).max(128),
          })
          .strict()
      )
      .max(256),
    sideEffects: z
      .array(
        z
          .object({
            kind: z.enum(TASK_SIDE_EFFECT_KINDS),
            description: textSchema,
            target: z.string().trim().min(1).max(4096).nullable(),
            authorized: z.boolean(),
            verified: z.boolean(),
          })
          .strict()
      )
      .max(256),
    continuation: z
      .object({
        provider: idSchema,
        kind: z.enum(TASK_CONTINUATION_KINDS),
        reference: z.string().trim().min(1).max(4096),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (!verifyCompletionResultDigest(result as CompletionResult)) {
      ctx.addIssue({
        code: 'custom',
        path: ['digest'],
        message: 'Completion result digest does not match the canonical payload',
      });
    }
    if (result.status === 'success') {
      if (result.error !== null || result.blockers.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Successful completion cannot include an error or blockers',
        });
      }
      if (!result.evidence.some((item) => item.verified)) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: 'Successful completion requires verified evidence',
        });
      }
      if (result.verification.some((item) => item.status !== 'passed')) {
        ctx.addIssue({
          code: 'custom',
          path: ['verification'],
          message: 'Successful completion cannot include an unpassed verification result',
        });
      }
    }
    if (result.status === 'blocked' && result.blockers.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockers'],
        message: 'Blocked completion requires at least one blocker',
      });
    }
    if (result.status === 'failed' && result.error === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Failed completion requires an error',
      });
    }
  });

export function parseTaskEnvelope(value: unknown): TaskEnvelope {
  return TaskEnvelopeSchema.parse(value) as TaskEnvelope;
}

export function parseCompletionResult(value: unknown): CompletionResult {
  return CompletionResultSchema.parse(value) as CompletionResult;
}

export function parseCompletionResultForEnvelope(
  value: unknown,
  envelope: TaskEnvelope
): CompletionResult {
  const result = parseCompletionResult(value);
  const mismatches = [
    result.taskId === envelope.subject.id || 'task ID',
    result.attemptId === envelope.attempt.id || 'attempt ID',
    result.taskEnvelopeDigest === envelope.digest || 'task envelope digest',
    result.providerRuntimeManifestDigest === envelope.launchManifest.digest || 'manifest digest',
  ].filter((item): item is string => typeof item === 'string');
  if (mismatches.length > 0) {
    throw new z.ZodError(
      mismatches.map((field) => ({
        code: 'custom' as const,
        path: [field],
        message: `Completion result does not match the task envelope ${field}`,
      }))
    );
  }

  if (result.status === 'success') {
    const verifiedEvidence = result.evidence.filter((item) => item.verified);
    const verifiedEvidenceIds = new Set(verifiedEvidence.map((item) => item.id));
    const missingEvidence = envelope.completionContract.evidenceRequirements.filter(
      (requirement) =>
        requirement.required &&
        !verifiedEvidence.some(
          (evidence) =>
            evidence.kind === requirement.kind && evidence.requirementIds.includes(requirement.id)
        )
    );
    const verificationByGate = new Map(result.verification.map((item) => [item.gateId, item]));
    const missingVerification = envelope.verificationGates.filter((gate) => {
      if (!gate.required) return false;
      const verification = verificationByGate.get(gate.id);
      if (!verification || verification.status !== 'passed') return true;
      if (!gate.evidenceRequired) return false;
      return !verification.evidenceIds.some((evidenceId) => verifiedEvidenceIds.has(evidenceId));
    });
    if (missingEvidence.length > 0 || missingVerification.length > 0) {
      throw new z.ZodError([
        ...missingEvidence.map((requirement) => ({
          code: 'custom' as const,
          path: ['evidence', requirement.id],
          message: `Missing verified completion evidence: ${requirement.description}`,
        })),
        ...missingVerification.map((gate) => ({
          code: 'custom' as const,
          path: ['verification', gate.id],
          message: `Missing passed verification evidence: ${gate.description}`,
        })),
      ]);
    }
  }
  return result;
}
