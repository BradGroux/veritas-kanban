import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { ConfigService } from './config-service.js';
import { TaskService } from './task-service.js';

export interface ConflictFile {
  path: string;
  content: string;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
  markers: ConflictMarker[];
}

export interface ConflictMarker {
  startLine: number;
  separatorLine: number;
  endLine: number;
  oursLines: string[];
  theirsLines: string[];
}

export interface ConflictStatus {
  hasConflicts: boolean;
  conflictingFiles: string[];
  rebaseInProgress: boolean;
  mergeInProgress: boolean;
}

export interface ResolveResult {
  success: boolean;
  remainingConflicts: string[];
}

export class ConflictService {
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
   * Get the working directory for a task (worktree or repo)
   */
  private async getWorkingDir(taskId: string): Promise<{ git: SimpleGit; workDir: string }> {
    const task = await this.taskService.getTask(taskId);
    if (!task?.git?.repo) {
      throw new Error('Task must have a repository configured');
    }

    const config = await this.configService.getConfig();
    const repoConfig = config.repos.find((r) => r.name === task.git!.repo);
    if (!repoConfig) {
      throw new Error(`Repository "${task.git.repo}" not found`);
    }

    const workDir = task.git.worktreePath || this.expandPath(repoConfig.path);
    const git = simpleGit(workDir);

    return { git, workDir };
  }

  /**
   * Check if there are conflicts in the working directory
   */
  async getConflictStatus(taskId: string): Promise<ConflictStatus> {
    const { git, workDir } = await this.getWorkingDir(taskId);

    // Check for rebase in progress
    const rebaseDir = path.join(workDir, '.git', 'rebase-merge');
    const rebaseApplyDir = path.join(workDir, '.git', 'rebase-apply');
    // Intentionally silent catches: fs.access throws if path doesn't exist — false means not present
    const rebaseInProgress =
      (await fs
        .access(rebaseDir)
        .then(() => true)
        .catch(() => false)) ||
      (await fs
        .access(rebaseApplyDir)
        .then(() => true)
        .catch(() => false));

    // Check for merge in progress (intentionally silent: false means no MERGE_HEAD)
    const mergeHead = path.join(workDir, '.git', 'MERGE_HEAD');
    const mergeInProgress = await fs
      .access(mergeHead)
      .then(() => true)
      .catch(() => false);

    // Get status to find conflicted files
    const status = await git.status();
    const conflictingFiles = status.conflicted || [];

    return {
      hasConflicts: conflictingFiles.length > 0,
      conflictingFiles,
      rebaseInProgress,
      mergeInProgress,
    };
  }

  /**
   * Get detailed conflict information for a file
   */
  async getFileConflict(taskId: string, filePath: string): Promise<ConflictFile> {
    const { git, workDir } = await this.getWorkingDir(taskId);

    const fullPath = path.join(workDir, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    // Parse conflict markers
    const markers = this.parseConflictMarkers(content);

    // Get the different versions
    let oursContent = '';
    let theirsContent = '';
    let baseContent = '';

    try {
      // Get our version (HEAD)
      oursContent = await git.show([`:2:${filePath}`]);
    } catch {
      // File might be new on our side
    }

    try {
      // Get their version (incoming)
      theirsContent = await git.show([`:3:${filePath}`]);
    } catch {
      // File might be new on their side
    }

    try {
      // Get base version (common ancestor)
      baseContent = await git.show([`:1:${filePath}`]);
    } catch {
      // File might not have a common ancestor
    }

    return {
      path: filePath,
      content,
      oursContent,
      theirsContent,
      baseContent,
      markers,
    };
  }

  /**
   * Parse conflict markers from file content
   */
  private parseConflictMarkers(content: string): ConflictMarker[] {
    const lines = content.split('\n');
    const markers: ConflictMarker[] = [];

    let i = 0;
    while (i < lines.length) {
      if (lines[i].startsWith('<<<<<<<')) {
        const startLine = i;
        const oursLines: string[] = [];
        const theirsLines: string[] = [];

        // Collect "ours" lines
        i++;
        while (i < lines.length && !lines[i].startsWith('=======')) {
          oursLines.push(lines[i]);
          i++;
        }

        const separatorLine = i;

        // Collect "theirs" lines
        i++;
        while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
          theirsLines.push(lines[i]);
          i++;
        }

        const endLine = i;

        markers.push({
          startLine,
          separatorLine,
          endLine,
          oursLines,
          theirsLines,
        });
      }
      i++;
    }

    return markers;
  }

  /**
   * Resolve a file conflict by choosing a side
   */
  async resolveFile(
    taskId: string,
    filePath: string,
    resolution: 'ours' | 'theirs' | 'manual',
    manualContent?: string
  ): Promise<ResolveResult> {
    const { git, workDir } = await this.getWorkingDir(taskId);
    const fullPath = path.join(workDir, filePath);

    if (resolution === 'manual') {
      if (!manualContent) {
        throw new Error('Manual content required for manual resolution');
      }
      await fs.writeFile(fullPath, manualContent, 'utf-8');
    } else if (resolution === 'ours') {
      // Checkout our version
      await git.checkout(['--ours', filePath]);
    } else if (resolution === 'theirs') {
      // Checkout their version
      await git.checkout(['--theirs', filePath]);
    }

    // Stage the resolved file
    await git.add(filePath);

    // Check remaining conflicts
    const status = await this.getConflictStatus(taskId);

    return {
      success: true,
      remainingConflicts: status.conflictingFiles,
    };
  }

  /**
   * Abort the current rebase
   */
  async abortRebase(taskId: string): Promise<void> {
    const { git } = await this.getWorkingDir(taskId);
    await git.rebase(['--abort']);
  }

  /**
   * Continue rebase after conflicts are resolved
   */
  async continueRebase(taskId: string): Promise<{ success: boolean; error?: string }> {
    const { git } = await this.getWorkingDir(taskId);

    try {
      await git.rebase(['--continue']);
      return { success: true };
    } catch (error: any) {
      // Check if there are still conflicts
      const status = await this.getConflictStatus(taskId);
      if (status.hasConflicts) {
        return {
          success: false,
          error: `Still have ${status.conflictingFiles.length} conflicting file(s)`,
        };
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Abort the current merge
   */
  async abortMerge(taskId: string): Promise<void> {
    const { git } = await this.getWorkingDir(taskId);
    await git.merge(['--abort']);
  }

  /**
   * Continue/finish merge after conflicts are resolved
   */
  async continueMerge(
    taskId: string,
    commitMessage?: string
  ): Promise<{ success: boolean; error?: string }> {
    const { git } = await this.getWorkingDir(taskId);

    try {
      // Commit the merge
      await git.commit(commitMessage || 'Merge conflict resolution');
      return { success: true };
    } catch (error: any) {
      const status = await this.getConflictStatus(taskId);
      if (status.hasConflicts) {
        return {
          success: false,
          error: `Still have ${status.conflictingFiles.length} conflicting file(s)`,
        };
      }
      return { success: false, error: error.message };
    }
  }
}
