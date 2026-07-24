import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig, Task, UpdateTaskInput } from '@veritas-kanban/shared';
import {
  DefaultWorktreeGitRunner,
  WorktreeService,
  type WorktreeGitRunner,
} from '../services/worktree-service.js';
import { FileWorktreeManifestRepository } from '../storage/worktree-manifest-repository.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd });
  return result.stdout.trim();
}

class FakeTaskStore {
  failNextUpdate = false;

  constructor(public task: Task) {}

  async getTask(taskId: string): Promise<Task | null> {
    return taskId === this.task.id ? structuredClone(this.task) : null;
  }

  async updateTask(taskId: string, update: UpdateTaskInput): Promise<Task> {
    if (taskId !== this.task.id) throw new Error('task not found');
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('simulated task persistence failure');
    }
    this.task = {
      ...this.task,
      ...structuredClone(update),
      git: update.git
        ? ({ ...this.task.git, ...structuredClone(update.git) } as Task['git'])
        : this.task.git,
      updated: new Date().toISOString(),
    };
    return structuredClone(this.task);
  }
}

class MultiTaskStore {
  constructor(public tasks: Map<string, Task>) {}

  async getTask(taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }

  async updateTask(taskId: string, update: UpdateTaskInput): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('task not found');
    const updated = {
      ...task,
      ...structuredClone(update),
      git: update.git ? ({ ...task.git, ...structuredClone(update.git) } as Task['git']) : task.git,
      updated: new Date().toISOString(),
    };
    this.tasks.set(taskId, updated);
    return structuredClone(updated);
  }
}

