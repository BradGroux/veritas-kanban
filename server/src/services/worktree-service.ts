import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { simpleGit } from 'simple-git';
import type {
  AppConfig,
  CreateWorktreeRequest,
  DeleteWorktreeRequest,
  Task,
  UpdateTaskInput,
  WorktreeCleanupPreview,
  WorktreeCleanupReason,
  WorktreeCleanupReasonCode,
  WorktreeInfo,
  WorktreeIntegrationResult,
  WorktreeManifest,
  WorktreeManifestError,
  WorktreeRepositoryIdentity,
  WorktreeResolvedBase,
} from '@veritas-kanban/shared';
import { WORKTREE_MANIFEST_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { fileExists, mkdir, realpath } from '../storage/fs-helpers.js';
import {
  FileWorktreeManifestRepository,
  type WorktreeManifestRepository,
} from '../storage/worktree-manifest-repository.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { getRuntimeDir, getWorktreesDir } from '../utils/paths.js';
import { redactString } from '../lib/redact.js';

const WORKTREES_DIR = getWorktreesDir();
const MANIFESTS_DIR = path.join(getRuntimeDir(), 'worktree-manifests');
const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_SECONDS = 30 * 24 * 60 * 60;
const MIN_LEASE_SECONDS = 60;
const MAX_LEASE_SECONDS = 365 * 24 * 60 * 60;

interface WorktreeTaskStore {
  getTask(taskId: string): Promise<Task | null>;
  updateTask(taskId: string, update: UpdateTaskInput): Promise<Task | null>;
}

type CodeTask = Task & {
  git: NonNullable<Task['git']> & {
    repo: string;
    branch: string;
    baseBranch: string;
  };
};

interface WorktreeConfigSource {
  getConfig(): Promise<AppConfig>;
}

export interface ExternalHoldProbeResult {
  state: 'clear' | 'held' | 'unavailable';
  detail?: string;
}

export type ExternalHoldProbe = (worktreePath: string) => Promise<ExternalHoldProbeResult>;

export interface WorktreeGitCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface WorktreeGitCommandOptions {
  allowedExitCodes?: number[];
}

export interface WorktreeGitRunner {
  run(
    cwd: string,
    args: string[],
    options?: WorktreeGitCommandOptions
  ): Promise<WorktreeGitCommandResult>;
}

class GitCommandError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string
  ) {
    super(message);
    this.name = 'GitCommandError';
  }
}

export class DefaultWorktreeGitRunner implements WorktreeGitRunner {
  constructor(
    private readonly timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
    private readonly executable = 'git',
    private readonly killGraceMs = 5_000
  ) {}

  run(
    cwd: string,
    args: string[],
    options: WorktreeGitCommandOptions = {}
  ): Promise<WorktreeGitCommandResult> {
    return new Promise((resolve, reject) => {
      const allowed = new Set(options.allowedExitCodes ?? [0]);
      const processHandle = spawn(this.executable, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        callback();
      };

      processHandle.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      processHandle.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      processHandle.once('error', (error) => {
        finish(() =>
          reject(
            new GitCommandError(
              `Git command could not start: ${sanitizeDiagnostic(error.message)}`,
              null,
              ''
            )
          )
        );
      });
      processHandle.once('close', (code) => {
        finish(() => {
          if (timedOut) {
            reject(
              new GitCommandError(`Git operation timed out after ${this.timeoutMs}ms`, null, '')
            );
            return;
          }
          if (code !== null && allowed.has(code)) {
            resolve({ stdout, stderr, code });
            return;
          }
          reject(
            new GitCommandError(
              `Git command failed${code === null ? '' : ` with code ${code}`}: ${
                sanitizeDiagnostic(stderr.trim()) || 'no diagnostic output'
              }`,
              code,
              sanitizeDiagnostic(stderr)
            )
          );
        });
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        processHandle.kill('SIGTERM');
        killTimer = setTimeout(() => processHandle.kill('SIGKILL'), this.killGraceMs);
      }, this.timeoutMs);
    });
  }
}

interface RepoContext {
  rootPath: string;
  identity: WorktreeRepositoryIdentity;
}

export interface WorktreeServiceOptions {
  worktreesDir?: string;
  taskService?: WorktreeTaskStore;
  configService?: WorktreeConfigSource;
  manifestRepository?: WorktreeManifestRepository;
  gitRunner?: WorktreeGitRunner;
  externalHoldProbe?: ExternalHoldProbe;
  now?: () => Date;
}

export class WorktreeService {
  private readonly worktreesDir: string;
  private readonly integrationDir: string;
  private readonly taskService: WorktreeTaskStore;
  private readonly configService: WorktreeConfigSource;
  private readonly manifests: WorktreeManifestRepository;
  private readonly git: WorktreeGitRunner;
  private readonly externalHoldProbe: ExternalHoldProbe;
  private readonly now: () => Date;

  constructor(options: WorktreeServiceOptions = {}) {
    this.worktreesDir = path.resolve(options.worktreesDir ?? WORKTREES_DIR);
    this.integrationDir = path.join(this.worktreesDir, '.integration');
    this.taskService = options.taskService ?? new TaskService();
    this.configService = options.configService ?? new ConfigService();
    this.manifests =
      options.manifestRepository ??
      new FileWorktreeManifestRepository({ manifestsDir: MANIFESTS_DIR });
    this.git = options.gitRunner ?? new DefaultWorktreeGitRunner();
    this.externalHoldProbe = options.externalHoldProbe ?? probeExternalHold;
    this.now = options.now ?? (() => new Date());
  }

  async createWorktree(taskId: string, request: CreateWorktreeRequest = {}): Promise<WorktreeInfo> {
    validatePathSegment(taskId);
    return this.manifests.withTaskLock(taskId, async () => {
      const task = await this.requireCodeTask(taskId);
      const repo = await this.getRepoContext(task.git.repo);
      return this.manifests.withAllocationLock(repo.identity.commonGitDir, async () => {
        await this.validateRefNames(repo.rootPath, task.git.branch, task.git.baseBranch);
        await mkdir(this.worktreesDir, { recursive: true });

        const existing = await this.manifests.read(taskId);
        if (existing && existing.lifecycle.cleanup !== 'removed') {
          this.assertManifestOwnership(existing, task, repo);
          if (existing.lifecycle.creation === 'ready' && (await fileExists(existing.path))) {
            await this.persistTaskAllocation(task, existing);
            const reconciled =
              existing.lastError?.operation === 'task-update'
                ? await this.saveManifest(existing, { lastError: undefined })
                : existing;
            return this.buildWorktreeInfo(taskId, task, reconciled);
          }
          return this.recoverCreation(task, repo, existing);
        }

        const worktreePath = ensureWithinBase(
          this.worktreesDir,
          path.join(this.worktreesDir, taskId)
        );
        if (await fileExists(worktreePath)) {
          throw new ConflictError('The requested worktree path already exists without ownership.', {
            taskId,
            worktreePath,
            remediation: 'Inspect the path and register or move it before retrying.',
          });
        }

        const base = await this.resolveBase(repo.rootPath, task.git.baseBranch, request);
        await this.assertUniqueAllocation(taskId, repo.rootPath, task.git.branch, worktreePath);

        const branchCommit = await this.tryResolveCommit(
          repo.rootPath,
          `refs/heads/${task.git.branch}^{commit}`
        );
        const canReuseOwnedBranch =
          existing?.lifecycle.cleanup === 'removed' &&
          existing.branch === task.git.branch &&
          existing.repository.commonGitDir === repo.identity.commonGitDir;
        if (branchCommit && !canReuseOwnedBranch) {
          throw new ConflictError(
            `Branch "${task.git.branch}" already exists without an active ownership lease.`,
            {
              taskId,
              branch: task.git.branch,
              remediation:
                'Choose a unique task branch or explicitly adopt the branch through a new task.',
            }
          );
        }

        const now = this.now().toISOString();
        const leaseSeconds = normalizeLeaseSeconds(request.leaseSeconds);
        let manifest = await this.manifests.save({
          schemaVersion: WORKTREE_MANIFEST_SCHEMA_VERSION,
          id: `worktree_${nanoid(16)}`,
          revision: 0,
          taskId,
          repository: repo.identity,
          path: worktreePath,
          branch: task.git.branch,
          base,
          lease: {
            id: `lease_${nanoid(16)}`,
            ownerTaskId: taskId,
            ...(task.attempt?.status === 'running' || task.attempt?.status === 'pending'
              ? { ownerAttemptId: task.attempt.id }
              : {}),
            acquiredAt: now,
            expiresAt: new Date(this.now().getTime() + leaseSeconds * 1_000).toISOString(),
          },
          lifecycle: {
            creation: 'planned',
            integration: 'idle',
            cleanup: 'active',
          },
          rebase: { state: 'idle' },
          integration: {},
          createdAt: now,
          updatedAt: now,
          overrides: [],
        });

        manifest = await this.saveManifest(manifest, {
          lifecycle: { ...manifest.lifecycle, creation: 'creating' },
          lastError: undefined,
        });

        try {
          if (branchCommit) {
            await this.git.run(repo.rootPath, ['worktree', 'add', worktreePath, task.git.branch]);
          } else {
            await this.git.run(repo.rootPath, [
              'worktree',
              'add',
              '-b',
              task.git.branch,
              worktreePath,
              base.commit,
            ]);
          }
          manifest = await this.saveManifest(manifest, {
            lifecycle: { ...manifest.lifecycle, creation: 'ready' },
            lastError: undefined,
          });
        } catch (error) {
          await this.recordFailure(manifest, 'create', error, {
            creation: 'failed',
          });
          throw error;
        }

        try {
          await this.persistTaskAllocation(task, manifest);
        } catch (error) {
          await this.recordFailure(manifest, 'task-update', error);
          throw error;
        }
        return this.buildWorktreeInfo(taskId, task, manifest);
      });
    });
  }

