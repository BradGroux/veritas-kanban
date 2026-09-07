import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fault = vi.hoisted(() => ({ stage: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readFile: async (...args: Parameters<typeof original.readFile>) => {
      if (fault.stage === 'read' && String(args[0]).endsWith('.json')) {
        throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      }
      return original.readFile(...args);
    },
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (fault.stage === 'write' && String(args[0]).includes('.tmp.')) {
        const write = handle.writeFile.bind(handle);
        handle.writeFile = async () => {
          await write('partial JSON');
          throw Object.assign(new Error('Interrupted write'), { code: 'EIO' });
        };
      }
      return handle;
    },
    rename: async (...args: Parameters<typeof original.rename>) => {
      if (fault.stage === 'rename')
        throw Object.assign(new Error('Rename failed'), { code: 'EIO' });
      return original.rename(...args);
    },
  };
});
import { NotificationFileRepository } from '../../storage/notification-file-repository.js';

for (const kind of ['notifications', 'subscriptions'] as const) {
  describe(`${kind} file durability`, () => {
    let root: string;
    let file: string;
    let repository: NotificationFileRepository;
    const previous = '[ { "id": "retained" } ]\n';
    const load = () =>
      kind === 'notifications' ? repository.loadNotifications() : repository.loadSubscriptions();
    const save = () =>
      kind === 'notifications'
        ? repository.saveNotifications([{ id: 'new' }])
        : repository.saveSubscriptions([{ id: 'new' }]);

    beforeEach(async () => {
      fault.stage = '';
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-notification-file-'));
      file = path.join(
        root,
        kind === 'notifications' ? 'notifications.json' : 'thread-subscriptions.json'
      );
      repository = new NotificationFileRepository({ dataDir: root });
    });
    afterEach(async () => {
      fault.stage = '';
      await fs.rm(root, { recursive: true, force: true });
    });

    it('initializes only missing files and writes complete JSON', async () => {
      expect(await load()).toEqual([]);
      await save();
      expect(await load()).toEqual([{ id: 'new' }]);
      expect(await fs.readdir(root)).toEqual([path.basename(file)]);
    });

    it.each(['{broken', '{}', 'null'])(
      'preserves malformed or non-array state: %s',
      async (bytes) => {
        await fs.writeFile(file, bytes);
        await expect(load()).rejects.toThrow('Preserve the file');
        await expect(save()).rejects.toThrow('Preserve the file');
        expect(await fs.readFile(file, 'utf8')).toBe(bytes);
      }
    );

    it('reports I/O errors without turning retained data into empty writable state', async () => {
      await fs.writeFile(file, previous);
      fault.stage = 'read';
      await expect(load()).rejects.toMatchObject({ cause: { code: 'EACCES' } });
      await expect(save()).rejects.toMatchObject({ cause: { code: 'EACCES' } });
      expect(await fs.readFile(file, 'utf8')).toBe(previous);
    });

    it.each(['write', 'rename'])(
      'retains exact previous bytes after a failed %s',
      async (stage) => {
        await fs.writeFile(file, previous);
        fault.stage = stage;
        await expect(save()).rejects.toMatchObject({ code: 'EIO' });
        expect(await fs.readFile(file, 'utf8')).toBe(previous);
        expect(await fs.readdir(root)).toEqual([path.basename(file)]);
        fault.stage = '';
        await save();
        expect(await load()).toEqual([{ id: 'new' }]);
      }
    );
  });
}

describe('incremental notification file rollback', () => {
  let root: string;
  beforeEach(async () => {
    fault.stage = '';
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-notification-rollback-'));
  });
  afterEach(async () => {
    fault.stage = '';
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each(['write', 'rename'])(
    'retains delivery state and supports retry after %s failure',
    async (stage) => {
      const repository = new NotificationFileRepository({ dataDir: root });
      await repository.appendNotifications([
        {
          id: 'retained',
          taskId: 'task',
          targetAgent: 'alice',
          fromAgent: 'bob',
          content: 'fixture',
          type: 'mention',
          delivered: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      const file = path.join(root, 'notifications.json');
      const before = await fs.readFile(file, 'utf8');
      fault.stage = stage;
      await expect(
        repository.markDelivered('retained', '2026-01-02T00:00:00.000Z')
      ).rejects.toMatchObject({ code: 'EIO' });
      expect(await fs.readFile(file, 'utf8')).toBe(before);
      expect((await repository.listNotifications())[0].delivered).toBe(false);
      fault.stage = '';
      expect(await repository.markDelivered('retained', '2026-01-02T00:00:00.000Z')).toBe(true);
      expect((await repository.listNotifications())[0].delivered).toBe(true);
    }
  );
});
