export const BUZZ_WORKFLOW_TRIGGER_SCHEMA_VERSION = 'buzz-workflow-trigger/v1' as const;

export type BuzzWorkflowTriggerDisposition =
  'accepted' | 'ignored-policy' | 'duplicate' | 'echo' | 'dispatch-failed' | 'dispatched';

export interface BuzzWorkflowTriggerRule {
  schemaVersion: typeof BUZZ_WORKFLOW_TRIGGER_SCHEMA_VERSION;
  id: string;
  adapterId: string;
  mappingId: string;
  community: string;
  channelId: string;
  event: 'message.posted';
  workflowId: string;
  enabled: boolean;
  authorPubkey?: string;
  contentIncludes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuzzWorkflowTriggerRuleInput {
  mappingId: string;
  workflowId: string;
  enabled?: boolean;
  authorPubkey?: string;
  contentIncludes?: string;
}

export interface BuzzWorkflowTriggerAudit {
  schemaVersion: typeof BUZZ_WORKFLOW_TRIGGER_SCHEMA_VERSION;
  id: string;
  causalKey: string;
  adapterId: string;
  mappingId: string;
  ruleId: string;
  workflowId: string;
  community: string;
  channelId: string;
  eventId: string;
  disposition: BuzzWorkflowTriggerDisposition;
  occurredAt: string;
  runId?: string;
  detail?: string;
}
