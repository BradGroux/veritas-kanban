import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  ChatMessage,
  ChatSession,
  SquadExternalMessage,
  SquadMention,
  SquadMessage,
  SquadMessageLink,
  SquadReaction,
} from '@veritas-kanban/shared';
import matter from '../utils/frontmatter.js';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_CHAT_SESSION_BYTES = 16 * 1024 * 1024;
const MAX_SQUAD_DAY_BYTES = 32 * 1024 * 1024;
const MAX_SQUAD_METADATA_BYTES = 16 * 1024 * 1024;

type MaybePromise<T> = T | Promise<T>;

export interface SquadMessageMetadata {
  threadId?: string;
  replyToId?: string;
  mentions?: SquadMention[];
  links?: SquadMessageLink[];
  pinned?: boolean;
  decision?: boolean;
  reactions?: SquadReaction[];
  external?: SquadExternalMessage;
  updatedAt?: string;
}

export interface SquadReadMetadata {
  actor: string;
  lastReadAt?: string;
  lastReadMessageId?: string;
  updatedAt: string;
}

export interface SquadMetadataFile {
  version: 1;
  messages: Record<string, SquadMessageMetadata>;
  reads: Record<string, SquadReadMetadata>;
  updatedAt: string;
}

export interface SquadMessageListOptions {
  since?: string;
  agent?: string;
  limit?: number;
  includeSystem?: boolean;
}

export interface ChatRepository {
  getSession(sessionId: string): MaybePromise<ChatSession | null>;
  getSessionForTask(taskId: string): MaybePromise<ChatSession | null>;
  listBoardSessions(): MaybePromise<ChatSession[]>;
  saveSession(session: ChatSession): MaybePromise<void>;
  appendSessionMessage(sessionId: string, message: ChatMessage): MaybePromise<boolean>;
  deleteSession(sessionId: string): MaybePromise<boolean>;
  appendSquadMessage(message: SquadMessage): MaybePromise<void>;
  listSquadMessages(options?: SquadMessageListOptions): MaybePromise<SquadMessage[]>;
}

export interface SquadMetadataRepository {
  readSquadMetadata(): Promise<SquadMetadataFile>;
  updateSquadMetadata<T>(mutator: (metadata: SquadMetadataFile) => T | Promise<T>): Promise<T>;
}

export class FileChatRepository implements ChatRepository, SquadMetadataRepository {
  private readonly chatsDir: string;
  private readonly sessionsDir: string;
  private readonly squadDir: string;
  private directorySetup: Promise<void> | null = null;

  constructor(chatsDir: string) {
    this.chatsDir = path.resolve(chatsDir);
    this.sessionsDir = ensureWithinBase(this.chatsDir, path.join(this.chatsDir, 'sessions'));
    this.squadDir = ensureWithinBase(this.chatsDir, path.join(this.chatsDir, 'squad'));
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    await this.ensureReady();
    const taskMatch = sessionId.match(/^task_(.+)$/);
    const filePath = this.sessionPath(sessionId, taskMatch?.[1]);
    const content = await this.readOptionalBoundedFile(
      filePath,
      MAX_CHAT_SESSION_BYTES,
      'Chat session'
    );
    return content === null ? null : this.parseSession(content);
  }

  async getSessionForTask(taskId: string): Promise<ChatSession | null> {
    validatePathSegment(taskId);
    return this.getSession(`task_${taskId}`);
  }

  async listBoardSessions(): Promise<ChatSession[]> {
    await this.ensureReady();
    const entries = await readdir(this.sessionsDir, { withFileTypes: true });
    const sessions: ChatSession[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.md')) continue;
      validatePathSegment(entry.name);
      const filePath = ensureWithinBase(this.sessionsDir, path.join(this.sessionsDir, entry.name));
      const content = await this.readOptionalBoundedFile(
        filePath,
        MAX_CHAT_SESSION_BYTES,
        'Chat session'
      );
      if (content !== null) sessions.push(this.parseSession(content));
    }
    return sessions.sort(
      (left, right) =>
        new Date(right.updated).getTime() - new Date(left.updated).getTime() ||
        right.id.localeCompare(left.id)
    );
  }

