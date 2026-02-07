/**
 * Chat Service
 *
 * Manages chat sessions stored as markdown files with YAML frontmatter.
 * - Task-scoped sessions: .veritas-kanban/chats/task_{taskId}.md
 * - Board-level sessions: .veritas-kanban/chats/sessions/{sessionId}.md
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { nanoid } from 'nanoid';
import type { ChatSession, ChatMessage, SquadMessage } from '@veritas-kanban/shared';
import { withFileLock } from './file-lock.js';
import { validatePathSegment, ensureWithinBase } from '../utils/sanitize.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('chat-service');

// Default paths - resolve to .veritas-kanban/chats/
const DEFAULT_PROJECT_ROOT = path.resolve(process.cwd(), '..');
const DEFAULT_CHATS_DIR = path.join(DEFAULT_PROJECT_ROOT, '.veritas-kanban', 'chats');
const DEFAULT_SESSIONS_DIR = path.join(DEFAULT_CHATS_DIR, 'sessions');
const DEFAULT_SQUAD_DIR = path.join(DEFAULT_CHATS_DIR, 'squad');

export interface ChatServiceOptions {
  chatsDir?: string;
}

export class ChatService {
  private chatsDir: string;
  private sessionsDir: string;
  private squadDir: string;

  constructor(options: ChatServiceOptions = {}) {
    this.chatsDir = options.chatsDir || DEFAULT_CHATS_DIR;
    this.sessionsDir = path.join(this.chatsDir, 'sessions');
    this.squadDir = path.join(this.chatsDir, 'squad');
    this.ensureDirectories();
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
    const messageBlocks = session.messages.map((msg) => {
      const meta = [`**${msg.id}**`, msg.role, msg.timestamp, msg.agent || '', msg.model || '']
        .filter(Boolean)
        .join(' | ');

      return `${meta}\n\n${msg.content}`;
    });

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
      system?: boolean;
      event?: 'agent.spawned' | 'agent.completed' | 'agent.failed' | 'agent.status';
      taskTitle?: string;
      duration?: string;
    },
    displayName?: string
  ): Promise<SquadMessage> {
    const messageId = this.generateMessageId();
    const timestamp = new Date().toISOString();

    const squadMessage: SquadMessage = {
      id: messageId,
      agent: input.agent,
      displayName: displayName,
      message: input.message,
      tags: input.tags,
      timestamp,
      system: input.system,
      event: input.event,
      taskTitle: input.taskTitle,
      duration: input.duration,
    };

    // Store as daily markdown file: squad/YYYY-MM-DD.md
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filePath = path.join(this.squadDir, `${date}.md`);
    ensureWithinBase(this.squadDir, filePath);

    await withFileLock(filePath, async () => {
      let content = '';
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
      const tagsStr = squadMessage.tags?.length ? ` [${squadMessage.tags.join(', ')}]` : '';
      const displayStr = displayName ? ` (${displayName})` : '';
      const taskTitleStr = squadMessage.taskTitle ? ` | ${squadMessage.taskTitle}` : '';
      const durationStr = squadMessage.duration ? ` (${squadMessage.duration})` : '';

      const messageBlock = `## ${squadMessage.agent}${displayStr} | ${messageId} | ${timestamp}${systemTag}${eventTag}${tagsStr}${taskTitleStr}${durationStr}\n\n${squadMessage.message}\n\n---\n\n`;

      content += messageBlock;

      await fs.writeFile(filePath, content, 'utf-8');
    });

    log.info(
      { messageId, agent: input.agent, tags: input.tags, system: input.system },
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

        // Parse messages from markdown
        const messageBlocks = content.split(/\n---\n/);

        for (const block of messageBlocks) {
          if (!block.trim() || block.startsWith('# Squad Chat')) continue;

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

          const tagMatch = bracketMatches.find(
            (value) => value !== 'system' && !value.startsWith('agent.')
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

      if (options.limit && messages.length > options.limit) {
        return messages.slice(-options.limit);
      }

      return messages;
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
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
