import { z } from 'zod';
import {
  CREDENTIAL_BROKER_AUDIT_SCHEMA_VERSION,
  CREDENTIAL_DEFINITION_SCHEMA_VERSION,
  CREDENTIAL_LEASE_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
import type { CredentialDefinition } from '@veritas-kanban/shared';
import { verifyCredentialDefinitionDigest } from '../utils/credential-broker-digest.js';
import { containsUnredactedProviderRuntimeSecret } from '../utils/provider-runtime-manifest-sanitize.js';

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const uniqueStringList = <T extends z.ZodType<string>>(item: T, maximum: number) =>
  z
    .array(item)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Values must be unique',
    });
const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i,
    'Host must be an exact DNS name or bracketed IPv6 address'
  );
const methodSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const pathPrefixSchema = z.string().trim().min(1).max(1000).startsWith('/');

export const credentialSecretSourceReferenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('environment'),
      reference: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .regex(/^[A-Z_][A-Z0-9_]*$/, 'Environment reference must be a safe key name'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('external'),
      provider: identifierSchema,
      reference: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .regex(
          /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
          'External secret references must be opaque names, not credential values'
        ),
    })
    .strict(),
]);

export const credentialScopeSchema = z
  .object({
    dispatchTypes: uniqueStringList(z.enum(['http', 'tool', 'mcp']), 3).min(1),
    hosts: uniqueStringList(hostnameSchema, 100).default([]),
    tools: uniqueStringList(identifierSchema, 100).default([]),
    destinations: uniqueStringList(z.string().trim().min(1).max(1000), 100).default([]),
    methods: uniqueStringList(methodSchema, 50).default([]),
    actions: uniqueStringList(identifierSchema, 100).default([]),
    pathPrefixes: uniqueStringList(pathPrefixSchema, 100).default([]),
  })
  .strict();

const credentialDefinitionBaseSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-z0-9-_]*$/, 'Credential definition id must be lowercase'),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(800).optional(),
    enabled: z.boolean(),
    source: credentialSecretSourceReferenceSchema,
    scope: credentialScopeSchema,
    lease: z
      .object({
        ttlSeconds: z.number().int().min(1).max(86_400),
        maxUses: z.number().int().min(1).max(1000),
        renewable: z.boolean(),
      })
      .strict(),
    approval: z.enum(['not-required', 'required']),
  })
  .strict();

function rejectCredentialMaterial(
  definition: z.infer<typeof credentialDefinitionBaseSchema>,
  context: z.RefinementCtx
): void {
  const publicText = [
    definition.id,
    definition.name,
    definition.description,
    definition.source.reference,
    definition.source.kind === 'external' ? definition.source.provider : undefined,
    ...definition.scope.hosts,
    ...definition.scope.tools,
    ...definition.scope.destinations,
    ...definition.scope.methods,
    ...definition.scope.actions,
    ...definition.scope.pathPrefixes,
  ].filter((value): value is string => Boolean(value));
  if (publicText.some(containsUnredactedProviderRuntimeSecret)) {
    context.addIssue({
      code: 'custom',
      message: 'Credential definition metadata must contain references, never credential values',
    });
  }
}

export const credentialDefinitionInputSchema =
  credentialDefinitionBaseSchema.superRefine(rejectCredentialMaterial);

