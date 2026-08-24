/**
 * Chat Service
 *
 * Manages chat sessions through file or SQLite repositories.
 * The file repository preserves the Markdown/YAML compatibility format.
 * - Task-scoped sessions: .veritas-kanban/chats/task_{taskId}.md
 * - Board-level sessions: .veritas-kanban/chats/sessions/{sessionId}.md
 */

import { nanoid } from 'nanoid';
import type {
  ChatSession,
  ChatMessage,
  SquadMention,
  SquadExternalMessage,
  SquadMessage,
  SquadMessageLink,
  SquadSearchResponse,
  SquadUnreadState,
} from '@veritas-kanban/shared';
import { getNotificationService, parseMentions } from './notification-service.js';
import { validatePathSegment } from '../utils/sanitize.js';
import { createLogger } from '../lib/logger.js';
import { redactString } from '../lib/redact.js';
import { getChatsDir } from '../utils/paths.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteChatRepository } from '../storage/sqlite/chat-repository.js';
import {
  FileChatRepository,
  type ChatRepository,
  type SquadMessageMetadata,
  type SquadMetadataFile,
  type SquadMetadataRepository,
} from '../storage/chat-repository.js';

const log = createLogger('chat-service');
const SQUAD_SEARCH_LIMIT_MAX = 50;
const SQUAD_MESSAGE_LIMIT_MAX = 500;
const SQUAD_SNIPPET_LENGTH = 180;

// Default paths - resolve via shared paths helper to .veritas-kanban/chats/
const DEFAULT_CHATS_DIR = getChatsDir();

export interface ChatServiceOptions {
  chatsDir?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
}

export class ChatService {
  private readonly repository: ChatRepository;
  private readonly squadMetadataRepository: SquadMetadataRepository;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;