describe('WorktreeService transactional lifecycle', () => {
  let root: string;
  let remotePath: string;
  let primaryPath: string;
  let worktreesDir: string;
  let taskStore: FakeTaskStore;
  let nowMs: number;
  let externalHoldState: 'clear' | 'held' | 'unavailable' = 'clear';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-worktree-service-'));
    remotePath = path.join(root, 'remote.git');
    primaryPath = path.join(root, 'primary');
    worktreesDir = path.join(root, 'runtime', 'worktrees');
    nowMs = Date.parse('2026-07-23T20:00:00.000Z');
    externalHoldState = 'clear';

    await fs.mkdir(remotePath, { recursive: true });
    await git(remotePath, 'init', '--bare', '--initial-branch=main');
    await git(root, 'clone', remotePath, primaryPath);
    await git(primaryPath, 'config', 'user.name', 'Veritas Test');
    await git(primaryPath, 'config', 'user.email', 'veritas@example.test');
    await fs.writeFile(path.join(primaryPath, 'README.md'), 'baseline\n');
    await git(primaryPath, 'add', 'README.md');
    await git(primaryPath, 'commit', '-m', 'baseline');
    await git(primaryPath, 'push', '-u', 'origin', 'main');

    taskStore = new FakeTaskStore({
      id: 'task_858',
      title: 'Remote-safe worktrees',
      description: '',
      type: 'code',
      status: 'todo',
      priority: 'high',
      created: '2026-07-23T19:00:00.000Z',
      updated: '2026-07-23T19:00:00.000Z',
      git: {
        repo: 'veritas',
        branch: 'feat/remote-safe-worktrees-858',
        baseBranch: 'main',
      },
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function service(gitRunner?: WorktreeGitRunner): WorktreeService {
    const config: AppConfig = {
      repos: [{ name: 'veritas', path: primaryPath, defaultBranch: 'main' }],
      agents: [],
      defaultAgent: 'codex',
    };
    return new WorktreeService({
      worktreesDir,
      taskService: taskStore,
      configService: { getConfig: async () => structuredClone(config) },
      manifestRepository: new FileWorktreeManifestRepository({
        manifestsDir: path.join(root, 'runtime', 'worktree-manifests'),
      }),
      externalHoldProbe: async () => ({
        state: externalHoldState,
        detail:
          externalHoldState === 'held'
            ? 'test process holds the worktree'
            : externalHoldState === 'unavailable'
              ? 'test probe is unavailable'
              : undefined,
      }),
      now: () => new Date(nowMs),
      ...(gitRunner ? { gitRunner } : {}),
    });
  }

  function manifestRepository(): FileWorktreeManifestRepository {
    return new FileWorktreeManifestRepository({
      manifestsDir: path.join(root, 'runtime', 'worktree-manifests'),
    });
  }

  it('waits for a timed-out Git child to close before rejecting the operation', async () => {
    const runner = new DefaultWorktreeGitRunner(100, process.execPath, 50);
    const startedAt = Date.now();

    await expect(
      runner.run(root, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"])
    ).rejects.toThrow(/timed out/i);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140);
  });

  it('resolves and persists the exact remote base commit before creating a unique worktree', async () => {
    const expectedBaseCommit = await git(primaryPath, 'rev-parse', 'refs/remotes/origin/main');

    const info = await service().createWorktree('task_858');
    const createdHead = await git(info.path, 'rev-parse', 'HEAD');

    expect(createdHead).toBe(expectedBaseCommit);
    expect(info.baseCommit).toBe(expectedBaseCommit);
    expect(info.baseSource).toBe('remote');
    expect(info.lifecycle.creation).toBe('ready');
    expect(taskStore.task.git).toMatchObject({
      worktreePath: info.path,
      worktreeManifestId: info.manifestId,
      worktreeBaseCommit: expectedBaseCommit,
      worktreeBaseSource: 'remote',
    });

    const claimed = await service().claimOwnership('task_858', 'attempt_858');
    expect(claimed.lease.ownerAttemptId).toBe('attempt_858');
    expect(taskStore.task.git?.worktreeLeaseOwnerAttemptId).toBe('attempt_858');
  });

  it('fails closed on fetch failure unless stale local state is explicitly acknowledged', async () => {
    await git(primaryPath, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
    const worktrees = service();

    await expect(worktrees.createWorktree('task_858')).rejects.toThrow(
      /fetch.*explicit stale-base acknowledgement/i
    );

    const info = await worktrees.createWorktree('task_858', {
      allowStaleBase: true,
      staleBaseAcknowledgement: {
        reason: 'Operator confirmed offline maintenance mode.',
        actor: 'operator:test',
      },
    });

    expect(info.baseSource).toBe('local-stale');
    expect(info.remoteState.stale).toBe(true);
    expect(info.manifest.base.staleBaseAcknowledgement?.reason).toBe(
      'Operator confirmed offline maintenance mode.'
    );
  });

  it('redacts URL credentials and query tokens from retained fetch diagnostics', async () => {
    const githubToken = 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const queryToken = 'query-secret-value-123456789';
    await git(
      primaryPath,
      'remote',
      'set-url',
      'origin',
      `https://operator:${githubToken}@example.invalid/repo.git?access_token=${queryToken}`
    );

    const info = await service().createWorktree('task_858', {
      allowStaleBase: true,
      staleBaseAcknowledgement: {
        reason: 'Offline test with a deliberately invalid credential-bearing URL.',
      },
    });
    const retained = JSON.stringify(info.manifest.base);

    expect(retained).not.toContain(githubToken);
    expect(retained).not.toContain(queryToken);
    expect(retained).toContain('[redacted]');
  });

  it('recovers creation after the git worktree succeeds but task persistence fails', async () => {
    const worktrees = service();
    taskStore.failNextUpdate = true;

    await expect(worktrees.createWorktree('task_858')).rejects.toThrow(/task persistence failure/);

    const persisted = await worktrees.getManifest('task_858');
    expect(persisted?.lifecycle.creation).toBe('ready');
    expect(persisted?.lastError?.operation).toBe('task-update');

    const recovered = await worktrees.createWorktree('task_858');
    expect(recovered.lifecycle.creation).toBe('ready');
    expect(taskStore.task.git?.worktreePath).toBe(recovered.path);
  });

  it('blocks active runs and previews dirty, untracked, unpushed, and unmerged hazards', async () => {
    const worktrees = service();
    const info = await worktrees.createWorktree('task_858');
    taskStore.task.attempt = {
      id: 'attempt_active',
      agent: 'codex',
      status: 'running',
    };

    const activePreview = await worktrees.previewCleanup('task_858');
    expect(activePreview.blockedReasons.map((reason) => reason.code)).toContain('active-run');
    await expect(worktrees.deleteWorktree('task_858')).rejects.toThrow(/active run/i);
    await expect(
      worktrees.deleteWorktree('task_858', {
        force: true,
        reason: 'Do not allow this override.',
      })
    ).rejects.toThrow(/active run/i);

    taskStore.task.attempt.status = 'complete';
    await fs.writeFile(path.join(info.path, 'untracked.txt'), 'untracked\n');
    await fs.writeFile(path.join(info.path, 'README.md'), 'feature\n');
    await git(info.path, 'add', 'README.md');
    await git(info.path, 'commit', '-m', 'feature commit');
    await fs.writeFile(path.join(info.path, 'README.md'), 'feature plus local edit\n');

    const hazardPreview = await worktrees.previewCleanup('task_858');
    expect(hazardPreview.blockedReasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(['dirty', 'untracked', 'unpushed', 'unmerged'])
    );

    await worktrees.deleteWorktree('task_858', {
      force: true,
      reason: 'Disposable test worktree; preserve branch for recovery.',
      actor: 'operator:test',
    });
    expect(taskStore.task.git?.worktreePath).toBeUndefined();
  });

  it('blocks an externally held worktree unless a reasoned override is supplied', async () => {
    const worktrees = service();
    await worktrees.createWorktree('task_858');
    externalHoldState = 'held';

    const preview = await worktrees.previewCleanup('task_858');
    expect(preview.blockedReasons.map((reason) => reason.code)).toContain('external-hold');
    await expect(worktrees.deleteWorktree('task_858')).rejects.toThrow(/externally held/i);

    await worktrees.deleteWorktree('task_858', {
      force: true,
      reason: 'The test hold is known and disposable.',
      actor: 'operator:test',
    });
  });

  it('requires an override when external hold inspection is unavailable', async () => {
    const worktrees = service();
    await worktrees.createWorktree('task_858');
    externalHoldState = 'unavailable';

    const preview = await worktrees.previewCleanup('task_858');
    expect(preview.eligible).toBe(false);
    expect(preview.blockedReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'inspection-failed', overrideable: true }),
      ])
    );
    await expect(worktrees.deleteWorktree('task_858')).rejects.toThrow(
      /inspection is unavailable/i
    );
  });

  it('enforces exclusive attempt claims and releases terminal ownership', async () => {
    const worktrees = service();
    await worktrees.createWorktree('task_858');
    await worktrees.claimOwnership('task_858', 'attempt_owner');

    await expect(worktrees.claimOwnership('task_858', 'attempt_competing')).rejects.toThrow(
      /already owned/i
    );
    await expect(worktrees.rebaseWorktree('task_858')).rejects.toThrow(
      /active attempt ownership lease/i
    );
    expect(
      (await worktrees.previewCleanup('task_858')).blockedReasons.map((reason) => reason.code)
    ).toContain('active-lease');

    await worktrees.releaseOwnership('task_858', 'attempt_owner');
    const claimed = await worktrees.claimOwnership('task_858', 'attempt_competing');
    expect(claimed.lease.ownerAttemptId).toBe('attempt_competing');
  });

  it('recovers cleanup when task metadata persistence fails after Git removal', async () => {
    const worktrees = service();
    const info = await worktrees.createWorktree('task_858');
    taskStore.failNextUpdate = true;

    await expect(worktrees.deleteWorktree('task_858')).rejects.toThrow(/task persistence failure/);
    await expect(fs.stat(info.path)).rejects.toThrow();
    expect(await worktrees.getManifest('task_858')).toMatchObject({
      lifecycle: { cleanup: 'failed' },
      lastError: { operation: 'task-update' },
    });

    const recovered = await worktrees.deleteWorktree('task_858');
    expect(recovered.lifecycle.cleanup).toBe('removed');
    expect(taskStore.task.git?.worktreePath).toBeUndefined();
  });

  it('integrates through a dedicated worktree without changing the primary checkout', async () => {
    const worktrees = service();
    const info = await worktrees.createWorktree('task_858');
    await fs.writeFile(path.join(info.path, 'feature.txt'), 'shipped\n');
    await git(info.path, 'add', 'feature.txt');
    await git(info.path, 'commit', '-m', 'ship feature');
    await fs.writeFile(path.join(primaryPath, 'operator-note.txt'), 'preserve me\n');

    const primaryBefore = {
      branch: await git(primaryPath, 'branch', '--show-current'),
      head: await git(primaryPath, 'rev-parse', 'HEAD'),
      status: await git(primaryPath, 'status', '--porcelain=v1', '--untracked-files=all'),
    };

    const result = await worktrees.mergeWorktree('task_858');
    const primaryAfter = {
      branch: await git(primaryPath, 'branch', '--show-current'),
      head: await git(primaryPath, 'rev-parse', 'HEAD'),
      status: await git(primaryPath, 'status', '--porcelain=v1', '--untracked-files=all'),
    };
    const remoteMain = await git(remotePath, 'rev-parse', 'refs/heads/main');

    expect(primaryAfter).toEqual(primaryBefore);
    expect(result.targetCommit).toBe(remoteMain);
    expect(taskStore.task.status).toBe('done');
    expect(taskStore.task.git?.worktreePath).toBeUndefined();
    expect((await worktrees.getManifest('task_858'))?.lifecycle.cleanup).toBe('removed');
  });

  it('persists a failed push and resumes it from the dedicated integration worktree', async () => {
    let failPush = true;
    const retryingRunner: WorktreeGitRunner = {
      run: async (cwd, args, options = {}) => {
        if (
          failPush &&
          args[0] === 'push' &&
          args[1] === 'origin' &&
          cwd.includes('.integration')
        ) {
          failPush = false;
          throw new Error('simulated remote push failure');
        }
        try {
          const result = await execFileAsync('git', args, { cwd });
          return { stdout: result.stdout, stderr: result.stderr, code: 0 };
        } catch (error) {
          const code = Number((error as { code?: number }).code);
          if (options.allowedExitCodes?.includes(code)) {
            return {
              stdout: String((error as { stdout?: string }).stdout ?? ''),
              stderr: String((error as { stderr?: string }).stderr ?? ''),
              code,
            };
          }
          throw error;
        }
      },
    };
    const worktrees = service(retryingRunner);
    const info = await worktrees.createWorktree('task_858');
    await fs.writeFile(path.join(info.path, 'retry.txt'), 'retry\n');
    await git(info.path, 'add', 'retry.txt');
    await git(info.path, 'commit', '-m', 'retryable integration');

    await expect(worktrees.mergeWorktree('task_858')).rejects.toThrow(
      /simulated remote push failure/
    );
    const failed = await worktrees.getManifest('task_858');
    expect(failed).toMatchObject({
      lifecycle: { integration: 'failed' },
      lastError: { operation: 'integration-push', recoverable: true },
    });
    if (!failed?.integration.worktreePath) throw new Error('missing recovery worktree path');
    expect(await fs.stat(failed.integration.worktreePath)).toBeDefined();

    const recovered = await worktrees.mergeWorktree('task_858');
    expect(recovered.merged).toBe(true);
    expect((await worktrees.getManifest('task_858'))?.lifecycle.cleanup).toBe('removed');
  });

  it('rejects a corrupted integration path before running a resumed push', async () => {
    let failPush = true;
    const runner: WorktreeGitRunner = {
      run: async (cwd, args, options = {}) => {
        if (failPush && args[0] === 'push' && cwd.includes('.integration')) {
          failPush = false;
          throw new Error('simulated push interruption');
        }
        try {
          const result = await execFileAsync('git', args, { cwd });
          return { stdout: result.stdout, stderr: result.stderr, code: 0 };
        } catch (error) {
          const code = Number((error as { code?: number }).code);
          if (options.allowedExitCodes?.includes(code)) {
            return {
              stdout: String((error as { stdout?: string }).stdout ?? ''),
              stderr: String((error as { stderr?: string }).stderr ?? ''),
              code,
            };
          }
          throw error;
        }
      },
    };
    const worktrees = service(runner);
    const info = await worktrees.createWorktree('task_858');
    await fs.writeFile(path.join(info.path, 'secure-resume.txt'), 'secure\n');
    await git(info.path, 'add', 'secure-resume.txt');
    await git(info.path, 'commit', '-m', 'secure integration resume');
    await expect(worktrees.mergeWorktree('task_858')).rejects.toThrow(/push interruption/);

    const repository = new FileWorktreeManifestRepository({
      manifestsDir: path.join(root, 'runtime', 'worktree-manifests'),
    });
    const manifest = await repository.read('task_858');
    if (!manifest) throw new Error('missing failed integration manifest');
    await repository.save({
      ...manifest,
      integration: {
        ...manifest.integration,
        worktreePath: primaryPath,
      },
    });

    await expect(service().mergeWorktree('task_858')).rejects.toThrow(/outside the base/i);
  });

  it('resumes a persisted preparing state after restart', async () => {
    const worktrees = service();
    const info = await worktrees.createWorktree('task_858');
    await fs.writeFile(path.join(info.path, 'prepare-restart.txt'), 'recover\n');
    await git(info.path, 'add', 'prepare-restart.txt');
    await git(info.path, 'commit', '-m', 'prepare restart');

    const manifest = await worktrees.getManifest('task_858');
    if (!manifest) throw new Error('missing worktree manifest');
    const integrationPath = path.join(
      worktreesDir,
      '.integration',
      `task_858-${manifest.id.slice(-8)}`
    );
    await manifestRepository().save({
      ...manifest,
      lifecycle: { ...manifest.lifecycle, integration: 'preparing' },
      integration: {
        worktreePath: integrationPath,
        baseCommit: manifest.base.commit,
        startedAt: new Date(nowMs).toISOString(),
      },
    });

    const recovered = await service().mergeWorktree('task_858');
    expect(recovered.merged).toBe(true);
    expect(recovered.manifest.lifecycle.cleanup).toBe('removed');
  });

  it('reconciles a restart after the remote accepted a push before state persisted', async () => {
    let reportCrashAfterPush = true;
    const crashAfterPushRunner: WorktreeGitRunner = {
      run: async (cwd, args, options = {}) => {
        try {
          const result = await execFileAsync('git', args, { cwd });
          if (
            reportCrashAfterPush &&
            args[0] === 'push' &&
            args[1] === 'origin' &&
            cwd.includes('.integration')
          ) {
            reportCrashAfterPush = false;
            throw new Error('simulated process death after push');
          }
          return { stdout: result.stdout, stderr: result.stderr, code: 0 };
        } catch (error) {
          const code = Number((error as { code?: number }).code);
          if (options.allowedExitCodes?.includes(code)) {
            return {
              stdout: String((error as { stdout?: string }).stdout ?? ''),
              stderr: String((error as { stderr?: string }).stderr ?? ''),
              code,
            };
          }
          throw error;
        }
      },
    };
    const worktrees = service(crashAfterPushRunner);
    const info = await worktrees.createWorktree('task_858');
    await fs.writeFile(path.join(info.path, 'landed.txt'), 'landed\n');
    await git(info.path, 'add', 'landed.txt');
    await git(info.path, 'commit', '-m', 'land before crash');

    await expect(worktrees.mergeWorktree('task_858')).rejects.toThrow(/process death after push/);
    const failed = await worktrees.getManifest('task_858');
    expect(failed).toMatchObject({
      lifecycle: { integration: 'failed' },
      lastError: { operation: 'integration-push' },
    });
    expect(await git(remotePath, 'rev-parse', 'refs/heads/main')).toBe(
      failed?.integration.integrationHead
    );
    if (!failed) throw new Error('missing failed push manifest');
    await manifestRepository().save({
      ...failed,
      lifecycle: { ...failed.lifecycle, integration: 'pushing' },
      lastError: undefined,
    });

    const recovered = await service().mergeWorktree('task_858');
    expect(recovered.merged).toBe(true);
    expect(recovered.manifest.lifecycle.cleanup).toBe('removed');
  });

  it('reconciles a restart after merge completion before the pushing state persisted', async () => {
    let reportCrashAfterMerge = true;
    const crashAfterMergeRunner: WorktreeGitRunner = {
      run: async (cwd, args, options = {}) => {
        try {
          const result = await execFileAsync('git', args, { cwd });
          if (
            reportCrashAfterMerge &&
            args[0] === 'merge' &&
            args.includes('--no-ff') &&
            cwd.includes('.integration')
          ) {
            reportCrashAfterMerge = false;
            throw new Error('simulated process death after merge');
          }
          return { stdout: result.stdout, stderr: result.stderr, code: 0 };
        } catch (error) {
          const code = Number((error as { code?: number }).code);
          if (options.allowedExitCodes?.includes(code)) {
            return {
              stdout: String((error as { stdout?: string }).stdout ?? ''),
              stderr: String((error as { stderr?: string }).stderr ?? ''),
              code,
            };
          }
          throw error;
        }
      },
    };
    const worktrees = service(crashAfterMergeRunner);
    const info = await worktrees.createWorktree('task_858');
    await fs.writeFile(path.join(info.path, 'merge-crash.txt'), 'recover\n');
    await git(info.path, 'add', 'merge-crash.txt');
    await git(info.path, 'commit', '-m', 'merge before crash');

    await expect(worktrees.mergeWorktree('task_858')).rejects.toThrow(/process death after merge/);
    expect(await worktrees.getManifest('task_858')).toMatchObject({
      lifecycle: { integration: 'failed' },
      lastError: { operation: 'integration-merge' },
    });
    const failed = await worktrees.getManifest('task_858');
    if (!failed) throw new Error('missing failed merge manifest');
    await manifestRepository().save({
      ...failed,
      lifecycle: { ...failed.lifecycle, integration: 'merging' },
      lastError: undefined,
    });

    const recovered = await service().mergeWorktree('task_858');
    expect(recovered.merged).toBe(true);
  });

  it('persists rebase intent and recovers after the Git rebase completed before state persisted', async () => {
    let reportCrashAfterRebase = true;
    const crashAfterRebaseRunner: WorktreeGitRunner = {
      run: async (cwd, args, options = {}) => {
        try {
          const result = await execFileAsync('git', args, { cwd });
          if (reportCrashAfterRebase && args[0] === 'rebase' && args[1] !== '--abort') {
            reportCrashAfterRebase = false;
            throw new Error('simulated process death after rebase');
          }
          return { stdout: result.stdout, stderr: result.stderr, code: 0 };
        } catch (error) {
          const code = Number((error as { code?: number }).code);
          if (options.allowedExitCodes?.includes(code)) {
            return {
              stdout: String((error as { stdout?: string }).stdout ?? ''),
              stderr: String((error as { stderr?: string }).stderr ?? ''),
              code,
            };
          }
          throw error;
        }
      },
    };
    const worktrees = service(crashAfterRebaseRunner);
    await worktrees.createWorktree('task_858');

    await expect(worktrees.rebaseWorktree('task_858')).rejects.toThrow(
      /process death after rebase/
    );
    expect(await worktrees.getManifest('task_858')).toMatchObject({
      rebase: {
        state: 'failed',
        targetBase: { source: 'remote' },
      },
      lastError: { operation: 'rebase' },
    });
    const failed = await worktrees.getManifest('task_858');
    if (!failed) throw new Error('missing failed rebase manifest');
    await manifestRepository().save({
      ...failed,
      rebase: { ...failed.rebase, state: 'rebasing' },
      lastError: undefined,
    });

    const recovered = await service().rebaseWorktree('task_858');
    expect(recovered.manifest.rebase.state).toBe('idle');
    expect(recovered.manifest.rebase.completedAt).toBeDefined();
  });

  it('serializes cross-task allocation for the same repository branch', async () => {
    const secondTask: Task = {
      ...structuredClone(taskStore.task),
      id: 'task_858_competing',
      title: 'Competing allocation',
    };
    const tasks = new MultiTaskStore(
      new Map([
        [taskStore.task.id, structuredClone(taskStore.task)],
        [secondTask.id, secondTask],
      ])
    );
    const config: AppConfig = {
      repos: [{ name: 'veritas', path: primaryPath, defaultBranch: 'main' }],
      agents: [],
      defaultAgent: 'codex',
    };
    const manifestsDir = path.join(root, 'runtime', 'worktree-manifests');
    const makeService = () =>
      new WorktreeService({
        worktreesDir,
        taskService: tasks,
        configService: { getConfig: async () => structuredClone(config) },
        manifestRepository: new FileWorktreeManifestRepository({ manifestsDir }),
        externalHoldProbe: async () => ({ state: 'clear' }),
        now: () => new Date(nowMs),
      });

    const results = await Promise.allSettled([
      makeService().createWorktree('task_858'),
      makeService().createWorktree('task_858_competing'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const manifests = await new FileWorktreeManifestRepository({ manifestsDir }).list();
    expect(manifests.filter((manifest) => manifest.lifecycle.cleanup !== 'removed')).toHaveLength(
      1
    );
  });

  it('adopts a validated legacy worktree without discarding local changes', async () => {
    const legacyPath = path.join(root, 'legacy-worktree');
    await git(
      primaryPath,
      'worktree',
      'add',
      '-b',
      taskStore.task.git?.branch as string,
      legacyPath,
      'main'
    );
    await fs.writeFile(path.join(legacyPath, 'legacy-untracked.txt'), 'preserve\n');
    taskStore.task.git = {
      ...taskStore.task.git,
      worktreePath: legacyPath,
    };

    const adopted = await service().adoptLegacyWorktree('task_858');

    expect(adopted.path).toBe(await fs.realpath(legacyPath));
    expect(adopted.manifest.lifecycle.creation).toBe('ready');
    expect(adopted.baseSource).toBe('legacy-adopted');
    expect(adopted.cleanupPreview.blockedReasons.map((reason) => reason.code)).toContain(
      'untracked'
    );
    expect(await fs.readFile(path.join(legacyPath, 'legacy-untracked.txt'), 'utf8')).toBe(
      'preserve\n'
    );
  });

  it('returns preview-first stale cleanup candidates without removing them', async () => {
    const worktrees = service();
    const info = await worktrees.createWorktree('task_858', { leaseSeconds: 60 });
    nowMs += 120_000;

    const candidates = await worktrees.previewCleanupCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      taskId: 'task_858',
      path: info.path,
      stale: true,
    });
    expect(await fs.stat(info.path)).toBeDefined();
  });
});
