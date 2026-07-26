import type {
  WorkspaceCheckpoint,
  WorkspaceCheckpointDiff,
  WorkspaceCheckpointDiffHunk,
  WorkspaceCheckpointDiffLine,
  WorkspaceCheckpointFile,
  WorkspaceCheckpointFileDiff,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import {
  FileWorkspaceCheckpointRepository,
  type WorkspaceCheckpointRepository,
} from '../storage/workspace-checkpoint-repository.js';
import {
  GitWorkspaceCheckpointDiffRunner,
  type WorkspaceCheckpointDiffRunner,
} from '../storage/workspace-checkpoint-diff-runner.js';

export interface WorkspaceCheckpointDiffInput {
  workspaceId: string;
  taskId: string;
  attemptId: string;
  fromCheckpointId: string;
  toCheckpointId: string;
}

export interface WorkspaceCheckpointDiffServiceOptions {
  repository?: WorkspaceCheckpointRepository;
  diffRunner?: WorkspaceCheckpointDiffRunner;
}

export class WorkspaceCheckpointDiffService {
  private readonly repository: WorkspaceCheckpointRepository;
  private readonly diffRunner: WorkspaceCheckpointDiffRunner;

  constructor(options: WorkspaceCheckpointDiffServiceOptions = {}) {
    this.repository = options.repository ?? new FileWorkspaceCheckpointRepository();
    this.diffRunner = options.diffRunner ?? new GitWorkspaceCheckpointDiffRunner();
  }

  async compare(input: WorkspaceCheckpointDiffInput): Promise<WorkspaceCheckpointDiff> {
    const scope = {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
    };
    const [from, to] = await Promise.all([
      this.repository.get({ ...scope, checkpointId: input.fromCheckpointId }),
      this.repository.get({ ...scope, checkpointId: input.toCheckpointId }),
    ]);
    if (!from || !to) {
      throw new ConflictError('Workspace checkpoint comparison requires both checkpoints.', {
        fromCheckpointFound: Boolean(from),
        toCheckpointFound: Boolean(to),
      });
    }
    this.assertDirectChain(from, to);

    const fromFiles = new Map(from.files.map((file) => [file.path, file]));
    const toFiles = new Map(to.files.map((file) => [file.path, file]));
    const paths = [...new Set([...fromFiles.keys(), ...toFiles.keys()])].sort((left, right) =>
      left.localeCompare(right)
    );
    const files: WorkspaceCheckpointFileDiff[] = [];
    for (const filePath of paths) {
      const file = await this.compareFile(filePath, fromFiles.get(filePath), toFiles.get(filePath));
      if (file) files.push(file);
    }

    return {
      schemaVersion: 'workspace-checkpoint-diff/v1',
      ...scope,
      fromCheckpoint: checkpointReference(from),
      toCheckpoint: checkpointReference(to),
      directParent: true,
      git: {
        headChanged: from.git.head !== to.git.head,
        branchChanged: from.git.branch !== to.git.branch,
        indexChanged: from.git.indexDigest !== to.git.indexDigest,
        statusChanged: from.git.statusDigest !== to.git.statusDigest,
      },
      summary: {
        filesChanged: files.length,
        additions: files.reduce((total, file) => total + file.additions, 0),
        deletions: files.reduce((total, file) => total + file.deletions, 0),
      },
      files,
    };
  }

  private assertDirectChain(from: WorkspaceCheckpoint, to: WorkspaceCheckpoint): void {
    if (to.parentCheckpointId !== from.id) {
      throw new ConflictError(
        'Workspace checkpoint comparison requires a direct parent-child chain.',
        {
          fromCheckpointId: from.id,
          toCheckpointId: to.id,
          actualParentCheckpointId: to.parentCheckpointId,
        }
      );
    }
    if (
      from.worktreeRootDigest !== to.worktreeRootDigest ||
      from.worktreeManifestId !== to.worktreeManifestId
    ) {
      throw new ConflictError(
        'Workspace checkpoint comparison cannot cross worktree ownership boundaries.',
        {
          fromCheckpointId: from.id,
          toCheckpointId: to.id,
        }
      );
    }
  }

  private async compareFile(
    filePath: string,
    fromFile: WorkspaceCheckpointFile | undefined,
    toFile: WorkspaceCheckpointFile | undefined
  ): Promise<WorkspaceCheckpointFileDiff | null> {
    const fromState = fromFile?.state ?? 'absent';
    const toState = toFile?.state ?? 'absent';
    const contentChanged = fromFile?.contentDigest !== toFile?.contentDigest;
    const modeChanged = fromFile?.mode !== toFile?.mode;
    if (fromState === toState && !contentChanged && !modeChanged) return null;

    let hunks: WorkspaceCheckpointDiffHunk[] = [];
    if (contentChanged) {
      const before = await this.readFileContent(fromFile);
      const after = await this.readFileContent(toFile);
      hunks = parseWorkspaceCheckpointUnifiedDiff(await this.diffRunner.diff(before, after));
    }
    if (contentChanged && hunks.length === 0) {
      throw new ConflictError(
        'Workspace checkpoint content changed without a complete text diff.',
        {
          path: filePath,
        }
      );
    }
    const additions = countLines(hunks, 'addition');
    const deletions = countLines(hunks, 'deletion');
    return {
      path: filePath,
      kind:
        fromState === 'absent'
          ? 'added'
          : toState === 'absent'
            ? 'deleted'
            : contentChanged
              ? 'modified'
              : 'mode-changed',
      source: toFile?.source ?? fromFile?.source ?? 'tracked',
      fromState,
      toState,
      ...(fromFile?.mode === undefined ? {} : { fromMode: fromFile.mode }),
      ...(toFile?.mode === undefined ? {} : { toMode: toFile.mode }),
      ...(fromFile?.contentDigest ? { fromContentDigest: fromFile.contentDigest } : {}),
      ...(toFile?.contentDigest ? { toContentDigest: toFile.contentDigest } : {}),
      additions,
      deletions,
      hunks,
    };
  }

  private async readFileContent(file: WorkspaceCheckpointFile | undefined): Promise<Buffer> {
    if (!file || file.state === 'absent') return Buffer.alloc(0);
    if (!file.blobDigest) {
      throw new ConflictError('Present workspace checkpoint file is missing blob evidence.', {
        path: file.path,
      });
    }
    return this.repository.readBlob(file.blobDigest);
  }
}

export function parseWorkspaceCheckpointUnifiedDiff(
  unifiedDiff: string
): WorkspaceCheckpointDiffHunk[] {
  const hunks: WorkspaceCheckpointDiffHunk[] = [];
  let current: WorkspaceCheckpointDiffHunk | undefined;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  for (const line of unifiedDiff.split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (match) {
      if (current) assertCompleteHunk(current);
      oldLineNumber = Number(match[1]);
      newLineNumber = Number(match[3]);
      current = {
        header: line,
        oldStart: oldLineNumber,
        oldLines: Number(match[2] ?? 1),
        newStart: newLineNumber,
        newLines: Number(match[4] ?? 1),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current || line === '\\ No newline at end of file') continue;

    let parsed: WorkspaceCheckpointDiffLine | undefined;
    if (line.startsWith(' ')) {
      parsed = {
        kind: 'context',
        content: line.slice(1),
        oldLineNumber,
        newLineNumber,
      };
      oldLineNumber += 1;
      newLineNumber += 1;
    } else if (line.startsWith('+')) {
      parsed = {
        kind: 'addition',
        content: line.slice(1),
        newLineNumber,
      };
      newLineNumber += 1;
    } else if (line.startsWith('-')) {
      parsed = {
        kind: 'deletion',
        content: line.slice(1),
        oldLineNumber,
      };
      oldLineNumber += 1;
    }
    if (parsed) current.lines.push(parsed);
  }
  if (current) assertCompleteHunk(current);
  return hunks;
}

function checkpointReference(checkpoint: WorkspaceCheckpoint) {
  return {
    id: checkpoint.id,
    boundary: checkpoint.boundary,
    createdAt: checkpoint.createdAt,
    digest: checkpoint.digest,
  };
}

function countLines(
  hunks: WorkspaceCheckpointDiffHunk[],
  kind: WorkspaceCheckpointDiffLine['kind']
): number {
  return hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === kind).length,
    0
  );
}

function assertCompleteHunk(hunk: WorkspaceCheckpointDiffHunk): void {
  const oldLines = countLines([hunk], 'context') + countLines([hunk], 'deletion');
  const newLines = countLines([hunk], 'context') + countLines([hunk], 'addition');
  if (oldLines !== hunk.oldLines || newLines !== hunk.newLines) {
    throw new ConflictError('Workspace checkpoint text comparison produced an incomplete hunk.', {
      header: hunk.header,
      expectedOldLines: hunk.oldLines,
      actualOldLines: oldLines,
      expectedNewLines: hunk.newLines,
      actualNewLines: newLines,
    });
  }
}
