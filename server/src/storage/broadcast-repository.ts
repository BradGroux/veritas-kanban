import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Broadcast, BroadcastPriority, BroadcastReadReceipt } from '@veritas-kanban/shared';
import { withFileLock } from '../services/file-lock.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_BROADCAST_BYTES = 1024 * 1024;

interface BroadcastFrontmatter {
  id: string;
  priority: BroadcastPriority;
  from?: string;
  tags?: string[];
  createdAt: string;
  readBy?: BroadcastReadReceipt[];
}

export class FileBroadcastRepository {
  private readonly broadcastsDir: string;

  constructor(broadcastsDir: string) {
    this.broadcastsDir = path.resolve(broadcastsDir);
    ensureWithinBase(path.dirname(this.broadcastsDir), this.broadcastsDir);
  }

  async get(id: string): Promise<Broadcast | null> {
    const filePath = this.getBroadcastPath(id);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_BROADCAST_BYTES) {
        throw new Error('Broadcast storage must use a bounded regular file');
      }
      return parseBroadcastFile(await handle.readFile({ encoding: 'utf8' }), id);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return null;
      if (errorCode === 'ELOOP') {
        throw new Error('Broadcast storage must not use symbolic links', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async listIds(): Promise<string[]> {
    await this.prepareDirectory();
    return (await readdir(this.broadcastsDir))
      .filter((file) => file.endsWith('.md'))
      .map((file) => path.basename(file, '.md'));
  }

  async save(broadcast: Broadcast): Promise<void> {
    const filePath = this.getBroadcastPath(broadcast.id);
    const content = serializeBroadcast(broadcast);
    this.assertBounded(content);
    await this.prepareDirectory();
    await withFileLock(filePath, () => atomicWriteFile(filePath, content, 'utf8'));
  }

  async update(
    id: string,
    updater: (broadcast: Broadcast) => Broadcast
  ): Promise<Broadcast | null> {
    const filePath = this.getBroadcastPath(id);
    await this.prepareDirectory();
    return withFileLock(filePath, async () => {
      const broadcast = await this.get(id);
      if (!broadcast) return null;
      const updated = updater(broadcast);
      const content = serializeBroadcast(updated);
      this.assertBounded(content);
      await atomicWriteFile(filePath, content, 'utf8');
      return updated;
    });
  }

  private getBroadcastPath(id: string): string {
    const safeId = validatePathSegment(id);
    return ensureWithinBase(this.broadcastsDir, path.join(this.broadcastsDir, `${safeId}.md`));
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.broadcastsDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.broadcastsDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Broadcast storage path must use a regular directory');
    }
  }

  private assertBounded(content: string): void {
    if (Buffer.byteLength(content, 'utf8') > MAX_BROADCAST_BYTES) {
      throw new Error('Broadcast exceeds the 1 MiB storage limit');
    }
  }
}

function parseBroadcastFile(content: string, id: string): Broadcast {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error(`Invalid broadcast file format: ${id}`);
  }

  const frontmatter: Partial<BroadcastFrontmatter> = {};
  for (const line of frontmatterMatch[1].split('\n')) {
    const [key, ...valueParts] = line.split(':');
    if (!key || valueParts.length === 0) continue;
    const value = valueParts.join(':').trim();

    switch (key.trim()) {
      case 'id':
        frontmatter.id = value;
        break;
      case 'priority':
        frontmatter.priority = value as BroadcastPriority;
        break;
      case 'from':
        frontmatter.from = parseJsonString(value);
        break;
      case 'tags':
        frontmatter.tags = parseJsonArray<string>(value);
        break;
      case 'createdAt':
        frontmatter.createdAt = value;
        break;
      case 'readBy':
        frontmatter.readBy = parseJsonArray<BroadcastReadReceipt>(value);
        break;
    }
  }

  return {
    id: frontmatter.id || id,
    message: frontmatterMatch[2].trim(),
    priority: frontmatter.priority || 'info',
    from: frontmatter.from,
    tags: frontmatter.tags || [],
    createdAt: frontmatter.createdAt || new Date().toISOString(),
    readBy: frontmatter.readBy || [],
  };
}

function parseJsonString(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function serializeBroadcast(broadcast: Broadcast): string {
  const frontmatter = [
    '---',
    `id: ${broadcast.id}`,
    `priority: ${broadcast.priority}`,
    broadcast.from ? `from: ${JSON.stringify(broadcast.from)}` : null,
    broadcast.tags && broadcast.tags.length > 0 ? `tags: ${JSON.stringify(broadcast.tags)}` : null,
    `createdAt: ${broadcast.createdAt}`,
    broadcast.readBy.length > 0 ? `readBy: ${JSON.stringify(broadcast.readBy)}` : null,
    '---',
  ]
    .filter((line) => line !== null)
    .join('\n');

  return `${frontmatter}\n${broadcast.message}\n`;
}
