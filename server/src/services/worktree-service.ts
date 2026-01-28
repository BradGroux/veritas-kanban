import fs from 'fs/promises';
import path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import type { Task } from '@veritas-kanban/shared';
import { spawn } from 'child_process';
import { promisify } from 'util';

// Default paths
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const WORKTREES_DIR = path.join(PROJECT_ROOT, '.veritas-kanban', 'worktrees');

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  aheadBehind: {
    ahead: number;
    behind: number;
  };
  hasChanges: boolean;
  changedFiles: number;
}

export interface WorktreeServiceOptions {
  worktreesDir?: string;
}

export class WorktreeService {
  private worktreesDir: string;
  private configService: ConfigService;
  private taskService: TaskService;
  private readonly GIT_TIMEOUT = 30000; // 30 seconds timeout for git operations

  constructor(options: WorktreeServiceOptions = {}) {
    this.worktreesDir = options.worktreesDir || WORKTREES_DIR;
    this.configService = new ConfigService();
    this.taskService = new TaskService();
  }

  /**
   * Execute a git command with timeout
   */
  private async execGitWithTimeout(repoPath: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: repoPath,
        timeout: this.GIT_TIMEOUT,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Git command failed: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else if (code === null) {
          reject(new Error(`Git command timed out after ${this.GIT_TIMEOUT}ms`));
        } else {
          reject(new Error(`Git command failed with code ${code}: ${stderr}`));
        }
      });

      // Set timeout manually as backup
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Git operation timed out after ${this.GIT_TIMEOUT}ms`));
      }, this.GIT_TIMEOUT);

      proc.on('exit', () => {
        clearTimeout(timeoutId);
      });
    });
  }

  private async ensureWorktreesDir(): Promise<void> {
    await fs.mkdir(this.worktreesDir, { recursive: true });
  }

  private expandPath(p: string): string {
    return p.replace(/^~/, process.env.HOME || '');
  }

  private async getRepoGit(repoName: string): Promise<{ git: SimpleGit; repoPath: string }> {
    const config = await this.configService.getConfig();
    const repo = config.repos.find((r) => r.name === repoName);

    if (!repo) {
      throw new Error(`Repository "${repoName}" not found in config`);
    }

    const repoPath = this.expandPath(repo.path);
    const git = simpleGit(repoPath);

    return { git, repoPath };
  }

  async createWorktree(taskId: string): Promise<WorktreeInfo> {
    await this.ensureWorktreesDir();

    // Get task
    const task = await this.taskService.getTask(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found`);
    }

    if (task.type !== 'code') {
      throw new Error('Worktrees can only be created for code tasks');
    }

    if (!task.git?.repo || !task.git?.branch || !task.git?.baseBranch) {
      throw new Error('Task must have git repo, branch, and base branch configured');
    }

    const { git, repoPath } = await this.getRepoGit(task.git.repo);
    const worktreePath = path.join(this.worktreesDir, taskId);

    // Check if worktree already exists
    // Intentionally silent: fs.access throws if path doesn't exist — false means no worktree
    const worktreeExists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false);
    if (worktreeExists) {
      throw new Error('Worktree already exists for this task');
    }

    // Fetch latest from remote with timeout
    try {
      await this.execGitWithTimeout(repoPath, ['fetch']);
    } catch (e: any) {
      // Ignore fetch errors (might be offline)
      console.warn('Could not fetch from remote:', e.message);
    }

    // Check if branch already exists
    const branches = await git.branchLocal();
    const branchExists = branches.all.includes(task.git.branch);

    if (branchExists) {
      // Use existing branch with timeout
      await this.execGitWithTimeout(repoPath, ['worktree', 'add', worktreePath, task.git.branch]);
    } else {
      // Create new branch from base with timeout
      await this.execGitWithTimeout(repoPath, [
        'worktree',
        'add',
        '-b',
        task.git.branch,
        worktreePath,
        task.git.baseBranch,
      ]);
    }

    // Update task with worktree path
    await this.taskService.updateTask(taskId, {
      git: {
        ...task.git,
        worktreePath,
      },
    });

    // Get worktree status
    return this.getWorktreeStatus(taskId);
  }

  async getWorktreeStatus(taskId: string): Promise<WorktreeInfo> {
    const task = await this.taskService.getTask(taskId);
    if (!task?.git?.worktreePath) {
      throw new Error('Task does not have an active worktree');
    }

    const worktreePath = task.git.worktreePath;
    const worktreeGit = simpleGit(worktreePath);

    // Get branch info
    const status = await worktreeGit.status();

    // Get ahead/behind info
    let aheadBehind = { ahead: 0, behind: 0 };
    try {
      const { git: repoGit, repoPath: mainRepoPath } = await this.getRepoGit(task.git.repo);

      // Fetch to get latest with timeout (intentionally silent: may be offline)
      await this.execGitWithTimeout(mainRepoPath, ['fetch']).catch(() => {});

      // Compare with base branch with timeout
      const log = await this.execGitWithTimeout(worktreePath, [
        'rev-list',
        '--left-right',
        '--count',
        `${task.git.baseBranch}...HEAD`,
      ]);
      const [behind, ahead] = log.trim().split('\t').map(Number);
      aheadBehind = { ahead: ahead || 0, behind: behind || 0 };
    } catch (e: any) {
      console.warn('Could not get ahead/behind info:', e.message);
    }

    return {
      path: worktreePath,
      branch: task.git.branch,
      baseBranch: task.git.baseBranch,
      aheadBehind,
      hasChanges: !status.isClean(),
      changedFiles: status.files.length,
    };
  }

  async deleteWorktree(taskId: string, force: boolean = false): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    if (!task?.git?.worktreePath) {
      throw new Error('Task does not have an active worktree');
    }

    const worktreePath = task.git.worktreePath;

    // Check for uncommitted changes
    if (!force) {
      const worktreeGit = simpleGit(worktreePath);
      const status = await worktreeGit.status();

      if (!status.isClean()) {
        throw new Error('Worktree has uncommitted changes. Use force=true to delete anyway.');
      }
    }

    // Get main repo git
    const { git: repoGit, repoPath } = await this.getRepoGit(task.git.repo);

    // Remove worktree with timeout
    const args = ['worktree', 'remove', worktreePath];
    if (force) args.push('--force');
    await this.execGitWithTimeout(repoPath, args);

    // Update task to remove worktree path
    await this.taskService.updateTask(taskId, {
      git: {
        ...task.git,
        worktreePath: undefined,
      },
    });
  }

  async rebaseWorktree(taskId: string): Promise<WorktreeInfo> {
    const task = await this.taskService.getTask(taskId);
    if (!task?.git?.worktreePath) {
      throw new Error('Task does not have an active worktree');
    }

    const worktreePath = task.git.worktreePath;

    // Fetch latest with timeout
    await this.execGitWithTimeout(worktreePath, ['fetch']);

    // Rebase onto base branch with timeout
    await this.execGitWithTimeout(worktreePath, ['rebase', `origin/${task.git.baseBranch}`]);

    return this.getWorktreeStatus(taskId);
  }

  async mergeWorktree(taskId: string): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    if (!task?.git?.worktreePath || !task.git?.repo) {
      throw new Error('Task does not have an active worktree');
    }

    const { git: repoGit, repoPath } = await this.getRepoGit(task.git.repo);

    // Checkout base branch in main repo with timeout
    await this.execGitWithTimeout(repoPath, ['checkout', task.git.baseBranch]);

    // Pull latest with timeout
    await this.execGitWithTimeout(repoPath, ['pull']);

    // Merge feature branch with timeout
    await this.execGitWithTimeout(repoPath, ['merge', task.git.branch]);

    // Push with timeout
    await this.execGitWithTimeout(repoPath, ['push']);

    // Delete worktree
    await this.deleteWorktree(taskId, true);

    // Update task status to done
    await this.taskService.updateTask(taskId, {
      status: 'done',
    });
  }

  async openInVSCode(taskId: string): Promise<string> {
    const task = await this.taskService.getTask(taskId);
    if (!task?.git?.worktreePath) {
      throw new Error('Task does not have an active worktree');
    }

    // Return the command to open in VS Code
    // The frontend can use this to open via a protocol handler or display instructions
    return `code "${task.git.worktreePath}"`;
  }
}
