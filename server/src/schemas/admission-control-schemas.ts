import { z } from 'zod';
import {
  ADMISSION_DECISION_OUTCOMES,
  ADMISSION_DECISION_SCHEMA_VERSION,
  ADMISSION_CONTROL_PROVIDER,
  ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION,
  ADMISSION_QUEUE_SCHEDULER_POLICY_VERSION,
  ADMISSION_QUEUE_SELECTION_SCHEMA_VERSION,
  ADMISSION_QUEUE_STATES,
  ADMISSION_REQUEST_SCHEMA_VERSION,
  ADMISSION_RESERVATION_SCHEMA_VERSION,
  ADMISSION_RESERVATION_STATES,
  ADMISSION_SCOPES,
  CONVERSATION_LAUNCH_INTENTS,
  CONVERSATION_LAUNCH_MODES,
  EXECUTION_TREE_BUDGET_EVENT_SCHEMA_VERSION,
  EXECUTION_TREE_EDGE_KINDS,
  EXECUTION_TREE_IDENTITY_SCHEMA_VERSION,
  EXECUTION_TREE_CONTROL_SCHEMA_VERSION,
  EXECUTABLE_AGENT_PROVIDERS,
  PHASE_NAMES,
  RUN_FAILURE_CLASSES,
  RUN_RECOVERY_ACTIONS,
  RUN_RECOVERY_SCHEMA_VERSION,
  RUN_RECOVERY_STATES,
  TASK_COMMIT_POLICIES,
} from '@veritas-kanban/shared';
import {
  AgentBudgetLimitsSchema,
  AgentBudgetPolicySchema,
  AgentBudgetUsageSchema,
} from './agent-budget-schemas.js';
import { ProviderRuntimeCapabilityIdSchema } from './provider-runtime-manifest-schemas.js';

const identifier = z.string().trim().min(1).max(240);
const policyIdentifier = z.string().trim().min(1).max(256);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const admissionProvider = z.enum([...EXECUTABLE_AGENT_PROVIDERS, ADMISSION_CONTROL_PROVIDER]);
const executionTreeBudgetPolicyScope = z.enum([
  'workspace',
  'agent',
  'workflow',
  'run',
  'root-objective',
]);

export const ExecutionTreeIdentitySchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_TREE_IDENTITY_SCHEMA_VERSION),
    rootObjectiveId: identifier,
    nodeId: identifier,
    parentNodeId: identifier.optional(),
    edge: z.enum(EXECUTION_TREE_EDGE_KINDS),
    depth: z.number().int().min(0).max(10_000),
  })
  .strict()
  .superRefine((identity, ctx) => {
    if (identity.depth === 0 && (identity.parentNodeId || identity.edge !== 'root')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Execution-tree roots cannot have a parent edge.',
      });
    }
    if (identity.depth > 0 && (!identity.parentNodeId || identity.edge === 'root')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Execution-tree descendants require a parent node and non-root edge.',
      });
    }
  });

export const ExecutionTreeControlSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_TREE_CONTROL_SCHEMA_VERSION),
    rootObjectiveId: identifier,
    state: z.enum(['paused', 'cancelled']),
    trigger: z.enum(['operator', 'fan-out-breaker']),
    reason: z.string().trim().min(1).max(1_000),
    idempotencyKey: digest,
    recordedAt: z.string().datetime(),
  })
  .strict();

export const ExecutionTreeBudgetPolicySchema = z
  .object({
    id: policyIdentifier,
    scope: executionTreeBudgetPolicyScope,
    scopeId: identifier,
    name: z.string().trim().min(1).max(160),
    limits: AgentBudgetLimitsSchema,
    hardAction: z.enum(['pause', 'require-approval', 'downgrade', 'cancel']),
  })
  .strict();

export const ExecutionTreeBudgetUsageEventSchema = z
  .object({
    schemaVersion: z.literal(EXECUTION_TREE_BUDGET_EVENT_SCHEMA_VERSION),
    id: identifier,
    mode: z.enum(['delta', 'snapshot']),
    usage: AgentBudgetUsageSchema,
    source: z.string().trim().min(1).max(160),
    occurredAt: z.string().datetime(),
  })
  .strict();

