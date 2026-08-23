import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Broadcast } from '@veritas-kanban/shared';
import { BroadcastStorageService } from '../services/broadcast-storage-service.js';
import { FileBroadcastRepository } from '../storage/broadcast-repository.js';

function broadcast(id: string, overrides: Partial<Broadcast> = {}): Broadcast {
  return {
    id,
    message: `Message ${id}`,
    priority: 'info',
    tags: [],
    createdAt: '2026-08-23T20:00:00.000Z',
    readBy: [],
    ...overrides,
  };
}

describe('BroadcastStorageService', () => {
  let root: string;
  let broadcastsDir: string;
  let repository: FileBroadcastRepository;
  let service: BroadcastStorageService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-broadcast-storage-'));
    broadcastsDir = path.join(root, 'broadcasts');
    repository = new FileBroadcastRepository(broadcastsDir);
    service = new BroadcastStorageService({ repository });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it('creates and round-trips safe frontmatter without field injection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T21:00:00.000Z'));

    const created = await service.create({
      message: 'Ship the release.',
      from: 'agent\npriority: urgent',
      tags: ['release'],
    });
    const loaded = await service.getById(created.id);

    expect(loaded).toMatchObject({
      id: created.id,
      message: 'Ship the release.',
      priority: 'info',
      from: 'agent\npriority: urgent',
      tags: ['release'],
      createdAt: '2026-08-23T21:00:00.000Z',
    });
    expect(await readFile(path.join(broadcastsDir, `${created.id}.md`), 'utf8')).toContain(
      'from: "agent\\npriority: urgent"'
    );
  });

  it('filters, sorts, limits, and marks broadcasts read without duplicate receipts', async () => {
    await repository.save(
      broadcast('older', {
        priority: 'urgent',
        createdAt: '2026-08-23T20:00:00.000Z',
      })
    );
    await repository.save(
      broadcast('newer', {
        priority: 'urgent',
        createdAt: '2026-08-23T21:00:00.000Z',
      })
    );
    await repository.save(
      broadcast('informational', {
        createdAt: '2026-08-23T22:00:00.000Z',
      })
    );

    await expect(service.list({ priority: 'urgent', limit: 1 })).resolves.toMatchObject([
      { id: 'newer' },
    ]);
    await expect(
      service.list({ since: '2026-08-23T20:30:00.000Z', priority: 'urgent' })
    ).resolves.toMatchObject([{ id: 'newer' }]);

    await expect(service.markRead('newer', 'VERITAS')).resolves.toBe(true);
    await expect(service.markRead('newer', 'VERITAS')).resolves.toBe(true);
    await expect(service.list({ unread: true, agent: 'VERITAS' })).resolves.toMatchObject([
      { id: 'informational' },
      { id: 'older' },
    ]);
    expect((await service.getById('newer'))?.readBy).toHaveLength(1);
    await expect(service.markRead('missing', 'VERITAS')).resolves.toBe(false);
  });

  it('serializes concurrent read receipts', async () => {
    await repository.save(broadcast('shared'));
    await Promise.all([service.markRead('shared', 'TARS'), service.markRead('shared', 'CASE')]);

    const receipts = (await repository.get('shared'))?.readBy.map(({ agent }) => agent);
    expect(receipts).toEqual(expect.arrayContaining(['TARS', 'CASE']));
    expect(receipts).toHaveLength(2);
  });

  it('loads legacy frontmatter and skips malformed broadcasts when listing', async () => {
    await mkdir(broadcastsDir, { recursive: true });
    await writeFile(
      path.join(broadcastsDir, 'legacy.md'),
      ['---', 'from: legacy-agent', 'tags: invalid', 'readBy: {}', 'ignored', '---', 'Legacy'].join(
        '\n'
      ),
      'utf8'
    );
    await writeFile(path.join(broadcastsDir, 'broken.md'), 'not frontmatter', 'utf8');

    await expect(service.getById('legacy')).resolves.toMatchObject({
      id: 'legacy',
      message: 'Legacy',
      priority: 'info',
      from: 'legacy-agent',
      tags: [],
      readBy: [],
    });
    await expect(service.getById('broken')).resolves.toBeNull();
    await expect(service.list()).resolves.toMatchObject([{ id: 'legacy' }]);
  });

  it('fails closed for unsafe, non-file, oversized, and linked storage paths', async () => {
    await mkdir(broadcastsDir, { recursive: true });
    const outside = path.join(root, 'outside.md');
    await writeFile(outside, 'not a broadcast', 'utf8');
    await symlink(outside, path.join(broadcastsDir, 'linked.md'));
    await expect(service.getById('linked')).resolves.toBeNull();

    await mkdir(path.join(broadcastsDir, 'directory.md'));
    await expect(service.getById('directory')).resolves.toBeNull();
    await expect(service.getById('../outside')).resolves.toBeNull();
    await expect(service.markRead('../outside', 'VERITAS')).resolves.toBe(false);
    await expect(service.create({ message: 'x'.repeat(1024 * 1024) })).rejects.toThrow(
      /Failed to create broadcast/
    );

    const realDirectory = path.join(root, 'real-broadcasts');
    const linkedDirectory = path.join(root, 'linked-broadcasts');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedService = new BroadcastStorageService({ broadcastsDir: linkedDirectory });
    await expect(linkedService.list()).rejects.toThrow(/Failed to list broadcasts/);
  });
});
