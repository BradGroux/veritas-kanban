import { z } from 'zod';
import { AgentBudgetPolicySchema } from './agent-budget-schemas.js';
import { BOARD_COLUMN_ID_PATTERN } from '@veritas-kanban/shared';

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

const ProductModeSettingsSchema = z
  .object({
    selectedMode: z
      .enum([
        'board-only',
        'agent-ready',
        'solo-coding',
        'pm-orchestration',
        'qa-review',
        'research',
        'operations',
        'advanced',
        'custom',
      ])
      .optional(),
    lastSelectedAt: z.string().datetime().optional(),
    dismissedHints: z.array(z.string().max(80)).max(50).optional(),
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

const BoardSavedViewFiltersSchema = z
  .object({
    search: z.string().max(200),
    project: z.string().min(1).max(120).nullable(),
    type: z.string().min(1).max(80).nullable(),
    agent: z.string().min(1).max(80).nullable(),
  })
  .strict();

const BoardSavedViewSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(80),
    filters: BoardSavedViewFiltersSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const BoardColumnSchema = z
  .object({
    id: z.string().min(1).max(50).regex(BOARD_COLUMN_ID_PATTERN),
    title: z.string().min(1).max(50),
  })
  .strict();

const BoardSettingsSchema = z
  .object({
    columns: z
      .array(BoardColumnSchema)
      .min(1)
      .max(12)
      .refine((columns) => new Set(columns.map((column) => column.id)).size === columns.length, {
        message: 'Board column IDs must be unique',
      })
      .optional(),
    defaultStatus: z.string().min(1).max(50).regex(BOARD_COLUMN_ID_PATTERN).optional(),
    showDashboard: z.boolean().optional(),
    showArchiveSuggestions: z.boolean().optional(),
    cardDensity: z.enum(['normal', 'compact']).optional(),
    showPriorityIndicators: z.boolean().optional(),
    showProjectBadges: z.boolean().optional(),
    showSprintBadges: z.boolean().optional(),
    enableDragAndDrop: z.boolean().optional(),
    showDoneMetrics: z.boolean().optional(),
    savedViews: z.array(BoardSavedViewSchema).max(50).optional(),
    defaultSavedViewId: z.string().min(1).max(100).nullable().optional(),
    dashboardWidgets: DashboardWidgetSettingsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.columns &&
      value.defaultStatus &&
      !value.columns.some((column) => column.id === value.defaultStatus)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'defaultStatus must reference a configured board column',
        path: ['defaultStatus'],
      });
    }
  })
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
    requireDeliverableForDone: z.boolean().optional(),
  })
  .strict()
  .optional();

const MarkdownSettingsSchema = z
  .object({
    enableMarkdown: z.boolean().optional(),
    enableCodeHighlighting: z.boolean().optional(),
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
    defaultRunBudget: AgentBudgetPolicySchema.optional(),
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
    orchestratorAgent: z.string().max(50).optional(),
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

const DocFreshnessSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultMaxAgeDays: z.number().int().min(1).max(365).optional(),
    alertOnStale: z.boolean().optional(),
    autoCreateReviewTasks: z.boolean().optional(),
    staleScanIntervalHours: z.number().int().min(1).max(168).optional(),
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

const WatcherRiskClassSchema = z.enum([
  'destructive_command',
  'credential_reference',
  'recent_test_failure',
  'provider_error',
  'policy_violation',
]);

const WatcherContinuationPolicySchema = z
  .object({
    id: z.string().min(1).max(120),
    enabled: z.boolean(),
    project: z.string().min(1).max(160).optional(),
    agent: z.string().min(1).max(120).optional(),
    mode: z.enum(['ask_always', 'ask_on_risk', 'auto']).optional(),
    maxContinuations: z.number().int().min(0).max(100).optional(),
    spendCapUsd: z.number().min(0).max(100000).optional(),
    riskClasses: z.array(WatcherRiskClassSchema).max(20).optional(),
    dispatchDenyPatterns: z.array(z.string().min(1).max(200)).max(100).optional(),
  })
  .strict();

const WatcherContinuationSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    globalKillSwitch: z.boolean().optional(),
    defaultMode: z.enum(['ask_always', 'ask_on_risk', 'auto']).optional(),
    maxContinuationsPerRun: z.number().int().min(0).max(100).optional(),
    spendCapUsd: z.number().min(0).max(100000).optional(),
    riskClasses: z.array(WatcherRiskClassSchema).max(20).optional(),
    dispatchDenyPatterns: z.array(z.string().min(1).max(200)).max(100).optional(),
    policies: z.array(WatcherContinuationPolicySchema).max(200).optional(),
  })
  .strict()
  .optional();

const SharedResourcesSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxResources: z.number().int().min(1).max(1000).optional(),
    allowedTypes: z
      .array(z.enum(['prompt', 'guideline', 'skill', 'config', 'template']))
      .optional(),
  })
  .strict()
  .optional();

const FeatureSettingsPatchObjectSchema = z
  .object({
    general: GeneralSettingsSchema,
    productMode: ProductModeSettingsSchema,
    board: BoardSettingsSchema,
    tasks: TaskBehaviorSettingsSchema,
    markdown: MarkdownSettingsSchema,
    agents: AgentBehaviorSettingsSchema,
    telemetry: TelemetrySettingsSchema,
    notifications: NotificationSettingsSchema,
    archive: ArchiveSettingsSchema,
    budget: BudgetSettingsSchema,
    enforcement: EnforcementSettingsSchema,
    hooks: HooksSettingsSchema,
    sharedResources: SharedResourcesSettingsSchema,
    docFreshness: DocFreshnessSettingsSchema,
    squadWebhook: SquadWebhookSettingsSchema,
    watcherContinuations: WatcherContinuationSettingsSchema,
  })
  .strict()
  .refine((val) => !hasDangerousKeys(val), {
    message: 'Payload contains forbidden keys (__proto__, constructor, prototype)',
  });

export const FeatureSettingsPatchSchema = z.preprocess((val) => {
  if (!hasDangerousKeys(val)) return val;
  return { __forbiddenPrototypePayload: true };
}, FeatureSettingsPatchObjectSchema);

export type FeatureSettingsPatch = z.infer<typeof FeatureSettingsPatchSchema>;
