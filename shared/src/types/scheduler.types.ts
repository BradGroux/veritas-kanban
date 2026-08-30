import type { WorkflowScheduleMode } from './workflow.js';

export type SchedulerDeliverableSchedule = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';
export type SchedulerItemKind =
  'scheduled-deliverable' | 'workflow' | 'queue-monitor' | 'automation';
export type SchedulerItemProvider = 'local-server';
export type SchedulerHealth = 'healthy' | 'warning' | 'paused' | 'blocked';
export type SchedulerRunStatus = 'success' | 'failed' | 'skipped' | 'started';
export type SchedulerEventType =
  'due-run' | 'manual-run' | 'pause' | 'resume' | 'revoke' | 'activate' | 'validate' | 'overlap';

export interface SchedulerTrigger {
  mode: SchedulerDeliverableSchedule | WorkflowScheduleMode;
  description: string;
  cronExpr?: string;
  timezone?: string;
  startAt?: string;
  endAt?: string;
  customDueRunnerSupported: boolean;
}

export interface SchedulerRetryState {
  attempts: number;
  maxAttempts: number;
  backoffMinutes: number;
  nextAttemptAt?: string;
}

export interface SchedulerItem {
  id: string;
  kind: SchedulerItemKind;
  provider: SchedulerItemProvider;
  sourceId: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: SchedulerTrigger;
  tags: string[];
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: SchedulerRunStatus;
  lastSummary?: string;
  lastError?: string;
  sourceRunId?: string;
  health: SchedulerHealth;
  healthSummary: string;
  retry: SchedulerRetryState;
  actions: {
    canRun: boolean;
    canPause: boolean;
    canResume: boolean;
    canValidate: boolean;
  };
}

export interface SchedulerEvent {
  id: string;
  itemId: string;
  sourceId: string;
  kind: SchedulerItemKind;
  type: SchedulerEventType;
  status: SchedulerRunStatus;
  summary: string;
  runAt: string;
  durationMs?: number;
  error?: string;
  sourceRunId?: string;
  nextRunAt?: string;
}

export interface SchedulerValidationIssue {
  severity: 'error' | 'warning' | 'info';
  path: string;
  message: string;
  remediation: string;
}

export interface SchedulerValidationResult {
  itemId: string;
  ok: boolean;
  issues: SchedulerValidationIssue[];
}

export interface SchedulerSummary {
  total: number;
  enabled: number;
  paused: number;
  due: number;
  failed: number;
  blocked: number;
}

export interface SchedulerListResponse {
  generatedAt: string;
  summary: SchedulerSummary;
  items: SchedulerItem[];
  recentEvents: SchedulerEvent[];
}

export interface SchedulerRunResult {
  item: SchedulerItem;
  event: SchedulerEvent;
}

export interface SchedulerDueRunResult {
  checked: number;
  executed: number;
  skipped: number;
  failed: number;
  overlapping: boolean;
  events: SchedulerEvent[];
}

export const AUTOMATION_DRAFT_SCHEMA_VERSION = 'automation-draft/v1' as const;

export type AutomationDraftOrigin = 'explicit' | 'inferred' | 'system' | 'unresolved';
export type AutomationDraftFieldStatus =
  'resolved' | 'missing' | 'ambiguous' | 'unavailable' | 'unsupported' | 'conflict';
export type AutomationDraftConfidence = 'high' | 'medium' | 'low' | 'none';

export interface AutomationDraftField<T> {
  value?: T;
  origin: AutomationDraftOrigin;
  status: AutomationDraftFieldStatus;
  confidence: AutomationDraftConfidence;
  explanation: string;
}

export interface AutomationDraftRetryPosture {
  maxAttempts: number;
  backoffMinutes: number;
}

export interface AutomationDraftBudget {
  maxRuns: number;
  maxCostUsd?: number;
  maxTokens?: number;
  maxDurationMinutes?: number;
}