  async getManifest(taskId: string): Promise<WorktreeManifest | null> {
    validatePathSegment(taskId);
    return this.manifests.read(taskId);
  }

  async adoptLegacyWorktree(taskId: string): Promise<WorktreeInfo> {
    validatePathSegment(taskId);
    return this.manifests.withTaskLock(taskId, async () => {
      const task = await this.requireCodeTask(taskId);
      if (!task.git.worktreePath || task.git.worktreeManifestId) {
        throw new ValidationError(
          'Legacy adoption requires a task worktree path without an existing manifest.'
        );
      }
      const repo = await this.getRepoContext(task.git.repo);
      return this.manifests.withAllocationLock(repo.identity.commonGitDir, async () => {
        const existing = await this.manifests.read(taskId);
        if (existing && existing.lifecycle.cleanup !== 'removed') {
          throw new ConflictError('The task already has an active worktree manifest.', {
            taskId,
            manifestId: existing.id,
          });
        }

        const configuredLegacyPath = path.resolve(expandPath(task.git.worktreePath as string));
        if (!(await fileExists(configuredLegacyPath))) {
          throw new ConflictError('The legacy worktree path does not exist.', {
            taskId,
            path: configuredLegacyPath,
          });
        }
        const legacyPath = await realpath(configuredLegacyPath);
        await this.assertPathRepositoryIdentity(legacyPath, repo.identity);
        const actualBranch = await this.currentBranch(legacyPath);
        if (actualBranch !== task.git.branch) {
          throw new ConflictError('The legacy worktree branch does not match the task.', {
            taskId,
            expected: task.git.branch,
            actual: actualBranch,
          });
        }

        const registered = parseWorktreeList(
          (await this.git.run(repo.rootPath, ['worktree', 'list', '--porcelain'])).stdout
        );
        const registeredWithCanonicalPaths = await Promise.all(
          registered.map(async (worktree) => ({
            ...worktree,
            canonicalPath: await realpath(worktree.path).catch(() => path.resolve(worktree.path)),
          }))
        );
        const exactRegistration = registeredWithCanonicalPaths.find(
          (worktree) => worktree.canonicalPath === legacyPath && worktree.branch === task.git.branch
        );
        if (!exactRegistration) {
          throw new ConflictError(
            'The legacy path and branch are not an exact registered Git worktree.',
            {
              taskId,
              path: legacyPath,
              branch: task.git.branch,
            }
          );
        }
        const conflictingRegistration = registeredWithCanonicalPaths.find(
          (worktree) => worktree.branch === task.git.branch && worktree.canonicalPath !== legacyPath
        );
        if (conflictingRegistration) {
          throw new ConflictError('The task branch is registered to another worktree path.', {
            taskId,
            branch: task.git.branch,
            conflictingPath: conflictingRegistration.path,
          });
        }
        const collision = (await this.manifests.list()).find(
          (candidate) =>
            candidate.taskId !== taskId &&
            candidate.lifecycle.cleanup !== 'removed' &&
            (candidate.branch === task.git.branch || path.resolve(candidate.path) === legacyPath)
        );
        if (collision) {
          throw new ConflictError('The legacy worktree is leased to another task.', {
            taskId,
            collidingTaskId: collision.taskId,
            collidingManifestId: collision.id,
          });
        }

        await this.git.run(legacyPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
        const resolvedRemoteBase = await this.resolveBase(repo.rootPath, task.git.baseBranch, {});
        const legacyHead = await this.resolveCommit(legacyPath, 'HEAD^{commit}');
        const descendsFromAdoptionBase = await this.git.run(
          legacyPath,
          ['merge-base', '--is-ancestor', resolvedRemoteBase.commit, legacyHead],
          { allowedExitCodes: [0, 1] }
        );
        if (descendsFromAdoptionBase.code !== 0) {
          throw new ConflictError(
            'The legacy worktree HEAD does not descend from the fetched remote base.',
            {
              taskId,
              legacyHead,
              remoteBaseCommit: resolvedRemoteBase.commit,
              remediation:
                'Rebase or merge the current remote base into the legacy branch before adoption.',
            }
          );
        }
        const base: WorktreeResolvedBase = {
          ...resolvedRemoteBase,
          source: 'legacy-adopted',
        };
        const now = this.now().toISOString();
        let manifest = await this.manifests.save({
          schemaVersion: WORKTREE_MANIFEST_SCHEMA_VERSION,
          id: `worktree_${nanoid(16)}`,
          revision: 0,
          taskId,
          repository: repo.identity,
          path: legacyPath,
          branch: task.git.branch,
          base,
          lease: {
            id: `lease_${nanoid(16)}`,
            ownerTaskId: taskId,
            ...(task.attempt?.status === 'running' || task.attempt?.status === 'pending'
              ? { ownerAttemptId: task.attempt.id }
              : {}),
            acquiredAt: now,
            expiresAt: new Date(this.now().getTime() + DEFAULT_LEASE_SECONDS * 1_000).toISOString(),
          },
          lifecycle: {
            creation: 'ready',
            integration: 'idle',
            cleanup: 'active',
          },
          rebase: { state: 'idle' },
          integration: {},
          createdAt: now,
          updatedAt: now,
          overrides: [],
        });
        await this.persistTaskAllocation(task, manifest);
        manifest = (await this.manifests.read(taskId)) ?? manifest;
        return this.buildWorktreeInfo(taskId, task, manifest);
      });
    });
  }

  async claimOwnership(taskId: string, attemptId: string): Promise<WorktreeManifest> {
    validatePathSegment(taskId);
    validatePathSegment(attemptId);
    return this.manifests.withTaskLock(taskId, async () => {
      const task = await this.requireCodeTask(taskId);
      let manifest = await this.requireActiveManifest(taskId);
      if (!(await fileExists(manifest.path))) {
        throw new ConflictError('The worktree cannot be claimed because its path is missing.', {
          taskId,
          manifestId: manifest.id,
          path: manifest.path,
        });
      }
      const repo = await this.getRepoContext(task.git.repo);
      this.assertManifestOwnership(manifest, task, repo);
      await this.assertWorktreeIdentity(manifest);
      const branch = await this.currentBranch(manifest.path);
      if (branch !== manifest.branch) {
        throw new ConflictError('The worktree branch does not match its ownership manifest.', {
          taskId,
          expected: manifest.branch,
          actual: branch,
        });
      }
      if (
        task.git?.worktreeManifestId !== manifest.id ||
        task.git.worktreeLeaseId !== manifest.lease.id ||
        task.git.worktreePath !== manifest.path
      ) {
        throw new ConflictError(
          'The task allocation does not match the worktree manifest and cannot be claimed.',
          {
            taskId,
            manifestId: manifest.id,
            remediation: 'Reconcile the worktree allocation before starting an agent.',
          }
        );
      }
      const now = this.now();
      const currentOwner = manifest.lease.ownerAttemptId;
      const currentTaskAttemptIsTerminal =
        currentOwner === task.attempt?.id &&
        (task.attempt?.status === 'complete' || task.attempt?.status === 'failed');
      if (
        currentOwner &&
        currentOwner !== attemptId &&
        !currentTaskAttemptIsTerminal &&
        Date.parse(manifest.lease.expiresAt) > now.getTime()
      ) {
        throw new ConflictError('The worktree lease is already owned by another attempt.', {
          taskId,
          manifestId: manifest.id,
          ownerAttemptId: currentOwner,
          requestedAttemptId: attemptId,
          expiresAt: manifest.lease.expiresAt,
        });
      }
      manifest = await this.saveManifest(manifest, {
        lease: {
          ...manifest.lease,
          ownerAttemptId: attemptId,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + DEFAULT_LEASE_SECONDS * 1_000).toISOString(),
        },
      });
      await this.persistTaskAllocation(task, manifest);
      return manifest;
    });
  }

