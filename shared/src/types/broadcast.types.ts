/**
 * Broadcast Types
 *
 * Persistent broadcast messages for agent-to-agent communication.
 * Agents can send broadcasts that all other agents pick up.
 */

export type BroadcastPriority = 'info' | 'action-required' | 'urgent';

export interface Broadcast {
  /** Unique identifier (UUID or timestamp-based) */
  id: string;

  /** Broadcast message content */
  message: string;

  /** Priority level */
  priority: BroadcastPriority;

  /** Agent or system that created the broadcast */
  from?: string;

  /** Optional tags for categorization/filtering */
  tags?: string[];

  /** ISO timestamp of creation */
  createdAt: string;

  /** Agents who have marked this broadcast as read */
  readBy: BroadcastReadReceipt[];
}

export interface BroadcastReadReceipt {
  /** Agent name */
  agent: string;

  /** ISO timestamp when marked as read */
  readAt: string;
}

export interface CreateBroadcastRequest {
  message: string;
  priority?: BroadcastPriority;
  from?: string;
  tags?: string[];
}

export interface GetBroadcastsQuery {
  /** ISO timestamp - only return broadcasts created after this time */
  since?: string;

  /** Filter to broadcasts the specified agent hasn't read */
  unread?: boolean;

  /** Agent name (required when unread=true) */
  agent?: string;

  /** Filter by priority */
  priority?: BroadcastPriority;

  /** Maximum number of broadcasts to return */
  limit?: number;
}

export interface MarkReadRequest {
  /** Agent marking the broadcast as read */
  agent: string;
}
