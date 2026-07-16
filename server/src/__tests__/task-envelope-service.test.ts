import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import { describe, expect, it, vi } from 'vitest';
import {
  COMPLETION_RESULT_SCHEMA_VERSION,
  TASK_ENVELOPE_SCHEMA_VERSION,
  type CompletionResult,
  type Task,
  type TaskLaunchBaseline,
} from '@veritas-kanban/shared';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';
import {
  CompletionResultSchema,
  TaskExecutionPolicySchema,
  TaskEnvelopeSchema,
  parseCompletionResultForEnvelope,
} from '../schemas/task-envelope-schemas.js';
import {
  GitCompletionEvidenceSource,
  TaskEnvelopeService,
  resolveTaskCommitPolicy,
  type CompletionEvidenceSource,
} from '../services/task-envelope-service.js';
import { verifyTaskEnvelopeDigest } from '../utils/task-envelope-digest.js';

const createdAt = '2026-07-16T12:00:00.000Z';
const baseline: TaskLaunchBaseline = {
  capturedAt: createdAt,
  headSha: 'a'.repeat(40),
  dirty: true,
  files: [
    {
      path: 'pre-existing.txt',
      status: 'modified',
      indexBlobHash: 'b'.repeat(40),
      worktreeSha256: 'c'.repeat(64),
    },
  ],
};

const evidenceSource: CompletionEvidenceSource = {
  captureLaunchBaseline: async () => structuredClone(baseline),
};

function task(): Task {
  return {
    id: 'task_20260716_contract',
    title: 'Define a task envelope',
    description: 'Replace transport-specific instructions with a durable contract.',
    type: 'code',
    status: 'todo',
    priority: 'high',
    project: 'veritas-kanban',
    created: createdAt,
    updated: createdAt,
    git: {
      repo: 'veritas-kanban',
      branch: 'feat/task-envelope',
      baseBranch: 'main',
      worktreePath: '/tmp/veritas-kanban-task',
    },
    subtasks: [
      {
        id: 'subtask-1',
        title: 'Contract',
        completed: false,
        created: createdAt,
        acceptanceCriteria: ['The envelope is versioned.'],
      },
    ],
    verificationSteps: [{ id: 'verify-1', description: 'Run focused tests', checked: false }],
    observations: [
      {
        id: 'observation-1',
        type: 'context',
        content: 'Existing callbacks must remain readable.',
        score: 8,
        timestamp: createdAt,
      },
    ],
  };
}

async function envelope(commitPolicy: 'forbidden' | 'allowed' | 'required' = 'allowed') {
  return new TaskEnvelopeService(evidenceSource).build({
    task: task(),
    attemptId: 'attempt_contract',
    createdAt,
    worktreePath: '/tmp/veritas-kanban-task',
    providerRuntimeManifest: providerRuntimeManifestFixture({
      capabilityStates: { 'artifact.write': 'supported' },
    }),
    commitPolicy,
    networkAccessEnabled: true,
  });
}

function completionResult(
  taskEnvelope: Awaited<ReturnType<typeof envelope>>,
  status: CompletionResult['status']
): CompletionResult {
  return {
    schemaVersion: COMPLETION_RESULT_SCHEMA_VERSION,
    taskEnvelopeSchemaVersion: TASK_ENVELOPE_SCHEMA_VERSION,
    taskEnvelopeDigest: taskEnvelope.digest,
    taskId: taskEnvelope.subject.id,
    attemptId: taskEnvelope.attempt.id,
    providerRuntimeManifestDigest: taskEnvelope.launchManifest.digest,
    status,
    summary: `Fixture ${status}`,
    error: status === 'failed' ? 'Fixture failure' : null,
    blockers:
      status === 'blocked'
        ? [{ code: 'fixture', summary: 'Blocked', detail: 'Fixture blocker', retryable: true }]
        : [],
    evidence:
      status === 'success'
        ? [
            {
              id: 'evidence-terminal',
              kind: 'provider-output',
              source: 'harness',
              summary: 'Process exited successfully.',
              reference: null,
              requirementIds: ['terminal-state'],
              verified: true,
            },
            {
              id: 'evidence-verification',
              kind: 'verification',
              source: 'harness',
              summary: 'Focused tests passed.',
              reference: null,
              requirementIds: ['verification'],
              verified: true,
            },
          ]
        : [],
    changedFiles: [],
    artifacts: [],
    verification:
      status === 'success'
        ? [
            {
              gateId: 'verify-1',
              status: 'passed',
              summary: 'Focused tests passed.',
              evidenceIds: ['evidence-verification'],
            },
          ]
        : [],
    sideEffects: [],
    continuation: null,
  };
}

