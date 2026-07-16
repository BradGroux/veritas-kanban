import { z } from 'zod';
import { AgentBudgetPolicySchema } from './agent-budget-schemas.js';

const AgentTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Agent type must be lowercase alphanumeric with dashes');

const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'ID must start with a lowercase letter or number');

const StringListSchema = z.array(z.string().trim().min(1).max(160)).max(50).default([]);

export const AgentProfilePackageFormatSchema = z.enum(['json', 'yaml']).optional();

export const AgentProfileRuntimeSchema = z
  .object({
    agent: AgentTypeSchema,
    provider: z
      .enum([
        'openclaw',
        'codex-cli',
        'codex-sdk',
        'hermes-cli',
        'codex-cloud',
        'ollama-local',
        'ollama-cloud',
        'lm-studio-local',
        'custom',
      ])
      .optional(),
    model: z.string().trim().min(1).max(120).optional(),
    fallbackAgent: AgentTypeSchema.optional(),
  })
  .strict();

export const AgentProfileInstructionsSchema = z
  .object({
    prompt: z.string().trim().max(10_000).optional(),
    promptFile: z.string().trim().min(1).max(500).optional(),
    files: z.array(z.string().trim().min(1).max(500)).max(25).default([]).optional(),
  })
  .strict()
  .optional();

export const AgentProfileToolsSchema = z
  .object({
    allowed: StringListSchema.optional(),
    mcpServers: StringListSchema.optional(),
  })
  .strict()
  .optional();

export const AgentProfilePermissionsSchema = z
  .object({
    level: z.enum(['intern', 'specialist', 'lead']).optional(),
    required: StringListSchema.optional(),
  })
  .strict()
  .optional();

export const AgentProfilePolicyBundleSchema = z
  .object({
    sandboxPresetId: z.string().trim().min(1).max(80).optional(),
    budget: AgentBudgetPolicySchema.optional(),
    toolPolicyIds: StringListSchema.optional(),
  })
  .strict()
  .optional();

export const AgentProfileWorkflowEntrypointSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    entrypoint: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .optional();

export const AgentProfileHealthCheckSchema = z
  .object({
    id: SlugSchema,
    label: z.string().trim().min(1).max(160),
    command: z.string().trim().min(1).max(500).optional(),
    required: z.boolean().optional(),
  })
  .strict();

export const AgentProfileHealthSchema = z
  .object({
    checks: z.array(AgentProfileHealthCheckSchema).max(20).default([]).optional(),
    readiness: StringListSchema.optional(),
  })
  .strict()
  .optional();

export const AgentProfilePackageMetadataSchema = z
  .object({
    source: z.string().trim().min(1).max(500).optional(),
    importedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict()
  .optional();

export const AgentProfilePackageSchema = z
  .object({
    id: SlugSchema,
    schemaVersion: z.literal('agent-profile-package/v1').default('agent-profile-package/v1'),
    version: z.string().trim().min(1).max(40),
    displayName: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    enabled: z.boolean().default(true),
    capabilities: StringListSchema,
    defaultTaskTypes: StringListSchema,
    runtime: AgentProfileRuntimeSchema,
    instructions: AgentProfileInstructionsSchema,
    tools: AgentProfileToolsSchema,
    permissions: AgentProfilePermissionsSchema,
    policy: AgentProfilePolicyBundleSchema,
    workflow: AgentProfileWorkflowEntrypointSchema,
    health: AgentProfileHealthSchema,
    metadata: AgentProfilePackageMetadataSchema,
  })
  .strict();

export const AgentProfileImportBodySchema = z
  .object({
    content: z.string().min(1).max(200_000),
    format: AgentProfilePackageFormatSchema,
    source: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const AgentProfileValidateBodySchema = AgentProfileImportBodySchema;

export const AgentProfileUpdateBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    role: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    capabilities: StringListSchema.optional(),
    defaultTaskTypes: StringListSchema.optional(),
  })
  .strict();

export const AgentProfileLaunchBodySchema = z
  .object({
    profileId: SlugSchema.optional(),
  })
  .strict();
