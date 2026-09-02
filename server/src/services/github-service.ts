import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { nanoid } from 'nanoid';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { WorktreeService, type WorktreePublicationAuthority } from './worktree-service.js';
import { getBreaker } from './circuit-registry.js';
import type { AgentType, Task } from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface CreatePRInput {
  taskId: string;
  title?: string;
  body?: string;
  targetBranch?: string;
  draft?: boolean;
}

export interface PRInfo {
  url: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  headBranch: string;
  baseBranch: string;
}

interface GitHubTaskStore {
  getTask(taskId: string): Promise<Task | null>;
  updateTask(
    taskId: string,
    update: Parameters<TaskService['updateTask']>[1]
  ): Promise<Task | null>;
}

interface GitHubConfigSource {
  getConfig(): ReturnType<ConfigService['getConfig']>;
}

interface PublicationAuthoritySource {
  resolvePublicationAuthority(taskId: string): Promise<WorktreePublicationAuthority>;
}

export interface GitHubServiceOptions {
  taskService?: GitHubTaskStore;
  configService?: GitHubConfigSource;
  worktreeService?: PublicationAuthoritySource;
}

export type CodexCloudTarget = 'issue' | 'issue-comment' | 'pr-comment';

export interface CodexCloudDelegationInput {
  taskId: string;
  target?: CodexCloudTarget;
  title?: string;
  prompt?: string;
  model?: string;
}

export interface CodexCloudDelegationResult {
  taskId: string;
  attemptId: string;
  target: CodexCloudTarget;
  url: string;
  number?: number;
  repo: string;
  prompt: string;
}

export class GitHubService {
  private readonly configService: GitHubConfigSource;
  private readonly taskService: GitHubTaskStore;
  private readonly worktreeService: PublicationAuthoritySource;

  constructor(options: GitHubServiceOptions = {}) {
    this.configService = options.configService ?? new ConfigService();
    this.taskService = options.taskService ?? new TaskService();
    this.worktreeService =
      options.worktreeService ??
      new WorktreeService({
        taskService: this.taskService,
        configService: this.configService,
      });
  }

  private expandPath(p: string): string {
    return p.replace(/^~/, process.env.HOME || '');
  }

  /**
   * Check if gh CLI is installed and authenticated
   */
  async checkGhCli(): Promise<{ installed: boolean; authenticated: boolean; user?: string }> {
    try {
      // Check if gh is installed
      await execAsync('which gh');

      // Check if authenticated
      const { stdout } = await execAsync('gh auth status 2>&1');
      const userMatch = stdout.match(/Logged in to github\.com account (\S+)/);

      return {
        installed: true,
        authenticated: true,
        user: userMatch?.[1],
      };
    } catch (error: any) {
      if (error.message?.includes('which')) {
        return { installed: false, authenticated: false };
      }
      // gh is installed but not authenticated
      return { installed: true, authenticated: false };
    }
  }

