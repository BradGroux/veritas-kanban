import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, Task } from '@veritas-kanban/shared';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const execFileAsync = promisify(execFile);
const fixtures = vi.hoisted(() => ({
  config: undefined as AppConfig | undefined,
  task: undefined as Task | undefined,
}));

vi.mock('../services/config-service.js', () => ({
  ConfigService: class MockConfigService {
    async getConfig(): Promise<AppConfig> {
      if (!fixtures.config) throw new Error('config fixture is not initialized');
      return structuredClone(fixtures.config);
    }
  },
}));

vi.mock('../services/task-service.js', () => ({
  TaskService: class MockTaskService {
    async getTask(taskId: string): Promise<Task | null> {
      return fixtures.task?.id === taskId ? structuredClone(fixtures.task) : null;
    }

    async updateTask(): Promise<Task> {
      if (!fixtures.task) throw new Error('task fixture is not initialized');
      return structuredClone(fixtures.task);
    }
  },
}));

import { GitHubService, githubRepositoryFromRemote } from '../services/github-service.js';
import {
  WorktreeService,
  type WorktreePublicationAuthority,
} from '../services/worktree-service.js';
import { FileWorktreeManifestRepository } from '../storage/worktree-manifest-repository.js';
import { errorHandler } from '../middleware/error-handler.js';
import { createGitHubPRHandler } from '../routes/github.js';
import { taskAccess } from '../routes/v1/permissions.js';

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd });
  return result.stdout.trim();
}