export const credentialDefinitionSchema = credentialDefinitionBaseSchema
  .extend({
    schemaVersion: z.literal(CREDENTIAL_DEFINITION_SCHEMA_VERSION),
    digest: digestSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((definition, context) => {
    rejectCredentialMaterial(definition, context);
    if (!verifyCredentialDefinitionDigest(definition as CredentialDefinition)) {
      context.addIssue({
        code: 'custom',
        path: ['digest'],
        message: 'Credential definition digest does not match its canonical payload',
      });
    }
  });

export const credentialActionSchema = z
  .object({
    dispatchType: z.enum(['http', 'tool', 'mcp']),
    host: hostnameSchema.optional(),
    tool: identifierSchema.optional(),
    destination: z.string().trim().min(1).max(1000).optional(),
    method: methodSchema.optional(),
    action: identifierSchema.optional(),
    path: z.string().trim().min(1).max(2000).startsWith('/').optional(),
    argumentsDigest: digestSchema,
  })
  .strict()
  .superRefine((action, context) => {
    if (action.dispatchType === 'http') {
      for (const field of ['host', 'destination', 'method', 'path'] as const) {
        if (!action[field]) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required for HTTP credential dispatch`,
          });
        }
      }
    } else if (!action.tool || !action.action) {
      context.addIssue({
        code: 'custom',
        path: !action.tool ? ['tool'] : ['action'],
        message: 'Tool and action are required for tool or MCP credential dispatch',
      });
    }
  });

export const credentialRunBindingSchema = z
  .object({
    taskId: z.string().trim().min(1).max(200),
    attemptId: z.string().trim().min(1).max(200),
    status: z.enum(['running', 'terminal']),
    runLaunchManifestDigest: digestSchema,
    credentialReferences: z.array(z.string().trim().min(1).max(300)).max(128),
  })
  .strict();

export const credentialLeaseSchema = z
  .object({
    schemaVersion: z.literal(CREDENTIAL_LEASE_SCHEMA_VERSION),
    id: identifierSchema,
    handleHash: z.string().regex(/^[a-f0-9]{64}$/),
    definitionId: z.string().trim().min(1).max(80),
    definitionDigest: digestSchema,
    taskId: z.string().trim().min(1).max(200),
    attemptId: z.string().trim().min(1).max(200),
    runLaunchManifestDigest: digestSchema,
    scopeDigest: digestSchema,
    actionFingerprint: digestSchema,
    approvalId: identifierSchema.optional(),
    state: z.enum(['active', 'exhausted', 'expired', 'revoked', 'blocked']),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    uses: z.number().int().min(0),
    maxUses: z.number().int().min(1),
    operations: z
      .array(
        z
          .object({
            id: identifierSchema,
            type: z.enum(['use', 'refresh']),
            occurredAt: z.string().datetime(),
          })
          .strict()
      )
      .max(2048),
    revokedAt: z.string().datetime().optional(),
    terminalReason: z
      .enum([
        'run-completed',
        'run-failed',
        'run-interrupted',
        'run-cancelled',
        'run-missing',
        'run-binding-changed',
        'definition-disabled',
        'definition-changed',
        'source-unavailable',
        'expired',
        'operator-revoked',
      ])
      .optional(),
  })
  .strict()
  .superRefine((lease, context) => {
    if (lease.uses > lease.maxUses) {
      context.addIssue({
        code: 'custom',
        path: ['uses'],
        message: 'Credential lease uses cannot exceed maximum uses',
      });
    }
    const operationIds = lease.operations.map((operation) => operation.id);
    if (new Set(operationIds).size !== operationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['operations'],
        message: 'Credential lease operation fingerprints must be unique',
      });
    }
    const recordedUses = lease.operations.filter((operation) => operation.type === 'use').length;
    if (recordedUses !== lease.uses) {
      context.addIssue({
        code: 'custom',
        path: ['operations'],
        message: 'Credential lease use count must match its operation history',
      });
    }
    if (lease.state === 'active' && lease.uses >= lease.maxUses) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'An active credential lease must have remaining uses',
      });
    }
    if (lease.state === 'exhausted' && lease.uses !== lease.maxUses) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'An exhausted credential lease must have consumed its maximum uses',
      });
    }
    const terminal = ['expired', 'revoked', 'blocked'].includes(lease.state);
    if (terminal && (!lease.revokedAt || !lease.terminalReason)) {
      context.addIssue({
        code: 'custom',
        path: ['terminalReason'],
        message: 'A terminal credential lease requires revocation metadata',
      });
    }
    if (!terminal && (lease.revokedAt || lease.terminalReason)) {
      context.addIssue({
        code: 'custom',
        path: ['terminalReason'],
        message: 'A usable or exhausted credential lease cannot carry revocation metadata',
      });
    }
  });

export const credentialBrokerAuditEventSchema = z
  .object({
    schemaVersion: z.literal(CREDENTIAL_BROKER_AUDIT_SCHEMA_VERSION),
    id: identifierSchema,
    type: z.enum([
      'definition-created',
      'definition-updated',
      'definition-deleted',
      'issue',
      'use',
      'denial',
      'refresh',
      'revoke',
      'expire',
      'reconcile',
    ]),
    occurredAt: z.string().datetime(),
    decision: z.enum(['allowed', 'denied', 'recorded']),
    definitionId: z.string().trim().min(1).max(80).optional(),
    definitionDigest: digestSchema.optional(),
    leaseId: identifierSchema.optional(),
    taskId: z.string().trim().min(1).max(200).optional(),
    attemptId: z.string().trim().min(1).max(200).optional(),
    runLaunchManifestDigest: digestSchema.optional(),
    scopeDigest: digestSchema.optional(),
    actionFingerprint: digestSchema.optional(),
    operationId: identifierSchema.optional(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();

export const credentialDefinitionParamsSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
  })
  .strict();
