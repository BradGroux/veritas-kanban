import { z } from 'zod';

const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'ID must start with a lowercase letter or number');

const WorkspaceIdSchema = z.string().trim().min(1).max(120);
const LabelListSchema = z.array(z.string().trim().min(1).max(80)).max(50).default([]);
const ContextFieldListSchema = z.array(z.string().trim().min(1).max(80)).max(25).default([]);
const TaskTypeListSchema = z.array(z.string().trim().min(1).max(80)).max(50).default([]);
const OptionalUrlSchema = z.string().trim().url().max(500).optional();

const SECRET_KEY_PATTERN = /(?:secret|token|password|api[-_]?key|private[-_]?key)/i;

function rejectSensitiveKeys(value: unknown, ctx: z.RefinementCtx, path: (string | number)[] = []) {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveKeys(entry, ctx, [...path, index]));
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (SECRET_KEY_PATTERN.test(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: nextPath,
        message: `Sensitive field is not allowed in capability manifests: ${key}`,
      });
    }
    rejectSensitiveKeys(nested, ctx, nextPath);
  }
}

export const WorkspaceCapabilityFormatSchema = z.enum(['json', 'yaml']).optional();

export const WorkspaceCapabilityDescriptorSchema = z
  .object({
    id: SlugSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    acceptedTaskTypes: TaskTypeListSchema,
    defaultLabels: LabelListSchema.optional(),
    defaultProject: z.string().trim().min(1).max(160).optional(),
    defaultPriority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    defaultTaskType: z.string().trim().min(1).max(80).optional(),
    triageOwner: z.string().trim().min(1).max(120).optional(),
    requiredContextFields: ContextFieldListSchema.optional(),
    intakeTargets: z
      .array(z.enum(['task', 'github-issue']))
      .max(2)
      .default(['task']),
  })
  .strict();

export const WorkspaceCapabilityManifestSchema = z
  .object({
    id: SlugSchema,
    schemaVersion: z.literal('workspace-capability/v1').default('workspace-capability/v1'),
    workspaceId: WorkspaceIdSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    boardUrl: OptionalUrlSchema,
    repositoryUrl: OptionalUrlSchema,
    safeContact: z
      .object({
        label: z.string().trim().min(1).max(120).optional(),
        url: OptionalUrlSchema,
        email: z.string().trim().email().max(200).optional(),
      })
      .strict()
      .optional(),
    enabled: z.boolean().default(true),
    capabilities: z.array(WorkspaceCapabilityDescriptorSchema).min(1).max(100),
    defaultLabels: LabelListSchema.optional(),
    defaultProject: z.string().trim().min(1).max(160).optional(),
    defaultPriority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    triageOwner: z.string().trim().min(1).max(120).optional(),
    trustedSourceWorkspaceIds: z.array(WorkspaceIdSchema).max(100).optional(),
    metadata: z
      .object({
        source: z.string().trim().min(1).max(500).optional(),
        importedAt: z.string().datetime().optional(),
        updatedAt: z.string().datetime().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    rejectSensitiveKeys(manifest, ctx);

    const capabilityIds = new Set<string>();
    manifest.capabilities.forEach((capability, index) => {
      if (capabilityIds.has(capability.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilities', index, 'id'],
          message: `Duplicate capability ID: ${capability.id}`,
        });
      }
      capabilityIds.add(capability.id);
    });
  });

export const WorkspaceCapabilityImportBodySchema = z
  .object({
    content: z.string().min(1).max(200_000).optional(),
    format: WorkspaceCapabilityFormatSchema,
    source: z.string().trim().min(1).max(500).optional(),
    manifest: z.unknown().optional(),
  })
  .strict()
  .refine((value) => value.manifest || value.content, {
    message: 'Provide manifest or content',
  });

export const WorkspaceCapabilityValidateBodySchema = WorkspaceCapabilityImportBodySchema;

export const WorkspaceCapabilityIntakeBodySchema = z
  .object({
    source: z
      .object({
        workspaceId: WorkspaceIdSchema,
        workspaceName: z.string().trim().min(1).max(160).optional(),
        taskId: z.string().trim().min(1).max(120).optional(),
        taskUrl: OptionalUrlSchema,
        repository: z.string().trim().min(1).max(200).optional(),
        issueUrl: OptionalUrlSchema,
      })
      .strict(),
    capabilityId: SlugSchema,
    title: z.string().trim().min(1).max(200),
    context: z.string().trim().min(1).max(20_000),
    contextFields: z
      .record(z.string().trim().min(1).max(80), z.string().trim().max(2000))
      .optional(),
    labels: LabelListSchema.optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    project: z.string().trim().min(1).max(160).optional(),
    type: z.string().trim().min(1).max(80).optional(),
    requestedBy: z.string().trim().min(1).max(160).optional(),
    backlinkUrl: OptionalUrlSchema,
    createAs: z.enum(['task', 'github-issue']).default('task'),
  })
  .strict();
