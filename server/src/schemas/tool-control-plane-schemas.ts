import { z } from 'zod';
import {
  RUN_TOOL_CATALOG_SCHEMA_VERSION,
  TOOL_DISCOVERY_SCHEMA_VERSION,
  TOOL_SERVER_DEFINITION_SCHEMA_VERSION,
  EXECUTABLE_AGENT_PROVIDERS,
  type RunToolCatalog,
  type ToolServerDefinition,
  type ToolServerDefinitionInput,
  type ToolServerDiscovery,
} from '@veritas-kanban/shared';

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const serverIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const toolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const qualifiedToolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/);
const toolSelectionSchema = z.union([toolNameSchema, qualifiedToolNameSchema]);
const toolSelectorSchema = z.union([z.literal('*'), toolSelectionSchema]);
const environmentKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Z_][A-Z0-9_]*$/);
const uniqueList = <T extends z.ZodType<string>>(schema: T, maximum: number) =>
  z
    .array(schema)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, 'Values must be unique');

const stdioTransportSchema = z
  .object({
    kind: z.literal('stdio'),
    command: z.string().trim().min(1).max(4_096),
    args: z.array(z.string().max(4_096)).max(100),
    environmentKeys: uniqueList(environmentKeySchema, 100),
    credentialReferences: uniqueList(serverIdSchema, 50),
  })
  .strict();

const httpHeaderSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z][A-Za-z0-9-]*$/),
    environmentKey: environmentKeySchema,
  })
  .strict();

const httpTransportSchema = z
  .object({
    kind: z.literal('http'),
    url: z
      .url()
      .max(2_048)
      .refine((value) => {
        const parsed = new URL(value);
        return (
          ['http:', 'https:'].includes(parsed.protocol) &&
          !parsed.username &&
          !parsed.password &&
          !parsed.search &&
          !parsed.hash
        );
      }, 'HTTP tool server URLs cannot contain credentials, query strings, or fragments'),
    headers: z.array(httpHeaderSchema).max(50),
    credentialReferences: uniqueList(serverIdSchema, 50),
  })
  .strict();

const definitionBaseSchema = z
  .object({
    id: serverIdSchema,
    version: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1_000).optional(),
    enabled: z.boolean(),
    transport: z.discriminatedUnion('kind', [stdioTransportSchema, httpTransportSchema]),
    requirement: z.enum(['required', 'optional']),
    startupTimeoutMs: z.number().int().min(100).max(120_000),
    toolTimeoutMs: z.number().int().min(100).max(300_000),
    allowedTools: uniqueList(toolSelectorSchema, 500),
    deniedTools: uniqueList(toolSelectorSchema, 500),
    approvalRequiredTools: uniqueList(toolSelectorSchema, 500),
    approvalMode: z.enum(['never', 'always']),
  })
  .strict()
  .superRefine((definition, context) => {
    const allowed = new Set(definition.allowedTools);
    const denied = new Set(definition.deniedTools);
    for (const tool of definition.approvalRequiredTools) {
      if (denied.has(tool)) {
        context.addIssue({
          code: 'custom',
          path: ['approvalRequiredTools'],
          message: `Tool ${tool} cannot be both denied and approval-required`,
        });
      }
    }
    if (allowed.has('*') && definition.allowedTools.length > 1) {
      context.addIssue({
        code: 'custom',
        path: ['allowedTools'],
        message: 'Wildcard allow cannot be combined with named tools',
      });
    }
  });

export const toolServerDefinitionInputSchema: z.ZodType<ToolServerDefinitionInput> =
  definitionBaseSchema;

export const toolServerDefinitionSchema: z.ZodType<ToolServerDefinition> = definitionBaseSchema
  .extend({
    schemaVersion: z.literal(TOOL_SERVER_DEFINITION_SCHEMA_VERSION),
    digest: digestSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const inputSchema = z.record(z.string(), z.unknown());
const discoveryToolSchema = z
  .object({
    name: toolNameSchema,
    description: z.string().max(4_000).optional(),
    inputSchema,
    inputSchemaDigest: digestSchema,
  })
  .strict();

export const toolServerDiscoverySchema: z.ZodType<ToolServerDiscovery> = z
  .object({
    schemaVersion: z.literal(TOOL_DISCOVERY_SCHEMA_VERSION),
    serverId: serverIdSchema,
    serverVersion: z.string().trim().min(1).max(120),
    definitionDigest: digestSchema,
    protocolVersion: z.string().trim().min(1).max(120),
    status: z.enum(['ready', 'failed']),
    tools: z.array(discoveryToolSchema).max(1_000),
    error: z.string().trim().min(1).max(4_000).optional(),
    discoveredAt: z.string().datetime(),
    digest: digestSchema,
  })
  .strict();

const catalogToolSchema = discoveryToolSchema
  .extend({
    qualifiedName: qualifiedToolNameSchema,
    decision: z.enum(['allow', 'deny', 'approval']),
  })
  .strict();

const catalogCredentialBindingSchema = z
  .object({
    credentialReference: serverIdSchema,
    credentialDefinitionDigest: digestSchema,
    scopeDigest: digestSchema,
    target: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('environment'),
          name: environmentKeySchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('http-header'),
          name: z
            .string()
            .trim()
            .min(1)
            .max(120)
            .regex(/^[A-Za-z][A-Za-z0-9-]*$/),
        })
        .strict(),
    ]),
  })
  .strict();

const catalogEntrySchema = z
  .object({
    serverId: serverIdSchema,
    serverVersion: z.string().trim().min(1).max(120),
    definitionDigest: digestSchema,
    discoveryDigest: digestSchema,
    transport: z.enum(['stdio', 'http']),
    requirement: z.enum(['required', 'optional']),
    status: z.enum(['ready', 'degraded']),
    credentialBindings: z.array(catalogCredentialBindingSchema).max(50).optional(),
    tools: z.array(catalogToolSchema).max(1_000),
    error: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export const runToolCatalogSchema: z.ZodType<RunToolCatalog> = z
  .object({
    schemaVersion: z.literal(RUN_TOOL_CATALOG_SCHEMA_VERSION),
    taskId: identifierSchema,
    attemptId: identifierSchema,
    provider: z.enum(EXECUTABLE_AGENT_PROVIDERS),
    providerRuntimeManifestDigest: digestSchema,
    taskEnvelopeDigest: digestSchema,
    entries: z.array(catalogEntrySchema).max(100),
    createdAt: z.string().datetime(),
    digest: digestSchema,
  })
  .strict();

export const toolServerParamsSchema = z.object({ id: serverIdSchema }).strict();

export const toolDiscoveryRequestSchema = z
  .object({
    force: z.boolean().optional(),
  })
  .strict();

export const toolInvocationRequestSchema = z
  .object({
    taskId: identifierSchema,
    attemptId: identifierSchema,
    serverId: serverIdSchema,
    tool: toolSelectionSchema,
    arguments: z.record(z.string(), z.unknown()),
    operationId: identifierSchema,
    approvalId: identifierSchema.optional(),
  })
  .strict();
