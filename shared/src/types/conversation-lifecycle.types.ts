export const CONVERSATION_LIFECYCLE_SCHEMA_VERSION = 'conversation-lifecycle/v1' as const;

export const CONVERSATION_LAUNCH_MODES = ['fresh', 'resume', 'fork'] as const;
export type ConversationLaunchMode = (typeof CONVERSATION_LAUNCH_MODES)[number];

export const CONVERSATION_LAUNCH_INTENTS = ['fresh', 'resume', 'follow-up', 'fork'] as const;
export type ConversationLaunchIntent = (typeof CONVERSATION_LAUNCH_INTENTS)[number];

export const CONVERSATION_STATES = ['active', 'compacted', 'archived', 'closed'] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export const CONVERSATION_CONTEXT_POSTURES = [
  'unknown',
  'healthy',
  'nearing-limit',
  'critical',
] as const;
export type ConversationContextPosture = (typeof CONVERSATION_CONTEXT_POSTURES)[number];

export interface ConversationContextWindow {
  usedTokens?: number;
  limitTokens?: number;
  remainingTokens?: number;
  utilization?: number;
  posture: ConversationContextPosture;
  measuredAt: string;
}

/**
 * Durable provider-neutral identity for the history attached to one attempt.
 *
 * Provider identifiers are opaque. Credential leases and process handles are
 * deliberately excluded so resume and fork never inherit transient authority.
 */
export interface ConversationLifecycleRecord {
  schemaVersion: typeof CONVERSATION_LIFECYCLE_SCHEMA_VERSION;
  mode: ConversationLaunchMode;
  intent: ConversationLaunchIntent;
  conversationId?: string;
  currentTurnId?: string;
  lastItemId?: string;
  parentConversationId?: string;
  parentAttemptId?: string;
  forkTurnId?: string;
  state: ConversationState;
  contextWindow: ConversationContextWindow;
  createdAt: string;
  updatedAt: string;
  compactedAt?: string;
  archivedAt?: string;
  closedAt?: string;
}

export interface ConversationLaunchRequest {
  mode: ConversationLaunchMode;
  intent?: ConversationLaunchIntent;
  sourceAttemptId?: string;
  forkTurnId?: string;
  message?: string;
}

export interface ConversationLifecycleResult {
  action: 'resume' | 'follow-up' | 'fork' | 'steer' | 'interrupt' | 'compact' | 'archive' | 'close';
  taskId: string;
  attemptId: string;
  delivered: boolean;
  note: string;
  conversation: ConversationLifecycleRecord;
}