  async releaseOwnership(taskId: string, attemptId: string): Promise<WorktreeManifest | null> {
    validatePathSegment(taskId);
    validatePathSegment(attemptId);
    return this.manifests.withTaskLock(taskId, async () => {
      const manifest = await this.manifests.read(taskId);
      if (!manifest || manifest.lifecycle.cleanup === 'removed') return manifest;
      if (!manifest.lease.ownerAttemptId) {
        const task = await this.taskService.getTask(taskId);
        if (
          task?.git?.worktreeManifestId === manifest.id &&
          task.git.worktreeLeaseOwnerAttemptId === attemptId
        ) {
          await this.persistTaskAllocation(task, manifest);
        }
        return manifest;
      }
      if (manifest.lease.ownerAttemptId !== attemptId) {
        throw new ConflictError('The attempt cannot release a worktree lease it does not own.', {
          taskId,
          manifestId: manifest.id,
          ownerAttemptId: manifest.lease.ownerAttemptId,
          requestedAttemptId: attemptId,
        });
      }
      const released = await this.saveManifest(manifest, {
        lease: {
          ...manifest.lease,
          ownerAttemptId: undefined,
          expiresAt: this.now().toISOString(),
        },
      });
      const task = await this.taskService.getTask(taskId);
      if (task?.git?.worktreeManifestId === manifest.id) {
        await this.persistTaskAllocation(task, released);
      }
      return released;
    });
  }

  async getWorktreeStatus(taskId: string): Promise<WorktreeInfo> {
    const task = await this.requireTask(taskId);
    const manifest = await this.requireActiveManifest(taskId);
    return this.buildWorktreeInfo(taskId, task, manifest);
  }

  async previewCleanup(taskId: string): Promise<WorktreeCleanupPreview> {
    const task = await this.taskService.getTask(taskId);
    const manifest = await this.requireActiveManifest(taskId);
    return this.buildCleanupPreview(task, manifest);
  }

  async previewCleanupCandidates(): Promise<WorktreeCleanupPreview[]> {
    const manifests = await this.manifests.list();
    const previews = await Promise.all(
      manifests
        .filter((manifest) => manifest.lifecycle.cleanup !== 'removed')
        .map(async (manifest) =>
          this.buildCleanupPreview(await this.taskService.getTask(manifest.taskId), manifest)
        )
    );
    return previews.filter((preview) => preview.stale);
  }

  async deleteWorktree(
    taskId: string,
    request: DeleteWorktreeRequest = {}
  ): Promise<WorktreeManifest> {
    validatePathSegment(taskId);
    return this.manifests.withTaskLock(taskId, async () => {
      const task = await this.taskService.getTask(taskId);
      let manifest = await this.requireActiveManifest(taskId);
      if (
        manifest.lifecycle.cleanup === 'failed' &&
        manifest.lastError?.operation === 'task-update' &&
        task?.git?.worktreeManifestId === manifest.id &&
        task.git.worktreePath === manifest.path &&
        !(await fileExists(manifest.path))
      ) {
        const repo = await this.repoContextForManifest(task, manifest);
        await this.git.run(repo.rootPath, ['worktree', 'prune']);
        if (task?.git) await this.clearTaskAllocation(task, false);
        return this.saveManifest(manifest, {
          lifecycle: { ...manifest.lifecycle, cleanup: 'removed' },
          removedAt: this.now().toISOString(),
          lastError: undefined,
        });
      }
      const preview = await this.buildCleanupPreview(task, manifest);
      const nonOverrideable = preview.blockedReasons.filter((reason) => !reason.overrideable);
      if (nonOverrideable.length > 0) {
        await this.markCleanupBlocked(manifest, nonOverrideable);
        throw cleanupConflict(nonOverrideable);
      }
      if (preview.blockedReasons.length > 0) {
        const reason = request.reason?.trim();
        if (!request.force || !reason) {
          await this.markCleanupBlocked(manifest, preview.blockedReasons);
          throw cleanupConflict(preview.blockedReasons);
        }
        manifest = await this.saveManifest(manifest, {
          overrides: [
            ...manifest.overrides,
            {
              operation: 'cleanup' as const,
              reason,
              ...(request.actor?.trim() ? { actor: request.actor.trim() } : {}),
              recordedAt: this.now().toISOString(),
              bypassedReasons: preview.blockedReasons.map((item) => item.code),
            },
          ].slice(-100),
        });
      }

      const repo = await this.repoContextForManifest(task, manifest);
      manifest = await this.saveManifest(manifest, {
        lifecycle: { ...manifest.lifecycle, cleanup: 'removing' },
        lastError: undefined,
      });

      try {
        if (await fileExists(manifest.path)) {
          const args = ['worktree', 'remove', manifest.path];
          if (request.force && preview.blockedReasons.length > 0) args.push('--force');
          await this.git.run(repo.rootPath, args);
        } else {
          await this.git.run(repo.rootPath, ['worktree', 'prune']);
        }
      } catch (error) {
        await this.recordFailure(manifest, 'cleanup', error, { cleanup: 'failed' });
        throw error;
      }

      if (task?.git) {
        try {
          await this.clearTaskAllocation(task, false);
        } catch (error) {
          await this.recordFailure(manifest, 'task-update', error, { cleanup: 'failed' });
          throw error;
        }
      }
      manifest = await this.saveManifest(manifest, {
        lifecycle: { ...manifest.lifecycle, cleanup: 'removed' },
        removedAt: this.now().toISOString(),
        lastError: undefined,
      });
      return manifest;
    });
  }