  constructor(options: ChatServiceOptions = {}) {
    const chatsDir = options.chatsDir || DEFAULT_CHATS_DIR;
    const fileRepository = new FileChatRepository(chatsDir);
    this.squadMetadataRepository = fileRepository;
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteChatRepository(this.sqliteDatabase);
    } else {
      this.repository = fileRepository;
    }
  }

  /**
   * Generate a new session ID
   */
  private generateSessionId(): string {
    return `chat_${nanoid(12)}`;
  }

  /**
   * Generate a new message ID
   */
  private generateMessageId(): string {
    return `msg_${nanoid(10)}`;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    const taskMatch = sessionId.match(/^task_(.+)$/);
    if (taskMatch) {
      validatePathSegment(taskMatch[1]);
    } else {
      validatePathSegment(sessionId);
    }
    return this.repository.getSession(sessionId);
  }

  /**
   * Get the session for a specific task
   */
  async getSessionForTask(taskId: string): Promise<ChatSession | null> {
    validatePathSegment(taskId);
    return this.repository.getSessionForTask(taskId);
  }

  /**
   * List all sessions (board-level only)
   */
  async listSessions(): Promise<ChatSession[]> {
    return this.repository.listBoardSessions();
  }

  /**
   * Create a new session
   */
  async createSession(input: {
    taskId?: string;
    agent: string;
    mode?: 'ask' | 'build';
  }): Promise<ChatSession> {
    if (input.taskId) {
      validatePathSegment(input.taskId);
    }

    const sessionId = input.taskId ? `task_${input.taskId}` : this.generateSessionId();
    const now = new Date().toISOString();

    const session: ChatSession = {
      id: sessionId,
      taskId: input.taskId,
      title: input.taskId ? `Task ${input.taskId}` : 'New Conversation',
      messages: [],
      agent: input.agent,
      mode: input.mode || 'ask',
      created: now,
      updated: now,
    };

    await this.repository.saveSession(session);
    log.info({ sessionId, taskId: input.taskId }, 'Created chat session');
    return session;
  }

  /**
   * Add a message to a session
   */
  async addMessage(
    sessionId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'>
  ): Promise<ChatMessage> {
    const newMessage: ChatMessage = {
      id: this.generateMessageId(),
      timestamp: new Date().toISOString(),
      ...message,
    };

    const taskMatch = sessionId.match(/^task_(.+)$/);
    const taskId = taskMatch ? taskMatch[1] : undefined;
    if (taskId) {
      validatePathSegment(taskId);
    } else {
      validatePathSegment(sessionId);
    }
    if (!(await this.repository.appendSessionMessage(sessionId, newMessage))) {
      throw new Error(`Session ${sessionId} not found`);
    }
    log.debug({ sessionId, messageId: newMessage.id, role: newMessage.role }, 'Added message');
    return newMessage;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const taskMatch = sessionId.match(/^task_(.+)$/);
    const taskId = taskMatch ? taskMatch[1] : undefined;
    if (taskId) {
      validatePathSegment(taskId);
    } else {
      validatePathSegment(sessionId);
    }
    if (!(await this.repository.deleteSession(sessionId))) {
      log.info({ sessionId }, 'Chat session already deleted or never existed');
      return;
    }
    log.info({ sessionId }, 'Deleted chat session');
  }

  private async readSquadMetadata(): Promise<SquadMetadataFile> {
    return this.squadMetadataRepository.readSquadMetadata();
  }

  private async updateSquadMetadata<T>(
    mutator: (metadata: SquadMetadataFile) => T | Promise<T>
  ): Promise<T> {
    return this.squadMetadataRepository.updateSquadMetadata(mutator);
  }

  private normalizeActor(actor: string): string {
    return actor.trim().toLowerCase();
  }

  private normalizeMentions(input: {
    message: string;
    mentions?: Array<string | SquadMention>;
    fromAgent: string;
  }): SquadMention[] {
    const parsedMentions = parseMentions(input.message).map<SquadMention>((target) => ({
      target,
    }));
    const explicitMentions = (input.mentions ?? []).map<SquadMention>((mention) =>
      typeof mention === 'string'
        ? { target: mention.trim().replace(/^@/, '') }
        : { target: mention.target.trim().replace(/^@/, ''), kind: mention.kind }
    );

    const seen = new Set<string>();
    const fromAgent = this.normalizeActor(input.fromAgent);
    const mentions: SquadMention[] = [];
    for (const mention of [...parsedMentions, ...explicitMentions]) {
      const target = mention.target.trim().replace(/^@/, '').toLowerCase();
      if (!target || target === fromAgent || seen.has(target)) continue;
      seen.add(target);
      mentions.push({ target, kind: mention.kind });
    }
    return mentions;
  }

  private buildLinks(input: {
    taskId?: string;
    runId?: string;
    links?: SquadMessageLink[];
  }): SquadMessageLink[] | undefined {
    const links: SquadMessageLink[] = [...(input.links ?? []).slice(0, 20)];
    if (input.taskId) links.push({ taskId: input.taskId, label: `Task ${input.taskId}` });
    if (input.runId) links.push({ runId: input.runId, label: `Run ${input.runId}` });
    return links.length > 0 ? links : undefined;
  }

  private hasSquadMessageMetadata(metadata: SquadMessageMetadata): boolean {
    return Object.values(metadata).some((value) => value !== undefined);
  }

  private async applySquadMetadata(messages: SquadMessage[]): Promise<SquadMessage[]> {
    const metadata = await this.readSquadMetadata();
    const merged = messages.map((message) => {
      const overlay = metadata.messages[message.id];
      if (!overlay) return message;

      const { updatedAt: _updatedAt, ...messageOverlay } = overlay;
      return {
        ...message,
        ...messageOverlay,
        reactions: overlay.reactions ?? message.reactions,
      };
    });

    const replyCounts = new Map<string, number>();
    for (const message of merged) {
      if (!message.replyToId) continue;
      const threadId = message.threadId ?? message.replyToId;
      replyCounts.set(threadId, (replyCounts.get(threadId) ?? 0) + 1);
    }

    return merged.map((message) => ({
      ...message,
      replyCount: replyCounts.get(message.id) ?? message.replyCount,
    }));
  }

  private async findSquadMessage(messageId: string): Promise<SquadMessage | null> {
    const messages = await this.getSquadMessages({ includeSystem: true });
    return messages.find((message) => message.id === messageId) ?? null;
  }

  private buildSearchSnippet(message: string, query: string): string {
    const safeMessage = redactString(message).replace(/\s+/g, ' ').trim();
    if (!safeMessage) return '';

    const index = safeMessage.toLowerCase().indexOf(query.toLowerCase());
    const start = index > 40 ? index - 40 : 0;
    const snippet = safeMessage.slice(start, start + SQUAD_SNIPPET_LENGTH).trim();
    const prefix = start > 0 ? '...' : '';
    const suffix = start + SQUAD_SNIPPET_LENGTH < safeMessage.length ? '...' : '';
    return `${prefix}${snippet}${suffix}`;
  }

  private async createMentionNotifications(message: SquadMessage): Promise<void> {
    if (!message.mentions?.length) return;

    const notificationService = getNotificationService();
    const snippet = this.buildSearchSnippet(message.message, message.mentions[0]?.target ?? '');
    const content = snippet || redactString(message.message).slice(0, SQUAD_SNIPPET_LENGTH);

    await Promise.all(
      message.mentions.map((mention) =>
        notificationService.createNotification({
          type: 'squad_mention',
          title: `Squad Chat mention from ${message.displayName || message.agent}`,
          message: content,
          taskId: message.links?.find((link) => link.taskId)?.taskId ?? 'squad-chat',
          targetAgent: mention.target,
          fromAgent: message.agent,
          targetUrl: `/chat/squad?messageId=${encodeURIComponent(message.id)}`,
          dedupeKey: `squad:${message.id}:${mention.target}`,
          source: {
            kind: 'squad-chat',
            messageId: message.id,
            threadId: message.threadId ?? message.id,
            mentionTarget: mention.target,
          },
        })
      )
    );
  }

  /**
   * ============================================================
   * SQUAD CHAT METHODS
   * Agent-to-agent communication channel (not task-scoped)
   * ============================================================
   */

  /**
   * Send a message to the squad channel
   */
  async sendSquadMessage(
    input: {
      id?: string;
      timestamp?: string;
      agent: string;
      message: string;
      tags?: string[];
      model?: string;
      system?: boolean;
      event?: 'agent.spawned' | 'agent.completed' | 'agent.failed' | 'agent.status';
      taskTitle?: string;
      duration?: string;
      card?: Record<string, unknown>;
      replyToId?: string;
      mentions?: Array<string | SquadMention>;
      taskId?: string;
      runId?: string;
      links?: SquadMessageLink[];
      pinned?: boolean;
      decision?: boolean;
      external?: SquadExternalMessage;
    },
    displayName?: string
  ): Promise<SquadMessage> {
    const messageId = input.id ?? this.generateMessageId();
    validatePathSegment(messageId);
    if (input.id) {
      const existing = await this.findSquadMessage(messageId);
      if (existing) return existing;
    }
    const parsedTimestamp = input.timestamp ? Date.parse(input.timestamp) : Date.now();
    if (!Number.isFinite(parsedTimestamp)) {
      throw new Error('Squad message timestamp is invalid');
    }
    const timestamp = new Date(parsedTimestamp).toISOString();
    const parentMessage = input.replyToId ? await this.findSquadMessage(input.replyToId) : null;
    const mentions = this.normalizeMentions({
      message: input.message,
      mentions: input.mentions,
      fromAgent: input.agent,
    });
    const links = this.buildLinks({
      taskId: input.taskId,
      runId: input.runId,
      links: input.links,
    });
    const threadId = input.replyToId
      ? (parentMessage?.threadId ?? parentMessage?.id ?? input.replyToId)
      : undefined;

    const squadMessage: SquadMessage = {
      id: messageId,
      agent: input.agent,
      displayName: displayName,
      message: input.message,
      tags: input.tags,
      timestamp,
      model: input.model,
      system: input.system,
      event: input.event,
      taskTitle: input.taskTitle,
      duration: input.duration,
      ...(input.card && { card: input.card }),
      ...(threadId && { threadId }),
      ...(input.replyToId && { replyToId: input.replyToId }),
      ...(mentions.length > 0 && { mentions }),
      ...(links && { links }),
      ...(input.pinned !== undefined && { pinned: input.pinned }),
      ...(input.decision !== undefined && { decision: input.decision }),
      ...(input.external && { external: input.external }),
    };

    await this.repository.appendSquadMessage(squadMessage);

    const messageMetadata: SquadMessageMetadata = {
      threadId: squadMessage.threadId,
      replyToId: squadMessage.replyToId,
      mentions: squadMessage.mentions,
      links: squadMessage.links,
      pinned: squadMessage.pinned,
      decision: squadMessage.decision,
      external: squadMessage.external,
      updatedAt: this.hasSquadMessageMetadata({
        threadId: squadMessage.threadId,
        replyToId: squadMessage.replyToId,
        mentions: squadMessage.mentions,
        links: squadMessage.links,
        pinned: squadMessage.pinned,
        decision: squadMessage.decision,
        external: squadMessage.external,
      })
        ? timestamp
        : undefined,
    };

    if (this.hasSquadMessageMetadata(messageMetadata)) {
      await this.updateSquadMetadata((metadata) => {
        metadata.messages[messageId] = messageMetadata;
      });
    }

    await this.createMentionNotifications(squadMessage);

    log.info(
      {
        messageId,
        agent: input.agent,
        tags: input.tags,
        model: input.model,
        system: input.system,
        mentions: squadMessage.mentions?.map((mention) => mention.target),
        replyToId: squadMessage.replyToId,
      },
      'Squad message sent'
    );

    return squadMessage;
  }

  /**
   * Get squad messages with optional filters
   */
  async getSquadMessages(
    options: {
      since?: string; // ISO timestamp
      agent?: string;
      limit?: number;
      includeSystem?: boolean;
    } = {}
  ): Promise<SquadMessage[]> {
    const safeLimit =
      options.limit && options.limit > 0
        ? Math.min(Math.floor(options.limit), SQUAD_MESSAGE_LIMIT_MAX)
        : undefined;

    return this.applySquadMetadata(
      await this.repository.listSquadMessages({
        ...options,
        limit: safeLimit,
      })
    );
  }

  async getSquadThread(messageId: string): Promise<SquadMessage[]> {
    const messages = await this.getSquadMessages({ includeSystem: true });
    const selected = messages.find((message) => message.id === messageId);
    if (!selected) return [];

    const threadId = selected.threadId ?? selected.id;
    return messages.filter(
      (message) =>
        message.id === threadId || message.threadId === threadId || message.id === messageId
    );
  }

  async searchSquadMessages(options: {
    query: string;
    limit?: number;
    includeSystem?: boolean;
    agent?: string;
  }): Promise<SquadSearchResponse> {
    const query = options.query.trim();
    const limit = Math.min(
      Math.max(options.limit ? Math.floor(options.limit) : 20, 1),
      SQUAD_SEARCH_LIMIT_MAX
    );
    if (!query) return { query, results: [] };

    const messages = await this.getSquadMessages({
      includeSystem: options.includeSystem,
      agent: options.agent,
    });
    const normalizedQuery = query.toLowerCase();
    const results = messages
      .filter((message) => {
        const safeFields = [
          redactString(message.message),
          message.agent,
          message.displayName,
          message.tags?.join(' '),
          message.taskTitle,
          message.links?.map((link) => [link.label, link.taskId, link.runId].join(' ')).join(' '),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return safeFields.includes(normalizedQuery);
      })
      .slice(-limit)
      .map((message) => ({
        messageId: message.id,
        threadId: message.threadId,
        replyToId: message.replyToId,
        timestamp: message.timestamp,
        agent: message.agent,
        displayName: message.displayName,
        snippet: this.buildSearchSnippet(message.message, query),
        pinned: message.pinned,
        decision: message.decision,
        links: message.links,
      }));

    return { query, results };
  }

  async getSquadUnreadState(actor: string): Promise<SquadUnreadState> {
    const normalizedActor = this.normalizeActor(actor);
    const metadata = await this.readSquadMetadata();
    const readState = metadata.reads[normalizedActor];
    const lastReadTime = readState?.lastReadAt ? Date.parse(readState.lastReadAt) : 0;
    const messages = await this.getSquadMessages({ includeSystem: true });
    const unreadMessages = messages.filter((message) => {
      const timestamp = Date.parse(message.timestamp);
      const messageActor = this.normalizeActor(message.agent);
      if (Number.isNaN(timestamp) || timestamp <= lastReadTime) return false;
      return messageActor !== normalizedActor;
    });
    const mentionCount = unreadMessages.filter((message) =>
      message.mentions?.some((mention) => this.normalizeActor(mention.target) === normalizedActor)
    ).length;
    const latestUnreadMessage = unreadMessages[unreadMessages.length - 1];

    return {
      actor,
      lastReadAt: readState?.lastReadAt,
      lastReadMessageId: readState?.lastReadMessageId,
      unreadCount: unreadMessages.length,
      mentionCount,
      latestUnreadMessageId: latestUnreadMessage?.id,
    };
  }

  async markSquadRead(input: { actor: string; messageId?: string }): Promise<SquadUnreadState> {
    const normalizedActor = this.normalizeActor(input.actor);
    const messages = await this.getSquadMessages({ includeSystem: true });
    const targetMessage = input.messageId
      ? messages.find((message) => message.id === input.messageId)
      : messages[messages.length - 1];
    const timestamp = targetMessage?.timestamp ?? new Date().toISOString();

    await this.updateSquadMetadata((metadata) => {
      metadata.reads[normalizedActor] = {
        actor: input.actor,
        lastReadAt: timestamp,
        lastReadMessageId: targetMessage?.id,
        updatedAt: new Date().toISOString(),
      };
    });

    return this.getSquadUnreadState(input.actor);
  }

  async updateSquadMessageState(
    messageId: string,
    update: { pinned?: boolean; decision?: boolean }
  ): Promise<SquadMessage | null> {
    const existing = await this.findSquadMessage(messageId);
    if (!existing) return null;

    await this.updateSquadMetadata((metadata) => {
      const current = metadata.messages[messageId] ?? {};
      metadata.messages[messageId] = {
        ...current,
        pinned: update.pinned ?? current.pinned,
        decision: update.decision ?? current.decision,
        updatedAt: new Date().toISOString(),
      };
    });

    return this.findSquadMessage(messageId);
  }

  async addSquadReaction(input: {
    messageId: string;
    actor: string;
    reaction: string;
  }): Promise<SquadMessage | null> {
    const existing = await this.findSquadMessage(input.messageId);
    if (!existing) return null;

    await this.updateSquadMetadata((metadata) => {
      const current = metadata.messages[input.messageId] ?? {};
      const reactions = (current.reactions ?? []).filter(
        (reaction) =>
          !(
            this.normalizeActor(reaction.actor) === this.normalizeActor(input.actor) &&
            reaction.reaction === input.reaction
          )
      );
      reactions.push({
        actor: input.actor,
        reaction: input.reaction,
        createdAt: new Date().toISOString(),
      });
      metadata.messages[input.messageId] = {
        ...current,
        reactions,
        updatedAt: new Date().toISOString(),
      };
    });

    return this.findSquadMessage(input.messageId);
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }
}

// Singleton instance
let chatService: ChatService | null = null;

export function getChatService(): ChatService {
  if (!chatService) {
    chatService = new ChatService();
  }
  return chatService;
}