export const ExecutionTreeBudgetStateSchema = z
  .object({
    requested: AgentBudgetUsageSchema,
    remaining: AgentBudgetUsageSchema,
    committed: AgentBudgetUsageSchema,
    releasedUnused: AgentBudgetUsageSchema,
    events: z.array(ExecutionTreeBudgetUsageEventSchema).max(10_000),
  })
  .strict();

export const AdmissionCapacityRequestSchema = z
  .object({
    runSlots: z.number().int().min(1).max(10_000),
    processSlots: z.number().int().min(0).max(10_000),
    estimatedMemoryMb: z.number().int().min(0).max(100_000_000),
  })
  .strict();

export const AdmissionCapacityLimitSchema = z
  .object({
    concurrentRuns: z.number().int().min(0).max(10_000).optional(),
    processSlots: z.number().int().min(0).max(10_000).optional(),
    estimatedMemoryMb: z.number().int().min(0).max(100_000_000).optional(),
  })
  .strict();

export const AdmissionLimitPolicySchema = z
  .object({
    id: policyIdentifier,
    scope: z.enum(ADMISSION_SCOPES),
    scopeId: identifier,
    limits: AdmissionCapacityLimitSchema,
  })
  .strict();

export const AdmissionRequestSchema = z
  .object({
    schemaVersion: z.literal(ADMISSION_REQUEST_SCHEMA_VERSION),
    idempotencyKey: identifier,
    source: z.enum([
      'direct',
      'conversation',
      'recovery',
      'fallback',
      'scheduled',
      'watcher',
      'workflow',
      'child-agent',
    ]),
    taskId: identifier,
    rootTaskId: identifier,
    workspaceId: identifier,
    provider: admissionProvider,
    hostId: identifier,
    workflowRunId: identifier.optional(),
    workflowStepId: identifier.optional(),
    rootReservationId: identifier.optional(),
    executionTree: ExecutionTreeIdentitySchema.optional(),
    budgetPolicies: z.array(ExecutionTreeBudgetPolicySchema).max(16).optional(),
    budgetRequest: AgentBudgetUsageSchema.optional(),
    requested: AdmissionCapacityRequestSchema,
    requestedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if ((request.budgetPolicies || request.budgetRequest) && !request.executionTree) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Execution budget requests require execution-tree identity.',
        path: ['executionTree'],
      });
    }
  });

export const AdmissionReservationLeaseSchema = z
  .object({
    ownerId: identifier,
    hostId: identifier,
    processId: z.number().int().nonnegative(),
    acquiredAt: z.string().datetime(),
    heartbeatAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const AdmissionReservationSchema = z
  .object({
    schemaVersion: z.literal(ADMISSION_RESERVATION_SCHEMA_VERSION),
    id: identifier,
    revision: z.number().int().positive(),
    state: z.enum(ADMISSION_RESERVATION_STATES),
    request: AdmissionRequestSchema,
    policies: z.array(AdmissionLimitPolicySchema).max(6),
    attemptId: identifier.optional(),
    lease: AdmissionReservationLeaseSchema,
    release: z
      .object({
        reason: z.enum([
          'start-failed',
          'completed',
          'failed',
          'cancelled',
          'interrupted',
          'reconciled',
        ]),
        idempotencyKey: identifier,
        releasedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    executionBudget: ExecutionTreeBudgetStateSchema.optional(),
    executionTreeControl: ExecutionTreeControlSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.state === 'released' && !record.release) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Released admission reservations require release evidence.',
        path: ['release'],
      });
    }
    if (record.state !== 'released' && record.release) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only released admission reservations may contain release evidence.',
        path: ['release'],
      });
    }
    if (record.request.executionTree && !record.executionBudget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Execution-tree reservations require durable budget state.',
        path: ['executionBudget'],
      });
    }
    if (
      record.executionTreeControl &&
      (record.request.executionTree?.edge !== 'root' ||
        record.request.executionTree.rootObjectiveId !==
          record.executionTreeControl.rootObjectiveId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Execution-tree control must be stored on its matching root reservation.',
        path: ['executionTreeControl'],
      });
    }
  });

