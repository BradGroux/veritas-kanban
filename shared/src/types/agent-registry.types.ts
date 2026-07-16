/**
 * Agent Registry Types
 *
 * Defines the self-reporting protocol for AI agents to register,
 * declare capabilities, send heartbeats, and link sessions to tasks.
 *
 * @see https://github.com/BradGroux/veritas-kanban/issues/52
 */

// ─── Agent Capabilities ──────────────────────────────────────────

/** Well-known agent capabilities. Custom capabilities use any string slug. */
export type BuiltInCapability =
  | 'code'
  | 'research'
  | 'deploy'
  | 'test'
  | 'review'
  | 'document'
  | 'plan'
  | 'debug'
  | 'refactor'
  | 'design'
  | 'devops'
  | 'security'
  | 'data-analysis';

export type AgentCapability = BuiltInCapability | (string & {});

// ─── Agent Status ────────────────────────────────────────────────

/** Lifecycle status of a registered agent. */
export type AgentLifecycleStatus = 'alive' | 'working' | 'idle' | 'error' | 'offline';

// ─── Registration ────────────────────────────────────────────────

/** Payload an agent sends to register itself. */
export interface AgentRegistrationInput {
  /** Unique agent name/slug (e.g. "claude-code-main", "codex-pr-review"). */
  name: string;
  /** Human-readable display name. */
  displayName?: string;
  /** Agent type/family (e.g. "claude-code", "amp", "copilot"). */
  agentType: string;
  /** Model identifier (e.g. "claude-sonnet-4-20250514", "gpt-4o"). */
  model?: string;
  /** Declared capabilities. */
  capabilities: AgentCapability[];
  /** Version string for the agent software. */
  version?: string;
  /** Optional metadata (environment, host, session label, etc.). */
  metadata?: Record<string, unknown>;
  /** Validated provider runtime evidence used for routing and enforcement. */
  providerRuntimeManifest?: import('./provider-runtime.types.js').ProviderRuntimeManifest;
}

/** A registered agent record (stored in the registry). */
export interface RegisteredAgent extends AgentRegistrationInput {
  /** Server-assigned unique ID. */
  id: string;
  /** Current lifecycle status. */
  status: AgentLifecycleStatus;
  /** ISO timestamp of initial registration. */
  registeredAt: string;
  /** ISO timestamp of the most recent heartbeat. */
  lastHeartbeat: string;
  /** Currently active session, if any. */
  activeSession?: AgentSession;
}

// ─── Heartbeat ───────────────────────────────────────────────────

/** Payload for a heartbeat/status update. */
export interface AgentHeartbeatInput {
  /** New lifecycle status. */
  status: AgentLifecycleStatus;
  /** Optional task association (links the agent to a task). */
  taskId?: string;
  /** Optional task title for display purposes. */
  taskTitle?: string;
  /** Short message (progress note, error detail, etc.). */
  message?: string;
  /** Updated capabilities (if changed since registration). */
  capabilities?: AgentCapability[];
  /** Arbitrary metadata update (merged with existing). */
  metadata?: Record<string, unknown>;
  /** Refreshed provider runtime evidence, if the provider identity changed. */
  providerRuntimeManifest?: import('./provider-runtime.types.js').ProviderRuntimeManifest;
}

// ─── Sessions ────────────────────────────────────────────────────

/** An agent work session linked to a task. */
export interface AgentSession {
  /** Session ID (auto-generated). */
  id: string;
  /** Associated task ID. */
  taskId: string;
  /** Task title for display. */
  taskTitle?: string;
  /** ISO timestamp when the session started. */
  startedAt: string;
  /** ISO timestamp when the session ended (if completed). */
  endedAt?: string;
  /** Session outcome. */
  outcome?: 'success' | 'failure' | 'abandoned';
  /** Optional summary of what was accomplished. */
  summary?: string;
}

// ─── API Response Shapes ─────────────────────────────────────────

/** Response from POST /api/agents/register. */
export interface AgentRegistrationResponse {
  agent: RegisteredAgent;
  /** Whether this was a new registration or a re-registration. */
  isNew: boolean;
}

/** Response from POST /api/agents/:id/heartbeat. */
export interface AgentHeartbeatResponse {
  agent: RegisteredAgent;
  /** Server timestamp for clock sync. */
  serverTime: string;
}

/** Response from GET /api/agents/registry. */
export interface AgentRegistryListResponse {
  agents: RegisteredAgent[];
  total: number;
}

/** Query parameters for listing agents. */
export interface AgentRegistryQuery {
  /** Filter by status. */
  status?: AgentLifecycleStatus;
  /** Filter by capability. */
  capability?: AgentCapability;
  /** Filter by agent type. */
  agentType?: string;
  /** Include offline/stale agents (default: false). */
  includeOffline?: boolean;
}