  async rebaseWorktree(taskId: string): Promise<WorktreeInfo> {
    validatePathSegment(taskId);
    return this.manifests.withTaskLock(taskId, async () => {
      const task = await this.requireCodeTask(taskId);
      this.assertNoActiveRun(task);
      let manifest = await this.requireActiveManifest(taskId);
      const repo = await this.getRepoContext(task.git.repo);
      this.assertManifestOwnership(manifest, task, repo);
      this.assertNoCompetingLease(task, manifest);
      await this.assertWorktreeIdentity(manifest);
      if (manifest.rebase.state !== 'idle') {
        await this.git.run(manifest.path, ['rebase', '--abort'], {
          allowedExitCodes: [0, 1, 128],
        });
        manifest = await this.saveManifest(manifest, {
          rebase: { state: 'idle' },
          lastError: undefined,
        });
      }
      await this.assertWorktreeClean(manifest.path);

      const base = await this.resolveBase(repo.rootPath, task.git.baseBranch, {});
      manifest = await this.saveManifest(manifest, {
        rebase: {
          state: 'rebasing',
          targetBase: base,
          startedAt: this.now().toISOString(),
        },
        lastError: undefined,
      });
      try {
        await this.git.run(manifest.path, ['rebase', base.commit]);
        manifest = await this.saveManifest(manifest, {
          base,
          rebase: {
            state: 'idle',
            targetBase: base,
            startedAt: manifest.rebase.startedAt,
            completedAt: this.now().toISOString(),
          },
          lastError: undefined,
        });
        await this.persistTaskAllocation(task, manifest);
      } catch (error) {
        await this.saveManifest(manifest, {
          rebase: { ...manifest.rebase, state: 'failed' },
          lastError: manifestError('rebase', error, this.now()),
        });
        throw error;
      }
      return this.buildWorktreeInfo(taskId, task, manifest);
    });
  }

  async mergeWorktree(taskId: string): Promise<WorktreeIntegrationResult> {
    validatePathSegment(taskId);
    return this.manifests.withTaskLock(taskId, async () => {
      const task = await this.requireCodeTask(taskId);
      this.assertNoActiveRun(task);
      let manifest = await this.requireActiveManifest(taskId);
      const repo = await this.getRepoContext(task.git.repo);
      this.assertManifestOwnership(manifest, task, repo);
      this.assertNoCompetingLease(task, manifest);
      const sourceExists = await fileExists(manifest.path);
      if (manifest.lifecycle.integration !== 'integrated' || sourceExists) {
        if (!sourceExists) {
          throw new ConflictError('The source worktree is missing before integration completed.', {
            taskId,
            manifestId: manifest.id,
          });
        }
        await this.assertWorktreeIdentity(manifest);
        await this.assertWorktreeClean(manifest.path);
        const actualBranch = await this.currentBranch(manifest.path);
        if (actualBranch !== manifest.branch) {
          throw new ConflictError('The worktree branch no longer matches its manifest.', {
            expected: manifest.branch,
            actual: actualBranch,
          });
        }
      }

      let targetBase = await this.resolveBase(repo.rootPath, manifest.base.branch, {});
      const integrationPath =
        manifest.integration.worktreePath ??
        ensureWithinBase(
          this.integrationDir,
          path.join(this.integrationDir, `${taskId}-${manifest.id.slice(-8)}`)
        );
      ensureWithinBase(this.integrationDir, path.resolve(integrationPath));
      await mkdir(this.integrationDir, { recursive: true });

      let integrationExists = await fileExists(integrationPath);
      let integrationHead = manifest.integration.integrationHead;

      if (manifest.lifecycle.integration === 'integrated') {
        if (!integrationHead) {
          throw new ConflictError(
            'The integrated manifest is missing its integration commit evidence.',
            {
              taskId,
              manifestId: manifest.id,
            }
          );
        }
        const landed = await this.git.run(
          repo.rootPath,
          ['merge-base', '--is-ancestor', integrationHead, targetBase.commit],
          { allowedExitCodes: [0, 1] }
        );
        if (landed.code !== 0) {
          throw new ConflictError(
            'The recorded integration commit is not reachable from the remote base.',
            {
              taskId,
              integrationHead,
              remoteBaseCommit: targetBase.commit,
            }
          );
        }
      } else if (!integrationExists) {
        if (
          integrationHead &&
          (manifest.lifecycle.integration === 'pushing' ||
            (manifest.lifecycle.integration === 'failed' &&
              manifest.lastError?.operation === 'integration-push'))
        ) {
          const landed = await this.git.run(
            repo.rootPath,
            ['merge-base', '--is-ancestor', integrationHead, targetBase.commit],
            { allowedExitCodes: [0, 1] }
          );
          if (landed.code === 0) {
            manifest = await this.markIntegrated(manifest, integrationHead, targetBase);
          } else {
            throw new ConflictError(
              'The integration worktree is missing and the recorded commit is not on the remote base.',
              {
                taskId,
                integrationHead,
                integrationPath,
                remediation:
                  'Restore the recorded integration worktree or integrate the source branch through an explicit operator workflow.',
              }
            );
          }
        } else {
          const baseCommit =
            manifest.lifecycle.integration === 'preparing' && manifest.integration.baseCommit
              ? manifest.integration.baseCommit
              : targetBase.commit;
          const startedAt = manifest.integration.startedAt ?? this.now().toISOString();
          manifest = await this.saveManifest(manifest, {
            lifecycle: { ...manifest.lifecycle, integration: 'preparing' },
            integration: {
              worktreePath: integrationPath,
              baseCommit,
              startedAt,
            },
            lastError: undefined,
          });

          try {
            await this.git.run(repo.rootPath, [
              'worktree',
              'add',
              '--detach',
              integrationPath,
              baseCommit,
            ]);
            integrationExists = true;
          } catch (error) {
            await this.recordFailure(manifest, 'integration-prepare', error, {
              integration: 'failed',
            });
            throw error;
          }
        }
      }

      if (integrationExists) {
        await this.assertIntegrationWorktreeIdentity(repo, integrationPath);
      }

      if (
        manifest.lifecycle.integration !== 'integrated' &&
        !(
          integrationHead &&
          (manifest.lifecycle.integration === 'pushing' ||
            (manifest.lifecycle.integration === 'failed' &&
              manifest.lastError?.operation === 'integration-push'))
        )
      ) {
        const mergeInProgress = await this.git.run(
          integrationPath,
          ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'],
          { allowedExitCodes: [0, 1, 128] }
        );
        if (mergeInProgress.code === 0) {
          await this.git.run(integrationPath, ['merge', '--abort']);
        }
        await this.assertWorktreeClean(integrationPath);

        const currentHead = await this.resolveCommit(integrationPath, 'HEAD^{commit}');
        const recordedBase = manifest.integration.baseCommit ?? targetBase.commit;
        const sourceAlreadyMerged = await this.git.run(
          integrationPath,
          ['merge-base', '--is-ancestor', manifest.branch, currentHead],
          { allowedExitCodes: [0, 1] }
        );
        const recordedBaseIsAncestor = await this.git.run(
          integrationPath,
          ['merge-base', '--is-ancestor', recordedBase, currentHead],
          { allowedExitCodes: [0, 1] }
        );

        if (
          currentHead !== recordedBase &&
          sourceAlreadyMerged.code === 0 &&
          recordedBaseIsAncestor.code === 0
        ) {
          integrationHead = currentHead;
        } else {
          if (currentHead !== recordedBase) {
            throw new ConflictError(
              'The integration worktree HEAD does not match its recoverable base state.',
              {
                taskId,
                integrationPath,
                currentHead,
                recordedBase,
              }
            );
          }
          manifest = await this.saveManifest(manifest, {
            lifecycle: { ...manifest.lifecycle, integration: 'merging' },
            lastError: undefined,
          });
          try {
            await this.git.run(integrationPath, ['merge', '--no-ff', '--no-edit', manifest.branch]);
          } catch (error) {
            await this.recordFailure(manifest, 'integration-merge', error, {
              integration: 'failed',
            });
            throw error;
          }
          integrationHead = await this.resolveCommit(integrationPath, 'HEAD^{commit}');
        }
      }

      if (manifest.lifecycle.integration !== 'integrated') {
        if (!integrationHead) {
          throw new ConflictError('Integration did not produce a commit to publish.', {
            taskId,
            integrationPath,
          });
        }
        manifest = await this.saveManifest(manifest, {
          lifecycle: { ...manifest.lifecycle, integration: 'pushing' },
          integration: {
            ...manifest.integration,
            integrationHead,
          },
          lastError: undefined,
        });
        await this.assertIntegrationWorktreeIdentity(repo, integrationPath);
        try {
          const landed = await this.git.run(
            repo.rootPath,
            ['merge-base', '--is-ancestor', integrationHead, targetBase.commit],
            { allowedExitCodes: [0, 1] }
          );
          if (landed.code !== 0) {
            const stillBasedOnRemote = await this.git.run(
              integrationPath,
              ['merge-base', '--is-ancestor', targetBase.commit, integrationHead],
              { allowedExitCodes: [0, 1] }
            );
            if (stillBasedOnRemote.code !== 0) {
              throw new ConflictError(
                'The remote base advanced beyond the recoverable integration commit.',
                {
                  taskId,
                  integrationPath,
                  integrationHead,
                  remoteBaseCommit: targetBase.commit,
                }
              );
            }
            await this.git.run(integrationPath, [
              'push',
              'origin',
              `HEAD:refs/heads/${manifest.base.branch}`,
            ]);
          }
          targetBase = await this.resolveBase(repo.rootPath, manifest.base.branch, {});
          const verified = await this.git.run(
            repo.rootPath,
            ['merge-base', '--is-ancestor', integrationHead, targetBase.commit],
            { allowedExitCodes: [0, 1] }
          );
          if (verified.code !== 0) {
            throw new ConflictError(
              'The push returned, but the integration commit is not reachable from the remote base.',
              {
                taskId,
                integrationHead,
                remoteBaseCommit: targetBase.commit,
              }
            );
          }
          manifest = await this.markIntegrated(manifest, integrationHead, targetBase);
        } catch (error) {
          await this.recordFailure(manifest, 'integration-push', error, {
            integration: 'failed',
          });
          throw error;
        }
      }

      if (integrationExists) {
        try {
          await this.assertIntegrationWorktreeIdentity(repo, integrationPath);
          await this.git.run(repo.rootPath, ['worktree', 'remove', integrationPath]);
          integrationExists = false;
        } catch (error) {
          await this.recordFailure(manifest, 'cleanup', error, { cleanup: 'blocked' });
          throw new ConflictError(
            'Integration reached the remote, but its temporary worktree could not be removed.',
            {
              taskId,
              targetCommit: targetBase.commit,
              integrationPath,
              remediation:
                'Inspect and remove the recorded integration worktree, then retry cleanup.',
            }
          );
        }
      }

      if (await fileExists(manifest.path)) {
        const cleanupPreview = await this.buildCleanupPreview(task, manifest);
        if (cleanupPreview.blockedReasons.length > 0) {
          await this.markCleanupBlocked(manifest, cleanupPreview.blockedReasons);
          throw new ConflictError(
            'Integration reached the remote, but source worktree cleanup is blocked.',
            {
              taskId,
              targetCommit: targetBase.commit,
              cleanupPreview,
              remediation:
                'Resolve the reported safety conditions and use the cleanup endpoint; the remote integration is already complete.',
            }
          );
        }
      }

      manifest = await this.saveManifest(manifest, {
        lifecycle: { ...manifest.lifecycle, cleanup: 'removing' },
      });
      try {
        if (await fileExists(manifest.path)) {
          await this.git.run(repo.rootPath, ['worktree', 'remove', manifest.path]);
        } else {
          await this.git.run(repo.rootPath, ['worktree', 'prune']);
        }
        await this.clearTaskAllocation(task, true);
        manifest = await this.saveManifest(manifest, {
          lifecycle: { ...manifest.lifecycle, cleanup: 'removed' },
          removedAt: this.now().toISOString(),
          lastError: undefined,
        });
      } catch (error) {
        await this.recordFailure(manifest, 'cleanup', error, { cleanup: 'failed' });
        throw error;
      }

      return {
        merged: true,
        targetCommit: targetBase.commit,
        manifest,
      };
    });
  }