const ConversationLaunchRequestSchema = z
  .object({
    mode: z.enum(CONVERSATION_LAUNCH_MODES),
    intent: z.enum(CONVERSATION_LAUNCH_INTENTS).optional(),
    sourceAttemptId: identifier.optional(),
    forkTurnId: z.string().trim().min(1).max(240).optional(),
    message: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict();

const RunRecoveryRecordSchema = z
  .object({
    schemaVersion: z.literal(RUN_RECOVERY_SCHEMA_VERSION),
    rootRunId: identifier,
    parentRunId: identifier,
    sequence: z.number().int().nonnegative().max(100),
    fallbackUsed: z.boolean(),
    state: z.enum(RUN_RECOVERY_STATES),
    action: z.enum(RUN_RECOVERY_ACTIONS),
    failure: z
      .object({
        classification: z.enum(RUN_FAILURE_CLASSES),
        summary: z.string().trim().min(1).max(1_000),
        retryable: z.boolean(),
        approvalRequired: z.boolean(),
        destructiveSideEffects: z.boolean(),
      })
      .strict(),
    reason: z.string().trim().min(1).max(4_000),
    backoffMs: z.number().int().nonnegative().max(2_147_483_647),
    scheduledAt: z.string().datetime().optional(),
    notBefore: z.string().datetime().optional(),
    launchedAt: z.string().datetime().optional(),
    launchedRunId: identifier.optional(),
    cancelledAt: z.string().datetime().optional(),
    cancelledBy: z.string().trim().min(1).max(240).optional(),
    selectedAgent: identifier,
    fallbackAgent: identifier.optional(),
    routingDecision: z.string().trim().min(1).max(4_000),
    sourceManifestDigest: digest.optional(),
    launchedManifestDigest: digest.optional(),
    requiredRuntimeCapabilities: z.array(ProviderRuntimeCapabilityIdSchema).max(128),
    cumulativeBudget: AgentBudgetUsageSchema,
    handoff: z
      .object({
        summary: z.string().trim().min(1).max(4_000),
        nextActions: z.array(z.string().trim().min(1).max(4_000)).max(32),
      })
      .strict()
      .optional(),
  })
  .strict();

const AdmissionAgentLaunchOptionsSchema = z
  .object({
    profileId: identifier.optional(),
    overrideReason: z.string().trim().min(1).max(2_000).optional(),
    sandboxPresetId: identifier.optional(),
    budget: AgentBudgetPolicySchema.optional(),
    requiredRuntimeCapabilities: z.array(ProviderRuntimeCapabilityIdSchema).max(128).optional(),
    commitPolicy: z.enum(TASK_COMMIT_POLICIES).optional(),
    phase: z.enum(PHASE_NAMES).optional(),
    parentAttemptId: identifier.optional(),
    conversation: ConversationLaunchRequestSchema.optional(),
    recovery: RunRecoveryRecordSchema.optional(),
  })
  .strict();

export const AdmissionQueueTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('direct'),
      agent: identifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal('agent-launch'),
      agent: identifier,
      source: z.enum(['direct', 'conversation', 'recovery', 'fallback', 'child-agent']),
      options: AdmissionAgentLaunchOptionsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('workflow-root'),
      workflowId: identifier,
      workflowVersion: z.number().int().positive(),
      workflowRunId: identifier,
      workflowRunRevision: z.number().int().positive(),
      associatedTaskId: identifier.optional(),
      initialContextDigest: digest,
      budgetPolicyDigest: digest,
      executionTreeDigest: digest,
    })
    .strict(),
  z
    .object({
      kind: z.literal('workflow-step'),
      workflowId: identifier,
      workflowVersion: z.number().int().positive(),
      workflowRunId: identifier,
      workflowRunRevision: z.number().int().positive(),
      workflowStepId: identifier,
      workflowStepSequence: z.number().int().positive(),
      recoverySequence: z.number().int().nonnegative(),
      parentNodeId: identifier,
      edge: z.enum(EXECUTION_TREE_EDGE_KINDS),
      provider: z.enum(EXECUTABLE_AGENT_PROVIDERS),
      hostId: identifier,
      providerRuntimeManifestDigest: digest,
      requiredRuntimeCapabilitiesDigest: digest,
      phaseEvidenceDigest: digest,
      phaseLaunchDigest: digest,
    })
    .strict(),
]);

