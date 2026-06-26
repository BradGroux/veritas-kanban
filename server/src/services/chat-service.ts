/**
 * Chat Service
 *
 * Manages chat sessions stored as markdown files with YAML frontmatter.
 * - Task-scoped sessions: .veritas-kanban/chats/task_{taskId}.md
 * - Board-level sessions: .veritas-kanban/chats/sessions/{sessionId}.md
 */

import fs from 'fs/promises';
import path from 'path';
import matter from '../utils/frontmatter.js';
import { nanoid } from 'nanoid';
import type {
  ChatSession,
  ChatMessage,
  SquadMention,
  SquadMessage,
  SquadMessageLink,
  SquadReaction,
  SquadSearchResponse,
  SquadUnreadState,
} from '@veritas-kanban/shared';
import { withFileLock } from './file-lock.js';
import { getNotificationService, parseMentions } from './notification-service.js';
import { validatePathSegment, ensureWithinBase } from '../utils/sanitize.js';
import { createLogger } from '../lib/logger.js';
import { redactString } from '../lib/redact.js';
import { getChatsDir } from '../utils/paths.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteChatRepository } from '../storage/sqlite/chat-repository.js';

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

interface SquadMessageMetadata {
  threadId?: string;
  replyToId?: string;
  mentions?: SquadMention[];
  links?: SquadMessageLink[];
  pinned?: boolean;
  decision?: boolean;
  reactions?: SquadReaction[];
  updatedAt?: string;
}

interface SquadReadMetadata {
  actor: string;
  lastReadAt?: string;
  lastReadMessageId?: string;
  updatedAt: string;
}

interface SquadMetadataFile {
  version: 1;
  messages: Record<string, SquadMessageMetadata>;
  reads: Record<string, SquadReadMetadata>;
  updatedAt: string;
}

export class ChatService {
  private chatsDir: string;
  private sessionsDir: string;
  private squadDir: string;
  private readonly repository: SqliteChatRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;

  constructor(options: ChatServiceOptions = {}) {
    this.chatsDir = options.chatsDir || DEFAULT_CHATS_DIR;
    this.sessionsDir = path.join(this.chatsDir, 'sessions');
    this.squadDir = path.join(this.chatsDir, 'squad');
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteChatRepository(this.sqliteDatabase);
    }