describe('TaskEnvelopeService', () => {
  it('builds a strict, immutable, digest-bound envelope with launch attribution', async () => {
    const result = await envelope('allowed');

    expect(result.schemaVersion).toBe(TASK_ENVELOPE_SCHEMA_VERSION);
    expect(result.workspace.baseline).toEqual(baseline);
    expect(result.subject.acceptanceCriteria).toEqual(['The envelope is versioned.']);
    expect(result.subject.background).toContain('Existing callbacks must remain readable.');
    expect(result.allowedSideEffects.map((item) => item.kind)).toEqual([
      'filesystem-write',
      'process-execute',
      'git-commit',
      'network-egress',
      'artifact-write',
    ]);
    expect(result.completionContract.evidenceRequirements.map((item) => item.id)).toEqual([
      'terminal-state',
      'verification',
    ]);
    expect(TaskEnvelopeSchema.safeParse(result).success).toBe(true);
    expect(verifyTaskEnvelopeDigest(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.workspace.baseline.files)).toBe(true);

    const tampered = structuredClone(result);
    tampered.commitPolicy = 'required';
    expect(TaskEnvelopeSchema.safeParse(tampered).success).toBe(false);
  });

  it('resolves run, task, legacy, and compatible default commit policy precedence', () => {
    expect(TaskExecutionPolicySchema.safeParse({ commitPolicy: 'sometimes' }).success).toBe(false);
    expect(
      resolveTaskCommitPolicy({
        runPolicy: 'forbidden',
        taskPolicy: { commitPolicy: 'required' },
        legacyAutoCommitOnComplete: true,
      })
    ).toBe('forbidden');
    expect(
      resolveTaskCommitPolicy({
        taskPolicy: { commitPolicy: 'required' },
        legacyAutoCommitOnComplete: false,
      })
    ).toBe('required');
    expect(resolveTaskCommitPolicy({ legacyAutoCommitOnComplete: true })).toBe('required');
    expect(resolveTaskCommitPolicy({ legacyAutoCommitOnComplete: false })).toBe('allowed');
    expect(resolveTaskCommitPolicy({})).toBe('allowed');
  });

  it('rejects contradictory commit and side-effect/output policy', async () => {
    const service = new TaskEnvelopeService(evidenceSource);
    const base = {
      task: task(),
      attemptId: 'attempt_policy',
      createdAt,
      worktreePath: '/tmp/veritas-kanban-task',
      providerRuntimeManifest: providerRuntimeManifestFixture(),
    };

    await expect(
      service.build({
        ...base,
        commitPolicy: 'required',
        executionPolicy: {
          allowedSideEffects: [{ kind: 'filesystem-write', scope: 'assigned worktree' }],
        },
      })
    ).rejects.toThrow(/must authorize the git-commit side effect/);

    await expect(
      service.build({
        ...base,
        commitPolicy: 'forbidden',
        executionPolicy: {
          expectedOutputs: [
            {
              id: 'contradictory-commit',
              kind: 'commit',
              description: 'Create a commit.',
              required: true,
            },
          ],
        },
      })
    ).rejects.toThrow(/cannot require a commit output/);
  });

  it('clamps requested filesystem scopes to the effective worktree sandbox', async () => {
    const result = await new TaskEnvelopeService(evidenceSource).build({
      task: task(),
      attemptId: 'attempt_scope',
      createdAt,
      worktreePath: '/tmp/veritas-kanban-task',
      providerRuntimeManifest: providerRuntimeManifestFixture({
        capabilityStates: { 'artifact.write': 'supported' },
      }),
      commitPolicy: 'required',
      executionPolicy: {
        allowedSideEffects: [
          { kind: 'filesystem-write', scope: '/' },
          { kind: 'process-execute', scope: '/tmp' },
          { kind: 'git-commit', scope: '/' },
          { kind: 'artifact-write', scope: '/etc' },
        ],
      },
    });

    expect(result.allowedSideEffects).toEqual([
      { kind: 'filesystem-write', scope: '/tmp/veritas-kanban-task' },
      { kind: 'process-execute', scope: '/tmp/veritas-kanban-task' },
      { kind: 'git-commit', scope: '/tmp/veritas-kanban-task' },
    ]);
  });

  it('normalizes oversized legacy project names into stable workspace IDs', async () => {
    const service = new TaskEnvelopeService(evidenceSource);
    const oversizedProject = `legacy-${'x'.repeat(300)}`;
    const input = {
      task: { ...task(), project: oversizedProject },
      attemptId: 'attempt_workspace',
      createdAt,
      worktreePath: '/tmp/veritas-kanban-task',
      providerRuntimeManifest: providerRuntimeManifestFixture(),
      commitPolicy: 'allowed' as const,
    };

    const first = await service.build(input);
    const second = await service.build(input);

    expect(first.workspace.workspaceId).toHaveLength(160);
    expect(first.workspace.workspaceId).toBe(second.workspace.workspaceId);
    expect(first.workspace.workspaceId).toMatch(/^legacy-x+~[a-f0-9]{16}$/);
  });

  it('validates all completion statuses and envelope-bound success evidence', async () => {
    const taskEnvelope = await envelope('allowed');
    for (const status of ['success', 'blocked', 'failed', 'interrupted', 'partial'] as const) {
      expect(CompletionResultSchema.safeParse(completionResult(taskEnvelope, status)).success).toBe(
        true
      );
    }
    expect(
      parseCompletionResultForEnvelope(completionResult(taskEnvelope, 'success'), taskEnvelope)
    ).toMatchObject({ status: 'success' });

    const missingVerification = completionResult(taskEnvelope, 'success');
    missingVerification.verification = [];
    expect(() => parseCompletionResultForEnvelope(missingVerification, taskEnvelope)).toThrow(
      /Missing passed verification evidence/
    );

    const wrongEvidenceKind = completionResult(taskEnvelope, 'success');
    wrongEvidenceKind.evidence[0].kind = 'file-change';
    expect(() => parseCompletionResultForEnvelope(wrongEvidenceKind, taskEnvelope)).toThrow(
      /Missing verified completion evidence/
    );

    const unboundVerification = completionResult(taskEnvelope, 'success');
    unboundVerification.verification[0].evidenceIds = ['missing-evidence'];
    expect(() => parseCompletionResultForEnvelope(unboundVerification, taskEnvelope)).toThrow(
      /Missing passed verification evidence/
    );

    const wrongEnvelope = completionResult(taskEnvelope, 'success');
    wrongEnvelope.taskEnvelopeDigest = `sha256:${'f'.repeat(64)}`;
    expect(() => parseCompletionResultForEnvelope(wrongEnvelope, taskEnvelope)).toThrow(
      /task envelope digest/
    );
  });

  it('captures the committed HEAD and pre-existing dirty files from a real worktree', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'veritas-task-envelope-'));
    const git = simpleGit(directory);
    await git.init();
    await git.addConfig('user.name', 'Veritas Test');
    await git.addConfig('user.email', 'veritas@example.com');
    await git.addConfig('commit.gpgsign', 'false');
    await writeFile(path.join(directory, 'tracked.txt'), 'baseline\n');
    await git.add('tracked.txt');
    await git.commit('baseline');
    const headSha = (await git.revparse(['HEAD'])).trim();
    await writeFile(path.join(directory, 'tracked.txt'), 'changed before launch\n');
    await writeFile(path.join(directory, 'untracked.txt'), 'pre-existing\n');

    const captured = await new GitCompletionEvidenceSource().captureLaunchBaseline(
      directory,
      createdAt
    );

    expect(captured.headSha).toBe(headSha);
    expect(captured.dirty).toBe(true);
    const trackedIndexHash = (await git.raw(['ls-files', '--stage', 'tracked.txt']))
      .trim()
      .split(/\s+/)[1];
    expect(captured.files).toEqual(
      expect.arrayContaining([
        {
          path: 'tracked.txt',
          status: 'modified',
          indexBlobHash: trackedIndexHash,
          worktreeSha256: createHash('sha256').update('changed before launch\n').digest('hex'),
        },
        {
          path: 'untracked.txt',
          status: 'untracked',
          indexBlobHash: null,
          worktreeSha256: createHash('sha256').update('pre-existing\n').digest('hex'),
        },
      ])
    );
  });

  it('retries a baseline capture when HEAD changes and then returns a coherent snapshot', async () => {
    const heads = ['a'.repeat(40), 'b'.repeat(40), ...Array(3).fill('c'.repeat(40))];
    const git = {
      raw: vi.fn().mockResolvedValue(''),
      revparse: vi.fn(async () => heads.shift() ?? 'c'.repeat(40)),
      status: vi.fn(async () => cleanStatus()),
    };
    const source = new GitCompletionEvidenceSource(
      () => git as unknown as Pick<SimpleGit, 'raw' | 'revparse' | 'status'>
    );

    const captured = await source.captureLaunchBaseline('/tmp/unused', createdAt);

    expect(captured.headSha).toBe('c'.repeat(40));
    expect(git.revparse).toHaveBeenCalledTimes(5);
    expect(git.status).toHaveBeenCalledTimes(5);
  });

  it('fails closed after bounded attempts when the worktree baseline never stabilizes', async () => {
    let revision = 0;
    const git = {
      raw: vi.fn().mockResolvedValue(''),
      revparse: vi.fn(async () => `${revision++}`.padStart(40, 'a')),
      status: vi.fn(async () => cleanStatus()),
    };
    const source = new GitCompletionEvidenceSource(
      () => git as unknown as Pick<SimpleGit, 'raw' | 'revparse' | 'status'>
    );

    await expect(source.captureLaunchBaseline('/tmp/unused', createdAt)).rejects.toThrow(
      /changed while capturing the launch baseline after 3 attempts/
    );
    expect(git.revparse).toHaveBeenCalledTimes(6);
  });
});

function cleanStatus(): StatusResult {
  return {
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    modified: [],
    renamed: [],
    staged: [],
    files: [],
    ahead: 0,
    behind: 0,
    current: 'main',
    tracking: null,
    detached: false,
    isClean: () => true,
  };
}