  async saveSession(session: ChatSession): Promise<void> {
    await this.ensureReady();
    const filePath = this.sessionPath(session.id, session.taskId);
    const content = this.serializeSession(session);
    this.assertBounded(content, MAX_CHAT_SESSION_BYTES, 'Chat session');
    await withFileLock(filePath, () => atomicWriteFile(filePath, content, 'utf8'));
  }

  async appendSessionMessage(sessionId: string, message: ChatMessage): Promise<boolean> {
    await this.ensureReady();
    const taskMatch = sessionId.match(/^task_(.+)$/);
    const filePath = this.sessionPath(sessionId, taskMatch?.[1]);
    return withFileLock(filePath, async () => {
      const content = await this.readOptionalBoundedFile(
        filePath,
        MAX_CHAT_SESSION_BYTES,
        'Chat session'
      );
      if (content === null) return false;
      const session = this.parseSession(content);
      session.messages.push(message);
      session.updated = message.timestamp;
      const nextContent = this.serializeSession(session);
      this.assertBounded(nextContent, MAX_CHAT_SESSION_BYTES, 'Chat session');
      await atomicWriteFile(filePath, nextContent, 'utf8');
      return true;
    });
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.ensureReady();
    const taskMatch = sessionId.match(/^task_(.+)$/);
    const filePath = this.sessionPath(sessionId, taskMatch?.[1]);
    return withFileLock(filePath, async () => {
      try {
        await unlink(filePath);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  async appendSquadMessage(message: SquadMessage): Promise<void> {
    await this.ensureReady();
    validatePathSegment(message.id);
    const date = message.timestamp.split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Squad message timestamp is invalid');
    }
    const filePath = ensureWithinBase(this.squadDir, path.join(this.squadDir, `${date}.md`));
    await withFileLock(filePath, async () => {
      const existing = await this.readOptionalBoundedFile(
        filePath,
        MAX_SQUAD_DAY_BYTES,
        'Squad chat log'
      );
      const content = existing ?? `# Squad Chat — ${date}\n\n`;
      const nextContent = content + this.serializeSquadMessage(message);
      this.assertBounded(nextContent, MAX_SQUAD_DAY_BYTES, 'Squad chat log');
      await atomicWriteFile(filePath, nextContent, 'utf8');
    });
  }

  async listSquadMessages(options: SquadMessageListOptions = {}): Promise<SquadMessage[]> {
    await this.ensureReady();
    const includeSystem = options.includeSystem !== false;
    const sinceTimestamp = options.since ? Date.parse(options.since) : null;
    const entries = await readdir(this.squadDir, { withFileTypes: true });
    const messages: SquadMessage[] = [];

    for (const entry of entries
      .filter(
        (candidate) =>
          candidate.isFile() &&
          !candidate.isSymbolicLink() &&
          /^\d{4}-\d{2}-\d{2}\.md$/.test(candidate.name)
      )
      .sort((left, right) => right.name.localeCompare(left.name))) {
      const filePath = ensureWithinBase(this.squadDir, path.join(this.squadDir, entry.name));
      const content = await this.readOptionalBoundedFile(
        filePath,
        MAX_SQUAD_DAY_BYTES,
        'Squad chat log'
      );
      if (content === null) continue;
      for (const message of this.parseSquadMessages(content)) {
        if (!includeSystem && message.system) continue;
        const numericTimestamp = Date.parse(message.timestamp);
        if (
          sinceTimestamp &&
          !Number.isNaN(numericTimestamp) &&
          numericTimestamp < sinceTimestamp
        ) {
          continue;
        }
        if (options.agent && message.agent !== options.agent) continue;
        messages.push(message);
      }
    }

    const getTime = (timestamp: string) => {
      const value = Date.parse(timestamp);
      return Number.isNaN(value) ? 0 : value;
    };
    messages.sort((left, right) => getTime(left.timestamp) - getTime(right.timestamp));
    const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : null;
    return limit && messages.length > limit ? messages.slice(-limit) : messages;
  }

  async readSquadMetadata(): Promise<SquadMetadataFile> {
    return this.readSquadMetadataFromPath(this.squadMetadataPath());
  }

  async updateSquadMetadata<T>(
    mutator: (metadata: SquadMetadataFile) => T | Promise<T>
  ): Promise<T> {
    await this.ensureReady();
    const filePath = this.squadMetadataPath();
    return withFileLock(filePath, async () => {
      const metadata = await this.readSquadMetadataFromPath(filePath);
      const result = await mutator(metadata);
      metadata.updatedAt = new Date().toISOString();
      const content = JSON.stringify(metadata, null, 2);
      this.assertBounded(content, MAX_SQUAD_METADATA_BYTES, 'Squad metadata');
      await atomicWriteFile(filePath, content, 'utf8');
      return result;
    });
  }

  private async ensureReady(): Promise<void> {
    this.directorySetup ??= Promise.all([
      this.prepareDirectory(this.chatsDir),
      this.prepareDirectory(this.sessionsDir),
      this.prepareDirectory(this.squadDir),
    ]).then(() => undefined);
    await this.directorySetup;
  }

  private async prepareDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Chat storage must use regular directories');
    }
  }

  private sessionPath(sessionId: string, taskId?: string): string {
    if (taskId) {
      validatePathSegment(taskId);
      return ensureWithinBase(this.chatsDir, path.join(this.chatsDir, `task_${taskId}.md`));
    }
    validatePathSegment(sessionId);
    return ensureWithinBase(this.sessionsDir, path.join(this.sessionsDir, `${sessionId}.md`));
  }

  private squadMetadataPath(): string {
    return ensureWithinBase(this.squadDir, path.join(this.squadDir, 'metadata.json'));
  }

  private parseSession(content: string): ChatSession {
    const { data, content: markdown } = matter(content);
    const messages: ChatMessage[] = [];
    for (const block of markdown.split(/\n---\n/)) {
      if (!block.trim()) continue;
      const lines = block.trim().split('\n');
      const match = lines[0].match(
        /^\*\*(.+?)\*\*\s*\|\s*(\w+)\s*\|\s*(.+?)(?:\s*\|\s*(.+?))?(?:\s*\|\s*(.+?))?$/
      );
      if (!match) continue;
      const [, id, role, timestamp, agent, model] = match;
      messages.push({
        id,
        role: role as ChatMessage['role'],
        content: lines.slice(1).join('\n').trim(),
        timestamp,
        agent: agent || undefined,
        model: model || undefined,
      });
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

  private serializeSession(session: ChatSession): string {
    const frontmatter: Record<string, unknown> = {
      id: session.id,
      taskId: session.taskId,
      title: session.title,
      agent: session.agent,
      model: session.model,
      mode: session.mode,
      created: session.created,
      updated: session.updated,
    };
    for (const [key, value] of Object.entries(frontmatter)) {
      if (value === undefined) delete frontmatter[key];
    }
    const markdown = session.messages
      .map((message) => {
        const meta = [
          `**${message.id}**`,
          message.role,
          message.timestamp,
          message.agent || '',
          message.model || '',
        ]
          .filter(Boolean)
          .join(' | ');
        return `${meta}\n\n${message.content}`;
      })
      .join('\n\n---\n\n');
    return matter.stringify(markdown, frontmatter);
  }

  private serializeSquadMessage(message: SquadMessage): string {
    const systemTag = message.system ? ' [system]' : '';
    const eventTag = message.event ? ` [${message.event}]` : '';
    const modelTag = message.model ? ` [model:${message.model}]` : '';
    const tags = message.tags?.length ? ` [${message.tags.join(', ')}]` : '';
    const display = message.displayName ? ` (${message.displayName})` : '';
    const taskTitle = message.taskTitle ? ` | ${message.taskTitle}` : '';
    const duration = message.duration ? ` (${message.duration})` : '';
    return `## ${message.agent}${display} | ${message.id} | ${message.timestamp}${systemTag}${eventTag}${modelTag}${tags}${taskTitle}${duration}\n\n${message.message}\n\n---\n\n`;
  }

  private parseSquadMessages(content: string): SquadMessage[] {
    const body = content.replace(/^#\s+Squad Chat[^\n]*\n+/, '');
    const messages: SquadMessage[] = [];
    for (const block of body.split(/\n---\n/)) {
      if (!block.trim()) continue;
      const lines = block.trim().split('\n');
      const headerParts = lines[0]
        .replace(/^##\s+/, '')
        .split('|')
        .map((part) => part.trim());
      if (headerParts.length < 3) continue;
      const [agentPart, id, metaPart, taskPart] = headerParts;
      if (!agentPart || !id || !metaPart) continue;
      const agentMatch = agentPart.match(/^(.+?)(?:\s+\((.+?)\))?$/)!;
      const bracketMatches = [...metaPart.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
      let timestamp = metaPart.replace(/\[.*?\]/g, '').trim();
      let duration: string | undefined;
      if (!taskPart) {
        const durationMatch = timestamp.match(/\(([^)]+)\)\s*$/);
        if (durationMatch) {
          duration = durationMatch[1];
          timestamp = timestamp.replace(/\(([^)]+)\)\s*$/, '').trim();
        }
      }
      if (!timestamp) continue;
      let taskTitle: string | undefined;
      if (taskPart) {
        const durationMatch = taskPart.match(/\(([^)]+)\)\s*$/);
        if (durationMatch) duration = durationMatch[1];
        taskTitle = taskPart.replace(/\(([^)]+)\)\s*$/, '').trim() || undefined;
      }
      const event = bracketMatches.find((value) => value.startsWith('agent.')) as
        SquadMessage['event'] | undefined;
      const modelTag = bracketMatches.find((value) => value.startsWith('model:'));
      const tagValue = bracketMatches.find(
        (value) => value !== 'system' && !value.startsWith('agent.') && !value.startsWith('model:')
      );
      messages.push({
        id,
        agent: agentMatch[1].trim(),
        displayName: agentMatch[2]?.trim() || undefined,
        message: lines.slice(1).join('\n').trim(),
        tags: tagValue
          ? tagValue
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : undefined,
        timestamp,
        model: modelTag?.replace('model:', ''),
        system: bracketMatches.includes('system') ? true : undefined,
        event,
        taskTitle,
        duration,
      });
    }
    return messages;
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
    const content = await this.readOptionalBoundedFile(
      filePath,
      MAX_SQUAD_METADATA_BYTES,
      'Squad metadata'
    );
    if (content === null) return this.emptySquadMetadata();
    const parsed = JSON.parse(content) as Partial<SquadMetadataFile>;
    return {
      version: 1,
      messages: parsed.messages && typeof parsed.messages === 'object' ? parsed.messages : {},
      reads: parsed.reads && typeof parsed.reads === 'object' ? parsed.reads : {},
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  }

  private async readOptionalBoundedFile(
    filePath: string,
    maximumBytes: number,
    label: string
  ): Promise<string | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(filePath), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino ||
        !stats.isFile() ||
        stats.size > maximumBytes
      ) {
        throw new Error(`${label} must use a bounded regular file`);
      }
      return await handle.readFile({ encoding: 'utf8' });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      if (code === 'ELOOP') {
        throw new Error(`${label} must not use a symbolic link`, { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private assertBounded(content: string, maximumBytes: number, label: string): void {
    if (Buffer.byteLength(content, 'utf8') > maximumBytes) {
      throw new Error(`${label} exceeds its storage limit`);
    }
  }
}
