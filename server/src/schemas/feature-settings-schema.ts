import { z } from 'zod';

// Dangerous keys check
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
function hasDangerousKeys(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.includes(key)) return true;
    if (hasDangerousKeys(record[key])) return true;
  }
  return false;
}

const BoardSettingsSchema = z
  .object({
    showDashboard: z.boolean().optional(),
    showArchiveSuggestions: z.boolean().optional(),
    cardDensity: z.enum(['normal', 'compact']).optional(),
    showPriorityIndicators: z.boolean().optional(),
    showProjectBadges: z.boolean().optional(),
    showSprintBadges: z.boolean().optional(),
    enableDragAndDrop: z.boolean().optional(),
  })
  .strict()
  .optional();

const TaskBehaviorSettingsSchema = z
  .object({
    enableTimeTracking: z.boolean().optional(),
    enableSubtaskAutoComplete: z.boolean().optional(),
    enableDependencies: z.boolean().optional(),
    enableAttachments: z.boolean().optional(),
    attachmentMaxFileSize: z
      .number()
      .int()
      .min(1024)
      .max(100 * 1024 * 1024)
      .optional(),
    attachmentMaxPerTask: z.number().int().min(1).max(100).optional(),
    attachmentMaxTotalSize: z
      .number()
      .int()
      .min(1024)
      .max(500 * 1024 * 1024)
      .optional(),
    enableComments: z.boolean().optional(),
    defaultPriority: z.enum(['none', 'low', 'medium', 'high', 'critical']).optional(),
  })
  .strict()
  .optional();

const AgentBehaviorSettingsSchema = z
  .object({
    timeoutMinutes: z.number().int().min(5).max(480).optional(),
    autoCommitOnComplete: z.boolean().optional(),
    autoCleanupWorktrees: z.boolean().optional(),
    enablePreview: z.boolean().optional(),
  })
  .strict()
  .optional();

const TelemetrySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    retentionDays: z.number().int().min(7).max(365).optional(),
    enableTraces: z.boolean().optional(),
    enableActivityTracking: z.boolean().optional(),
  })
  .strict()
  .optional();

const NotificationSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    onTaskComplete: z.boolean().optional(),
    onAgentFailure: z.boolean().optional(),
    onReviewNeeded: z.boolean().optional(),
    channel: z.string().max(200).optional(),
  })
  .strict()
  .optional();

const ArchiveSettingsSchema = z
  .object({
    autoArchiveEnabled: z.boolean().optional(),
    autoArchiveAfterDays: z.number().int().min(1).max(365).optional(),
  })
  .strict()
  .optional();

const BudgetSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    monthlyTokenLimit: z.number().int().min(0).optional(),
    monthlyCostLimit: z.number().min(0).optional(),
    warningThreshold: z.number().min(0).max(100).optional(),
  })
  .strict()
  .optional();

export const FeatureSettingsPatchSchema = z
  .object({
    board: BoardSettingsSchema,
    tasks: TaskBehaviorSettingsSchema,
    agents: AgentBehaviorSettingsSchema,
    telemetry: TelemetrySettingsSchema,
    notifications: NotificationSettingsSchema,
    archive: ArchiveSettingsSchema,
    budget: BudgetSettingsSchema,
  })
  .strict()
  .refine((val) => !hasDangerousKeys(val), {
    message: 'Payload contains forbidden keys (__proto__, constructor, prototype)',
  });

export type FeatureSettingsPatch = z.infer<typeof FeatureSettingsPatchSchema>;
