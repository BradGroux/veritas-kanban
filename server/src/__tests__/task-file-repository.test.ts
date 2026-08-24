import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { Task } from '@veritas-kanban/shared';
import { FileTaskRepository } from '../storage/task-file-repository.js';

const { watchMock } = vi.hoisted(() => ({ watchMock: vi.fn() }));

vi.mock('../storage/fs-helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/fs-helpers.js')>();
  return { ...actual, watch: watchMock };
});

function task(id = 'task_20260823_repo01', title = 'Repository task'): Task {
  return {
    id,
    title,
    description: 'initial',
    type: 'code',
    status: 'todo',
    priority: 'medium',
    created: '2026-08-23T00:00:00.000Z',
    updated: '2026-08-23T00:00:00.000Z',
    revision: 1,
  };
}

describe('FileTaskRepository', () => {
  let root: string;
  let activeDir: string;
  let archiveDir: string;
  let repository: FileTaskRepository;

  beforeEach(async () => {
    watchMock.mockReset();
    watchMock.mockReturnValue({ close: vi.fn() });
    root = await mkdtemp(path.join(process.cwd(), '.veritas-task-repository-'));
    activeDir = path.join(root, 'active');
    archiveDir = path.join(root, 'archive');
    repository = new FileTaskRepository({ activeDir, archiveDir });
  });

  afterEach(async () => {
    repository.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it('loads legacy Markdown and preserves tasks across repository restart', async () => {
    await repository.ensureReady();
    await writeFile(
      path.join(activeDir, 'task_legacy-legacy-title.md'),
      `---
id: task_legacy
title: Legacy Title
type: code
status: todo
priority: high
created: '2026-01-01T00:00:00.000Z'
updated: '2026-01-02T00:00:00.000Z'
---
Legacy description.
`,
      'utf8'
    );

    await expect(repository.listActive()).resolves.toMatchObject([
      { id: 'task_legacy', title: 'Legacy Title', description: 'Legacy description.' },
    ]);

    const created = task();
    await repository.createActive(created);
    const restarted = new FileTaskRepository({ activeDir, archiveDir });
    await expect(restarted.findActiveById(created.id)).resolves.toMatchObject(created);
    restarted.dispose();
  });

  it('serializes concurrent mutations and archive restoration without lost updates', async () => {
    const original = task();
    await repository.createActive(original);

    const append = (value: string) =>
      repository.withActiveMutation(original.id, async (current, persist) => {
        const updated = {
          ...current,
          description: `${current.description}:${value}`,
          revision: (current.revision ?? 1) + 1,
          updated: `2026-08-23T00:00:0${value}.000Z`,
        };
        await persist(updated);
        return updated;
      });

    await expect(Promise.all([append('1'), append('2')])).resolves.toHaveLength(2);
    const mutated = await repository.findActiveById(original.id);
    expect(mutated?.description).toBe('initial:1:2');

    const archived = { ...mutated!, deletedBy: 'operator' };
    await expect(repository.archiveActive(original.id, archived)).resolves.toBe(true);
    await expect(repository.findActiveById(original.id)).resolves.toBeNull();
    await expect(repository.findArchivedById(original.id)).resolves.toMatchObject({
      deletedBy: 'operator',
    });

    const restored = {
      ...archived,
      status: 'done' as const,
      deletedBy: undefined,
      updated: '2026-08-23T00:00:03.000Z',
    };
    await expect(repository.restoreArchived(original.id, restored)).resolves.toBe(true);
    await expect(repository.findActiveById(original.id)).resolves.toMatchObject(restored);
    await expect(repository.findArchivedById(original.id)).resolves.toBeNull();
  });

  it('fails closed for unsafe state and treats absent tasks as normal misses', async () => {
    await repository.ensureReady();
    await expect(repository.findActiveById('../outside')).rejects.toThrow(/lookup ID/);
    await expect(repository.deleteActive('missing')).resolves.toBe(false);
    await expect(
      repository.withActiveMutation('missing', async () => 'unexpected')
    ).resolves.toBeNull();
    await expect(repository.restoreArchived('missing', task('task_missing'))).resolves.toBe(false);

    const outside = path.join(root, 'outside.md');
    await writeFile(outside, 'outside', 'utf8');
    await symlink(outside, path.join(activeDir, 'task_symlink-linked.md'));
    await expect(repository.findActiveById('task_symlink')).resolves.toBeNull();

    const oversized = path.join(activeDir, 'task_oversized-large.md');
    await writeFile(oversized, '', 'utf8');
    await truncate(oversized, 16 * 1024 * 1024 + 1);
    await expect(repository.findActiveById('task_oversized')).rejects.toThrow(
      /bounded regular file/
    );
    await expect(repository.listActive()).resolves.toEqual([]);
  });

  it('seeds examples once and reports unexpected seed storage errors', async () => {
    const examplesDir = path.join(root, 'examples');
    await mkdir(examplesDir);
    await writeFile(
      path.join(examplesDir, 'task_example-one.md'),
      `---\nid: task_example\ntitle: Example\nupdated: '2026-08-23T00:00:00.000Z'\n---\nExample`,
      'utf8'
    );
    await writeFile(path.join(examplesDir, 'ignored.txt'), 'ignored', 'utf8');

    await expect(repository.seedExamplesIfEmpty()).resolves.toBe(1);
    await expect(repository.findActiveById('task_example')).resolves.toMatchObject({
      title: 'Example',
    });
    await expect(repository.seedExamplesIfEmpty()).resolves.toBe(0);

    const brokenRoot = path.join(root, 'broken');
    await mkdir(brokenRoot);
    await writeFile(path.join(brokenRoot, 'examples'), 'not a directory', 'utf8');
    const broken = new FileTaskRepository({
      activeDir: path.join(brokenRoot, 'active'),
      archiveDir: path.join(brokenRoot, 'archive'),
    });
    await expect(broken.seedExamplesIfEmpty()).rejects.toMatchObject({ code: 'ENOTDIR' });
    broken.dispose();
  });

  it('rejects invalid identities and invalid mutation outcomes', async () => {
    await expect(repository.createActive(task('invalid id'))).rejects.toThrow(/task ID format/);

    const original = task('task_mutation', 'Original');
    await repository.createActive(original);
    await expect(
      repository.withActiveMutation(original.id, async (current, persist) => {
        await persist({ ...current, title: 'First' });
        await persist({ ...current, title: 'Second' });
      })
    ).rejects.toThrow(/more than one persistence write/);
    await expect(
      repository.withActiveMutation(original.id, async (current, persist) => {
        await persist({ ...current, id: 'task_changed' });
      })
    ).rejects.toThrow(/cannot change task identity/);

    await writeFile(
      path.join(activeDir, 'task_unreadable-bad.md'),
      `---\nid: invalid.id\n---\ninvalid`,
      'utf8'
    );
    await expect(
      repository.withActiveMutation('task_unreadable', async () => 'unexpected')
    ).resolves.toBeNull();
  });

  it('handles missing, unreadable, and identity-changing archive operations', async () => {
    await repository.ensureReady();
    await expect(repository.archiveActive('task_missing', task('task_missing'))).resolves.toBe(
      false
    );
    await writeFile(
      path.join(activeDir, 'task_badarchive-bad.md'),
      `---\nid: invalid.id\n---\ninvalid`,
      'utf8'
    );
    await expect(
      repository.archiveActive('task_badarchive', task('task_badarchive'))
    ).resolves.toBe(false);

    const active = task('task_archiveidentity');
    await repository.createActive(active);
    await expect(repository.archiveActive(active.id, task('task_different'))).rejects.toThrow(
      /Archived task identity/
    );

    await writeFile(
      path.join(archiveDir, 'task_badrestore-bad.md'),
      `---\nid: invalid.id\n---\ninvalid`,
      'utf8'
    );
    await expect(
      repository.restoreArchived('task_badrestore', task('task_badrestore'))
    ).resolves.toBe(false);

    const archived = task('task_restore');
    await writeFile(
      path.join(archiveDir, 'task_restore-restorable.md'),
      `---\nid: task_restore\ntitle: Restorable\nupdated: '2026-08-23T00:00:00.000Z'\n---\nrestore`,
      'utf8'
    );
    await expect(repository.restoreArchived(archived.id, () => null)).resolves.toBe(false);
    await expect(repository.restoreArchived(archived.id, task('task_different'))).rejects.toThrow(
      /Restored task identity/
    );
  });

  it('exposes bounded diagnostics and preserves review comment serialization', async () => {
    const reviewed = {
      ...task('task_reviewed', '  Reviewed --- Task  '),
      description: 'Description',
      reviewComments: [{ file: 'server/src/file.ts', line: 12, content: 'Keep this.' }],
    };
    const descriptor = repository.describeActiveTask(reviewed);
    await repository.createActive(reviewed);
    await expect(readFile(descriptor.path, 'utf8')).resolves.toContain(
      '**server/src/file.ts:12** - Keep this.'
    );
    await expect(repository.readActiveFile(descriptor.filename)).resolves.toMatchObject({
      description: 'Description',
    });
    await expect(repository.readActiveFile('missing.md')).resolves.toBeNull();
    await expect(repository.readActiveFile('../outside.md')).rejects.toThrow(/single path segment/);

    expect(repository.getActiveDirectory()).toBe(activeDir);
    expect(repository.getActiveDestinationPath()).toBe('active');
    expect(repository.getIdentityScanSources(null)).toHaveLength(2);
    expect(repository.getIdentityScanSources(path.join(root, 'backlog'))).toHaveLength(3);
    expect(repository.describeIdentityCandidate(reviewed, 'active')).toMatchObject({
      location: 'active',
      taskId: reviewed.id,
    });
    expect(repository.describeIdentityCandidate(reviewed, 'archive')).toMatchObject({
      location: 'archive',
      taskId: reviewed.id,
    });
  });

  it('tolerates malformed task files and strips legacy review sections', async () => {
    await repository.ensureReady();
    await writeFile(
      path.join(activeDir, 'task_reviewsection-legacy.md'),
      `---\nid: task_reviewsection\ntitle: Legacy\nupdated: '2026-08-23T00:00:00.000Z'\n---\nDescription\n\n## Review Comments\n\n- old`,
      'utf8'
    );
    await writeFile(
      path.join(activeDir, 'task_invalidid-invalid.md'),
      `---\nid: invalid.id\n---\ninvalid`,
      'utf8'
    );
    await writeFile(
      path.join(activeDir, 'task_badyaml-invalid.md'),
      `---\ninvalid: [\n---\ninvalid`,
      'utf8'
    );

    await expect(repository.findActiveById('task_reviewsection')).resolves.toMatchObject({
      description: 'Description',
    });
    await expect(repository.listActive()).resolves.toHaveLength(1);
  });

  it('handles watcher filtering, reloads, removal errors, and startup failure', async () => {
    await repository.ensureReady();
    await writeFile(
      path.join(activeDir, 'task_watched-file.md'),
      `---\nid: task_watched\ntitle: Watched\nupdated: '2026-08-23T00:00:00.000Z'\n---\nwatched`,
      'utf8'
    );
    const listener = vi.fn();
    repository.watchActive(listener);
    repository.watchActive(listener);
    expect(watchMock).toHaveBeenCalledTimes(1);
    const callback = watchMock.mock.calls[0]?.[1] as (
      eventType: string,
      filename: string | null
    ) => void;
    callback('change', null);
    callback('change', 'ignored.txt');
    callback('change', 'task_watched-file.md');
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'task_watched-file.md',
          task: expect.objectContaining({ id: 'task_watched' }),
        })
      )
    );

    const readSpy = vi.spyOn(repository, 'readActiveFile');
    readSpy.mockRejectedValueOnce(Object.assign(new Error('removed'), { code: 'ENOENT' }));
    callback('rename', 'task_removed-file.md');
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith({ filename: 'task_removed-file.md', task: null })
    );
    readSpy.mockRejectedValueOnce(new Error('reload failed'));
    callback('change', 'task_failed-file.md');
    await vi.waitFor(() => expect(readSpy).toHaveBeenCalledTimes(2));

    const debounced = task('task_debounced');
    await repository.createActive(debounced);
    callback('change', repository.describeActiveTask(debounced).filename);

    const failed = new FileTaskRepository({
      activeDir: path.join(root, 'missing', 'active'),
      archiveDir: path.join(root, 'missing', 'archive'),
    });
    watchMock.mockImplementationOnce(() => {
      throw new Error('watch unavailable');
    });
    expect(() => failed.watchActive(vi.fn())).not.toThrow();
    failed.dispose();
  });

  it('tolerates vanished rename sources but surfaces non-file unlink failures', async () => {
    const vanished = task('task_vanished', 'Old');
    await repository.createActive(vanished);
    const vanishedPath = repository.describeActiveTask(vanished).path;
    await expect(
      repository.withActiveMutation(vanished.id, async (current, persist) => {
        await unlink(vanishedPath);
        await persist({ ...current, title: 'New' });
      })
    ).resolves.not.toBeNull();

    const blocked = task('task_blockedunlink', 'Old');
    await repository.createActive(blocked);
    const blockedPath = repository.describeActiveTask(blocked).path;
    await expect(
      repository.withActiveMutation(blocked.id, async (current, persist) => {
        await unlink(blockedPath);
        await mkdir(blockedPath);
        await persist({ ...current, title: 'New' });
      })
    ).rejects.toThrow();
  });
});
