import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ErrorLearningService, type ErrorAnalysis } from '../services/error-learning-service.js';
import {
  FileErrorAnalysisRepository,
  InMemoryErrorAnalysisRepository,
} from '../storage/error-analysis-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

function analysis(id: string): ErrorAnalysis {
  return {
    id,
    context: { errorMessage: `Failure ${id}`, occurredAt: '2026-08-23T20:00:00.000Z' },
    rootCause: '',
    summary: `Failure ${id}`,
    severity: 'medium',
    optionsConsidered: [],
    chosenFix: '',
    preventionSteps: [],
    tags: [],
    relatedTasks: [],
    isRepeat: false,
    previousOccurrences: [],
    analyzedAt: '2026-08-23T20:00:00.000Z',
  };
}

describe('FileErrorAnalysisRepository', () => {
  let root: string;
  let runtimeDir: string;
  let repository: FileErrorAnalysisRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-error-analysis-'));
    runtimeDir = path.join(root, 'runtime');
    repository = new FileErrorAnalysisRepository(runtimeDir, []);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads defaults and serializes concurrent updates', async () => {
    await expect(repository.read()).resolves.toEqual([]);
    await Promise.all([
      repository.update((analyses) => [...analyses, analysis('one')]),
      repository.update((analyses) => [...analyses, analysis('two')]),
    ]);
    expect((await repository.read()).map(({ id }) => id)).toEqual(
      expect.arrayContaining(['one', 'two'])
    );
  });

  it('migrates legacy data and tolerates malformed or non-array JSON', async () => {
    const legacyDir = path.join(root, 'legacy');
    await mkdir(legacyDir);
    await writeFile(
      path.join(legacyDir, 'error-analyses.json'),
      JSON.stringify([analysis('legacy')]),
      'utf8'
    );
    const migratingRepository = new FileErrorAnalysisRepository(runtimeDir, [legacyDir]);
    await expect(migratingRepository.read()).resolves.toEqual([analysis('legacy')]);

    await writeFile(path.join(runtimeDir, 'error-analyses.json'), '{broken', 'utf8');
    await expect(repository.read()).resolves.toEqual([]);
    await writeFile(path.join(runtimeDir, 'error-analyses.json'), '{}', 'utf8');
    await expect(repository.read()).resolves.toEqual([]);
  });

  it('rejects symbolic links, changed files, and non-file paths', async () => {
    await mkdir(runtimeDir, { recursive: true });
    const target = path.join(root, 'outside.json');
    await writeFile(target, '[]', 'utf8');
    await symlink(target, path.join(runtimeDir, 'error-analyses.json'));
    await expect(repository.read()).rejects.toThrow(/symbolic link/i);

    await rm(path.join(runtimeDir, 'error-analyses.json'));
    await writeFile(path.join(runtimeDir, 'error-analyses.json'), '[]', 'utf8');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementationOnce(async (filePath) => {
      const stats = await actual.lstat(filePath);
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });
    await expect(repository.read()).rejects.toThrow(/changed file/i);

    await rm(path.join(runtimeDir, 'error-analyses.json'));
    await mkdir(path.join(runtimeDir, 'error-analyses.json'));
    await expect(repository.read()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link directories and oversized state', async () => {
    const realDirectory = path.join(root, 'real-runtime');
    const linkedDirectory = path.join(root, 'linked-runtime');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileErrorAnalysisRepository(linkedDirectory, []);
    await expect(linkedRepository.update(() => [analysis('unsafe')])).rejects.toThrow(
      /regular directory/i
    );

    await expect(
      repository.update(() => [{ ...analysis('large'), summary: 'x'.repeat(16 * 1024 * 1024) }])
    ).rejects.toThrow(/16 MiB/i);
  });
});

describe('ErrorLearningService storage integration', () => {
  it('creates, detects repeats, updates, lists, searches, and summarizes analyses', async () => {
    const repository = new InMemoryErrorAnalysisRepository();
    await repository.update(() => []);
    const service = new ErrorLearningService(repository);
    const first = await service.submitError({ errorMessage: 'Build failed with timeout' });
    const second = await service.submitError({ errorMessage: 'Build failed with timeout again' });
    expect(second.isRepeat).toBe(true);

    const updated = await service.updateAnalysis(first.id, {
      rootCause: 'Dependency unavailable',
      preventionSteps: ['Retry with backoff'],
    });
    expect(updated?.rootCause).toBe('Dependency unavailable');
    await expect(service.getAnalysis(first.id)).resolves.toMatchObject({
      rootCause: 'Dependency unavailable',
    });
    await expect(service.listAnalyses({ severity: 'medium' })).resolves.toHaveLength(2);
    await expect(service.searchSimilar('dependency unavailable')).resolves.toHaveLength(1);
    await expect(service.getStats()).resolves.toMatchObject({
      totalAnalyses: 2,
      bySeverity: { medium: 2 },
      repeatRate: 0.5,
    });
  });
});
