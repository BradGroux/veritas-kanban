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

const GeneralSettingsSchema = z
  .object({
    humanDisplayName: z.string().min(1).max(50).optional(),
  })
  .strict()
  .optional();

const DashboardWidgetSettingsSchema = z
  .object({
    showTokenUsage: z.boolean().optional(),
    showRunDuration: z.boolean().optional(),
    showAgentComparison: z.boolean().optional(),
    showStatusTimeline: z.boolean().optional(),
    showCostPerTask: z.boolean().optional(),
    showAgentUtilization: z.boolean().optional(),
    showWallTime: z.boolean().optional(),
    showSessionMetrics: z.boolean().optional(),
    showActivityClock: z.boolean().optional(),
    showWhereTimeWent: z.boolean().optional(),
    showHourlyActivity: z.boolean().optional(),
    showTrendsCharts: z.boolean().optional(),
  })
  .strict()
  .optional();

const BoardSettingsSchema = z
  .object({
    showDashboard: z.boolean().optional(),
    showArchiveSuggestions: z.boolean().optional(),
    cardDensity: z.enum(['normal', 'compact']).optional(),
    showPriorityIndicators: z.boolean().optional(),
    showProjectBadges: z.boolean().optional(),
    showSprintBadges: z.boolean().optional(),
    enableDragAndDrop: z.boolean().optional(),
    showDoneMetrics: z.boolean().optional(),
    dashboardWidgets: DashboardWidgetSettingsSchema,
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
    autoSaveDelayMs: z.number().int().min(200).max(5000).optional(),
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
    webhookUrl: z.string().url().optional(),
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

const EnforcementSettingsSchema = z
  .object({
    squadChat: z.boolean().optional(),
    reviewGate: z.boolean().optional(),
    closingComments: z.boolean().optional(),
    autoTelemetry: z.boolean().optional(),
    autoTimeTracking: z.boolean().optional(),
    orchestratorDelegation: z.boolean().optional(),
  })
  .strict()
  .optional();

/**
 * Task lifecycle hooks configuration.
 *
 * Hooks are triggered on task state transitions:
 * - onCreated: Task is created
 * - onStarted: Task moves to in-progress
 * - onBlocked: Task moves to blocked
 * - onCompleted: Task moves to done
 * - onArchived: Task is archived
 *
 * Each hook can specify:
 * - enabled: Whether the hook is active
 * - webhook: URL to POST event payload (optional)
 * - notify: Send notification to configured channel (optional)
 * - logActivity: Record in activity log (default: true)
 */
const HookConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    webhook: z.string().url().optional(),
    notify: z.boolean().optional(),
    logActivity: z.boolean().optional(),
  })
  .strict()
  .optional();

const HooksSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    onCreated: HookConfigSchema,
    onStarted: HookConfigSchema,
    onBlocked: HookConfigSchema,
    onCompleted: HookConfigSchema,
    onArchived: HookConfigSchema,
  })
  .strict()
  .optional();

const SquadWebhookSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(['webhook', 'openclaw']).optional(),
    // Generic webhook fields
    url: z.string().url().max(500).optional(),
    secret: z.string().min(16).max(128).optional(),
    // OpenClaw fields
    openclawGatewayUrl: z.string().url().max(500).optional(),
    openclawGatewayToken: z.string().min(16).max(128).optional(),
    // Common fields
    notifyOnHuman: z.boolean().optional(),
    notifyOnAgent: z.boolean().optional(),
  })
  .strict()
  .optional();

export const FeatureSettingsPatchSchema = z
  .object({
    general: GeneralSettingsSchema,
    board: BoardSettingsSchema,
    tasks: TaskBehaviorSettingsSchema,
    agents: AgentBehaviorSettingsSchema,
    telemetry: TelemetrySettingsSchema,
    notifications: NotificationSettingsSchema,
    archive: ArchiveSettingsSchema,
    budget: BudgetSettingsSchema,
    enforcement: EnforcementSettingsSchema,
    hooks: HooksSettingsSchema,
    squadWebhook: SquadWebhookSettingsSchema,
  })
  .strict()
  .refine((val) => !hasDangerousKeys(val), {
    message: 'Payload contains forbidden keys (__proto__, constructor, prototype)',
  });

export type FeatureSettingsPatch = z.infer<typeof FeatureSettingsPatchSchema>;