  async openInVSCode(taskId: string): Promise<string> {
    const manifest = await this.requireActiveManifest(taskId);
    return `code "${manifest.path}"`;
  }

  private async recoverCreation(
    task: Task,
    repo: RepoContext,
    manifest: WorktreeManifest
  ): Promise<WorktreeInfo> {
    if (await fileExists(manifest.path)) {
      await this.assertWorktreeIdentity(manifest);
      const branch = await this.currentBranch(manifest.path);
      if (branch !== manifest.branch) {
        throw new ConflictError('Partial worktree creation has a branch mismatch.', {
          expected: manifest.branch,
          actual: branch,
          path: manifest.path,
        });
      }
      manifest = await this.saveManifest(manifest, {
        lifecycle: { ...manifest.lifecycle, creation: 'ready' },
        lastError: undefined,
      });
      await this.persistTaskAllocation(task, manifest);
      return this.buildWorktreeInfo(task.id, task, manifest);
    }

    const branchCommit = await this.tryResolveCommit(
      repo.rootPath,
      `refs/heads/${manifest.branch}^{commit}`
    );
    if (branchCommit && branchCommit !== manifest.base.commit) {
      throw new ConflictError(
        'Partial creation left a branch with commits that cannot be adopted automatically.',
        {
          branch: manifest.branch,
          branchCommit,
          expectedBaseCommit: manifest.base.commit,
          remediation: 'Inspect the branch and explicitly preserve or remove it before retrying.',
        }
      );
    }

    manifest = await this.saveManifest(manifest, {
      lifecycle: { ...manifest.lifecycle, creation: 'creating' },
      lastError: undefined,
    });
    try {
      if (branchCommit) {
        await this.git.run(repo.rootPath, ['worktree', 'add', manifest.path, manifest.branch]);
      } else {
        await this.git.run(repo.rootPath, [
          'worktree',
          'add',
          '-b',
          manifest.branch,
          manifest.path,
          manifest.base.commit,
        ]);
      }
      manifest = await this.saveManifest(manifest, {
        lifecycle: { ...manifest.lifecycle, creation: 'ready' },
      });
      await this.persistTaskAllocation(task, manifest);
      return this.buildWorktreeInfo(task.id, task, manifest);
    } catch (error) {
      await this.recordFailure(manifest, 'create', error, { creation: 'failed' });
      throw error;
    }
  }

  private async buildWorktreeInfo(
    taskId: string,
    task: Task,
    manifest: WorktreeManifest
  ): Promise<WorktreeInfo> {
    if (!(await fileExists(manifest.path))) {
      throw new ConflictError('The worktree manifest exists, but its path is missing.', {
        taskId,
        manifestId: manifest.id,
        path: manifest.path,
        remediation:
          'Use cleanup preview or retry worktree creation to reconcile the partial state.',
      });
    }
    const status = await simpleGit(manifest.path).status(['--untracked-files=all']);
    const comparisonBase =
      (await this.tryResolveCommit(
        manifest.repository.rootPath,
        `refs/remotes/origin/${manifest.base.branch}^{commit}`
      )) ?? manifest.base.commit;
    const counts = await this.git.run(manifest.path, [
      'rev-list',
      '--left-right',
      '--count',
      `${comparisonBase}...HEAD`,
    ]);
    const [behind = 0, ahead = 0] = counts.stdout
      .trim()
      .split(/\s+/)
      .map((value) => Number(value) || 0);
    const currentTask = (await this.taskService.getTask(taskId)) ?? task;
    const cleanupPreview = await this.buildCleanupPreview(currentTask, manifest);
    return {
      path: manifest.path,
      branch: manifest.branch,
      baseBranch: manifest.base.branch,
      baseCommit: manifest.base.commit,
      baseSource: manifest.base.source,
      manifestId: manifest.id,
      manifest: structuredClone(manifest),
      lifecycle: structuredClone(manifest.lifecycle),
      remoteState: {
        stale: manifest.base.source === 'local-stale',
        ...(manifest.base.fetchedAt ? { fetchedAt: manifest.base.fetchedAt } : {}),
        ...(manifest.base.fetchError ? { error: manifest.base.fetchError } : {}),
      },
      aheadBehind: { ahead, behind },
      hasChanges: !status.isClean(),
      changedFiles: status.files.length,
      cleanupPreview,
    };
  }

