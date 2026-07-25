import { z } from 'zod';
import {
  WORKSPACE_EXECUTION_TRUST_DECISION_SCHEMA_VERSION,
  WORKSPACE_EXECUTION_TRUST_INVENTORY_SCHEMA_VERSION,
  WORKSPACE_EXECUTION_TRUST_POLICY_VERSION,
  WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION,
} from '@veritas-kanban/shared';

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const safeTextSchema = z.string().trim().min(1).max(4_096);
const identifierSchema = z.string().trim().min(1).max(240);

export const workspaceExecutionTrustPostureSchema = z.enum([
  'declarative-only',
  'model-influencing',
  'executable',
]);

export const workspaceExecutionTrustComponentKindSchema = z.enum([
  'agent-instruction',
  'provider-instruction',
  'provider-configuration',
  'tool-server-configuration',
  'runtime-hook',
  'language-server-configuration',
  'workflow-configuration',
  'extension-configuration',
  'agent-definition',
  'skill-definition',
  'project-trust-policy',
  'unknown-executable',
]);

export const workspaceExecutionTrustIdentitySchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION),
    digest: digestSchema,
    canonicalWorkspacePathDigest: digestSchema,
    canonicalRepositoryRootDigest: digestSchema,
    gitCommonDirectoryDigest: digestSchema,
    remoteIdentityDigest: digestSchema,
  })
  .strict();

export const workspaceExecutionTrustInventoryEntrySchema = z
  .object({
    id: identifierSchema,
    relativePath: z.string().min(1).max(4_096),
    canonicalPathDigest: digestSchema,
    scope: z.enum(['workspace-root', 'workspace-descendant', 'git-common-directory']),
    kind: workspaceExecutionTrustComponentKindSchema,
    posture: workspaceExecutionTrustPostureSchema,
    sourceFingerprint: digestSchema,
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(2 * 1024 * 1024),
    symbolicLink: z.boolean(),
    requestedCapabilities: z.array(identifierSchema).max(64),
  })
  .strict();

export const workspaceExecutionTrustProjectPolicySchema = z
  .object({
    maximumTrust: z.enum(['trusted', 'restricted', 'denied']),
    sourceFingerprint: digestSchema.optional(),
    valid: z.boolean(),
    diagnostic: safeTextSchema.optional(),
  })
  .strict();

export const workspaceExecutionTrustInventorySchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_EXECUTION_TRUST_INVENTORY_SCHEMA_VERSION),
    digest: digestSchema,
    scannerRevision: z.number().int().positive().max(10_000),
    scannedAt: z.string().datetime({ offset: true }),
    identity: workspaceExecutionTrustIdentitySchema,
    entries: z.array(workspaceExecutionTrustInventoryEntrySchema).max(2_000),
    projectPolicy: workspaceExecutionTrustProjectPolicySchema,
  })
  .strict();

export const workspaceExecutionTrustDecisionSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_EXECUTION_TRUST_DECISION_SCHEMA_VERSION),
    id: identifierSchema,
    identityDigest: digestSchema,
    inventoryDigest: digestSchema,
    mode: z.enum(['trusted', 'restricted', 'denied', 'revoked']),
    actor: safeTextSchema.max(240),
    reason: safeTextSchema,
    policyVersion: z.literal(WORKSPACE_EXECUTION_TRUST_POLICY_VERSION),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    supersedesDecisionId: identifierSchema.optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.expiresAt && Date.parse(decision.expiresAt) <= Date.parse(decision.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'expiresAt must be later than createdAt',
      });
    }
    if (decision.mode === 'revoked' && !decision.supersedesDecisionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['supersedesDecisionId'],
        message: 'revoked decisions must identify the superseded decision',
      });
    }
  });

export const workspaceExecutionTrustRestrictionCheckSchema = z
  .object({
    id: identifierSchema,
    satisfied: z.boolean(),
    detail: safeTextSchema,
  })
  .strict();

export const workspaceExecutionTrustEvaluationSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION),
    status: z.enum(['trusted', 'restricted', 'untrusted', 'not-required']),
    source: safeTextSchema,
    requiresExplicitDecision: z.boolean(),
    identity: workspaceExecutionTrustIdentitySchema,
    inventory: workspaceExecutionTrustInventorySchema,
    decision: workspaceExecutionTrustDecisionSchema.optional(),
    restrictionChecks: z.array(workspaceExecutionTrustRestrictionCheckSchema).max(32),
  })
  .strict();

export const workspaceExecutionTrustDecisionInputSchema = z
  .object({
    inventoryDigest: digestSchema,
    mode: z.enum(['trusted', 'restricted', 'denied']),
    reason: safeTextSchema.max(1_000),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const workspaceExecutionTrustRevokeInputSchema = z
  .object({
    inventoryDigest: digestSchema,
    reason: safeTextSchema.max(1_000),
  })
  .strict();

export const workspaceExecutionTrustProjectFileSchema = z
  .object({
    schemaVersion: z.literal('workspace-trust-policy/v1'),
    maximumTrust: z.enum(['trusted', 'restricted', 'denied']),
  })
  .strict();