export interface AutomationDraftStandingScope {
  reads: string[];
  writes: string[];
  sends: string[];
  externalTargets: string[];
  artifactDestinations: string[];
  integrationIds: string[];
  toolIds: string[];
  credentialDefinitionIds: string[];
  approvalRequiredActions: string[];
}

export interface AutomationDraftValidationIssue {
  severity: 'blocker' | 'warning' | 'info';
  code: string;
  path: string;
  message: string;
  remediation: string;
}

export interface AutomationDraft {
  schemaVersion: typeof AUTOMATION_DRAFT_SCHEMA_VERSION;
  id: string;
  revision: number;
  status: 'inactive';
  parentDraftId?: string;
  objective: AutomationDraftField<string>;
  source: {
    workspaceId: AutomationDraftField<string>;
    taskId: AutomationDraftField<string>;
    proposingRunId: AutomationDraftField<string>;
  };
  execution: {
    workflowId: AutomationDraftField<string>;
    taskTemplateId: AutomationDraftField<string>;
    provider: AutomationDraftField<string>;
  };
  schedule: {
    expression: AutomationDraftField<string>;
    timezone: AutomationDraftField<string>;
    startAt: AutomationDraftField<string>;
    expiresAt: AutomationDraftField<string>;
    overlapPolicy: AutomationDraftField<'skip' | 'queue-one' | 'forbid'>;
    retry: AutomationDraftField<AutomationDraftRetryPosture>;
    nextRunExamples: string[];
  };
  output: {
    destination: AutomationDraftField<string>;
    expectedDeliverables: AutomationDraftField<string[]>;
  };
  standingScope: AutomationDraftField<AutomationDraftStandingScope>;
  perRunBudget: AutomationDraftField<AutomationDraftBudget>;
  aggregateBudget: AutomationDraftField<AutomationDraftBudget>;
  stopConditions: AutomationDraftField<string[]>;
  validation: {
    valid: boolean;
    issues: AutomationDraftValidationIssue[];
  };
  redaction: {
    safeToExport: true;
    removedFields: string[];
  };
  requestedBy: string;
  requestId: string;
  inputDigest: string;
  createdAt: string;
  digest: string;
}

export interface AutomationDraftHints {
  workspaceId?: string;
  sourceTaskId?: string;
  proposingRunId?: string;
  workflowId?: string;
  taskTemplateId?: string;
  provider?: string;
  scheduleExpression?: string;
  timezone?: string;
  startAt?: string;
  expiresAt?: string;
  overlapPolicy?: 'skip' | 'queue-one' | 'forbid';
  retry?: AutomationDraftRetryPosture;
  outputDestination?: string;
  expectedDeliverables?: string[];
  standingScope?: AutomationDraftStandingScope;
  perRunBudget?: AutomationDraftBudget;
  aggregateBudget?: AutomationDraftBudget;
  stopConditions?: string[];
}

export interface AutomationDraftCompileInput {
  intent: string;
  requestId: string;
  requestedBy: string;
  hints?: AutomationDraftHints;
}

export interface AutomationDraftListResponse {
  generatedAt: string;
  drafts: AutomationDraft[];
}

export const AUTOMATION_ACTIVATION_PREVIEW_SCHEMA_VERSION =
  'automation-activation-preview/v1' as const;
export const AUTOMATION_VERSION_SCHEMA_VERSION = 'automation-version/v1' as const;
export const AUTOMATION_BINDING_SCHEMA_VERSION = 'automation-binding/v1' as const;
export const AUTOMATION_RUN_CLAIM_SCHEMA_VERSION = 'automation-run-claim/v1' as const;

export type AutomationBindingStatus = 'active' | 'paused' | 'revoked' | 'expired' | 'blocked';
export type AutomationRunClaimStatus = 'accepted' | 'started' | 'completed' | 'blocked' | 'failed';