  private async buildCleanupPreview(
    task: Task | null,
    manifest: WorktreeManifest
  ): Promise<WorktreeCleanupPreview> {
    const blockedReasons: WorktreeCleanupReason[] = [];
    const checkedAt = this.now().toISOString();
    const add = (code: WorktreeCleanupReasonCode, message: string, overrideable: boolean): void => {
      if (!blockedReasons.some((reason) => reason.code === code)) {
        blockedReasons.push({ code, message, overrideable });
      }
    };

    if (task?.attempt?.status === 'running' || task?.attempt?.status === 'pending') {
      add(
        'active-run',
        `Attempt ${task.attempt.id} is ${task.attempt.status}; active runs lock destructive operations.`,
        false
      );
    }
    const leaseOwner = manifest.lease.ownerAttemptId;
    const leaseIsUnexpired = Date.parse(manifest.lease.expiresAt) > this.now().getTime();
    const ownerAttemptIsTerminal =
      leaseOwner === task?.attempt?.id &&
      (task?.attempt?.status === 'complete' || task?.attempt?.status === 'failed');
    if (leaseOwner && leaseIsUnexpired && !ownerAttemptIsTerminal) {
      add(
        'active-lease',
        `Attempt ${leaseOwner} owns the worktree lease until ${manifest.lease.expiresAt}.`,
        false
      );
    }
    if (
      !task ||
      task.git?.worktreeManifestId !== manifest.id ||
      task.git?.worktreePath !== manifest.path
    ) {
      add(
        'manifest-mismatch',
        'Task allocation metadata does not match the durable worktree manifest.',
        false
      );
    }

    const snapshot = {
      dirty: false,
      untrackedFiles: 0,
      unpushedCommits: 0,
      mergedIntoBase: false,
      externalHold: 'unavailable' as 'clear' | 'held' | 'unavailable',
    };

    if (!(await fileExists(manifest.path))) {
      add('worktree-missing', 'The registered worktree path is missing.', true);
      return {
        taskId: manifest.taskId,
        manifestId: manifest.id,
        path: manifest.path,
        checkedAt,
        stale: this.now().getTime() > Date.parse(manifest.lease.expiresAt),
        eligible: false,
        requiresOverride:
          blockedReasons.length > 0 && blockedReasons.every((reason) => reason.overrideable),
        blockedReasons,
        snapshot,
      };
    }

    try {
      const status = await this.git.run(manifest.path, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ]);
      const entries = status.stdout.split('\0').filter(Boolean);
      snapshot.untrackedFiles = entries.filter((entry) => entry.startsWith('?? ')).length;
      snapshot.dirty = entries.some((entry) => !entry.startsWith('?? '));
      if (snapshot.dirty) {
        add('dirty', 'The worktree has tracked staged or unstaged changes.', true);
      }
      if (snapshot.untrackedFiles > 0) {
        add(
          'untracked',
          `The worktree has ${snapshot.untrackedFiles} untracked file${
            snapshot.untrackedFiles === 1 ? '' : 's'
          }.`,
          true
        );
      }

      const actualBranch = await this.currentBranch(manifest.path);
      if (actualBranch !== manifest.branch) {
        add(
          'branch-mismatch',
          `Expected branch "${manifest.branch}", but found "${actualBranch}".`,
          false
        );
      }
      try {
        await this.assertWorktreeIdentity(manifest);
      } catch (error) {
        add('manifest-mismatch', errorMessage(error), false);
      }

      const head = await this.resolveCommit(manifest.path, 'HEAD^{commit}');
      const remoteBase = await this.tryResolveCommit(
        manifest.repository.rootPath,
        `refs/remotes/origin/${manifest.base.branch}^{commit}`
      );
      if (!remoteBase) {
        add(
          'inspection-failed',
          'The remote base ref is unavailable, so pushed and merged state cannot be proven.',
          true
        );
      } else {
        const unpushed = await this.git.run(manifest.path, [
          'rev-list',
          '--count',
          `${remoteBase}..${head}`,
        ]);
        snapshot.unpushedCommits = Number(unpushed.stdout.trim()) || 0;
        const merged = await this.git.run(
          manifest.path,
          ['merge-base', '--is-ancestor', head, remoteBase],
          { allowedExitCodes: [0, 1] }
        );
        snapshot.mergedIntoBase = merged.code === 0;
        if (snapshot.unpushedCommits > 0) {
          add(
            'unpushed',
            `${snapshot.unpushedCommits} commit${
              snapshot.unpushedCommits === 1 ? ' is' : 's are'
            } not reachable from the remote base.`,
            true
          );
        }
        if (!snapshot.mergedIntoBase) {
          add('unmerged', 'The worktree HEAD is not merged into the remote base.', true);
        }
      }

      const hold = await this.externalHoldProbe(manifest.path);
      snapshot.externalHold = hold.state;
      if (hold.state === 'held') {
        add(
          'external-hold',
          hold.detail
            ? `The worktree is externally held: ${sanitizeDiagnostic(hold.detail)}.`
            : 'The worktree is externally held by another process.',
          true
        );
      } else if (hold.state === 'unavailable') {
        add(
          'inspection-failed',
          hold.detail
            ? `External hold inspection is unavailable: ${sanitizeDiagnostic(hold.detail)}.`
            : 'External hold inspection is unavailable.',
          true
        );
      }
    } catch (error) {
      add('inspection-failed', `Cleanup safety inspection failed: ${errorMessage(error)}.`, true);
    }

