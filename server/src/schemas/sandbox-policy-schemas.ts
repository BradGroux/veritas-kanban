import { z } from 'zod';

const sandboxPresetIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'Sandbox preset id must be lowercase kebab/snake case');

const pathListSchema = z.array(z.string().min(1).max(1000)).max(100);
const envKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Z_][A-Z0-9_]*$/i, 'Environment keys must be shell-safe identifiers');

export const sandboxPolicyEnforcementSchema = z.enum(['required', 'advisory']);
export const sandboxNetworkDefaultSchema = z.enum(['allow', 'deny']);
export const sandboxCredentialModeSchema = z.enum(['none', 'brokered', 'env-passthrough']);

export const skillCapabilityIdSchema = z.enum([
  'filesystem.read',
  'filesystem.write',
  'shell.execute',
  'network.egress',
  'credential.access',
  'external.message',
  'memory.write',
  'task.mutate',
  'schedule.persist',
  'browser.session',
  'mcp.tool',
]);

export const sandboxPolicyPresetSchema = z.object({
  id: sandboxPresetIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(800).optional(),
  enabled: z.boolean(),
  builtIn: z.boolean().optional(),
  enforcement: sandboxPolicyEnforcementSchema,
  requiredCapabilities: z.array(skillCapabilityIdSchema).max(50).default([]),
  filesystem: z.object({
    readPaths: pathListSchema.default([]),
    writePaths: pathListSchema.default([]),
    deniedPaths: pathListSchema.default([]),
    dotfileMasking: z.boolean(),
    localOnlyHandles: z.boolean(),
  }),
  network: z.object({
    defaultEgress: sandboxNetworkDefaultSchema,
    allowedHosts: z.array(z.string().min(1).max(255)).max(100).default([]),
    allowedMethods: z
      .array(
        z
          .string()
          .min(1)
          .max(16)
          .transform((method) => method.toUpperCase())
      )
      .max(20)
      .default([]),
    allowedPathPrefixes: pathListSchema.default([]),
    blockPrivateNetwork: z.boolean(),
    blockMetadataEndpoints: z.boolean(),
    blockLoopback: z.boolean(),
  }),
  environment: z.object({
    passthrough: z.array(envKeySchema).max(120).default([]),
    redactDisplay: z.boolean(),
  }),
  credentials: z.object({
    mode: sandboxCredentialModeSchema,
    brokerRefs: z.array(z.string().min(1).max(160)).max(50).default([]),
  }),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const sandboxPolicyParamsSchema = z.object({
  id: sandboxPresetIdSchema,
});

export const sandboxPolicyDryRunSchema = z
  .object({
    presetId: sandboxPresetIdSchema.optional(),
    preset: sandboxPolicyPresetSchema.optional(),
    provider: z.string().max(80).optional(),
    workspacePath: z.string().max(1000).optional(),
    requiredCapabilities: z.array(skillCapabilityIdSchema).max(50).optional(),
    providerRuntimeManifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export type SandboxPolicyPresetInput = z.infer<typeof sandboxPolicyPresetSchema>;
export type SandboxPolicyDryRunInput = z.infer<typeof sandboxPolicyDryRunSchema>;
