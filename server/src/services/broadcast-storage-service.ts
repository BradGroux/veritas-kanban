/**
 * Broadcast Storage Service
 *
 * Handles persistent broadcast messages for agent-to-agent communication.
 * Storage: Markdown files in .veritas-kanban/broadcasts/
 * Each broadcast is stored as a separate .md file with frontmatter metadata.
 */

import { createLogger } from '../lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Broadcast,
  CreateBroadcastRequest,
  GetBroadcastsQuery,
  BroadcastReadReceipt,
  BroadcastPriority,
} from '@veritas-kanban/shared';
import { fileExists } from '../storage/fs-helpers.js';
import { validatePathSegment } from '../utils/sanitize.js';
import { withFileLock } from './file-lock.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');
const BROADCASTS_DIR = path.join(DATA_DIR, 'broadcasts');

const log = createLogger('broadcast-storage');

// ─── Frontmatter Parsing ─────────────────────────────────────

interface BroadcastFrontmatter {
  id: string;
  priority: BroadcastPriority;
  from?: string;
  tags?: string[];
  createdAt: string;
  readBy?: BroadcastReadReceipt[];
}

/**
 * Parse a broadcast markdown file (frontmatter + content).
 */
function parseBroadcastFile(content: string, id: string): Broadcast {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error(`Invalid broadcast file format: ${id}`);
  }

  const frontmatterText = frontmatterMatch[1];
  const message = frontmatterMatch[2].trim();

  // Parse frontmatter manually (simple YAML subset)
  const frontmatter: Partial<BroadcastFrontmatter> = {};
  const lines = frontmatterText.split('\n');

  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (!key || valueParts.length === 0) continue;

    const value = valueParts.join(':').trim();
    const trimmedKey = key.trim();

    if (trimmedKey === 'id') {
      frontmatter.id = value;
    } else if (trimmedKey === 'priority') {
      frontmatter.priority = value as BroadcastPriority;
    } else if (trimmedKey === 'from') {
      frontmatter.from = value;
    } else if (trimmedKey === 'tags') {
      frontmatter.tags = JSON.parse(value);
    } else if (trimmedKey === 'createdAt') {
      frontmatter.createdAt = value;
    } else if (trimmedKey === 'readBy') {
      frontmatter.readBy = JSON.parse(value);
    }
  }

  return {
    id: frontmatter.id || id,
    message,
    priority: frontmatter.priority || 'info',
    from: frontmatter.from,
    tags: frontmatter.tags || [],
    createdAt: frontmatter.createdAt || new Date().toISOString(),
    readBy: frontmatter.readBy || [],
  };
}

/**
 * Serialize a broadcast to markdown with frontmatter.
 */
function serializeBroadcast(broadcast: Broadcast): string {
  const frontmatter = [
    '---',
    `id: ${broadcast.id}`,
    `priority: ${broadcast.priority}`,
    broadcast.from ? `from: ${broadcast.from}` : null,
    broadcast.tags && broadcast.tags.length > 0 ? `tags: ${JSON.stringify(broadcast.tags)}` : null,
    `createdAt: ${broadcast.createdAt}`,
    broadcast.readBy.length > 0 ? `readBy: ${JSON.stringify(broadcast.readBy)}` : null,
    '---',
  ]
    .filter((line) => line !== null)
    .join('\n');

  return `${frontmatter}\n${broadcast.message}\n`;
}

// ─── Service ─────────────────────────────────────────────────

export class BroadcastStorageService {
  /**
   * Ensure the broadcasts directory exists.
   */
  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(BROADCASTS_DIR, { recursive: true });
    } catch (err) {
      log.error({ err }, 'Failed to create broadcasts directory');
      throw err;
    }
  }

  /**
   * Get the file path for a broadcast ID.
   */
  private getBroadcastPath(id: string): string {
    validatePathSegment(id);
    return path.join(BROADCASTS_DIR, `${id}.md`);
  }

  /**
   * Create a new broadcast.
   */
  async create(data: CreateBroadcastRequest): Promise<Broadcast> {
    await this.ensureDir();

    const id = randomUUID();
    const broadcast: Broadcast = {
      id,
      message: data.message,
      priority: data.priority || 'info',
      from: data.from,
      tags: data.tags || [],
      createdAt: new Date().toISOString(),
      readBy: [],
    };

    const filePath = this.getBroadcastPath(id);
    const content = serializeBroadcast(broadcast);

    try {
      await withFileLock(filePath, async () => {
        await fs.writeFile(filePath, content, 'utf-8');
      });
      log.info({ id, priority: broadcast.priority }, 'Broadcast created');
      return broadcast;
    } catch (err) {
      log.error({ err, id }, 'Failed to create broadcast');
      throw new Error('Failed to create broadcast');
    }
  }

  /**
   * Get a single broadcast by ID.
   */
  async getById(id: string): Promise<Broadcast | null> {
    const filePath = this.getBroadcastPath(id);

    if (!(await fileExists(filePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return parseBroadcastFile(content, id);
    } catch (err) {
      log.error({ err, id }, 'Failed to read broadcast');
      return null;
    }
  }

  /**
   * List broadcasts with optional filters.
   */
  async list(query: GetBroadcastsQuery = {}): Promise<Broadcast[]> {
    await this.ensureDir();

    try {
      const files = await fs.readdir(BROADCASTS_DIR);
      const broadcastFiles = files.filter((f) => f.endsWith('.md'));

      const broadcasts: Broadcast[] = [];

      for (const file of broadcastFiles) {
        const id = path.basename(file, '.md');
        const broadcast = await this.getById(id);

        if (!broadcast) continue;

        // Apply filters
        if (query.since && broadcast.createdAt < query.since) {
          continue;
        }

        if (query.priority && broadcast.priority !== query.priority) {
          continue;
        }

        if (query.unread && query.agent) {
          const hasRead = broadcast.readBy.some(
            (r: BroadcastReadReceipt) => r.agent === query.agent
          );
          if (hasRead) continue;
        }

        broadcasts.push(broadcast);
      }

      // Sort by createdAt descending (newest first)
      broadcasts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      // Apply limit
      if (query.limit) {
        return broadcasts.slice(0, query.limit);
      }

      return broadcasts;
    } catch (err) {
      log.error({ err }, 'Failed to list broadcasts');
      throw new Error('Failed to list broadcasts');
    }
  }

  /**
   * Mark a broadcast as read by an agent.
   */
  async markRead(id: string, agent: string): Promise<boolean> {
    const filePath = this.getBroadcastPath(id);

    try {
      return await withFileLock(filePath, async () => {
        // Read inside lock to prevent TOCTTOU race
        const broadcast = await this.getById(id);

        if (!broadcast) {
          return false;
        }

        // Check if already marked as read
        const alreadyRead = broadcast.readBy.some((r: BroadcastReadReceipt) => r.agent === agent);
        if (alreadyRead) {
          return true;
        }

        // Add read receipt
        broadcast.readBy.push({
          agent,
          readAt: new Date().toISOString(),
        });

        // Write back
        const content = serializeBroadcast(broadcast);
        await fs.writeFile(filePath, content, 'utf-8');
        log.info({ id, agent }, 'Broadcast marked as read');
        return true;
      });
    } catch (err) {
      log.error({ err, id, agent }, 'Failed to mark broadcast as read');
      return false;
    }
  }
}

// Singleton instance
let serviceInstance: BroadcastStorageService | null = null;

export function getBroadcastStorageService(): BroadcastStorageService {
  if (!serviceInstance) {
    serviceInstance = new BroadcastStorageService();
  }
  return serviceInstance;
}
