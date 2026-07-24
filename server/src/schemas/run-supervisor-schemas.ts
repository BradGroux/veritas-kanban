import { z } from 'zod';
import {
  EXECUTABLE_AGENT_PROVIDERS,
  RUN_SUPERVISOR_RECOVERY_OPERATIONS,
  RUN_SUPERVISOR_RECOVERY_REASON_CODES,
  RUN_SUPERVISOR_SCHEMA_VERSION,
  RUN_SUPERVISOR_STATES,
  type AgentBudgetState,
  type RunSupervisorRecord,
} from '@veritas-kanban/shared';
import { CompletionResultSchema } from './task-envelope-schemas.js';

const IdentifierSchema = z.string().trim().min(1).max(240);
const IsoTimestampSchema = z.string().datetime();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const BudgetMetricSchema = z.enum([
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'costUsd',
  'toolCalls',
  'runtimeSeconds',
  'idleRuntimeSeconds',
  'retries',
  'fanOut',
]);
const BudgetActionSchema = z.enum(['warn', 'pause', 'require-approval', 'downgrade', 'cancel']);
const BudgetLimitsSchema = z
  .object({
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    totalTokens: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
    toolCalls: z.number().nonnegative().optional(),
    runtimeSeconds: z.number().nonnegative().optional(),
    idleRuntimeSeconds: z.number().nonnegative().optional(),
    retries: z.number().nonnegative().optional(),
    fanOut: z.number().nonnegative().optional(),
  })
  .strict();
const BudgetUsageSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
    toolCalls: z.number().nonnegative(),
    runtimeSeconds: z.number().nonnegative(),
    idleRuntimeSeconds: z.number().nonnegative(),
    retries: z.number().nonnegative(),
    fanOut: z.number().nonnegative(),
  })
  .strict();
const AgentBudgetStateSchema: z.ZodType<AgentBudgetState> = z
  .object({
    enabled: z.boolean(),
    policy: z
      .object({
        enabled: z.boolean().optional(),
        name: z.string().max(240).optional(),
        scope: z.enum(['workspace', 'agent', 'workflow', 'workflow-agent', 'run']).optional(),
        limits: BudgetLimitsSchema.optional(),
        softThresholdPercent: z.number().min(0).max(100).optional(),
        hardAction: z.enum(['pause', 'require-approval', 'downgrade', 'cancel']).optional(),
        downgradeModel: z.string().max(240).optional(),
        notes: z.string().max(4_000).optional(),
      })
      .strict()
      .optional(),
    usage: BudgetUsageSchema,
    decision: z.enum(['allow', 'warn', 'pause', 'require-approval', 'downgrade', 'cancel']),
    thresholdEvents: z
      .array(
        z
          .object({
            metric: BudgetMetricSchema,
            limit: z.number().nonnegative(),
            used: z.number().nonnegative(),
            percent: z.number().nonnegative(),
            threshold: z.enum(['soft', 'hard']),
            action: BudgetActionSchema,
            message: z.string().max(2_000),
          })
          .strict()
      )
      .max(100),
    traceIds: z.array(IdentifierSchema).max(100),
    overrideReason: z.string().max(4_000).optional(),
    modelOverride: z.string().max(240).optional(),
  })
  .strict();

const LeaseSchema = z
  .object({
    ownerId: IdentifierSchema,
    hostId: Sha256Schema,
    processId: z.number().int().positive(),
    acquiredAt: IsoTimestampSchema,
    heartbeatAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
  })
  .strict();

const ControlSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('local-process'),
      hostId: Sha256Schema,
      pid: z.number().int().positive(),
      processGroupId: z.number().int().positive().optional(),
      startToken: z.string().trim().min(1).max(512).optional(),
      sessionId: IdentifierSchema.optional(),
      threadId: IdentifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('remote-session'),
      hostId: Sha256Schema,
      sessionId: IdentifierSchema,
      threadId: IdentifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('in-process'),
      hostId: Sha256Schema,
    })
    .strict(),
]);

const BindingsSchema = z
  .object({
    provider: z.enum(EXECUTABLE_AGENT_PROVIDERS),
    adapter: IdentifierSchema,
    providerVersion: z.string().trim().min(1).max(240).optional(),
    providerRuntimeManifestDigest: DigestSchema,
    taskEnvelopeDigest: DigestSchema,
    runLaunchManifestDigest: DigestSchema,
    worktreePath: z.string().trim().min(1).max(4_096),
    worktreeManifestId: IdentifierSchema.optional(),
    worktreeLeaseId: IdentifierSchema.optional(),
    worktreeFingerprint: Sha256Schema,
  })
  .strict();

export const RunSupervisorRecordSchema: z.ZodType<RunSupervisorRecord> = z
  .object({
    schemaVersion: z.literal(RUN_SUPERVISOR_SCHEMA_VERSION),
    id: z.string().regex(/^runsupervisor_[A-Za-z0-9_-]{12,32}$/),
    workspaceId: IdentifierSchema,
    taskId: IdentifierSchema,
    attemptId: IdentifierSchema,
    state: z.enum(RUN_SUPERVISOR_STATES),
    revision: z.number().int().positive(),
    bindings: BindingsSchema,
    control: ControlSchema,
    recoveryOperations: z.array(z.enum(RUN_SUPERVISOR_RECOVERY_OPERATIONS)).max(4),
    budget: AgentBudgetStateSchema.optional(),
    lastEventSequence: z.number().int().nonnegative(),
    lease: LeaseSchema,
    recovery: z
      .object({
        code: z.enum(RUN_SUPERVISOR_RECOVERY_REASON_CODES),
        detail: z.string().trim().min(1).max(4_000),
        nextAction: z.string().trim().min(1).max(4_000),
        recordedAt: IsoTimestampSchema,
      })
      .strict()
      .optional(),
    terminal: z
      .object({
        state: z.enum(['completed', 'failed', 'interrupted', 'cancelled']),
        summary: z.string().trim().min(1).max(20_000),
        idempotencyKey: z.string().trim().min(1).max(240).optional(),
        completionResult: CompletionResultSchema.optional(),
        recordedAt: IsoTimestampSchema,
      })
      .strict()
      .optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const terminal = ['completed', 'failed', 'interrupted', 'cancelled'].includes(record.state);
    if (
      terminal !== Boolean(record.terminal) ||
      (record.terminal && record.terminal.state !== record.state)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminal'],
        message: 'Terminal supervisor state and terminal record must match.',
      });
    }
    if (
      record.terminal?.completionResult &&
      record.terminal.idempotencyKey !== record.terminal.completionResult.idempotencyKey
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminal', 'completionResult', 'idempotencyKey'],
        message: 'Supervisor terminal ownership must match the completion result.',
      });
    }
    if (record.state === 'recovery-required' && !record.recovery) {
      context.addIssue({
        code: 'custom',
        path: ['recovery'],
        message: 'Recovery-required state must include an actionable recovery record.',
      });
    }
    if (Date.parse(record.lease.expiresAt) <= Date.parse(record.lease.heartbeatAt)) {
      context.addIssue({
        code: 'custom',
        path: ['lease', 'expiresAt'],
        message: 'Supervisor lease expiry must follow its heartbeat.',
      });
    }
  });
