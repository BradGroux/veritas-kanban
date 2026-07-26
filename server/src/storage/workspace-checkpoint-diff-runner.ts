import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConflictError } from '../middleware/error-handler.js';

const MAX_DIFF_OUTPUT_BYTES = 32 * 1_024 * 1_024;

export interface WorkspaceCheckpointDiffCommandResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

export type WorkspaceCheckpointDiffCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; maxBuffer: number }
) => Promise<WorkspaceCheckpointDiffCommandResult>;

export interface GitWorkspaceCheckpointDiffRunnerOptions {
  temporaryRoot?: string;
  runCommand?: WorkspaceCheckpointDiffCommandRunner;
}

export interface WorkspaceCheckpointDiffRunner {
  diff(before: Buffer, after: Buffer): Promise<string>;
}

export class GitWorkspaceCheckpointDiffRunner implements WorkspaceCheckpointDiffRunner {
  private readonly temporaryRoot: string;
  private readonly runCommand: WorkspaceCheckpointDiffCommandRunner;

  constructor(options: GitWorkspaceCheckpointDiffRunnerOptions = {}) {
    this.temporaryRoot = path.resolve(options.temporaryRoot ?? os.tmpdir());
    this.runCommand = options.runCommand ?? defaultCommandRunner;
  }

  async diff(before: Buffer, after: Buffer): Promise<string> {
    await mkdir(this.temporaryRoot, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(path.join(this.temporaryRoot, 'vk-checkpoint-diff-'));
    const beforePath = path.join(temporary, 'before');
    const afterPath = path.join(temporary, 'after');
    try {
      await writePrivateFile(beforePath, before);
      await writePrivateFile(afterPath, after);
      const result = await this.runCommand(
        'git',
        [
          'diff',
          '--no-index',
          '--no-color',
          '--no-ext-diff',
          '--text',
          '--unified=3',
          '--',
          beforePath,
          afterPath,
        ],
        { cwd: temporary, maxBuffer: MAX_DIFF_OUTPUT_BYTES }
      );
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new ConflictError('Workspace checkpoint text comparison failed.', {
          exitCode: result.exitCode,
        });
      }
      if (result.stdout.byteLength > MAX_DIFF_OUTPUT_BYTES) {
        throw new ConflictError('Workspace checkpoint text comparison exceeded its output bound.');
      }
      return result.stdout.toString('utf8');
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function writePrivateFile(filePath: string, content: Buffer): Promise<void> {
  const handle = await open(
    filePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string; maxBuffer: number }
): Promise<WorkspaceCheckpointDiffCommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: 'buffer',
        maxBuffer: options.maxBuffer,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: typeof error?.code === 'number' ? error.code : error ? 2 : 0,
          stdout: Buffer.from(stdout),
          stderr: Buffer.from(stderr),
        });
      }
    );
  });
}
