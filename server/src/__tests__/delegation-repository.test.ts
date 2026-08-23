import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DelegationApproval, DelegationSettings } from '@veritas-kanban/shared';
import { FileDelegationRepository } from '../storage/delegation-repository.js';

function settings(delegateAgent: string): DelegationSettings {
  return {
    enabled: true,
    delegateAgent,
    expires: '2026-08-24T00:00:00.000Z',
    scope: { type: 'all' },
    createdAt: '2026-08-23T20:00:00.000Z',
    createdBy: 'brad',
  };
}

function approval(id: string): DelegationApproval {
  return {
    id,
    taskId: `task-${id}`,
    taskTitle: `Task ${id}`,
    agent: 'TARS',
    delegated: true,
    timestamp: '2026-08-23T20:00:00.000Z',
    originalDelegation: 'TARS_2026-08-23T20:00:00.000Z',
  };
}

describe('FileDelegationRepository', () => {
  let root: string;
  let runtimeDir: string;
  let repository: FileDelegationRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-delegation-repository-'));
    runtimeDir = path.join(root, 'runtime');
    repository = new FileDelegationRepository(runtimeDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads defaults and persists settings and approvals', async () => {
    await expect(repository.readSettings()).resolves.toBeNull();
    await expect(repository.readLog()).resolves.toEqual({ approvals: [] });

    await repository.writeSettings(settings('TARS'));
    await repository.updateLog(() => ({ approvals: [approval('one')] }));

    await expect(repository.readSettings()).resolves.toEqual(settings('TARS'));
    await expect(repository.readLog()).resolves.toEqual({ approvals: [approval('one')] });
    await expect(readFile(path.join(runtimeDir, 'delegation.json'), 'utf8')).resolves.toContain(
      '"delegateAgent": "TARS"'
    );
  });

  it('serializes concurrent settings and log updates', async () => {
    await repository.writeSettings(settings('TARS'));
    await Promise.all([
      repository.updateSettings((current) =>
        current ? { ...current, excludeTags: [...(current.excludeTags ?? []), 'private'] } : null
      ),
      repository.updateSettings((current) =>
        current ? { ...current, excludeTags: [...(current.excludeTags ?? []), 'blocked'] } : null
      ),
    ]);
    await Promise.all([
      repository.updateLog((current) => ({ approvals: [...current.approvals, approval('one')] })),
      repository.updateLog((current) => ({ approvals: [...current.approvals, approval('two')] })),
    ]);

    expect((await repository.readSettings())?.excludeTags).toEqual(
      expect.arrayContaining(['private', 'blocked'])
    );
    expect((await repository.readLog()).approvals.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['one', 'two'])
    );
  });

  it('rejects symbolic links and non-file state paths', async () => {
    await mkdir(runtimeDir, { recursive: true });
    const target = path.join(root, 'outside.json');
    await writeFile(target, JSON.stringify(settings('CASE')), 'utf8');
    await symlink(target, path.join(runtimeDir, 'delegation.json'));
    await expect(repository.readSettings()).rejects.toThrow(/symbolic link/i);

    await mkdir(path.join(runtimeDir, 'delegation-log.json'));
    await expect(repository.readLog()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link directories and oversized state', async () => {
    const realDirectory = path.join(root, 'real-runtime');
    const linkedDirectory = path.join(root, 'linked-runtime');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileDelegationRepository(linkedDirectory);
    await expect(linkedRepository.writeSettings(settings('TARS'))).rejects.toThrow(
      /regular directory/i
    );

    await expect(
      repository.writeSettings({ ...settings('TARS'), excludeTags: ['x'.repeat(4 * 1024 * 1024)] })
    ).rejects.toThrow(/4 MiB/i);
  });
});