describe('GitHubService repository publication boundary', () => {
  let root: string;
  let remotePath: string;
  let primaryPath: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-github-service-'));
    remotePath = path.join(root, 'remote.git');
    primaryPath = path.join(root, 'primary');
    originalPath = process.env.PATH;

    await fs.mkdir(remotePath, { recursive: true });
    await git(remotePath, 'init', '--bare', '--initial-branch=main');
    await git(root, 'clone', remotePath, primaryPath);
    await git(primaryPath, 'config', 'user.name', 'Veritas Test');
    await git(primaryPath, 'config', 'user.email', 'veritas@example.test');
    await fs.writeFile(path.join(primaryPath, 'README.md'), 'baseline\n');
    await git(primaryPath, 'add', 'README.md');
    await git(primaryPath, 'commit', '-m', 'baseline');
    await git(primaryPath, 'push', '-u', 'origin', 'main');
    await git(primaryPath, 'remote', 'set-url', 'origin', `file://${remotePath}`);

    fixtures.config = {
      repos: [{ name: 'veritas', path: primaryPath, defaultBranch: 'main' }],
      agents: [],
      defaultAgent: 'codex',
    };
    fixtures.task = {
      id: 'task_publication',
      title: 'Repository publication boundary',
      description: '',
      type: 'code',
      status: 'todo',
      priority: 'high',
      created: '2026-09-02T12:00:00.000Z',
      updated: '2026-09-02T12:00:00.000Z',
      git: {
        repo: 'veritas',
        branch: 'HEAD:refs/heads/canary',
        baseBranch: 'main',
        worktreePath: primaryPath,
      },
    };
  });

  afterEach(async () => {
    fixtures.config = undefined;
    fixtures.task = undefined;
    process.env.PATH = originalPath;
    delete process.env.GH_ARGS_FILE;
    delete process.env.GH_LIST_JSON;
    await fs.rm(root, { recursive: true, force: true });
  });

  function managedServices(): {
    taskStore: {
      getTask(taskId: string): Promise<Task | null>;
      updateTask(taskId: string, update: Partial<Task>): Promise<Task | null>;
    };
    configSource: { getConfig(): Promise<AppConfig> };
    worktreeService: WorktreeService;
    manifestRepository: FileWorktreeManifestRepository;
  } {
    const taskStore = {
      async getTask(taskId: string): Promise<Task | null> {
        return fixtures.task?.id === taskId ? structuredClone(fixtures.task) : null;
      },
      async updateTask(taskId: string, update: Partial<Task>): Promise<Task | null> {
        if (!fixtures.task || fixtures.task.id !== taskId) return null;
        fixtures.task = {
          ...fixtures.task,
          ...structuredClone(update),
          git: update.git
            ? ({ ...fixtures.task.git, ...structuredClone(update.git) } as Task['git'])
            : fixtures.task.git,
        };
        return structuredClone(fixtures.task);
      },
    };
    const configSource = {
      async getConfig(): Promise<AppConfig> {
        if (!fixtures.config) throw new Error('config fixture is not initialized');
        return structuredClone(fixtures.config);
      },
    };
    const manifestRepository = new FileWorktreeManifestRepository({
      manifestsDir: path.join(root, 'worktree-manifests'),
    });
    const worktreeService = new WorktreeService({
      worktreesDir: path.join(root, 'worktrees'),
      taskService: taskStore,
      configService: configSource,
      manifestRepository,
    });
    return { taskStore, configSource, worktreeService, manifestRepository };
  }

  it('derives only a credential-free GitHub repository slug from verified remotes', () => {
    expect(
      githubRepositoryFromRemote(
        'https://publication-token:secret-value@github.com/BradGroux/veritas-kanban.git'
      )
    ).toBe('BradGroux/veritas-kanban');
    expect(githubRepositoryFromRemote('git@github.com:BradGroux/veritas-kanban.git')).toBe(
      'BradGroux/veritas-kanban'
    );
  });

  async function prepareManagedBranch(
    remoteBehind = false
  ): Promise<ReturnType<typeof managedServices>> {
    fixtures.task = {
      ...fixtures.task!,
      git: {
        repo: 'veritas',
        branch: 'feature/repository-publication',
        baseBranch: 'main',
      },
    };
    const services = managedServices();
    const info = await services.worktreeService.createWorktree('task_publication');
    if (remoteBehind) {
      await git(info.path, 'push', '-u', 'origin', 'feature/repository-publication');
    }
    await fs.writeFile(path.join(info.path, 'change.txt'), 'managed change\n');
    await git(info.path, 'add', 'change.txt');
    await git(info.path, 'commit', '-m', 'managed change');
    return services;
  }

  async function installFakeGh(): Promise<string> {
    const binDir = path.join(root, 'bin');
    const argsFile = path.join(root, 'gh-args.txt');
    const ghPath = path.join(binDir, 'gh');
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(
      ghPath,
      '#!/bin/sh\nif [ "$1" = "repo" ] && [ "$2" = "view" ]; then\n  printf \'%s\\n\' \'{"nameWithOwner":"BradGroux/veritas-kanban"}\'\n  exit 0\nfi\nif [ "$1" = "pr" ] && [ "$2" = "list" ]; then\n  printf \'%s\\n\' "$GH_LIST_JSON"\n  exit 0\nfi\nprintf \'%s\\n\' "$@" > "$GH_ARGS_FILE"\nprintf \'https://github.com/example/repo/pull/17\\n\'\n'
    );
    await fs.chmod(ghPath, 0o755);
    process.env.PATH = `${binDir}:${originalPath ?? ''}`;
    process.env.GH_ARGS_FILE = argsFile;
    return argsFile;
  }

  it.each(['HEAD:refs/heads/canary', '+HEAD:refs/heads/main'])(
    'rejects stored refspec-shaped branch %s before it mutates the remote',
    async (hostileBranch) => {
      const { taskStore, configSource, worktreeService, manifestRepository } =
        await prepareManagedBranch();
      const manifest = await manifestRepository.read('task_publication');
      if (!manifest) throw new Error('managed manifest was not created');
      await taskStore.updateTask('task_publication', {
        git: { ...fixtures.task?.git, branch: hostileBranch },
      });
      await manifestRepository.save({ ...manifest, branch: hostileBranch });
      const mainBefore = await git(remotePath, 'rev-parse', 'refs/heads/main');
      const service = new GitHubService({
        taskService: taskStore,
        configService: configSource,
        worktreeService,
      });

      await expect(service.createPR({ taskId: 'task_publication' })).rejects.toThrow(
        /Invalid Git branch name/i
      );

      expect(await git(remotePath, 'rev-parse', 'refs/heads/main')).toBe(mainBefore);
      await expect(git(remotePath, 'show-ref', '--verify', 'refs/heads/canary')).rejects.toThrow();
    }
  );

  it('rejects legacy task paths until the existing adoption flow records authority', async () => {
    fixtures.task = {
      ...fixtures.task!,
      git: {
        repo: 'veritas',
        branch: 'feature/legacy-publication',
        baseBranch: 'main',
        worktreePath: primaryPath,
      },
    };
    const { taskStore, configSource, worktreeService } = managedServices();
    const service = new GitHubService({
      taskService: taskStore,
      configService: configSource,
      worktreeService,
      repositoryResolver: () => 'BradGroux/veritas-kanban',
    });

    await expect(service.createPR({ taskId: 'task_publication' })).rejects.toThrow(
      /requires an active managed worktree/i
    );
  });

  it('publishes only the exact managed branch to a throwaway bare remote', async () => {
    const { taskStore, configSource, worktreeService } = await prepareManagedBranch(true);
    const argsFile = await installFakeGh();
    const service = new GitHubService({
      taskService: taskStore,
      configService: configSource,
      worktreeService,
      repositoryResolver: () => 'BradGroux/veritas-kanban',
    });
    vi.spyOn(service, 'checkGhCli').mockResolvedValue({
      installed: true,
      authenticated: true,
      user: 'VeritasTest',
    });
    vi.spyOn(service, 'getPRForBranch').mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const result = await service.createPR({ taskId: 'task_publication' });
    const worktreePath = fixtures.task!.git!.worktreePath!;

    expect(result.url).toBe('https://github.com/example/repo/pull/17');
    expect(await git(remotePath, 'rev-parse', 'refs/heads/feature/repository-publication')).toBe(
      await git(worktreePath, 'rev-parse', 'HEAD')
    );
    expect((await fs.readFile(argsFile, 'utf8')).split('\n')).toEqual(
      expect.arrayContaining(['--base', 'main', '--head', 'feature/repository-publication'])
    );
  });

  it('enforces the publication boundary for an authenticated agent task-write request', async () => {
    const { taskStore, configSource, worktreeService } = await prepareManagedBranch(true);
    await installFakeGh();
    const service = new GitHubService({
      taskService: taskStore,
      configService: configSource,
      worktreeService,
      repositoryResolver: () => 'BradGroux/veritas-kanban',
    });
    vi.spyOn(service, 'checkGhCli').mockResolvedValue({
      installed: true,
      authenticated: true,
      user: 'VeritasTest',
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).auth = { role: 'agent', isLocalhost: false };
      next();
    });
    app.post('/api/v1/github/pr', taskAccess, createGitHubPRHandler(service));
    app.use(errorHandler);

    const rejected = await request(app).post('/api/v1/github/pr').send({
      taskId: 'task_publication',
      targetBranch: 'HEAD:refs/heads/canary',
    });
    expect(rejected.status).toBe(400);
    await expect(git(remotePath, 'show-ref', '--verify', 'refs/heads/canary')).rejects.toThrow();

    const accepted = await request(app).post('/api/v1/github/pr').send({
      taskId: 'task_publication',
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toEqual(
      expect.objectContaining({
        url: 'https://github.com/example/repo/pull/17',
        headBranch: 'feature/repository-publication',
        baseBranch: 'main',
      })
    );
  });

  it('binds publication to the captured commit and remote when mutable Git state drifts', async () => {
    const { taskStore, configSource, worktreeService } = await prepareManagedBranch(true);
    await installFakeGh();
    const decoyRemotePath = path.join(root, 'decoy.git');
    await fs.mkdir(decoyRemotePath, { recursive: true });
    await git(decoyRemotePath, 'init', '--bare', '--initial-branch=main');
    let capturedHead = '';
    const authoritySource = {
      resolvePublicationAuthority: (taskId: string) =>
        worktreeService.resolvePublicationAuthority(taskId),
      withPublicationAuthority: <T>(
        taskId: string,
        operation: (authority: WorktreePublicationAuthority) => Promise<T>
      ) =>
        worktreeService.withPublicationAuthority(taskId, async (authority) => {
          capturedHead = authority.headCommit;
          await fs.writeFile(path.join(authority.worktreePath, 'later-change.txt'), 'later\n');
          await git(authority.worktreePath, 'add', 'later-change.txt');
          await git(authority.worktreePath, 'commit', '-m', 'later change');
          await git(
            authority.worktreePath,
            'config',
            'remote.veritas-publication-authority.pushurl',
            decoyRemotePath
          );
          await git(
            authority.worktreePath,
            'config',
            `url.file://${decoyRemotePath}.insteadOf`,
            `file://${remotePath}`
          );
          await git(authority.worktreePath, 'remote', 'set-url', 'origin', decoyRemotePath);
          return operation(authority);
        }),
    };
    const service = new GitHubService({
      taskService: taskStore,
      configService: configSource,
      worktreeService: authoritySource,
      repositoryResolver: () => 'BradGroux/veritas-kanban',
    });
    vi.spyOn(service, 'checkGhCli').mockResolvedValue({
      installed: true,
      authenticated: true,
      user: 'VeritasTest',
    });
    vi.spyOn(service, 'getPRForBranch').mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await service.createPR({ taskId: 'task_publication' });

    expect(await git(remotePath, 'rev-parse', 'refs/heads/feature/repository-publication')).toBe(
      capturedHead
    );
    expect(await git(fixtures.task!.git!.worktreePath!, 'rev-parse', 'HEAD')).not.toBe(
      capturedHead
    );
    await expect(
      git(decoyRemotePath, 'show-ref', '--verify', 'refs/heads/feature/repository-publication')
    ).rejects.toThrow();
  });

  it('rejects a mismatched requested base before publication', async () => {
    const { taskStore, configSource, worktreeService } = await prepareManagedBranch();
    const service = new GitHubService({
      taskService: taskStore,
      configService: configSource,
      worktreeService,
      repositoryResolver: () => 'BradGroux/veritas-kanban',
    });

    await expect(
      service.createPR({ taskId: 'task_publication', targetBranch: 'release/other' })
    ).rejects.toThrow(/does not match the managed worktree/i);
    await expect(
      git(remotePath, 'show-ref', '--verify', 'refs/heads/feature/repository-publication')
    ).rejects.toThrow();
  });

  it('does not adopt a same-named PR from a fork repository', async () => {
    const argsFile = await installFakeGh();
    process.env.GH_LIST_JSON = JSON.stringify([
      {
        url: 'https://github.com/BradGroux/veritas-kanban/pull/99',
        number: 99,
        title: 'Fork branch',
        state: 'OPEN',
        isDraft: false,
        headRefName: 'feature/repository-publication',
        baseRefName: 'main',
        headRepository: { nameWithOwner: 'someone-else/veritas-kanban' },
      },
    ]);
    const service = new GitHubService();

    await expect(
      service.getPRForBranch(primaryPath, 'feature/repository-publication', 'main')
    ).resolves.toBeNull();
    await expect(fs.readFile(argsFile, 'utf8')).rejects.toThrow();
  });

  it('rejects task allocation and origin drift', async () => {
    const { worktreeService } = await prepareManagedBranch();
    const managedPath = fixtures.task!.git!.worktreePath!;
    fixtures.task!.git!.worktreePath = primaryPath;
    await expect(worktreeService.resolvePublicationAuthority('task_publication')).rejects.toThrow(
      /allocation does not match/i
    );

    fixtures.task!.git!.worktreePath = managedPath;
    await git(primaryPath, 'remote', 'set-url', 'origin', path.join(root, 'other.git'));
    await expect(worktreeService.resolvePublicationAuthority('task_publication')).rejects.toThrow(
      /durable worktree manifest/i
    );
  });

  it('rejects actual branch drift and invalid legacy manifest refs', async () => {
    const { worktreeService, manifestRepository } = await prepareManagedBranch();
    const managedPath = fixtures.task!.git!.worktreePath!;
    await git(managedPath, 'checkout', '-b', 'feature/unexpected');
    await expect(worktreeService.resolvePublicationAuthority('task_publication')).rejects.toThrow(
      /branch does not match/i
    );

    await git(managedPath, 'checkout', 'feature/repository-publication');
    const manifest = await manifestRepository.read('task_publication');
    if (!manifest) throw new Error('managed manifest was not created');
    await manifestRepository.save({
      ...manifest,
      base: { ...manifest.base, branch: 'main:refs/heads/canary' },
    });
    await expect(worktreeService.previewCleanup('task_publication')).rejects.toThrow(
      /Invalid Git branch name/i
    );
  });

  it('stops before PR creation when the explicit push fails', async () => {
    const { taskStore, configSource, worktreeService } = await prepareManagedBranch();
    const hookPath = path.join(remotePath, 'hooks', 'pre-receive');
    await fs.writeFile(hookPath, '#!/bin/sh\nexit 1\n');
    await fs.chmod(hookPath, 0o755);
    const argsFile = await installFakeGh();
    const service = new GitHubService({
      taskService: taskStore,
      configService: configSource,
      worktreeService,
      repositoryResolver: () => 'BradGroux/veritas-kanban',
    });
    vi.spyOn(service, 'checkGhCli').mockResolvedValue({
      installed: true,
      authenticated: true,
      user: 'VeritasTest',
    });
    vi.spyOn(service, 'getPRForBranch').mockResolvedValue(null);

    await expect(service.createPR({ taskId: 'task_publication' })).rejects.toThrow();
    await expect(fs.readFile(argsFile, 'utf8')).rejects.toThrow();
  });
});