const AdmissionQueueSelectionEvidenceSchema = z
  .object({
    schemaVersion: z.literal(ADMISSION_QUEUE_SELECTION_SCHEMA_VERSION),
    policyVersion: z.literal(ADMISSION_QUEUE_SCHEDULER_POLICY_VERSION),
    selectedAt: z.string().datetime(),
    selectedQueueEntryId: identifier,
    workspaceKey: digest,
    rawPriority: z.number().int().min(0).max(15),
    effectivePriority: z.number().int().min(0).max(15),
    agePromotion: z.number().int().min(0).max(15),
    ageMs: z.number().int().nonnegative(),
    workspaceTurn: z.enum(['normal', 'fairness-promoted']),
    capacityReadiness: z.literal('ready'),
    limitingScopes: z
      .array(
        z
          .object({
            scope: z.enum(ADMISSION_SCOPES),
            scopeKey: digest,
          })
          .strict()
      )
      .max(6),
    conditionalStartFactors: z
      .array(z.enum(['queue-eligibility', 'capacity-available', 'active-reservation-release']))
      .max(3),
    snapshotSize: z.number().int().nonnegative(),
    evaluatedCount: z.number().int().positive().max(256),
    skipped: z
      .array(
        z
          .object({
            queueEntryId: identifier,
            workspaceKey: digest,
            rawPriority: z.number().int().min(0).max(15),
            effectivePriority: z.number().int().min(0).max(15),
            agePromotion: z.number().int().min(0).max(15),
            capacityReadiness: z.enum(['blocked', 'not-evaluated']),
            limitingScopes: z
              .array(
                z
                  .object({
                    scope: z.enum(ADMISSION_SCOPES),
                    scopeKey: digest,
                  })
                  .strict()
              )
              .max(6),
            reason: z.enum(['capacity-blocked', 'lower-rank', 'workspace-burst']),
          })
          .strict()
      )
      .max(256),
  })
  .strict();

