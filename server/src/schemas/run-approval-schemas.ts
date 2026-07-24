import { z } from 'zod';
import {
  EXECUTABLE_AGENT_PROVIDERS,
  RUN_APPROVAL_ACTION_CLASSES,
  RUN_APPROVAL_SCHEMA_VERSION,
  type RunApprovalActor,
  type RunApprovalDecisionInput,
  type RunApprovalRequest,
  type RunApprovalResolution,
  type RunEventJsonValue,
} from '@veritas-kanban/shared';

const IdentifierSchema = z.string().trim().min(1).max(240);
const IsoTimestampSchema = z.string().datetime();

const JsonValueSchema: z.ZodType<RunEventJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(16_384),
    z.array(JsonValueSchema).max(200),
    z.record(z.string().max(160), JsonValueSchema),
  ])
);

export const RunApprovalActorSchema: z.ZodType<RunApprovalActor> = z
  .object({
    id: IdentifierSchema,
    label: z.string().trim().min(1).max(240).optional(),
    type: z.enum(['user', 'agent', 'service', 'device', 'localhost-bypass']).optional(),
    authMethod: z.string().trim().min(1).max(120).optional(),
    authenticatedAt: IsoTimestampSchema.optional(),
    clientMode: z.string().trim().min(1).max(120).optional(),
    workspaceId: IdentifierSchema,
  })
  .strict();

export const RunApprovalResolutionSchema: z.ZodType<RunApprovalResolution> = z
  .object({
    decision: z.enum(['approved', 'rejected', 'expired', 'cancelled']),
    actor: RunApprovalActorSchema,
    decidedAt: IsoTimestampSchema,
    note: z.string().trim().min(1).max(4_000).optional(),
    responseData: z.record(z.string().max(160), JsonValueSchema).optional(),
  })
  .strict();

export const RunApprovalRequestSchema: z.ZodType<RunApprovalRequest> = z
  .object({
    schemaVersion: z.literal(RUN_APPROVAL_SCHEMA_VERSION),
    id: z.string().regex(/^runapproval_[A-Za-z0-9_-]{12,32}$/),
    workspaceId: IdentifierSchema,
    taskId: IdentifierSchema,
    attemptId: IdentifierSchema,
    provider: z.enum(EXECUTABLE_AGENT_PROVIDERS),
    agentId: IdentifierSchema,
    requestKind: z.enum(['approval', 'elicitation']),
    actionClass: z.enum(RUN_APPROVAL_ACTION_CLASSES),
    action: z.string().trim().min(1).max(2_000),
    actionHash: z.string().regex(/^[a-f0-9]{64}$/),
    details: z.string().trim().min(1).max(8_000).optional(),
    resourceScope: z.array(z.string().trim().min(1).max(2_048)).max(100),
    workingDirectory: z.string().trim().min(1).max(4_096).optional(),
    riskClass: z.enum(['low', 'medium', 'high', 'critical']),
    policyReason: z.string().trim().min(1).max(2_000).optional(),
    evidenceRevision: IdentifierSchema,
    providerRequestId: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
    turnId: IdentifierSchema.optional(),
    itemId: IdentifierSchema.optional(),
    mobileSafe: z.boolean(),
    status: z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']),
    revision: z.number().int().positive(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
    resolution: RunApprovalResolutionSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.status === 'pending' && request.resolution) {
      context.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: 'Pending approvals cannot have a resolution.',
      });
    }
    if (request.status !== 'pending' && request.resolution?.decision !== request.status) {
      context.addIssue({
        code: 'custom',
        path: ['resolution', 'decision'],
        message: 'Approval status and resolution decision must match.',
      });
    }
    if (Date.parse(request.expiresAt) <= Date.parse(request.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Approval expiry must be after creation.',
      });
    }
  });

export const RunApprovalDecisionInputSchema: z.ZodType<RunApprovalDecisionInput> = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    expectedRevision: z.number().int().positive(),
    expectedActionHash: z.string().regex(/^[a-f0-9]{64}$/),
    note: z.string().trim().min(1).max(4_000).optional(),
    responseData: z.record(z.string().max(160), JsonValueSchema).optional(),
  })
  .strict();
