import { simpleGit } from 'simple-git';
import { WorktreeService } from './worktree-service.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('diff-service');

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  oldPath?: string; // For renames
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  language: string;
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'delete';
  content: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface DiffSummary {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
}

export class DiffService {
  private readonly worktreeService: Pick<WorktreeService, 'resolvePublicationAuthority'>;

  constructor(
    options: {
      worktreeService?: Pick<WorktreeService, 'resolvePublicationAuthority'>;
    } = {}
  ) {
    this.worktreeService = options.worktreeService ?? new WorktreeService();
  }

  private getLanguageFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'jsx',
      json: 'json',
      md: 'markdown',
      css: 'css',
      scss: 'scss',
      html: 'html',
      py: 'python',
      rs: 'rust',
      go: 'go',
      rb: 'ruby',
      java: 'java',
      sh: 'bash',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      sql: 'sql',
    };
    return langMap[ext] || 'plaintext';
  }

  private parseStatusCode(code: string): FileChange['status'] {
    switch (code[0]) {
      case 'A':
        return 'added';
      case 'M':
        return 'modified';
      case 'D':
        return 'deleted';
      case 'R':
        return 'renamed';
      default:
        return 'modified';
    }
  }

  async getDiffSummary(taskId: string): Promise<DiffSummary> {
    const authority = await this.worktreeService.resolvePublicationAuthority(taskId);
    const git = simpleGit(authority.worktreePath);

    // Get list of changed files with stats
    const diffStat = await git.diffSummary([authority.baseCommit]);

    const files: FileChange[] = diffStat.files.map((file) => {
      const additions = 'insertions' in file ? file.insertions : 0;
      const deletions = 'deletions' in file ? file.deletions : 0;
      const isBinary = 'binary' in file && file.binary;

      return {
        path: file.file,
        status: isBinary
          ? ('modified' as const)
          : additions > 0 && deletions === 0
            ? ('added' as const)
            : deletions > 0 && additions === 0
              ? ('deleted' as const)
              : ('modified' as const),
        additions,
        deletions,
      };
    });

    return {
      files,
      totalAdditions: diffStat.insertions,
      totalDeletions: diffStat.deletions,
      totalFiles: files.length,
    };
  }

  async getFileDiff(taskId: string, filePath: string): Promise<FileDiff> {
    const authority = await this.worktreeService.resolvePublicationAuthority(taskId);
    const git = simpleGit(authority.worktreePath);

    // Get unified diff for the file
    const diffOutput = await git.diff([authority.baseCommit, '--', filePath]);

    // Get file stats
    const diffStat = await git.diffSummary([authority.baseCommit, '--', filePath]);
    const fileStat = diffStat.files[0];

    // Parse the unified diff
    const hunks = this.parseUnifiedDiff(diffOutput);

    // Determine status and get stats
    let status: FileChange['status'] = 'modified';
    let additions = 0;
    let deletions = 0;

    if (fileStat && 'insertions' in fileStat) {
      additions = fileStat.insertions;
      deletions = fileStat.deletions;
      if (additions > 0 && deletions === 0) status = 'added';
      else if (deletions > 0 && additions === 0) status = 'deleted';
    }

    return {
      path: filePath,
      status,
      hunks,
      language: this.getLanguageFromPath(filePath),
      additions,
      deletions,
    };
  }

  private parseUnifiedDiff(diffOutput: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = diffOutput.split('\n');

    let currentHunk: DiffHunk | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (const line of lines) {
      // Match hunk header: @@ -start,count +start,count @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);

      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        oldLineNum = parseInt(hunkMatch[1], 10);
        newLineNum = parseInt(hunkMatch[3], 10);

        currentHunk = {
          oldStart: oldLineNum,
          oldLines: parseInt(hunkMatch[2] || '1', 10),
          newStart: newLineNum,
          newLines: parseInt(hunkMatch[4] || '1', 10),
          lines: [],
        };
        continue;
      }

      if (!currentHunk) continue;

      // Skip diff metadata lines
      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('\\')
      ) {
        continue;
      }

      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.slice(1),
          newNumber: newLineNum++,
        });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'delete',
          content: line.slice(1),
          oldNumber: oldLineNum++,
        });
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({
          type: 'context',
          content: line.slice(1) || '',
          oldNumber: oldLineNum++,
          newNumber: newLineNum++,
        });
      }
    }

    if (currentHunk && currentHunk.lines.length > 0) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  async getFullDiff(taskId: string): Promise<FileDiff[]> {
    const summary = await this.getDiffSummary(taskId);
    const diffs: FileDiff[] = [];

    for (const file of summary.files) {
      try {
        const diff = await this.getFileDiff(taskId, file.path);
        diffs.push(diff);
      } catch (e) {
        // Skip files that can't be diffed (binary, etc.)
        log.warn({ data: e }, `Could not get diff for ${file.path}`);
      }
    }

    return diffs;
  }
}
