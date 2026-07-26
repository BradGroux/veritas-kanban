import { describe, expect, it, vi } from 'vitest';
import type {
  RunEventEnvelope,
  RunEventSource,
  WorkspaceCheckpointDiff,
  WorkspaceCheckpointFileDiff,
} from '@veritas-kanban/shared';
import { WorkspaceCheckpointAttributionService } from '../services/workspace-checkpoint-attribution-service.js';

const fromCheckpointId = 'checkpoint_from1234567890123456';
const toCheckpointId = 'checkpoint_to123456789012345678';
const input = {
  workspaceId: 'workspace-872',
  taskId: 'task-872',
  attemptId: 'attempt-872',
  fromCheckpointId,
  toCheckpointId,
};

function changedFile(path: string): WorkspaceCheckpointFileDiff {
  return {
    path,
    kind: 'modified',
    source: 'tracked',
    fromState: 'present',
    toState: 'present',
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: '@@ -1 +1 @@',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: 'deletion', content: 'old', oldLineNumber: 1 },
          { kind: 'addition', content: 'new', newLineNumber: 1 },
        ],
      },
    ],
  };
}

function diff(paths: string[]): WorkspaceCheckpointDiff {
  return {
    schemaVersion: 'workspace-checkpoint-diff/v1',
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    attemptId: input.attemptId,
    fromCheckpoint: {
      id: fromCheckpointId,
      boundary: 'before-user-turn',
      createdAt: '2026-07-26T06:00:00.000Z',
      digest: `sha256:${'1'.repeat(64)}`,
    },
    toCheckpoint: {
      id: toCheckpointId,
      boundary: 'before-user-turn',
      createdAt: '2026-07-26T06:05:00.000Z',
      digest: `sha256:${'2'.repeat(64)}`,
    },
    directParent: true,
    git: {
      headChanged: false,
      branchChanged: false,
      indexChanged: true,
      statusChanged: true,
    },
    summary: { filesChanged: paths.length, additions: paths.length, deletions: paths.length },
    files: paths.map(changedFile),
  };
}

function event(
  sequence: number,
  kind: string,
  source: RunEventSource,
  payload: RunEventEnvelope['payload']
): RunEventEnvelope {
  return {
    schemaVersion: 'run-event/v1',
    eventId: `event-${sequence}`,
    taskId: input.taskId,
    runId: input.attemptId,
    attemptId: input.attemptId,
    sequence,
    receivedAt: `2026-07-26T06:00:0${sequence}.000Z`,
    kind,
    source,
    redaction: { status: 'none', fields: [], originalBytes: 0, persistedBytes: 0 },
    payload,
    payloadHash: `${sequence}`,
  };
}

const systemSource = { provider: 'system', adapter: 'workspace-checkpoint' } as const;
const codexSource = { provider: 'codex-cli', adapter: 'codex-cli', agent: 'CODEX' } as const;
const claudeSource = {
  provider: 'claude-code',
  adapter: 'claude-code',
  agent: 'CLAUDE',
} as const;
const operatorSource = { provider: 'operator', adapter: 'operator-file-editor' } as const;

