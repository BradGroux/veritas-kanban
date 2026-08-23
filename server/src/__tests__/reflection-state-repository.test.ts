import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReflectionCandidate } from '@veritas-kanban/shared';
import { FileReflectionStateRepository } from '../storage/reflection-state-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

function candidate(id: string, summary = id): ReflectionCandidate {
  return {
    id,
    status: 'pending',
    category: 'team',
    promotionTarget: 'memory',
    confidence: 0.5,
    source: { kind: 'user-correction' },
    summary,
    previousApproach: 'old',
    correction: 'new',
    nextAttempt: 'retry',
    evidence: [],
    tags: [],
    duplicateKey: id,
    duplicateCount: 1,
    appliedTargets: [],
    redaction: { redacted: false, notes: [] },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
}

describe('FileReflectionStateRepository', () => {
  let root: string;
  let storageDir: string;
  let repository: FileReflectionStateRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-reflection-state-'));
    storageDir = path.join(root, 'reflections');
    repository = new FileReflectionStateRepository(storageDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads missing state and atomically replaces normalized state', async () => {
    await expect(repository.read()).resolves.toBeNull();
    const state = {
      version: 1 as const,
      candidates: [candidate('one')],
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    await repository.write(state);
    await expect(repository.read()).resolves.toEqual(state);
    await repository.write({ ...state, candidates: [candidate('two')] });
    await expect(repository.read()).resolves.toEqual({
      ...state,
      candidates: [candidate('two')],
    });
  });

  it('rejects symbolic links, changed files, and non-file paths', async () => {
    await mkdir(storageDir, { recursive: true });
    const stateFile = path.join(storageDir, 'candidates.json');
    const target = path.join(root, 'outside.json');
    await writeFile(target, JSON.stringify({ version: 1, candidates: [] }), 'utf8');
    await symlink(target, stateFile);
    await expect(repository.read()).rejects.toThrow(/symbolic link/i);

    await rm(stateFile);
    await writeFile(stateFile, JSON.stringify({ version: 1, candidates: [] }), 'utf8');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementationOnce(async (filePath) => {
      const stats = await actual.lstat(filePath);
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });
    await expect(repository.read()).rejects.toThrow(/changed file/i);

    await rm(stateFile);
    await mkdir(stateFile);
    await expect(repository.read()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link directories and oversized state', async () => {
    const realDirectory = path.join(root, 'real-reflections');
    const linkedDirectory = path.join(root, 'linked-reflections');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileReflectionStateRepository(linkedDirectory);
    await expect(
      linkedRepository.write({
        version: 1,
        candidates: [],
        updatedAt: '2026-08-23T00:00:00.000Z',
      })
    ).rejects.toThrow(/regular directory/i);

    await expect(
      repository.write({
        version: 1,
        candidates: [candidate('large', 'x'.repeat(16 * 1024 * 1024))],
        updatedAt: '2026-08-23T00:00:00.000Z',
      })
    ).rejects.toThrow(/16 MiB/i);
  });
});