    if (!this.repository) {
      this.ensureDirectories();
    }
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.chatsDir, { recursive: true });
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.mkdir(this.squadDir, { recursive: true });
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
   * Get file path for a session.
   * Validates path segments to prevent directory traversal.
   */
  private getSessionPath(sessionId: string, taskId?: string): string {
    if (taskId) {
      validatePathSegment(taskId);
      const filePath = path.join(this.chatsDir, `task_${taskId}.md`);
      ensureWithinBase(this.chatsDir, filePath);
      return filePath;
    }
    validatePathSegment(sessionId);
    const filePath = path.join(this.sessionsDir, `${sessionId}.md`);
    ensureWithinBase(this.sessionsDir, filePath);
    return filePath;
  }

  /**
   * Parse a session from markdown file
   */
  private parseSession(filePath: string, content: string): ChatSession {
    const { data, content: markdown } = matter(content);

    // Parse messages from markdown (simple format: role + content blocks)
    const messages: ChatMessage[] = [];
    const messageBlocks = markdown.split(/\n---\n/);

    for (const block of messageBlocks) {
      if (!block.trim()) continue;

      const lines = block.trim().split('\n');
      const metaLine = lines[0];
      const messageContent = lines.slice(1).join('\n').trim();

      // Parse meta line: **id** | role | timestamp | [agent] | [model]
      const match = metaLine.match(
        /^\*\*(.+?)\*\*\s*\|\s*(\w+)\s*\|\s*(.+?)(?:\s*\|\s*(.+?))?(?:\s*\|\s*(.+?))?$/
      );

      if (match) {
        const [, id, role, timestamp, agent, model] = match;
        messages.push({
          id,
          role: role as 'user' | 'assistant' | 'system',
          content: messageContent,
          timestamp,
          agent: agent || undefined,
          model: model || undefined,
        });
      }
    }

    return {
      id: data.id,
      taskId: data.taskId,
      title: data.title,
      messages,
      agent: data.agent,
      model: data.model,
      mode: data.mode || 'ask',
      created: data.created,
      updated: data.updated,
    };
  }

  /**
   * Serialize a session to markdown with YAML frontmatter
   */
  private serializeSession(session: ChatSession): string {
    const frontmatter = {
      id: session.id,
      taskId: session.taskId,
      title: session.title,
      agent: session.agent,
      model: session.model,
      mode: session.mode,
      created: session.created,
      updated: session.updated,
    };

    // Remove undefined values
    Object.keys(frontmatter).forEach((key) => {
      if (frontmatter[key as keyof typeof frontmatter] === undefined) {
        delete frontmatter[key as keyof typeof frontmatter];
      }
    });

    // Serialize messages as markdown blocks
    const messageBlocks = session.messages.map(
      (msg: {
        id: string;
        role: string;
        content: string;
        timestamp: string;
        agent?: string;
        model?: string;
      }) => {
        const meta = [`**${msg.id}**`, msg.role, msg.timestamp, msg.agent || '', msg.model || '']
          .filter(Boolean)
          .join(' | ');

        return `${meta}\n\n${msg.content}`;
      }
    );

    const markdown = messageBlocks.join('\n\n---\n\n');

    return matter.stringify(markdown, frontmatter);
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    // Try to find the session file (could be task-scoped or board-level)
    // First check if it's a task-scoped session
    const taskMatch = sessionId.match(/^task_(.+)$/);
    if (this.repository) {
      if (taskMatch) {
        validatePathSegment(taskMatch[1]);
      } else {
        validatePathSegment(sessionId);
      }
      return this.repository.getSession(sessionId);
    }

    if (taskMatch) {
      const taskId = taskMatch[1];
      const filePath = this.getSessionPath(sessionId, taskId);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return this.parseSession(filePath, content);
      } catch (err: any) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    }

    // Board-level session
    const filePath = this.getSessionPath(sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseSession(filePath, content);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Get the session for a specific task
   */
  async getSessionForTask(taskId: string): Promise<ChatSession | null> {
    if (this.repository) {
      validatePathSegment(taskId);
      return this.repository.getSessionForTask(taskId);
    }

    const filePath = this.getSessionPath(`task_${taskId}`, taskId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseSession(filePath, content);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * List all sessions (board-level only)
   */
  async listSessions(): Promise<ChatSession[]> {
    if (this.repository) {
      return this.repository.listBoardSessions();
    }

    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessions: ChatSession[] = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = path.join(this.sessionsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        sessions.push(this.parseSession(filePath, content));
      }

      // Sort by updated time (newest first)
      sessions.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

      return sessions;
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
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

    if (this.repository) {
      this.repository.saveSession(session);
      log.info({ sessionId, taskId: input.taskId }, 'Created chat session');
      return session;
    }

    const filePath = this.getSessionPath(sessionId, input.taskId);
    const content = this.serializeSession(session);

    await withFileLock(filePath, async () => {
      await fs.writeFile(filePath, content, 'utf-8');
    });

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

    // Determine file path - need to check both task-scoped and board-level paths
    const taskMatch = sessionId.match(/^task_(.+)$/);
    const taskId = taskMatch ? taskMatch[1] : undefined;
    if (this.repository) {
      if (taskId) {
        validatePathSegment(taskId);
      } else {
        validatePathSegment(sessionId);
      }

      const session = await this.repository.getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      session.messages.push(newMessage);
      session.updated = newMessage.timestamp;
      this.repository.saveSession(session);

      log.debug({ sessionId, messageId: newMessage.id, role: newMessage.role }, 'Added message');
      return newMessage;
    }

    const filePath = this.getSessionPath(sessionId, taskId);

    await withFileLock(filePath, async () => {
      const session = await this.getSession(sessionId);

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      session.messages.push(newMessage);
      session.updated = newMessage.timestamp;

      const content = this.serializeSession(session);
      await fs.writeFile(filePath, content, 'utf-8');
    });

    log.debug({ sessionId, messageId: newMessage.id, role: newMessage.role }, 'Added message');

    return newMessage;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    // Determine file path - need to check both task-scoped and board-level paths
    const taskMatch = sessionId.match(/^task_(.+)$/);
    const taskId = taskMatch ? taskMatch[1] : undefined;
    if (this.repository) {
      if (taskId) {
        validatePathSegment(taskId);
      } else {
        validatePathSegment(sessionId);
      }

      if (!this.repository.deleteSession(sessionId)) {
        log.info({ sessionId }, 'Chat session already deleted or never existed');
        return;
      }

      log.info({ sessionId }, 'Deleted chat session');
      return;
    }

    const filePath = this.getSessionPath(sessionId, taskId);

    await withFileLock(filePath, async () => {
      const session = await this.getSession(sessionId);

      if (!session) {
        // Already gone — treat as success
        log.info({ sessionId }, 'Chat session already deleted or never existed');
        return;
      }

      try {
        await fs.unlink(filePath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }

      log.info({ sessionId }, 'Deleted chat session');
    });
  }

  private getSquadMetadataPath(): string {
    const filePath = path.join(this.squadDir, 'metadata.json');
    ensureWithinBase(this.squadDir, filePath);
    return filePath;
  }

  private emptySquadMetadata(): SquadMetadataFile {
    return {
      version: 1,
      messages: {},
      reads: {},
      updatedAt: new Date().toISOString(),
    };
  }

  private async readSquadMetadataFromPath(filePath: string): Promise<SquadMetadataFile> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<SquadMetadataFile>;
      return {
        version: 1,
        messages: parsed.messages && typeof parsed.messages === 'object' ? parsed.messages : {},
        reads: parsed.reads && typeof parsed.reads === 'object' ? parsed.reads : {},
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') return this.emptySquadMetadata();
      throw err;
    }
  }

  private async readSquadMetadata(): Promise<SquadMetadataFile> {
    return this.readSquadMetadataFromPath(this.getSquadMetadataPath());
  }

  private async updateSquadMetadata<T>(
    mutator: (metadata: SquadMetadataFile) => T | Promise<T>
  ): Promise<T> {
    const filePath = this.getSquadMetadataPath();
    await fs.mkdir(this.squadDir, { recursive: true });

    return withFileLock(filePath, async () => {
      const metadata = await this.readSquadMetadataFromPath(filePath);
      const result = await mutator(metadata);
      metadata.updatedAt = new Date().toISOString();
      await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
      return result;
    });
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

  private buildLinks(input: { taskId?: string; runId?: string }): SquadMessageLink[] | undefined {
    const links: SquadMessageLink[] = [];
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
      pinned?: boolean;
      decision?: boolean;
    },
    displayName?: string
  ): Promise<SquadMessage> {
    const messageId = this.generateMessageId();
    const timestamp = new Date().toISOString();
    const parentMessage = input.replyToId ? await this.findSquadMessage(input.replyToId) : null;
    const mentions = this.normalizeMentions({
      message: input.message,
      mentions: input.mentions,
      fromAgent: input.agent,
    });
    const links = this.buildLinks({ taskId: input.taskId, runId: input.runId });
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
    };

    if (this.repository) {
      this.repository.appendSquadMessage(squadMessage);
    } else {
      // Store as daily markdown file: squad/YYYY-MM-DD.md
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const filePath = path.join(this.squadDir, `${date}.md`);
      ensureWithinBase(this.squadDir, filePath);

      await withFileLock(filePath, async () => {
        let content: string;
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch (err: any) {
          if (err.code !== 'ENOENT') throw err;
          // File doesn't exist yet — create with header
          content = `# Squad Chat — ${date}\n\n`;
        }

        // Append the new message in a consistent format
        const systemTag = squadMessage.system ? ' [system]' : '';
        const eventTag = squadMessage.event ? ` [${squadMessage.event}]` : '';
        const modelTag = squadMessage.model ? ` [model:${squadMessage.model}]` : '';
        const tagsStr = squadMessage.tags?.length ? ` [${squadMessage.tags.join(', ')}]` : '';
        const displayStr = displayName ? ` (${displayName})` : '';
        const taskTitleStr = squadMessage.taskTitle ? ` | ${squadMessage.taskTitle}` : '';
        const durationStr = squadMessage.duration ? ` (${squadMessage.duration})` : '';

        const messageBlock = `## ${squadMessage.agent}${displayStr} | ${messageId} | ${timestamp}${systemTag}${eventTag}${modelTag}${tagsStr}${taskTitleStr}${durationStr}\n\n${squadMessage.message}\n\n---\n\n`;

        content += messageBlock;

        await fs.writeFile(filePath, content, 'utf-8');
      });
    }

    const messageMetadata: SquadMessageMetadata = {
      threadId: squadMessage.threadId,
      replyToId: squadMessage.replyToId,
      mentions: squadMessage.mentions,
      links: squadMessage.links,
      pinned: squadMessage.pinned,
      decision: squadMessage.decision,
      updatedAt: this.hasSquadMessageMetadata({
        threadId: squadMessage.threadId,
        replyToId: squadMessage.replyToId,
        mentions: squadMessage.mentions,
        links: squadMessage.links,
        pinned: squadMessage.pinned,
        decision: squadMessage.decision,
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

    if (this.repository) {
      return this.applySquadMetadata(
        this.repository.listSquadMessages({
          ...options,
          limit: safeLimit,
        })
      );
    }

    const messages: SquadMessage[] = [];
    const includeSystem = options.includeSystem !== false; // Default to true
    const sinceTimestamp = options.since ? Date.parse(options.since) : null;

    try {
      // Read all daily squad files
      const files = (await fs.readdir(this.squadDir))
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse(); // Newest first

      for (const file of files) {
        const filePath = path.join(this.squadDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const body = content.replace(/^#\s+Squad Chat[^\n]*\n+/, '');

        // Parse messages from markdown
        const messageBlocks = body.split(/\n---\n/);

        for (const block of messageBlocks) {
          if (!block.trim()) continue;

          const lines = block.trim().split('\n');
          const headerLine = lines[0];
          const normalizedHeader = headerLine.replace(/^##\s+/, '');
          const headerParts = normalizedHeader.split('|').map((part) => part.trim());

          if (headerParts.length < 3) continue;

          const [agentPart, idPart, metaPart, taskPart] = headerParts;
          if (!agentPart || !idPart || !metaPart) continue;

          const agentMatch = agentPart.match(/^(.+?)(?:\s+\((.+?)\))?$/);
          if (!agentMatch) continue;

          const agent = agentMatch[1].trim();
          const displayName = agentMatch[2]?.trim();

          const bracketMatches = [...metaPart.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
          const isSystem = bracketMatches.includes('system');
          if (!includeSystem && isSystem) continue;

          const eventMatch = bracketMatches.find((value) => value.startsWith('agent.'));
          const event = eventMatch ? (eventMatch as SquadMessage['event']) : undefined;

          const modelMatch = bracketMatches.find((value) => value.startsWith('model:'));
          const model = modelMatch ? modelMatch.replace('model:', '') : undefined;

          const tagMatch = bracketMatches.find(
            (value) =>
              value !== 'system' && !value.startsWith('agent.') && !value.startsWith('model:')
          );
          const tags = tagMatch
            ? tagMatch
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
            : undefined;

          let timestampSegment = metaPart.replace(/\[.*?\]/g, '').trim();
          let duration: string | undefined;

          if (!taskPart) {
            const durationMatch = timestampSegment.match(/\(([^)]+)\)\s*$/);
            if (durationMatch) {
              duration = durationMatch[1];
              timestampSegment = timestampSegment.replace(/\(([^)]+)\)\s*$/, '').trim();
            }
          }

          const timestamp = timestampSegment;
          if (!timestamp) continue;

          let taskTitle: string | undefined;
          if (taskPart) {
            const durationMatch = taskPart.match(/\(([^)]+)\)\s*$/);
            if (durationMatch) {
              duration = durationMatch[1];
            }
            const title = taskPart.replace(/\(([^)]+)\)\s*$/, '').trim();
            taskTitle = title || undefined;
          }

          const messageBody = lines.slice(1).join('\n').trim();

          const squadMessage: SquadMessage = {
            id: idPart,
            agent,
            displayName: displayName || undefined,
            message: messageBody,
            tags,
            timestamp,
            model,
            system: isSystem ? true : undefined,
            event,
            taskTitle,
            duration,
          };

          const numericTimestamp = Date.parse(timestamp);
          if (
            sinceTimestamp &&
            !Number.isNaN(numericTimestamp) &&
            numericTimestamp < sinceTimestamp
          ) {
            continue;
          }

          if (options.agent && squadMessage.agent !== options.agent) continue;

          messages.push(squadMessage);
        }
      }

      const getTime = (ts: string) => {
        const value = Date.parse(ts);
        return Number.isNaN(value) ? 0 : value;
      };

      messages.sort((a, b) => getTime(a.timestamp) - getTime(b.timestamp));

      if (safeLimit && messages.length > safeLimit) {
        return this.applySquadMetadata(messages.slice(-safeLimit));
      }

      return this.applySquadMetadata(messages);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
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
