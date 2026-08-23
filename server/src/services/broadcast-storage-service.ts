/**
 * Broadcast Storage Service
 *
 * Handles persistent broadcast messages for agent-to-agent communication.
 * Storage: Markdown files in .veritas-kanban/broadcasts/
 * Each broadcast is stored as a separate .md file with frontmatter metadata.
 */

import { createLogger } from '../lib/logger.js';
import { randomUUID } from 'node:crypto';
import type {
  Broadcast,
  CreateBroadcastRequest,
  GetBroadcastsQuery,
  BroadcastReadReceipt,
} from '@veritas-kanban/shared';
import { getBroadcastsDir } from '../utils/paths.js';
import { FileBroadcastRepository } from '../storage/broadcast-repository.js';

const BROADCASTS_DIR = getBroadcastsDir();

const log = createLogger('broadcast-storage');

// ─── Service ─────────────────────────────────────────────────

export class BroadcastStorageService {
  private readonly repository: FileBroadcastRepository;

  constructor(options: BroadcastStorageServiceOptions = {}) {
    this.repository =
      options.repository ?? new FileBroadcastRepository(options.broadcastsDir ?? BROADCASTS_DIR);
  }

  /**
   * Create a new broadcast.
   */
  async create(data: CreateBroadcastRequest): Promise<Broadcast> {
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

    try {
      await this.repository.save(broadcast);
      log.info({ id, priority: broadcast.priority }, 'Broadcast created');
      return broadcast;
    } catch (err) {
      log.error({ err, id }, 'Failed to create broadcast');
      throw new Error('Failed to create broadcast', { cause: err });
    }
  }

  /**
   * Get a single broadcast by ID.
   */
  async getById(id: string): Promise<Broadcast | null> {
    try {
      return await this.repository.get(id);
    } catch (err) {
      log.error({ err, id }, 'Failed to read broadcast');
      return null;
    }
  }

  /**
   * List broadcasts with optional filters.
   */
  async list(query: GetBroadcastsQuery = {}): Promise<Broadcast[]> {
    try {
      const broadcasts: Broadcast[] = [];
      for (const id of await this.repository.listIds()) {
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
      throw new Error('Failed to list broadcasts', { cause: err });
    }
  }

  /**
   * Mark a broadcast as read by an agent.
   */
  async markRead(id: string, agent: string): Promise<boolean> {
    try {
      const updated = await this.repository.update(id, (broadcast) => {
        const alreadyRead = broadcast.readBy.some((r: BroadcastReadReceipt) => r.agent === agent);
        if (alreadyRead) {
          return broadcast;
        }
        broadcast.readBy.push({
          agent,
          readAt: new Date().toISOString(),
        });
        return broadcast;
      });
      if (!updated) return false;
      log.info({ id, agent }, 'Broadcast marked as read');
      return true;
    } catch (err) {
      log.error({ err, id, agent }, 'Failed to mark broadcast as read');
      return false;
    }
  }
}

export interface BroadcastStorageServiceOptions {
  broadcastsDir?: string;
  repository?: FileBroadcastRepository;
}

// Singleton instance
let serviceInstance: BroadcastStorageService | null = null;

export function getBroadcastStorageService(): BroadcastStorageService {
  if (!serviceInstance) {
    serviceInstance = new BroadcastStorageService();
  }
  return serviceInstance;
}
