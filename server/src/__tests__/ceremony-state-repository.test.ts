import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CeremonyRequirement } from '@veritas-kanban/shared';
import { CeremonyService } from '../services/ceremony-service.js';
import {
  FileCeremonyStateRepository,
  InMemoryCeremonyStateRepository,
} from '../storage/ceremony-state-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

function requirement(id: string): CeremonyRequirement {
  return {
    id,
    kind: 'design_review',
    status: 'pending',
    enforcementMode: 'warn',
    title: `Review ${id}`,
    reason: 'Test requirement',
    target: { taskId: `task-${id}` },
    trigger: 'task.completion',
    participants: [],
    requiredArtifacts: [],
    artifacts: [],
    actionItems: [],
    createdAt: '2026-08-23T20:00:00.000Z',
    updatedAt: '2026-08-23T20:00:00.000Z',
  };
}

describe('FileCeremonyStateRepository', () => {
  let root: string;
  let storageDir: string;
  let repository: FileCeremonyStateRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-ceremony-state-'));
    storageDir = path.join(root, 'ceremonies');
    repository = new FileCeremonyStateRepository(storageDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads defaults and persists normalized state', async () => {
    await expect(repository.read()).resolves.toMatchObject({ version: 1, requirements: [] });
    await repository.update((state) => ({
      ...state,
      requirements: [requirement('one')],
    }));
    await expect(repository.read()).resolves.toMatchObject({
      version: 1,
      requirements: [requirement('one')],
    });

    await writeFile(
      path.join(storageDir, 'requirements.json'),
      JSON.stringify({ version: 99, requirements: 'legacy' }),
      'utf8'
    );
    await expect(repository.read()).resolves.toMatchObject({ version: 1, requirements: [] });
  });

  it('serializes concurrent read-modify-write updates', async () => {
    await Promise.all([
      repository.update((state) => ({
        ...state,
        requirements: [...state.requirements, requirement('one')],
      })),
      repository.update((state) => ({
        ...state,
        requirements: [...state.requirements, requirement('two')],
      })),
    ]);

    expect((await repository.read()).requirements.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['one', 'two'])
    );
  });

  it('prevents duplicate requirements across concurrent service instances', async () => {
    const serviceOptions = {
      storageDir,
      persist: true,
      audit: vi.fn().mockResolvedValue(undefined),
      governanceTraceService: { record: vi.fn().mockResolvedValue({ id: 'trace-one' }) } as never,
    };
    const first = new CeremonyService(serviceOptions);
    const second = new CeremonyService(serviceOptions);
    const input = {
      kind: 'design_review' as const,
      enforcementMode: 'warn' as const,
      reason: 'Concurrent creation test',
      target: { taskId: 'task-concurrent' },
      trigger: 'task.completion' as const,
    };

    const [firstResult, secondResult] = await Promise.all([
      first.create(input),
      second.create(input),
    ]);

    expect(firstResult.id).toBe(secondResult.id);
    await expect(repository.read()).resolves.toMatchObject({
      requirements: [{ id: firstResult.id }],
    });
  });

  it('rejects symbolic links and non-file state paths', async () => {
    await mkdir(storageDir, { recursive: true });
    const target = path.join(root, 'outside.json');
    await writeFile(target, JSON.stringify({ version: 1, requirements: [] }), 'utf8');
    await symlink(target, path.join(storageDir, 'requirements.json'));
    await expect(repository.read()).rejects.toThrow(/symbolic link/i);

    await rm(path.join(storageDir, 'requirements.json'));
    await mkdir(path.join(storageDir, 'requirements.json'));
    await expect(repository.read()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects state replaced after its file handle is opened', async () => {
    await repository.update((state) => ({ ...state, requirements: [requirement('one')] }));
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementationOnce(async (filePath) => {
      const stats = await actual.lstat(filePath);
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });

    await expect(repository.read()).rejects.toThrow(/changed file/i);
  });

  it('rejects symbolic-link directories and oversized state', async () => {
    const realDirectory = path.join(root, 'real-ceremonies');
    const linkedDirectory = path.join(root, 'linked-ceremonies');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileCeremonyStateRepository(linkedDirectory);
    await expect(
      linkedRepository.update((state) => ({ ...state, requirements: [requirement('unsafe')] }))
    ).rejects.toThrow(/regular directory/i);

    await expect(
      repository.update((state) => ({
        ...state,
        requirements: [{ ...requirement('large'), reason: 'x'.repeat(16 * 1024 * 1024) }],
      }))
    ).rejects.toThrow(/16 MiB/i);
  });
});

describe('InMemoryCeremonyStateRepository', () => {
  it('reads and updates transient ceremony state', async () => {
    const repository = new InMemoryCeremonyStateRepository();
    await repository.update((state) => ({
      ...state,
      requirements: [requirement('memory')],
    }));

    await expect(repository.read()).resolves.toMatchObject({
      version: 1,
      requirements: [requirement('memory')],
    });
  });
});
