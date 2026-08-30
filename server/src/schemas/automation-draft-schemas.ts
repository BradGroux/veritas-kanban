import { z } from 'zod';
import { AUTOMATION_DRAFT_SCHEMA_VERSION } from '@veritas-kanban/shared';

const identifier = z.string().trim().min(1).max(200);
const boundedStringList = z.array(z.string().trim().min(1).max(1000)).max(100);

const budget = z
  .object({
    maxRuns: z.number().int().min(1).max(100_000),
    maxCostUsd: z.number().positive().max(1_000_000).optional(),
    maxTokens: z.number().int().positive().max(10_000_000_000).optional(),
    maxDurationMinutes: z.number().positive().max(525_600).optional(),
  })
  .strict();

const retry = z
  .object({
    maxAttempts: z.number().int().min(0).max(20),
    backoffMinutes: z.number().int().min(1).max(1440),
  })
  .strict();

const standingScope = z
  .object({
    reads: boundedStringList,
    writes: boundedStringList,
    sends: boundedStringList,
    externalTargets: boundedStringList,
    artifactDestinations: boundedStringList,
    integrationIds: z.array(identifier).max(50),
    toolIds: z.array(identifier).max(100),
    credentialDefinitionIds: z.array(identifier).max(50),
    approvalRequiredActions: boundedStringList,
  })
  .strict();

const hints = z
  .object({
    workspaceId: identifier.optional(),
    sourceTaskId: identifier.optional(),
    proposingRunId: identifier.optional(),
    workflowId: identifier.optional(),
    taskTemplateId: identifier.optional(),
    provider: identifier.optional(),
    scheduleExpression: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    startAt: z.iso.datetime({ offset: true }).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    overlapPolicy: z.enum(['skip', 'queue-one', 'forbid']).optional(),
    retry: retry.optional(),
    outputDestination: z.string().trim().min(1).max(1000).optional(),
    expectedDeliverables: boundedStringList.optional(),
    standingScope: standingScope.optional(),
    perRunBudget: budget.optional(),
    aggregateBudget: budget.optional(),
    stopConditions: boundedStringList.optional(),
  })
  .strict();

const fieldStatus = z.enum([
  'resolved',
  'missing',
  'ambiguous',
  'unavailable',
  'unsupported',
  'conflict',
]);

function draftField<T extends z.ZodType>(value: T) {
  return z
    .object({
      value: value.optional(),
      origin: z.enum(['explicit', 'inferred', 'system', 'unresolved']),
      status: fieldStatus,
      confidence: z.enum(['high', 'medium', 'low', 'none']),
      explanation: z.string().min(1).max(2000),
    })
    .strict();
}

const validationIssue = z
  .object({
    severity: z.enum(['blocker', 'warning', 'info']),
    code: z.string().min(1).max(100),
    path: z.string().min(1).max(500),
    message: z.string().min(1).max(2000),
    remediation: z.string().min(1).max(2000),
  })
  .strict();

export const AutomationDraftSchema = z
  .object({
    schemaVersion: z.literal(AUTOMATION_DRAFT_SCHEMA_VERSION),
    id: z.string().regex(/^automation_[a-f0-9]{24}$/),
    revision: z.number().int().min(1).max(50),
    status: z.literal('inactive'),
    parentDraftId: z
      .string()
      .regex(/^automation_[a-f0-9]{24}$/)
      .optional(),
    objective: draftField(z.string().min(1).max(10_000)),
    source: z
      .object({
        workspaceId: draftField(identifier),
        taskId: draftField(identifier),
        proposingRunId: draftField(identifier),
      })
      .strict(),
    execution: z
      .object({
        workflowId: draftField(identifier),
        taskTemplateId: draftField(identifier),
        provider: draftField(identifier),
      })
      .strict(),
    schedule: z
      .object({
        expression: draftField(z.string().min(1).max(200)),
        timezone: draftField(z.string().min(1).max(100)),
        startAt: draftField(z.iso.datetime({ offset: true })),
        expiresAt: draftField(z.iso.datetime({ offset: true })),
        overlapPolicy: draftField(z.enum(['skip', 'queue-one', 'forbid'])),
        retry: draftField(retry),
        nextRunExamples: z.array(z.iso.datetime({ offset: true })).max(10),
      })
      .strict(),
    output: z
      .object({
        destination: draftField(z.string().min(1).max(1000)),
        expectedDeliverables: draftField(boundedStringList),
      })
      .strict(),
    standingScope: draftField(standingScope),
    perRunBudget: draftField(budget),
    aggregateBudget: draftField(budget),
    stopConditions: draftField(boundedStringList),
    validation: z
      .object({
        valid: z.boolean(),
        issues: z.array(validationIssue).max(500),
      })
      .strict(),
    redaction: z
      .object({
        safeToExport: z.literal(true),
        removedFields: z.array(z.string().min(1).max(500)).max(100),
      })
      .strict(),
    requestedBy: identifier,
    requestId: identifier,
    inputDigest: z.string().regex(/^scrypt:[a-f0-9]{64}$/),
    createdAt: z.iso.datetime({ offset: true }),
    digest: z.string().regex(/^scrypt:[a-f0-9]{64}$/),
  })
  .strict();

export const AutomationDraftCompileBodySchema = z
  .object({
    intent: z.string().trim().min(1).max(10_000),
    requestId: identifier,
    hints: hints.optional(),
  })
  .strict();

export const AutomationDraftCloneBodySchema = z
  .object({
    requestId: identifier,
  })
  .strict();

export const AutomationDraftRevisionQuerySchema = z
  .object({
    revision: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export const AutomationDraftDeleteQuerySchema = z
  .object({ confirm: z.string().regex(/^automation_[a-f0-9]{24}$/) })
  .strict();