export const AdmissionQueueEntrySchema = z
  .object({
    schemaVersion: z.literal(ADMISSION_QUEUE_ENTRY_SCHEMA_VERSION),
    id: identifier,
    revision: z.number().int().positive(),
    state: z.enum(ADMISSION_QUEUE_STATES),
    enqueueSequence: z.number().int().positive(),
    priority: z.number().int().min(0).max(15).optional(),
    agent: identifier.optional(),
    target: AdmissionQueueTargetSchema.optional(),
    attemptId: identifier,
    request: AdmissionRequestSchema,
    policies: z.array(AdmissionLimitPolicySchema).max(6),
    limitingPolicies: z.array(AdmissionLimitPolicySchema).max(6),
    limitingBudgetPolicies: z.array(ExecutionTreeBudgetPolicySchema).max(16).optional(),
    retryAfterMs: z.number().int().min(250).max(60_000),
    retryCount: z.number().int().min(0).max(100),
    maxRetries: z.number().int().min(0).max(100),
    availableAt: z.string().datetime(),
    lease: AdmissionReservationLeaseSchema.optional(),
    reservationId: identifier.optional(),
    dispatchedAttemptId: identifier.optional(),
    terminal: z
      .object({
        code: z.string().trim().min(1).max(160),
        reason: z.string().trim().min(1).max(1_000),
        idempotencyKey: digest.optional(),
        recordedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    selectionEvidence: AdmissionQueueSelectionEvidenceSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const directAgent = entry.target?.kind === 'direct' ? entry.target.agent : entry.agent;
    if (!entry.target && !entry.agent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Admission queue entries require a launch target.',
        path: ['target'],
      });
    }
    if (entry.target?.kind === 'direct' && entry.agent && entry.agent !== directAgent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Direct queue target and legacy agent identity must match.',
        path: ['agent'],
      });
    }
    if (entry.target && !['direct'].includes(entry.target.kind) && entry.agent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Versioned queue targets cannot contain a legacy direct agent identity.',
        path: ['agent'],
      });
    }
    if (
      entry.target?.kind === 'agent-launch' &&
      (entry.request.source !== entry.target.source ||
        entry.request.provider === ADMISSION_CONTROL_PROVIDER ||
        entry.request.workflowRunId !== undefined ||
        entry.request.workflowStepId !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Agent launch queue target must match its admission request.',
        path: ['target'],
      });
    }
    if (
      entry.target?.kind === 'workflow-root' &&
      (entry.request.workflowRunId !== entry.target.workflowRunId ||
        entry.request.workflowStepId !== undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Workflow root queue target must match its admission request.',
        path: ['target'],
      });
    }
    if (
      entry.target?.kind === 'workflow-step' &&
      (entry.request.workflowRunId !== entry.target.workflowRunId ||
        entry.request.workflowStepId !== entry.target.workflowStepId ||
        entry.request.provider !== entry.target.provider ||
        entry.request.hostId !== entry.target.hostId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Workflow step queue target must match its admission request.',
        path: ['target'],
      });
    }
    if (entry.state === 'leased' && (!entry.lease || !entry.reservationId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Leased queue entries require lease and reservation evidence.',
        path: ['lease'],
      });
    }
    if (entry.selectionEvidence && entry.selectionEvidence.selectedQueueEntryId !== entry.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Admission selection evidence must identify its queue entry.',
        path: ['selectionEvidence', 'selectedQueueEntryId'],
      });
    }
    if (entry.state === 'dispatched' && (!entry.reservationId || !entry.dispatchedAttemptId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Dispatched queue entries require reservation and attempt evidence.',
        path: ['dispatchedAttemptId'],
      });
    }
    if (entry.state === 'terminal' && !entry.terminal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terminal queue entries require terminal evidence.',
        path: ['terminal'],
      });
    }
    if (entry.state !== 'terminal' && entry.terminal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only terminal queue entries may contain terminal evidence.',
        path: ['terminal'],
      });
    }
  });

export const AdmissionDecisionSchema = z
  .object({
    schemaVersion: z.literal(ADMISSION_DECISION_SCHEMA_VERSION),
    outcome: z.enum(ADMISSION_DECISION_OUTCOMES),
    request: AdmissionRequestSchema,
    reservation: AdmissionReservationSchema.optional(),
    queueEntry: AdmissionQueueEntrySchema.optional(),
    executionTreeControl: ExecutionTreeControlSchema.optional(),
    limitingPolicies: z.array(AdmissionLimitPolicySchema).max(6),
    limitingBudgetPolicies: z.array(ExecutionTreeBudgetPolicySchema).max(16).optional(),
    retryAfterMs: z.number().int().min(250).max(60_000).optional(),
    reason: z.string().min(1).max(1_000),
    decidedAt: z.string().datetime(),
  })
  .strict();

export const AdmissionReservationListQuerySchema = z
  .object({
    workspaceId: identifier.optional(),
    taskId: identifier.optional(),
    rootTaskId: identifier.optional(),
    provider: admissionProvider.optional(),
    hostId: identifier.optional(),
    workflowRunId: identifier.optional(),
    workflowStepId: identifier.optional(),
    rootReservationId: identifier.optional(),
    rootObjectiveId: identifier.optional(),
    nodeId: identifier.optional(),
    parentNodeId: identifier.optional(),
    states: z.array(z.enum(ADMISSION_RESERVATION_STATES)).max(3).optional(),
    limit: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();
