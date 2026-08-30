import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowDefinition, WorkflowRun } from '../types/workflow.js';
import { FileWorkflowRunRepository } from '../storage/workflow-run-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

function run(id: string, revision = 1, startedAt = '2026-08-23T00:00:00.000Z'): WorkflowRun {
  return {
    id,
    workflowId: 'workflow-1',
    workflowVersion: 1,
    status: 'running',
    context: {},
    steps: [],
    startedAt,
    revision,
  };
}

describe('FileWorkflowRunRepository', () => {
  let root: string;
  let runsDir: string;
  let repository: FileWorkflowRunRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-workflow-runs-'));
    runsDir = path.join(root, 'runs');
    repository = new FileWorkflowRunRepository(runsDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('enforces revisions and preserves one concurrent winner', async () => {
    await expect(repository.get('run_one')).resolves.toBeNull();
    await expect(repository.save(run('run_one'), 0)).resolves.toBe(true);
    const results = await Promise.all([
      repository.save(run('run_one', 2), 1),
      repository.save({ ...run('run_one', 2), status: 'completed' }, 1),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(repository.save(run('run_one', 3), 1)).resolves.toBe(false);
    await expect(repository.get('run_one')).resolves.toMatchObject({ revision: 2 });
  });

  it('lists filtered runs and writes immutable workflow snapshots', async () => {
    await repository.save(run('run_old', 1, '2026-08-22T00:00:00.000Z'), 0);
    await repository.save(run('run_new', 1, '2026-08-23T00:00:00.000Z'), 0);
    await expect(repository.list({ workflowId: 'workflow-1' })).resolves.toMatchObject([
      { id: 'run_new' },
      { id: 'run_old' },
    ]);
    await expect(repository.listMetadata({ status: 'missing' })).resolves.toEqual([]);

    await repository.saveWorkflowSnapshot('run_new', {
      id: 'workflow-1',
      name: 'Workflow',
      version: 1,
      steps: [],
    } as WorkflowDefinition);
    await expect(
      readFile(path.join(runsDir, 'run_new', 'workflow.yml'), 'utf8')
    ).resolves.toContain('workflow-1');
  });

  it('retries when an atomic write replaces the path after open', async () => {
    await repository.save(run('run_replaced'), 0);
    const runPath = path.join(runsDir, 'run_replaced', 'run.json');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let pathChecks = 0;
    vi.mocked(lstat).mockImplementation(async (filePath) => {
      const stats = await actual.lstat(filePath);
      if (path.resolve(String(filePath)) !== runPath || pathChecks++ > 0) return stats;
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });

    await expect(repository.get('run_replaced')).resolves.toMatchObject({ id: 'run_replaced' });
    expect(pathChecks).toBe(2);
  });

  it('rejects symbolic links, changed files, and non-file state', async () => {
    const runDir = path.join(runsDir, 'run_unsafe');
    await mkdir(runDir, { recursive: true });
    const runPath = path.join(runDir, 'run.json');
    const target = path.join(root, 'outside.json');
    await writeFile(target, JSON.stringify(run('run_unsafe')), 'utf8');
    await symlink(target, runPath);
    await expect(repository.get('run_unsafe')).rejects.toThrow(/symbolic link/i);

    await rm(runPath);
    await writeFile(runPath, JSON.stringify(run('run_unsafe')), 'utf8');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementation(async (filePath) => {
      const stats = await actual.lstat(filePath);
      if (path.resolve(String(filePath)) !== runPath) return stats;
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });
    await expect(repository.get('run_unsafe')).rejects.toThrow(/changed file/i);
    vi.mocked(lstat).mockImplementation(actual.lstat);

    await rm(runPath);
    await mkdir(runPath);
    await expect(repository.get('run_unsafe')).rejects.toThrow(/bounded regular file/i);
  });

  it('fails closed for oversized content and unsafe run directories', async () => {
    await expect(
      repository.save(
        {
          ...run('run_oversized'),
          context: { payload: 'x'.repeat(16 * 1024 * 1024) },
        },
        0
      )
    ).rejects.toThrow(/16 MiB storage limit/);
    await expect(
      repository.saveWorkflowSnapshot('run_snapshot', {
        id: 'workflow-1',
        name: 'x'.repeat(4 * 1024 * 1024),
        version: 1,
        steps: [],
      } as WorkflowDefinition)
    ).rejects.toThrow(/4 MiB storage limit/);

    await mkdir(path.join(runsDir, 'run_..invalid'), { recursive: true });
    await expect(repository.list()).resolves.toEqual([]);

    await rm(runsDir, { recursive: true });
    await writeFile(runsDir, 'not a directory', 'utf8');
    await expect(repository.list()).rejects.toThrow();
    await expect(repository.get('run_regular')).rejects.toThrow(/regular directory/i);

    await rm(runsDir);
    const targetDir = path.join(root, 'linked-runs');
    await mkdir(targetDir);
    await symlink(targetDir, runsDir);
    await expect(repository.list()).rejects.toThrow(/regular directory/i);
    await expect(repository.save(run('run_linked'), 0)).rejects.toThrow(/regular directory/i);
  });
});