    return {
      taskId: manifest.taskId,
      manifestId: manifest.id,
      path: manifest.path,
      checkedAt,
      stale: this.now().getTime() > Date.parse(manifest.lease.expiresAt),
      eligible: blockedReasons.length === 0,
      requiresOverride:
        blockedReasons.length > 0 && blockedReasons.every((reason) => reason.overrideable),
      blockedReasons,
      snapshot,
    };
  }

  private async resolveBase(
    repoPath: string,
    baseBranch: string,
    request: CreateWorktreeRequest
  ): Promise<WorktreeResolvedBase> {
    const resolvedAt = this.now().toISOString();
    try {
      await this.git.run(repoPath, [
        'fetch',
        '--no-tags',
        'origin',
        `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`,
      ]);
      return {
        branch: baseBranch,
        commit: await this.resolveCommit(repoPath, `refs/remotes/origin/${baseBranch}^{commit}`),
        source: 'remote',
        resolvedAt,
        fetchedAt: resolvedAt,
      };
    } catch (error) {
      const acknowledgement = request.staleBaseAcknowledgement;
      if (!request.allowStaleBase || !acknowledgement?.reason?.trim()) {
        throw new ConflictError(
          'Remote fetch failed; worktree creation requires an explicit stale-base acknowledgement.',
          {
            baseBranch,
            fetchError: errorMessage(error),
            remediation:
              'Restore remote access, or retry with allowStaleBase=true and a non-empty acknowledgement reason.',
          }
        );
      }
      const localCommit = await this.tryResolveCommit(repoPath, `${baseBranch}^{commit}`);
      if (!localCommit) {
        throw new ConflictError('Remote fetch failed and no local base commit is available.', {
          baseBranch,
          fetchError: errorMessage(error),
        });
      }
      return {
        branch: baseBranch,
        commit: localCommit,
        source: 'local-stale',
        resolvedAt,
        fetchError: errorMessage(error),
        staleBaseAcknowledgement: {
          reason: acknowledgement.reason.trim(),
          acknowledgedAt: resolvedAt,
          ...(acknowledgement.actor?.trim() ? { actor: acknowledgement.actor.trim() } : {}),
        },
      };
    }
  }

  private async getRepoContext(repoName: string): Promise<RepoContext> {
    const config = await this.configService.getConfig();
    const configured = config.repos.find((repo) => repo.name === repoName);
    if (!configured) throw new NotFoundError(`Repository "${repoName}" not found in config`);

    const configuredPath = path.resolve(expandPath(configured.path));
    const rootPath = path.resolve(
      (await this.git.run(configuredPath, ['rev-parse', '--show-toplevel'])).stdout.trim()
    );
    const commonGitDirOutput = (
      await this.git.run(rootPath, ['rev-parse', '--git-common-dir'])
    ).stdout.trim();
    const commonGitDir = path.resolve(rootPath, commonGitDirOutput);
    const origin = await this.git
      .run(rootPath, ['remote', 'get-url', 'origin'])
      .then((result) => result.stdout.trim())
      .catch(() => 'origin-unavailable');
    return {
      rootPath,
      identity: {
        name: repoName,
        rootPath,
        commonGitDir,
        originFingerprint: fingerprintRemote(origin),
      },
    };
  }

  private async repoContextForManifest(
    task: Task | null,
    manifest: WorktreeManifest
  ): Promise<RepoContext> {
    if (!task?.git?.repo) {
      return { rootPath: manifest.repository.rootPath, identity: manifest.repository };
    }
    const current = await this.getRepoContext(task.git.repo);
    if (
      current.identity.commonGitDir !== manifest.repository.commonGitDir ||
      current.identity.originFingerprint !== manifest.repository.originFingerprint
    ) {
      throw new ConflictError(
        'The configured repository no longer matches the worktree manifest.',
        {
          taskId: manifest.taskId,
          manifestRepository: manifest.repository.name,
          configuredRepository: current.identity.name,
        }
      );
    }
    return current;
  }

  private async assertUniqueAllocation(
    taskId: string,
    repoPath: string,
    branch: string,
    worktreePath: string
  ): Promise<void> {
    const manifests = await this.manifests.list();
    const collision = manifests.find(
      (manifest) =>
        manifest.taskId !== taskId &&
        manifest.lifecycle.cleanup !== 'removed' &&
        (manifest.branch === branch || path.resolve(manifest.path) === path.resolve(worktreePath))
    );
    if (collision) {
      throw new ConflictError('Worktree branch or path is already leased to another task.', {
        taskId,
        collidingTaskId: collision.taskId,
        collidingManifestId: collision.id,
      });
    }

    const registered = parseWorktreeList(
      (await this.git.run(repoPath, ['worktree', 'list', '--porcelain'])).stdout
    );
    const gitCollision = registered.find(
      (worktree) =>
        path.resolve(worktree.path) === path.resolve(worktreePath) || worktree.branch === branch
    );
    if (gitCollision) {
      throw new ConflictError('Git already has the requested branch or path checked out.', {
        taskId,
        branch,
        worktreePath,
        registeredWorktree: gitCollision.path,
      });
    }
  }

  private async validateRefNames(
    repoPath: string,
    branch: string,
    baseBranch: string
  ): Promise<void> {
    for (const candidate of [branch, baseBranch]) {
      const result = await this.git.run(repoPath, ['check-ref-format', '--branch', candidate], {
        allowedExitCodes: [0, 128],
      });
      if (result.code !== 0) {
        throw new ValidationError(`Invalid Git branch name: "${candidate}"`);
      }
    }
  }

  private assertManifestOwnership(manifest: WorktreeManifest, task: Task, repo: RepoContext): void {
    if (
      manifest.taskId !== task.id ||
      manifest.branch !== task.git?.branch ||
      manifest.base.branch !== task.git?.baseBranch ||
      manifest.repository.commonGitDir !== repo.identity.commonGitDir ||
      manifest.repository.originFingerprint !== repo.identity.originFingerprint
    ) {
      throw new ConflictError('Task Git settings do not match the durable worktree manifest.', {
        taskId: task.id,
        manifestId: manifest.id,
        remediation: 'Restore the recorded task Git settings or clean up the manifest explicitly.',
      });
    }
  }

  private assertNoActiveRun(task: Task): void {
    if (task.attempt?.status === 'running' || task.attempt?.status === 'pending') {
      throw new ConflictError(
        `Task has an active run (${task.attempt.id}); destructive worktree operations are locked.`,
        {
          taskId: task.id,
          attemptId: task.attempt.id,
          attemptStatus: task.attempt.status,
        }
      );
    }
  }

  private assertNoCompetingLease(task: Task, manifest: WorktreeManifest): void {
    const ownerAttemptId = manifest.lease.ownerAttemptId;
    if (!ownerAttemptId || Date.parse(manifest.lease.expiresAt) <= this.now().getTime()) return;
    const ownerIsTerminal =
      task.attempt?.id === ownerAttemptId &&
      (task.attempt.status === 'complete' || task.attempt.status === 'failed');
    if (ownerIsTerminal) return;
    throw new ConflictError('The worktree has an active attempt ownership lease.', {
      taskId: task.id,
      manifestId: manifest.id,
      ownerAttemptId,
      expiresAt: manifest.lease.expiresAt,
    });
  }

  private async assertWorktreeClean(worktreePath: string): Promise<void> {
    const status = await this.git.run(worktreePath, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    if (status.stdout.length > 0) {
      throw new ConflictError(
        'The worktree has staged, unstaged, or untracked changes and cannot be rebased or integrated.'
      );
    }
  }

  private async persistTaskAllocation(task: Task, manifest: WorktreeManifest): Promise<void> {
    const updated = await this.taskService.updateTask(task.id, {
      git: {
        ...task.git,
        worktreePath: manifest.path,
        worktreeManifestId: manifest.id,
        worktreeBaseCommit: manifest.base.commit,
        worktreeBaseSource: manifest.base.source,
        worktreeLeaseId: manifest.lease.id,
        worktreeLeaseOwnerAttemptId: manifest.lease.ownerAttemptId,
      },
    });
    if (!updated) throw new NotFoundError(`Task "${task.id}" not found during allocation update`);
  }

  private async assertWorktreeIdentity(manifest: WorktreeManifest): Promise<void> {
    await this.assertPathRepositoryIdentity(manifest.path, manifest.repository);
  }

  private async assertIntegrationWorktreeIdentity(
    repo: RepoContext,
    integrationPath: string
  ): Promise<void> {
    ensureWithinBase(this.integrationDir, path.resolve(integrationPath));
    const resolvedIntegrationDir = await realpath(this.integrationDir);
    const resolvedIntegrationPath = await realpath(integrationPath);
    ensureWithinBase(resolvedIntegrationDir, resolvedIntegrationPath);
    await this.assertPathRepositoryIdentity(resolvedIntegrationPath, repo.identity);
    const registered = parseWorktreeList(
      (await this.git.run(repo.rootPath, ['worktree', 'list', '--porcelain'])).stdout
    );
    if (
      !registered.some(
        (worktree) => path.resolve(worktree.path) === path.resolve(resolvedIntegrationPath)
      )
    ) {
      throw new ConflictError('The integration path is not a registered Git worktree.', {
        integrationPath,
      });
    }
  }

  private async assertPathRepositoryIdentity(
    worktreePath: string,
    repository: WorktreeRepositoryIdentity
  ): Promise<void> {
    const commonGitDirOutput = (
      await this.git.run(worktreePath, ['rev-parse', '--git-common-dir'])
    ).stdout.trim();
    const commonGitDir = path.resolve(worktreePath, commonGitDirOutput);
    if (commonGitDir !== path.resolve(repository.commonGitDir)) {
      throw new ConflictError('The worktree belongs to a different Git repository.', {
        path: worktreePath,
        expectedCommonGitDir: repository.commonGitDir,
      });
    }
    const origin = (
      await this.git.run(worktreePath, ['remote', 'get-url', 'origin'])
    ).stdout.trim();
    if (fingerprintRemote(origin) !== repository.originFingerprint) {
      throw new ConflictError('The worktree origin does not match its repository manifest.', {
        path: worktreePath,
      });
    }
  }

  private async markIntegrated(
    manifest: WorktreeManifest,
    integrationHead: string,
    targetBase: WorktreeResolvedBase
  ): Promise<WorktreeManifest> {
    return this.saveManifest(manifest, {
      lifecycle: { ...manifest.lifecycle, integration: 'integrated' },
      integration: {
        ...manifest.integration,
        integrationHead,
        targetCommit: targetBase.commit,
        completedAt: this.now().toISOString(),
      },
      lastError: undefined,
    });
  }

  private async clearTaskAllocation(task: Task, markDone: boolean): Promise<void> {
    const updated = await this.taskService.updateTask(task.id, {
      ...(markDone ? { status: 'done' } : {}),
      git: {
        ...task.git,
        worktreePath: undefined,
        worktreeManifestId: undefined,
        worktreeBaseCommit: undefined,
        worktreeBaseSource: undefined,
        worktreeLeaseId: undefined,
        worktreeLeaseOwnerAttemptId: undefined,
      },
    });
    if (!updated) throw new NotFoundError(`Task "${task.id}" not found during allocation cleanup`);
  }

  private async markCleanupBlocked(
    manifest: WorktreeManifest,
    reasons: WorktreeCleanupReason[]
  ): Promise<void> {
    await this.saveManifest(manifest, {
      lifecycle: { ...manifest.lifecycle, cleanup: 'blocked' },
      lastError: {
        operation: 'cleanup',
        code: reasons
          .map((reason) => reason.code)
          .join('+')
          .slice(0, 240),
        message: reasons
          .map((reason) => reason.message)
          .join(' ')
          .slice(0, 2000),
        at: this.now().toISOString(),
        recoverable: true,
      },
    });
  }

  private async recordFailure(
    manifest: WorktreeManifest,
    operation: WorktreeManifestError['operation'],
    error: unknown,
    lifecycle: Partial<WorktreeManifest['lifecycle']> = {}
  ): Promise<WorktreeManifest> {
    return this.saveManifest(manifest, {
      lifecycle: { ...manifest.lifecycle, ...lifecycle },
      lastError: {
        operation,
        code:
          error instanceof GitCommandError
            ? `git-${error.code ?? 'unavailable'}`
            : 'operation-failed',
        message: errorMessage(error),
        at: this.now().toISOString(),
        recoverable: true,
      },
    });
  }

  private async saveManifest(
    manifest: WorktreeManifest,
    patch: Partial<WorktreeManifest>
  ): Promise<WorktreeManifest> {
    return this.manifests.save({
      ...manifest,
      ...structuredClone(patch),
      updatedAt: this.now().toISOString(),
    });
  }

  private async requireTask(taskId: string): Promise<Task> {
    const task = await this.taskService.getTask(taskId);
    if (!task) throw new NotFoundError(`Task "${taskId}" not found`);
    return task;
  }

  private async requireCodeTask(taskId: string): Promise<CodeTask> {
    const task = await this.requireTask(taskId);
    if (task.type !== 'code') {
      throw new ValidationError('Worktrees can only be created for code tasks');
    }
    if (!task.git?.repo || !task.git.branch || !task.git.baseBranch) {
      throw new ValidationError('Task must have git repo, branch, and base branch configured');
    }
    return task as CodeTask;
  }

  private async requireActiveManifest(taskId: string): Promise<WorktreeManifest> {
    const manifest = await this.manifests.read(taskId);
    if (!manifest || manifest.lifecycle.cleanup === 'removed') {
      throw new NotFoundError('Task does not have an active worktree manifest');
    }
    return manifest;
  }

  private async resolveCommit(cwd: string, ref: string): Promise<string> {
    return (await this.git.run(cwd, ['rev-parse', '--verify', ref])).stdout.trim();
  }

  private async tryResolveCommit(cwd: string, ref: string): Promise<string | null> {
    try {
      return await this.resolveCommit(cwd, ref);
    } catch {
      return null;
    }
  }

  private async currentBranch(worktreePath: string): Promise<string> {
    return (
      await this.git.run(worktreePath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    ).stdout.trim();
  }
}

function normalizeLeaseSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LEASE_SECONDS;
  if (!Number.isInteger(value) || value < MIN_LEASE_SECONDS || value > MAX_LEASE_SECONDS) {
    throw new ValidationError(
      `leaseSeconds must be an integer between ${MIN_LEASE_SECONDS} and ${MAX_LEASE_SECONDS}`
    );
  }
  return value;
}