  /**
   * Get the GitHub remote URL for a repository
   */
  private async getGitHubRemote(repoPath: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd: repoPath });
      return stdout.trim();
    } catch {
      // Intentionally silent: repo may not have an origin remote
      return null;
    }
  }

  /**
   * Check if a PR already exists for the branch
   */
  async getPRForBranch(
    repoPath: string,
    branch: string,
    baseBranch: string
  ): Promise<PRInfo | null> {
    const ghBreaker = getBreaker('github');
    try {
      const expectedHeadRepository = await this.getRepoNameWithOwner(repoPath);
      const { stdout } = await ghBreaker.execute(() =>
        execFileAsync(
          'gh',
          [
            'pr',
            'list',
            '--head',
            branch,
            '--base',
            baseBranch,
            '--state',
            'all',
            '--limit',
            '1',
            '--json',
            'url,number,title,state,isDraft,headRefName,baseRefName,headRepository',
          ],
          { cwd: repoPath }
        )
      );

      const data = (
        JSON.parse(stdout) as Array<{
          url: string;
          number: number;
          title: string;
          state: string;
          isDraft: boolean;
          headRefName: string;
          baseRefName: string;
          headRepository?: { nameWithOwner?: string };
        }>
      ).find(
        (candidate) =>
          candidate.headRefName === branch &&
          candidate.baseRefName === baseBranch &&
          candidate.headRepository?.nameWithOwner === expectedHeadRepository
      );
      if (!data) return null;
      return {
        url: data.url,
        number: data.number,
        title: data.title,
        state: data.state,
        draft: data.isDraft,
        headBranch: data.headRefName,
        baseBranch: data.baseRefName,
      };
    } catch {
      // Intentionally silent: no PR exists for this branch
      return null;
    }
  }

  async delegateToCodexCloud(
    input: CodexCloudDelegationInput
  ): Promise<CodexCloudDelegationResult> {
    const task = await this.taskService.getTask(input.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (!task.git?.repo) {
      throw new Error('Task must have a repository configured for Codex Cloud delegation');
    }

    const config = await this.configService.getConfig();
    const repoConfig = config.repos.find((r) => r.name === task.git!.repo);
    if (!repoConfig) {
      throw new Error(`Repository "${task.git.repo}" not found in config`);
    }

    const ghStatus = await this.checkGhCli();
    if (!ghStatus.installed) {
      throw new Error('GitHub CLI (gh) is not installed. Install it with: brew install gh');
    }
    if (!ghStatus.authenticated) {
      throw new Error('GitHub CLI is not authenticated. Run: gh auth login');
    }

    const repoPath = this.expandPath(repoConfig.path);
    const repo = await this.getRepoNameWithOwner(repoPath);
    const target = input.target || (task.git.prNumber || task.git.prUrl ? 'pr-comment' : 'issue');
    const prompt = input.prompt || this.buildCodexCloudPrompt(task, repo);
    const title = input.title || `Codex: ${task.title}`;
    const ghBreaker = getBreaker('github');

    let url: string;
    let number: number | undefined;

    if (target === 'issue') {
      const { stdout } = await ghBreaker.execute(() =>
        execFileAsync('gh', ['issue', 'create', '--title', title, '--body', prompt], {
          cwd: repoPath,
        })
      );
      url = stdout.trim();
      number = this.extractIssueNumber(url);
      if (number) {
        await this.taskService.updateTask(input.taskId, {
          github: { issueNumber: number, repo, url },
        });
      }
    } else if (target === 'issue-comment') {
      if (!task.github?.issueNumber) {
        throw new Error('Task must be linked to a GitHub issue for issue-comment delegation');
      }
      const issueRef = String(task.github.issueNumber);
      const { stdout } = await ghBreaker.execute(() =>
        execFileAsync('gh', ['issue', 'comment', issueRef, '--body', prompt], { cwd: repoPath })
      );
      const issue = await this.getIssueInfo(repoPath, issueRef);
      url = stdout.trim() || issue.url;
      number = issue.number;
    } else {
      const prRef = task.git.prNumber ? String(task.git.prNumber) : task.git.prUrl;
      if (!prRef) {
        throw new Error('Task must have a GitHub PR for pr-comment delegation');
      }
      const { stdout } = await ghBreaker.execute(() =>
        execFileAsync('gh', ['pr', 'comment', prRef, '--body', prompt], { cwd: repoPath })
      );
      const pr = await this.getPRInfo(repoPath, prRef);
      url = stdout.trim() || pr.url;
      number = pr.number;
    }

    const attemptId = `attempt_${nanoid(8)}`;
    const now = new Date().toISOString();
    const cloudComment = {
      id: `comment_${nanoid(8)}`,
      author: 'veritas',
      text: `Delegated to Codex Cloud via GitHub ${target}: ${url}`,
      timestamp: now,
    };

    await this.taskService.updateTask(input.taskId, {
      status: 'in-progress',
      agent: 'codex-cloud',
      attempt: {
        id: attemptId,
        agent: 'codex-cloud' as AgentType,
        status: 'pending',
        started: now,
        provider: 'codex-cloud',
        model: input.model,
        cloudUrl: url,
        cloudTarget: target,
      },
      comments: [...(task.comments || []), cloudComment],
    });

    return {
      taskId: input.taskId,
      attemptId,
      target,
      url,
      number,
      repo,
      prompt,
    };
  }

  /**
   * Create a GitHub PR for a task
   */
  async createPR(input: CreatePRInput): Promise<PRInfo> {
    let authority = await this.worktreeService.resolvePublicationAuthority(input.taskId);
    let task = authority.task;
    const requestedTarget = input.targetBranch ?? authority.baseBranch;
    if (requestedTarget !== authority.baseBranch) {
      throw new ConflictError('The requested PR base does not match the managed worktree.', {
        taskId: input.taskId,
        requestedBase: requestedTarget,
        authorizedBase: authority.baseBranch,
      });
    }

    // Check if gh CLI is ready
    const ghStatus = await this.checkGhCli();
    if (!ghStatus.installed) {
      throw new Error('GitHub CLI (gh) is not installed. Install it with: brew install gh');
    }
    if (!ghStatus.authenticated) {
      throw new Error('GitHub CLI is not authenticated. Run: gh auth login');
    }

    // Check if PR already exists
    const existingPR = await this.getPRForBranch(
      authority.repoPath,
      authority.branch,
      authority.baseBranch
    );
    if (existingPR) {
      // Update task with PR link
      await this.taskService.updateTask(input.taskId, {
        git: {
          ...task.git,
          prUrl: existingPR.url,
          prNumber: existingPR.number,
        },
      });
      return existingPR;
    }

    // Re-resolve immediately before publication so task or worktree drift fails closed.
    authority = await this.worktreeService.resolvePublicationAuthority(input.taskId);
    task = authority.task;
    if (requestedTarget !== authority.baseBranch) {
      throw new ConflictError('The managed PR base changed before publication.', {
        taskId: input.taskId,
        requestedBase: requestedTarget,
        authorizedBase: authority.baseBranch,
      });
    }
    const headRef = `refs/heads/${authority.branch}`;
    const { stdout: existingRemoteOutput } = await execFileAsync(
      'git',
      ['ls-remote', '--heads', 'origin', headRef],
      { cwd: authority.worktreePath }
    );
    const existingRemoteHead = existingRemoteOutput.trim().split(/\s+/)[0];
    if (existingRemoteHead && existingRemoteHead !== authority.headCommit) {
      try {
        await execFileAsync(
          'git',
          ['merge-base', '--is-ancestor', existingRemoteHead, authority.headCommit],
          { cwd: authority.worktreePath }
        );
      } catch {
        throw new ConflictError('The remote branch is not an ancestor of the managed HEAD.', {
          taskId: input.taskId,
          manifestId: authority.manifestId,
        });
      }
    }
    await execFileAsync('git', ['push', '-u', 'origin', `${headRef}:${headRef}`], {
      cwd: authority.worktreePath,
    });
    const { stdout: remoteHeadOutput } = await execFileAsync(
      'git',
      ['ls-remote', '--exit-code', 'origin', headRef],
      { cwd: authority.worktreePath }
    );
    const remoteHead = remoteHeadOutput.trim().split(/\s+/)[0];
    if (remoteHead !== authority.headCommit) {
      throw new ConflictError('The published remote branch does not match the managed worktree.', {
        taskId: input.taskId,
        manifestId: authority.manifestId,
      });
    }

    // Build PR title and body
    const prTitle = input.title || task.title;
    const prBody = input.body || this.buildPRBody(task);
    const targetBranch = authority.baseBranch;

    // Create the PR using execFile (no shell — safe from injection)
    const ghArgs = [
      'pr',
      'create',
      '--title',
      prTitle,
      '--body',
      prBody,
      '--base',
      targetBranch,
      '--head',
      authority.branch,
    ];

    if (input.draft) {
      ghArgs.push('--draft');
    }

    const ghBreaker = getBreaker('github');
    try {
      const { stdout } = await ghBreaker.execute(() =>
        execFileAsync('gh', ghArgs, { cwd: authority.repoPath })
      );
      const prUrl = stdout.trim();

      // Extract PR number from URL
      const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
      const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

      // Update task with PR link
      await this.taskService.updateTask(input.taskId, {
        git: {
          ...task.git,
          prUrl,
          prNumber,
        },
      });

      // Fetch full PR info
      return (
        (await this.getPRForBranch(authority.repoPath, authority.branch, authority.baseBranch)) || {
          url: prUrl,
          number: prNumber,
          title: prTitle,
          state: 'OPEN',
          draft: input.draft || false,
          headBranch: authority.branch,
          baseBranch: targetBranch,
        }
      );
    } catch (error: any) {
      throw new Error(`Failed to create PR: ${error.message}`, { cause: error });
    }
  }

  /**
   * Build PR body from task details
   */
  private buildPRBody(task: any): string {
    const lines: string[] = [];

    if (task.description) {
      lines.push(task.description);
      lines.push('');
    }

    lines.push('---');
    lines.push(`**Task:** ${task.title}`);
    lines.push(`**Type:** ${task.type}`);
    lines.push(`**Priority:** ${task.priority}`);

    if (task.project) {
      lines.push(`**Project:** ${task.project}`);
    }

    if (task.sprint) {
      lines.push(`**Sprint:** ${task.sprint}`);
    }

    lines.push('');
    lines.push('*Created via Veritas Kanban*');

    return lines.join('\n');
  }

  private buildCodexCloudPrompt(task: Task, repo: string): string {
    const lines = [
      '@codex Please work on this Veritas Kanban task.',
      '',
      `Task: ${task.id} - ${task.title}`,
      `Repository: ${repo}`,
      `Type: ${task.type}`,
      `Priority: ${task.priority}`,
    ];

    if (task.project) lines.push(`Project: ${task.project}`);
    if (task.sprint) lines.push(`Sprint: ${task.sprint}`);
    if (task.git?.baseBranch) lines.push(`Base branch: ${task.git.baseBranch}`);
    if (task.git?.branch) lines.push(`Working branch: ${task.git.branch}`);

    lines.push('', 'Task description:', task.description || 'No description provided.', '');
    lines.push('Acceptance criteria:');
    if (task.verificationSteps?.length) {
      for (const step of task.verificationSteps) lines.push(`- ${step.description}`);
    } else {
      lines.push('- Implement the task as described.');
      lines.push('- Run relevant checks and summarize the result.');
      lines.push('- Open or update a GitHub PR with the completed work.');
    }

    lines.push('', 'When finished:');
    lines.push('- Link the PR or final artifact back to this GitHub thread.');
    lines.push('- Summarize changed files, validation performed, and any follow-up risks.');
    lines.push('- Keep Veritas Kanban as the source of truth for task status.');

    return lines.join('\n');
  }

  private async getRepoNameWithOwner(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('gh', ['repo', 'view', '--json', 'nameWithOwner'], {
        cwd: repoPath,
      });
      const parsed = JSON.parse(stdout) as { nameWithOwner?: string };
      if (parsed.nameWithOwner) return parsed.nameWithOwner;
    } catch {
      // Fall back to the origin remote when gh cannot resolve repo metadata.
    }

    const remote = await this.getGitHubRemote(repoPath);
    const match = remote?.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
    if (match?.[1]) return match[1];
    throw new Error('Could not determine GitHub owner/repo for Codex Cloud delegation');
  }

  private async getIssueInfo(
    repoPath: string,
    issueRef: string
  ): Promise<{ url: string; number?: number }> {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'view', issueRef, '--json', 'url,number'],
      {
        cwd: repoPath,
      }
    );
    const parsed = JSON.parse(stdout) as { url: string; number?: number };
    return parsed;
  }

  private async getPRInfo(
    repoPath: string,
    prRef: string
  ): Promise<{ url: string; number?: number }> {
    const { stdout } = await execFileAsync('gh', ['pr', 'view', prRef, '--json', 'url,number'], {
      cwd: repoPath,
    });
    const parsed = JSON.parse(stdout) as { url: string; number?: number };
    return parsed;
  }

  private extractIssueNumber(url: string): number | undefined {
    const match = url.match(/\/issues\/(\d+)/);
    return match ? Number(match[1]) : undefined;
  }

  /**
   * Open PR in browser
   */
  async openPRInBrowser(taskId: string): Promise<void> {
    const task = await this.taskService.getTask(taskId);
    if (!task?.git?.prUrl) {
      throw new Error('Task does not have a PR URL');
    }

    // Return the URL - frontend will handle opening
    // Or we could use 'open' command on macOS
    await execFileAsync('open', [task.git.prUrl]);
  }
}
