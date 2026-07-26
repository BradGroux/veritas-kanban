import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCheckpoint, WorkspaceCheckpointFile } from '@veritas-kanban/shared';
import {
  WorkspaceCheckpointDiffService,
  parseWorkspaceCheckpointUnifiedDiff,
} from '../services/workspace-checkpoint-diff-service.js';
import { GitWorkspaceCheckpointDiffRunner } from '../storage/workspace-checkpoint-diff-runner.js';
import type { WorkspaceCheckpointRepository } from '../storage/workspace-checkpoint-repository.js';

const roots: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function file(
  filePath: string,
  contentDigest: string,
  overrides: Partial<WorkspaceCheckpointFile> = {}
): WorkspaceCheckpointFile {
  return {
    path: filePath,
    source: 'tracked',
    state: 'present',
    mode: 0o644,
    size: 10,
    contentDigest,
    blobDigest: contentDigest,
    ...overrides,
  };
}

function checkpoint(
  id: string,
  files: WorkspaceCheckpointFile[],
  overrides: Partial<WorkspaceCheckpoint> = {}
): WorkspaceCheckpoint {
  return {
    schemaVersion: 'workspace-checkpoint/v1',
    id,
    workspaceId: 'workspace-872',
    taskId: 'task-872',
    attemptId: 'attempt-872',
    boundary: 'before-user-turn',
    operationIdDigest: digest('1'),
    captureRequestDigest: digest('2'),
    worktreeRootDigest: digest('3'),
    worktreeManifestId: 'worktree-872',
    git: {
      head: 'a'.repeat(40),
      branch: 'feat/checkpoints',
      indexDigest: digest('4'),
      indexBlobDigest: digest('5'),
      indexBytes: 10,
      statusDigest: digest('6'),
      dirty: true,
    },
    policy: {
      ignoredFiles: 'excluded',
      sensitiveFiles: 'excluded',
      binaryFiles: 'excluded',
      symlinks: 'excluded',
      maxFiles: 10_000,
      maxBytes: 64 * 1_024 * 1_024,
      maxFileBytes: 8 * 1_024 * 1_024,
      maxExclusions: 2_000,
    },
    files,
    exclusions: [],
    excludedCount: 0,
    exclusionsTruncated: false,
    fileCount: files.length,
    contentBytes: files.reduce((total, entry) => total + entry.size, 0),
    storedBytes: 10,
    createdAt: '2026-07-26T06:00:00.000Z',
    digest: digest('7'),
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('WorkspaceCheckpointDiffService', () => {
  it('compares direct checkpoints without touching the worktree', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-checkpoint-preview-test-'));
    roots.push(temporaryRoot);
    const blobs = new Map([
      [digest('a'), Buffer.from('old\nsame\n')],
      [digest('b'), Buffer.from('new\nsame\n')],
      [digest('c'), Buffer.from('deleted\n')],
      [digest('d'), Buffer.from('added\n')],
      [digest('e'), Buffer.from('mode only\n')],
    ]);
    const from = checkpoint('checkpoint_from1234567890123456', [
      file('modified.txt', digest('a')),
      file('deleted.txt', digest('c')),
      file('mode.txt', digest('e')),
    ]);
    const to = checkpoint(
      'checkpoint_to123456789012345678',
      [
        file('modified.txt', digest('b')),
        file('deleted.txt', digest('c'), {
          state: 'absent',
          size: 0,
          mode: undefined,
          contentDigest: undefined,
          blobDigest: undefined,
        }),
        file('added.txt', digest('d'), { source: 'untracked' }),
        file('mode.txt', digest('e'), { mode: 0o755 }),
      ],
      {
        parentCheckpointId: from.id,
        git: {
          ...from.git,
          indexDigest: digest('8'),
          statusDigest: digest('9'),
        },
        createdAt: '2026-07-26T06:05:00.000Z',
      }
    );
    const repository = {
      get: vi.fn(async ({ checkpointId }) =>
        checkpointId === from.id ? from : checkpointId === to.id ? to : null
      ),
      readBlob: vi.fn(async (blobDigest: string) => blobs.get(blobDigest) ?? Buffer.alloc(0)),
    } as unknown as WorkspaceCheckpointRepository;
    const service = new WorkspaceCheckpointDiffService({
      repository,
      diffRunner: new GitWorkspaceCheckpointDiffRunner({ temporaryRoot }),
    });

    const result = await service.compare({
      workspaceId: from.workspaceId,
      taskId: from.taskId,
      attemptId: from.attemptId,
      fromCheckpointId: from.id,
      toCheckpointId: to.id,
    });

    expect(result).toMatchObject({
      schemaVersion: 'workspace-checkpoint-diff/v1',
      directParent: true,
      git: {
        headChanged: false,
        branchChanged: false,
        indexChanged: true,
        statusChanged: true,
      },
      summary: {
        filesChanged: 4,
        additions: 2,
        deletions: 2,
      },
    });
    expect(result.files.map(({ path: filePath, kind }) => [filePath, kind])).toEqual([
      ['added.txt', 'added'],
      ['deleted.txt', 'deleted'],
      ['mode.txt', 'mode-changed'],
      ['modified.txt', 'modified'],
    ]);
    expect(result.files.find((entry) => entry.path === 'modified.txt')?.hunks).toEqual([
      expect.objectContaining({
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: 'deletion', content: 'old', oldLineNumber: 1 },
          { kind: 'addition', content: 'new', newLineNumber: 1 },
          { kind: 'context', content: 'same', oldLineNumber: 2, newLineNumber: 2 },
        ],
      }),
    ]);
    expect(await fs.readdir(temporaryRoot)).toEqual([]);
  });

  it('fails closed across non-direct or differently owned checkpoint chains', async () => {
    const from = checkpoint('checkpoint_from1234567890123456', []);
    const to = checkpoint('checkpoint_to123456789012345678', [], {
      parentCheckpointId: 'checkpoint_other12345678901234',
    });
    const repository = {
      get: vi.fn(async ({ checkpointId }) => (checkpointId === from.id ? from : to)),
    } as unknown as WorkspaceCheckpointRepository;
    const service = new WorkspaceCheckpointDiffService({ repository });
    const input = {
      workspaceId: from.workspaceId,
      taskId: from.taskId,
      attemptId: from.attemptId,
      fromCheckpointId: from.id,
      toCheckpointId: to.id,
    };

    await expect(service.compare(input)).rejects.toThrow('direct parent-child chain');

    to.parentCheckpointId = from.id;
    to.worktreeRootDigest = digest('f');
    await expect(service.compare(input)).rejects.toThrow('worktree ownership boundaries');
  });
});

describe('parseWorkspaceCheckpointUnifiedDiff', () => {
  it('preserves hunk line numbers while ignoring Git file headers and newline markers', () => {
    const hunks = parseWorkspaceCheckpointUnifiedDiff(
      [
        'diff --git a/before b/after',
        '--- a/before',
        '+++ b/after',
        '@@ -2,2 +2,2 @@',
        ' keep',
        '-old',
        '\\ No newline at end of file',
        '+new',
        '\\ No newline at end of file',
        '',
      ].join('\n')
    );

    expect(hunks[0]?.lines).toEqual([
      { kind: 'context', content: 'keep', oldLineNumber: 2, newLineNumber: 2 },
      { kind: 'deletion', content: 'old', oldLineNumber: 3 },
      { kind: 'addition', content: 'new', newLineNumber: 3 },
    ]);
    expect(() => parseWorkspaceCheckpointUnifiedDiff('@@ -1 +1 @@\n-old\n')).toThrow(
      'incomplete hunk'
    );
  });
});