function expandPath(value: string): string {
  if (!value.startsWith('~')) return value;
  const home = process.env.HOME;
  if (!home) throw new ValidationError('Cannot expand repository path because HOME is unset');
  return path.join(home, value.slice(1));
}

function fingerprintRemote(remote: string): string {
  const withoutCredentials = remote
    .trim()
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1')
    .replace(/\/\/[^/@\s]+@/g, '//')
    .replace(/([?&](?:access_token|api_key|token|key|secret|password)=)[^&#\s]+/gi, '$1[redacted]');
  return `sha256:${createHash('sha256').update(withoutCredentials).digest('hex')}`;
}

function parseWorktreeList(
  output: string
): Array<{ path: string; branch?: string; detached: boolean }> {
  return output
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const worktreePath = lines.find((line) => line.startsWith('worktree '))?.slice(9) ?? '';
      const branchRef = lines.find((line) => line.startsWith('branch '))?.slice(7);
      return {
        path: worktreePath,
        ...(branchRef?.startsWith('refs/heads/')
          ? { branch: branchRef.slice('refs/heads/'.length) }
          : {}),
        detached: lines.includes('detached'),
      };
    })
    .filter((worktree) => Boolean(worktree.path));
}

function cleanupConflict(reasons: WorktreeCleanupReason[]): ConflictError {
  const activeRun = reasons.find((reason) => reason.code === 'active-run');
  return new ConflictError(
    activeRun
      ? 'Worktree cleanup is blocked by an active run.'
      : `Worktree cleanup is blocked: ${reasons.map((reason) => reason.message).join(' ')}`,
    {
      reasons,
      remediation: reasons.every((reason) => reason.overrideable)
        ? 'Resolve the conditions, or retry with force=true and an explicit reason.'
        : 'Resolve every non-overrideable condition before retrying.',
    }
  );
}

function errorMessage(error: unknown): string {
  return sanitizeDiagnostic(error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function manifestError(
  operation: WorktreeManifestError['operation'],
  error: unknown,
  now: Date
): WorktreeManifestError {
  return {
    operation,
    code:
      error instanceof GitCommandError ? `git-${error.code ?? 'unavailable'}` : 'operation-failed',
    message: errorMessage(error),
    at: now.toISOString(),
    recoverable: true,
  };
}

function sanitizeDiagnostic(value: string): string {
  return redactString(value)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
    .replace(/\b(?:ghp|github_pat)[_-][A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\b(?:sk|xai)[_-][A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/([?&](?:access_token|api_key|token|key|secret|password)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(
      /\b((?:ACCESS_TOKEN|API_KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[redacted]'
    )
    .replace(/\s+/g, ' ')
    .trim();
}

async function probeExternalHold(worktreePath: string): Promise<ExternalHoldProbeResult> {
  if (process.platform === 'win32') return { state: 'unavailable' };
  return new Promise((resolve) => {
    const processHandle = spawn('lsof', ['+D', worktreePath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const timeout = setTimeout(() => {
      processHandle.kill('SIGTERM');
      resolve({ state: 'unavailable', detail: 'lsof timed out' });
    }, 5_000);
    processHandle.once('error', (error) => {
      clearTimeout(timeout);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ state: 'unavailable', detail: 'lsof is not installed' });
      } else {
        resolve({ state: 'unavailable', detail: sanitizeDiagnostic(error.message) });
      }
    });
    processHandle.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code === 0 ? { state: 'held' } : { state: 'clear' });
    });
  });
}