export interface AutomationActivationEvidence {
  sourceTarget: {
    kind: 'workflow' | 'task-template';
    id: string;
    version: number;
    digest: string;
  };
  workflowId: string;
  workflowVersion: number;
  workflowDigest: string;
  provider: string;
  providerEvidenceDigest: string;
  toolCatalogDigest: string;
  integrationEvidenceDigest: string;
  policyDigest: string;
  enforceable: boolean;
  blockers: string[];
}

export interface AutomationActivationPreview {
  schemaVersion: typeof AUTOMATION_ACTIVATION_PREVIEW_SCHEMA_VERSION;
  draftId: string;
  draftRevision: number;
  draftDigest: string;
  requestId: string;
  requestRevision: string;
  workspaceId: string;
  sourceTaskId?: string;
  objective: string;
  schedule: {
    expression: string;
    timezone: string;
    startAt?: string;
    expiresAt: string;
    overlapPolicy: 'skip' | 'queue-one' | 'forbid';
    retry: AutomationDraftRetryPosture;
    nextRunAt?: string;
  };
  output: {
    destination: string;
    expectedDeliverables: string[];
  };
  standingScope: AutomationDraftStandingScope;
  perRunBudget: AutomationDraftBudget;
  aggregateBudget: AutomationDraftBudget;
  stopConditions: string[];
  effectiveRunAccess: {
    reads: string[];
    writes: string[];
    sends: string[];
    externalTargets: string[];
    artifactDestinations: string[];
    tools: string[];
    integrations: string[];
    approvalRequiredActions: string[];
  };
  evidence: AutomationActivationEvidence;
  approval: {
    required: true;
    riskClass: 'critical';
    expiresInMs: number;
  };
}

export interface AutomationVersion {
  schemaVersion: typeof AUTOMATION_VERSION_SCHEMA_VERSION;
  id: string;
  version: number;
  draftId: string;
  draftRevision: number;
  draftDigest: string;
  requestRevision: string;
  workspaceId: string;
  sourceTaskId?: string;
  objective: string;
  workflowId: string;
  workflowVersion: number;
  provider: string;
  schedule: AutomationActivationPreview['schedule'];
  output: AutomationActivationPreview['output'];
  standingScope: AutomationDraftStandingScope;
  perRunBudget: AutomationDraftBudget;
  aggregateBudget: AutomationDraftBudget;
  stopConditions: string[];
  evidence: AutomationActivationEvidence;
  approval: {
    id: string;
    revision: number;
    actionHash: string;
    approvedBy: string;
    approvedAt: string;
  };
  activatedAt: string;
  digest: string;
}

export interface AutomationBinding {
  schemaVersion: typeof AUTOMATION_BINDING_SCHEMA_VERSION;
  id: string;
  revision: number;
  automationVersionId: string;
  automationVersion: number;
  status: AutomationBindingStatus;
  nextRunAt?: string;
  lastRunAt?: string;
  acceptedRuns: number;
  failedRuns: number;
  aggregateUsage: {
    runs: number;
    costUsd: number;
    tokens: number;
    durationMinutes: number;
  };
  statusReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunClaim {
  schemaVersion: typeof AUTOMATION_RUN_CLAIM_SCHEMA_VERSION;
  id: string;
  requestId: string;
  automationVersionId: string;
  bindingId: string;
  dueWindow: string;
  trigger: 'due-run' | 'manual-run';
  status: AutomationRunClaimStatus;
  workflowRunId?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationActivationResult {
  preview: AutomationActivationPreview;
  approvalId?: string;
  approvalStatus?: 'pending' | 'approved';
  version?: AutomationVersion;
  binding?: AutomationBinding;
}

export interface AutomationVersionListResponse {
  generatedAt: string;
  versions: AutomationVersion[];
  bindings: AutomationBinding[];
  recentClaims: AutomationRunClaim[];
}

export interface WorkflowAutomationBinding {
  automationVersionId: string;
  automationVersion: number;
  bindingId: string;
  claimId: string;
  requestId: string;
  workspaceId: string;
  outputDestination: string;
  standingScope: AutomationDraftStandingScope;
  evidenceDigest: string;
}
