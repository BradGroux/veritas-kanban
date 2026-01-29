import { exec } from 'child_process';
import { promisify } from 'util';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';
import { getBreaker } from './circuit-registry.js';

const execAsync = promisify(exec);

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

export class GitHubService {
  private configService: ConfigService;
  private taskService: TaskService;

  constructor() {
    this.configService = new ConfigService();
    this.taskService = new TaskService();
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
  async getPRForBranch(repoPath: string, branch: string): Promise<PRInfo | null> {
    const ghBreaker = getBreaker('github');
    try {
      const { stdout } = await ghBreaker.execute(() =>
        execAsync(
          `gh pr view ${branch} --json url,number,title,state,isDraft,headRefName,baseRefName 2>/dev/null`,
          { cwd: repoPath }
        )
      );

      const data = JSON.parse(stdout);
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

  /**
   * Create a GitHub PR for a task
   */
  async createPR(input: CreatePRInput): Promise<PRInfo> {
    const task = await this.taskService.getTask(input.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    if (!task.git?.repo || !task.git?.branch) {
      throw new Error('Task must have a repository and branch configured');
    }

    // Get repo config
    const config = await this.configService.getConfig();
    const repoConfig = config.repos.find((r) => r.name === task.git!.repo);
    if (!repoConfig) {
      throw new Error(`Repository "${task.git.repo}" not found in config`);
    }

    const repoPath = this.expandPath(repoConfig.path);
    const workingDir = task.git.worktreePath || repoPath;

    // Check if gh CLI is ready
    const ghStatus = await this.checkGhCli();
    if (!ghStatus.installed) {
      throw new Error('GitHub CLI (gh) is not installed. Install it with: brew install gh');
    }
    if (!ghStatus.authenticated) {
      throw new Error('GitHub CLI is not authenticated. Run: gh auth login');
    }

    // Check if PR already exists
    const existingPR = await this.getPRForBranch(repoPath, task.git.branch);
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

    // Push branch first to ensure it exists on remote
    try {
      await execAsync(`git push -u origin ${task.git.branch}`, { cwd: workingDir });
    } catch (error: any) {
      // Ignore if already pushed
      if (!error.message?.includes('Everything up-to-date')) {
        console.warn('Push warning:', error.message);
      }
    }

    // Build PR title and body
    const prTitle = input.title || task.title;
    const prBody = input.body || this.buildPRBody(task);
    const targetBranch = input.targetBranch || task.git.baseBranch || 'main';

    // Create the PR
    const args = [
      'gh',
      'pr',
      'create',
      '--title',
      JSON.stringify(prTitle),
      '--body',
      JSON.stringify(prBody),
      '--base',
      targetBranch,
      '--head',
      task.git.branch,
    ];

    if (input.draft) {
      args.push('--draft');
    }

    const ghBreaker = getBreaker('github');
    try {
      const { stdout } = await ghBreaker.execute(() =>
        execAsync(args.join(' '), { cwd: repoPath })
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
        (await this.getPRForBranch(repoPath, task.git.branch)) || {
          url: prUrl,
          number: prNumber,
          title: prTitle,
          state: 'OPEN',
          draft: input.draft || false,
          headBranch: task.git.branch,
          baseBranch: targetBranch,
        }
      );
    } catch (error: any) {
      throw new Error(`Failed to create PR: ${error.message}`);
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
    await execAsync(`open "${task.git.prUrl}"`);
  }
}
