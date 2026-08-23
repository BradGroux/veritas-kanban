import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileWorkflowExecutionFileRepository } from '../storage/workflow-execution-file-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

describe('FileWorkflowExecutionFileRepository', () => {
  let root: string;
  let runsDir: string;
  let repository: FileWorkflowExecutionFileRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-workflow-files-'));
    runsDir = path.join(root, 'runs');
    repository = new FileWorkflowExecutionFileRepository(runsDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('atomically writes outputs and preserves concurrent progress appends', async () => {
    const outputPath = await repository.writeStepOutput('run-1', 'result.md', 'complete');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('complete');

    await Promise.all([
      repository.appendProgress('run-1', 'step one\n'),
      repository.appendProgress('run-1', 'step two\n'),
    ]);
    const progress = await repository.readProgress('run-1');
    expect(progress).toContain('step one');
    expect(progress).toContain('step two');
  });

  it('rejects traversal, symbolic links, changed files, and non-files', async () => {
    await expect(repository.readProgress('../outside')).rejects.toThrow(/traversal/i);
    await mkdir(path.join(runsDir, 'run-1'), { recursive: true });
    const progressPath = path.join(runsDir, 'run-1', 'progress.md');
    const target = path.join(root, 'outside.md');
    await writeFile(target, 'outside', 'utf8');
    await symlink(target, progressPath);
    await expect(repository.readProgress('run-1')).rejects.toThrow(/symbolic link/i);

    await rm(progressPath);
    await writeFile(progressPath, 'current', 'utf8');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementation(async (filePath) => {
      const stats = await actual.lstat(filePath);
      if (path.resolve(String(filePath)) !== progressPath) return stats;
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });
    await expect(repository.readProgress('run-1')).rejects.toThrow(/changed file/i);
    vi.mocked(lstat).mockImplementation(actual.lstat);

    await rm(progressPath);
    await mkdir(progressPath);
    await expect(repository.readProgress('run-1')).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link directories and oversized content', async () => {
    const realRuns = path.join(root, 'real-runs');
    const linkedRuns = path.join(root, 'linked-runs');
    await mkdir(realRuns);
    await symlink(realRuns, linkedRuns, 'dir');
    const linkedRepository = new FileWorkflowExecutionFileRepository(linkedRuns);
    await expect(linkedRepository.appendProgress('run-1', 'entry')).rejects.toThrow(
      /regular directory/i
    );

    await expect(
      repository.writeStepOutput('run-1', 'large.md', 'x'.repeat(16 * 1024 * 1024 + 1))
    ).rejects.toThrow(/16 MiB/i);
    const oversizedProgress = await repository.appendProgress(
      'run-1',
      'x'.repeat(10 * 1024 * 1024 + 1)
    );
    expect(oversizedProgress).toEqual({ appended: false, size: 0 });
  });
});