describe('WorkspaceCheckpointAttributionService', () => {
  it('attributes only explicit path-bearing evidence inside checkpoint boundaries', async () => {
    const paths = [
      'agent.ts',
      'operator.ts',
      'external.ts',
      'write-tool.ts',
      'mixed.ts',
      'unknown.ts',
    ];
    const events = [
      event(1, 'workspace.checkpoint.created', systemSource, {
        checkpointId: fromCheckpointId,
      }),
      event(2, 'file.changed', codexSource, { paths: ['agent.ts'] }),
      event(3, 'file.changed', operatorSource, { paths: ['operator.ts'] }),
      event(
        4,
        'file.changed',
        { provider: 'system', adapter: 'filesystem-watcher' },
        {
          paths: ['external.ts'],
        }
      ),
      event(5, 'tool.started', claudeSource, {
        tool: 'Write',
        paths: ['write-tool.ts'],
      }),
      event(6, 'file.changed', codexSource, { paths: ['mixed.ts'] }),
      event(7, 'file.changed', operatorSource, { paths: ['mixed.ts'] }),
      event(8, 'tool.started', claudeSource, { tool: 'Read', paths: ['unknown.ts'] }),
      event(9, 'workspace.checkpoint.created', systemSource, { checkpointId: toCheckpointId }),
    ];
    const service = new WorkspaceCheckpointAttributionService({
      diffs: { compare: vi.fn(async () => diff(paths)) },
      events: {
        list: vi.fn(async () => ({
          schemaVersion: 'run-event/v1',
          taskId: input.taskId,
          attemptId: input.attemptId,
          events,
          nextCursor: 9,
          hasMore: false,
        })),
      },
    });

    const result = await service.compare(input);
    const attribution = Object.fromEntries(
      result.files.map((file) => [file.path, file.attribution])
    );

    expect(result.attribution).toEqual({
      evidenceComplete: true,
      fromEventSequence: 1,
      toEventSequence: 9,
      eventsConsidered: 7,
    });
    expect(attribution['agent.ts']).toMatchObject({
      source: 'agent-tool',
      confidence: 'high',
      basis: 'provider-file-event',
      scope: 'checkpoint-file-window',
      provider: 'codex-cli',
      agent: 'CODEX',
    });
    expect(attribution['operator.ts']).toMatchObject({
      source: 'operator',
      basis: 'operator-file-event',
    });
    expect(attribution['external.ts']).toMatchObject({
      source: 'external',
      basis: 'filesystem-file-event',
    });
    expect(attribution['write-tool.ts']).toMatchObject({
      source: 'agent-tool',
      basis: 'write-tool-event',
      tool: 'Write',
    });
    expect(attribution['mixed.ts']).toEqual({
      source: 'unknown',
      confidence: 'ambiguous',
      basis: 'mixed-file-evidence',
      scope: 'checkpoint-file-window',
      evidenceEventIds: ['event-6', 'event-7'],
    });
    expect(attribution['unknown.ts']).toEqual({
      source: 'unknown',
      confidence: 'none',
      basis: 'no-file-evidence',
      scope: 'checkpoint-file-window',
      evidenceEventIds: [],
    });
    expect(result.files[0].hunks[0].attribution).toEqual(result.files[0].attribution);
  });

  it('marks all attribution unknown when the event boundary window is incomplete', async () => {
    const service = new WorkspaceCheckpointAttributionService({
      diffs: { compare: vi.fn(async () => diff(['agent.ts'])) },
      events: {
        list: vi.fn(async () => ({
          schemaVersion: 'run-event/v1',
          taskId: input.taskId,
          attemptId: input.attemptId,
          events: [
            event(1, 'workspace.checkpoint.created', systemSource, {
              checkpointId: fromCheckpointId,
            }),
            event(2, 'workspace.checkpoint.created', codexSource, {
              checkpointId: toCheckpointId,
            }),
            event(3, 'file.changed', codexSource, { paths: ['agent.ts'] }),
          ],
          nextCursor: 3,
          hasMore: false,
        })),
      },
    });

    const result = await service.compare(input);

    expect(result.attribution).toEqual({
      evidenceComplete: false,
      fromEventSequence: 1,
      eventsConsidered: 0,
    });
    expect(result.files[0].attribution?.source).toBe('unknown');
  });

  it('attributes separate hunks when every write event carries exact unified-diff ranges', async () => {
    const path = 'mixed-ranges.ts';
    const file = changedFile(path);
    file.hunks = [
      {
        header: '@@ -10 +10 @@',
        oldStart: 10,
        oldLines: 1,
        newStart: 10,
        newLines: 1,
        lines: [],
      },
      {
        header: '@@ -30,2 +30,2 @@',
        oldStart: 30,
        oldLines: 2,
        newStart: 30,
        newLines: 2,
        lines: [],
      },
      {
        header: '@@ -50 +50 @@',
        oldStart: 50,
        oldLines: 1,
        newStart: 50,
        newLines: 1,
        lines: [],
      },
      {
        header: '@@ -70 +70 @@',
        oldStart: 70,
        oldLines: 1,
        newStart: 70,
        newLines: 1,
        lines: [],
      },
    ];
    const checkpointDiff = diff([path]);
    checkpointDiff.files = [file];
    const events = [
      event(1, 'workspace.checkpoint.created', systemSource, {
        checkpointId: fromCheckpointId,
      }),
      event(2, 'file.changed', codexSource, {
        paths: [path],
        hunkRanges: [
          { path, oldStart: 10, oldLines: 1, newStart: 10, newLines: 1 },
          { path, oldStart: 70, oldLines: 1, newStart: 70, newLines: 1 },
        ],
      }),
      event(3, 'file.changed', operatorSource, {
        paths: [path],
        hunkRanges: [
          { path, oldStart: 30, oldLines: 2, newStart: 30, newLines: 2 },
          { path, oldStart: 70, oldLines: 1, newStart: 70, newLines: 1 },
        ],
      }),
      event(4, 'workspace.checkpoint.created', systemSource, {
        checkpointId: toCheckpointId,
      }),
    ];
    const service = new WorkspaceCheckpointAttributionService({
      diffs: { compare: vi.fn(async () => checkpointDiff) },
      events: {
        list: vi.fn(async () => ({
          schemaVersion: 'run-event/v1',
          taskId: input.taskId,
          attemptId: input.attemptId,
          events,
          nextCursor: 4,
          hasMore: false,
        })),
      },
    });

    const result = await service.compare(input);

    expect(result.files[0].attribution).toMatchObject({
      source: 'unknown',
      confidence: 'ambiguous',
      basis: 'mixed-file-evidence',
      scope: 'checkpoint-file-window',
    });
    expect(result.files[0].hunks[0].attribution).toMatchObject({
      source: 'agent-tool',
      confidence: 'high',
      basis: 'hunk-range-event',
      scope: 'checkpoint-hunk-window',
      evidenceEventIds: ['event-2'],
    });
    expect(result.files[0].hunks[1].attribution).toMatchObject({
      source: 'operator',
      confidence: 'high',
      basis: 'hunk-range-event',
      scope: 'checkpoint-hunk-window',
      evidenceEventIds: ['event-3'],
    });
    expect(result.files[0].hunks[2].attribution).toEqual({
      source: 'unknown',
      confidence: 'none',
      basis: 'no-hunk-evidence',
      scope: 'checkpoint-hunk-window',
      evidenceEventIds: [],
    });
    expect(result.files[0].hunks[3].attribution).toEqual({
      source: 'unknown',
      confidence: 'ambiguous',
      basis: 'mixed-hunk-evidence',
      scope: 'checkpoint-hunk-window',
      evidenceEventIds: ['event-2', 'event-3'],
    });
  });
});
