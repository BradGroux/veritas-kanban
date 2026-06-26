/**
 * Chat Interface Types
 *
 * Built-in chat interface for conversing with agents about tasks or the board.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  agent?: string; // Which agent responded
  model?: string; // Which model was used
  toolCalls?: Array<{
    // Collapsible tool-use blocks
    name: string;
    input: string;
    output?: string;
  }>;
}

export interface ChatSession {
  id: string;
  taskId?: string; // Task-scoped (undefined = board-level)
  title: string;
  messages: ChatMessage[];
  agent: string; // Current agent for this session
  model?: string;
  mode: 'ask' | 'build'; // Ask = read-only, Build = can mutate
  created: string;
  updated: string;
}

export interface ChatSendInput {
  sessionId?: string; // Existing session (omit for new)
  taskId?: string; // Task context
  message: string;
  agent?: string; // Override agent
  model?: string; // Override model
  mode?: 'ask' | 'build';
  includeContext?: boolean; // Set false to skip retrieval context injection
}

/**
 * Squad Chat Message
 * Agent-to-agent communication not tied to a specific task
 */
export interface SquadMessage {
  id: string;
  agent: string; // Which agent sent this
  displayName?: string; // Optional display name (e.g., "Human" or actual person name)
  message: string;
  tags?: string[]; // Optional categorization
  timestamp: string;
  model?: string; // Which model generated this message (e.g., "claude-sonnet-4.5")
  system?: boolean; // True if this is an automated system message
  event?: 'agent.spawned' | 'agent.completed' | 'agent.failed' | 'agent.status'; // Event type for system messages
  taskTitle?: string; // Task title for system messages
  duration?: string; // Duration string for completed/failed events (e.g., "2m 44s")
  card?: Record<string, unknown>; // Adaptive Card v1.5 JSON for rich Teams rendering
  threadId?: string; // Root message ID for threaded replies
  replyToId?: string; // Direct parent message ID
  mentions?: SquadMention[]; // Parsed @mentions and explicit mention targets
  links?: SquadMessageLink[]; // Optional task/run/UI links associated with the message
  pinned?: boolean; // Message is pinned for recovery
  decision?: boolean; // Message records a decision
  reactions?: SquadReaction[]; // Lightweight acknowledgements/reactions
  replyCount?: number; // Derived count of direct/indirect replies in the current result set
}

export type SquadMentionKind = 'user' | 'agent' | 'role' | 'owner';

export interface SquadMention {
  target: string;
  kind?: SquadMentionKind;
}

export interface SquadMessageLink {
  taskId?: string;
  runId?: string;
  href?: string;
  label?: string;
}

export interface SquadReaction {
  actor: string;
  reaction: string;
  createdAt: string;
}

/**
 * Input for sending a squad message
 */
export interface SquadMessageInput {
  agent: string;
  message: string;
  tags?: string[];
  model?: string; // Which model generated this message
  system?: boolean; // Mark as system message
  event?: 'agent.spawned' | 'agent.completed' | 'agent.failed' | 'agent.status';
  taskTitle?: string;
  duration?: string;
  card?: Record<string, unknown>; // Adaptive Card v1.5 JSON for rich Teams rendering
  replyToId?: string;
  mentions?: Array<string | SquadMention>;
  taskId?: string;
  runId?: string;
  pinned?: boolean;
  decision?: boolean;
}

export interface SquadUnreadState {
  actor: string;
  lastReadAt?: string;
  lastReadMessageId?: string;
  unreadCount: number;
  mentionCount: number;
  latestUnreadMessageId?: string;
}

export interface SquadSearchResult {
  messageId: string;
  threadId?: string;
  replyToId?: string;
  timestamp: string;
  agent: string;
  displayName?: string;
  snippet: string;
  pinned?: boolean;
  decision?: boolean;
  links?: SquadMessageLink[];
}

export interface SquadSearchResponse {
  query: string;
  results: SquadSearchResult[];
}
