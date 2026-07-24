export const RUNTIME_HOOK_SCHEMA_VERSION = 'runtime-hook/v1' as const;

export const RUNTIME_HOOK_EVENT_IDS = [
  'session.pre-start',
  'session.post-end',
  'tool.pre-use',
  'tool.post-use',
  'permission.post-denied',
  'completion.post-recorded',
  'workflow.pre-external-trigger',
] as const;

export type RuntimeHookEventId = (typeof RUNTIME_HOOK_EVENT_IDS)[number];

export const BLOCKING_RUNTIME_HOOK_EVENT_IDS = [
  'session.pre-start',
  'tool.pre-use',
  'workflow.pre-external-trigger',
] as const;

export type BlockingRuntimeHookEventId = (typeof BLOCKING_RUNTIME_HOOK_EVENT_IDS)[number];
export type RuntimeHookFailurePolicy = 'fail-open' | 'fail-closed';
export type RuntimeHookScopeKind = 'global' | 'workspace' | 'profile' | 'workflow' | 'run';

export type RuntimeHookScope =
  { kind: 'global' } | { kind: Exclude<RuntimeHookScopeKind, 'global'>; id: string };

export interface RuntimeHookDefinition {
  schemaVersion: typeof RUNTIME_HOOK_SCHEMA_VERSION;
  id: string;
  event: RuntimeHookEventId;
  handlerId: string;
  scope: RuntimeHookScope;
  enabled: boolean;
  order: number;
  timeoutMs: number;
  failurePolicy: RuntimeHookFailurePolicy;
}

export interface RuntimeHookScopeContext {
  workspaceId?: string;
  profileId?: string;
  workflowId?: string;
  runId?: string;
}

export interface RuntimeHookReferences {
  sourceEventId: string;
  taskId?: string;
  attemptId?: string;
  toolCallId?: string;
  approvalId?: string;
  workflowId?: string;
  externalEventId?: string;
}

export interface RuntimeHookEnvelope {
  schemaVersion: typeof RUNTIME_HOOK_SCHEMA_VERSION;
  eventId: string;
  event: RuntimeHookEventId;
  occurredAt: string;
  scope: RuntimeHookScopeContext;
  references: RuntimeHookReferences;
  metadata: Record<string, string | number | boolean | null>;
}

export interface RuntimeHookHandlerResult {
  decision: 'allow' | 'deny' | 'observe';
  diagnostic?: string;
}

export type RuntimeHookDisposition =
  | 'allowed'
  | 'denied'
  | 'failed-open'
  | 'failed-closed'
  | 'timed-out'
  | 'reentrant'
  | 'missing-handler'
  | 'invalid-post-decision';

export interface RuntimeHookEvidenceReference {
  kind: 'run-event';
  eventId: string;
  sequence: number;
}

export interface RuntimeHookOutcome {
  schemaVersion: typeof RUNTIME_HOOK_SCHEMA_VERSION;
  eventId: string;
  sourceEventId: string;
  hookId: string;
  handlerId: string;
  event: RuntimeHookEventId;
  order: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  disposition: RuntimeHookDisposition;
  blocking: boolean;
  diagnostic?: string;
  evidence?: RuntimeHookEvidenceReference;
}

export interface RuntimeHookDispatchResult {
  schemaVersion: typeof RUNTIME_HOOK_SCHEMA_VERSION;
  eventId: string;
  event: RuntimeHookEventId;
  allowed: boolean;
  outcomes: RuntimeHookOutcome[];
}

export interface RuntimeHookDryRunEntry {
  hookId: string;
  handlerId: string;
  scope: RuntimeHookScope;
  order: number;
  blocking: boolean;
  handlerRegistered: boolean;
  blocker?: string;
}

export interface RuntimeHookDryRunResult {
  schemaVersion: typeof RUNTIME_HOOK_SCHEMA_VERSION;
  eventId: string;
  event: RuntimeHookEventId;
  effectiveHooks: RuntimeHookDryRunEntry[];
  wouldBlock: boolean;
  blockers: string[];
}

export type RuntimeHookHandler = (
  envelope: Readonly<RuntimeHookEnvelope>,
  context: { signal: AbortSignal }
) => Promise<RuntimeHookHandlerResult>;

export interface RuntimeHookOutcomeRecorder {
  record(
    envelope: RuntimeHookEnvelope,
    outcome: RuntimeHookOutcome
  ): Promise<RuntimeHookEvidenceReference | undefined>;
}

export function isBlockingRuntimeHookEvent(
  event: RuntimeHookEventId
): event is BlockingRuntimeHookEventId {
  return (BLOCKING_RUNTIME_HOOK_EVENT_IDS as readonly RuntimeHookEventId[]).includes(event);
}
