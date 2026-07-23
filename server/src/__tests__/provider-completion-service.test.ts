import { describe, expect, it } from 'vitest';
import {
  COMPLETION_RESULT_SCHEMA_VERSION,
  TASK_ENVELOPE_SCHEMA_VERSION,
  type Task,
  type TaskEnvelope,
} from '@veritas-kanban/shared';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';
import { parseCompletionResultForEnvelope } from '../schemas/task-envelope-schemas.js';
import {
  ProviderCompletionService,
  type CompletionEvidenceSnapshot,
} from '../services/provider-completion-service.js';
import { TaskEnvelopeService } from '../services/task-envelope-service.js';
import { verifyCompletionResultDigest } from '../utils/completion-result-digest.js';

const completedAt = '2026-07-23T18:00:00.000Z';

function task(commitPolicy: 'forbidden' | 'allowed' | 'required' = 'allowed'): Task {
  return {
    id: `task_completion_${commitPolicy}`,
    title: 'Persist an authoritative completion',
    description: 'Normalize provider output against harness evidence.',
    type: 'code',
    status: 'in-progress',
    priority: 'high',
    project: 'veritas-kanban',
    created: '2026-07-23T17:00:00.000Z',
    updated: '2026-07-23T17:00:00.000Z',
    git: {
      repo: 'BradGroux/veritas-kanban',
      branch: 'feat/provider-completion',
      baseBranch: 'main',
      worktreePath: '/tmp/veritas-provider-completion',
    },
    executionPolicy: { commitPolicy },
    verificationSteps: [
      {
        id: 'verify-focused',
        description: 'Run focused completion tests',
        checked: true,
        checkedAt: completedAt,
      },
    ],
  };
}

async function envelope(
  commitPolicy: 'forbidden' | 'allowed' | 'required' = 'allowed'
): Promise<TaskEnvelope> {
  return new TaskEnvelopeService({
    captureLaunchBaseline: async (_worktreePath, capturedAt) => ({
      capturedAt,
      headSha: 'a'.repeat(40),
      dirty: false,
      files: [],
    }),
    captureCompletionEvidence: async () => snapshot(),
  }).build({
    task: task(commitPolicy),
    attemptId: `attempt_completion_${commitPolicy}`,
    createdAt: '2026-07-23T17:30:00.000Z',
    worktreePath: '/tmp/veritas-provider-completion',
    providerRuntimeManifest: providerRuntimeManifestFixture(),
    commitPolicy,
  });
}

function snapshot(overrides: Partial<CompletionEvidenceSnapshot> = {}): CompletionEvidenceSnapshot {
  return {
    capturedAt: completedAt,
    headSha: 'b'.repeat(40),
    changedFiles: [
      {
        path: 'server/src/services/provider-completion-service.ts',
        status: 'added',
        previousPath: null,
        verified: true,
      },
    ],
    commits: [{ sha: 'b'.repeat(40), summary: 'feat: persist completion results' }],
    artifacts: [],
    verification: [
      {
        gateId: 'verify-focused',
        status: 'passed',
        summary: 'Task verification state records this gate as passed.',
        evidenceIds: ['verification-verify-focused'],
      },
    ],
    sideEffects: [
      {
        kind: 'filesystem-write',
        description: 'Changed 1 file after launch.',
        target: '/tmp/veritas-provider-completion',
        authorized: true,
        verified: true,
      },
      {
        kind: 'git-commit',
        description: 'Created 1 commit after launch.',
        target: 'b'.repeat(40),
        authorized: true,
        verified: true,
      },
    ],
    ...overrides,
  };
}

function completionService(result: CompletionEvidenceSnapshot = snapshot()) {
  return new ProviderCompletionService(
    {
      captureCompletionEvidence: async () => structuredClone(result),
    },
    () => completedAt
  );
}

describe('ProviderCompletionService', () => {
  it('builds a digest-bound successful result from harness evidence', async () => {
    const taskEnvelope = await envelope('required');
    const service = completionService();
    const claim = {
      terminalSource: 'process' as const,
      status: 'success' as const,
      summary: 'Provider completed the requested work.',
    };

    const result = await service.complete({
      task: task('required'),
      taskEnvelope,
      claim,
    });

    expect(result).toMatchObject({
      schemaVersion: COMPLETION_RESULT_SCHEMA_VERSION,
      taskEnvelopeSchemaVersion: TASK_ENVELOPE_SCHEMA_VERSION,
      taskEnvelopeDigest: taskEnvelope.digest,
      taskId: taskEnvelope.subject.id,
      attemptId: taskEnvelope.attempt.id,
      providerRuntimeManifestDigest: taskEnvelope.launchManifest.digest,
      status: 'success',
      terminalSource: 'process',
      completedAt,
      changedFiles: [
        expect.objectContaining({
          path: 'server/src/services/provider-completion-service.ts',
          verified: true,
        }),
      ],
    });
    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.idempotencyKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.evidence.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['provider-output', 'file-change', 'commit', 'verification'])
    );
    expect(verifyCompletionResultDigest(result)).toBe(true);
    expect(parseCompletionResultForEnvelope(result, taskEnvelope)).toEqual(result);

    const duplicate = await service.complete({
      task: task('required'),
      taskEnvelope,
      claim,
    });
    expect(duplicate.idempotencyKey).toBe(result.idempotencyKey);
    expect(duplicate.digest).toBe(result.digest);
  });

  it.each([
    ['callback', 'success', 'success'],
    ['remote-session', 'blocked', 'blocked'],
    ['stream', 'failed', 'failed'],
    ['operator-interruption', 'interrupted', 'interrupted'],
    ['process', 'partial', 'partial'],
  ] as const)(
    'normalizes the %s terminal path to %s',
    async (terminalSource, status, expectedStatus) => {
      const taskEnvelope = await envelope();
      const result = await completionService().complete({
        task: task(),
        taskEnvelope,
        claim: {
          terminalSource,
          status,
          summary: `Fixture ${status}`,
          error: status === 'failed' ? 'Fixture failure' : undefined,
          blockers:
            status === 'blocked'
              ? [
                  {
                    code: 'waiting',
                    summary: 'Waiting',
                    detail: 'A dependency is unavailable.',
                    retryable: true,
                  },
                ]
              : undefined,
        },
      });

      expect(result.status).toBe(expectedStatus);
      expect(result.terminalSource).toBe(terminalSource);
      expect(parseCompletionResultForEnvelope(result, taskEnvelope)).toEqual(result);
    }
  );

  it('downgrades successful claims that violate required and forbidden commit policies', async () => {
    const requiredEnvelope = await envelope('required');
    const missingCommit = await completionService(
      snapshot({
        headSha: requiredEnvelope.workspace.baseline.headSha,
        commits: [],
        sideEffects: [],
      })
    ).complete({
      task: task('required'),
      taskEnvelope: requiredEnvelope,
      claim: { terminalSource: 'process', status: 'success', summary: 'No commit created.' },
    });

    expect(missingCommit.status).toBe('partial');
    expect(missingCommit.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'required-commit-missing' })])
    );

    const forbiddenEnvelope = await envelope('forbidden');
    const forbiddenCommit = await completionService().complete({
      task: task('forbidden'),
      taskEnvelope: forbiddenEnvelope,
      claim: { terminalSource: 'stream', status: 'success', summary: 'Commit was created.' },
    });

    expect(forbiddenCommit.status).toBe('partial');
    expect(forbiddenCommit.sideEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'git-commit', authorized: false, verified: true }),
      ])
    );
    expect(forbiddenCommit.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'forbidden-commit-created' })])
    );
  });

  it('redacts and bounds provider-controlled completion fields', async () => {
    const taskEnvelope = await envelope();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm92aWRlciJ9.signature-with-secret-material';
    const oauthToken = `gho_${'o'.repeat(24)}`;
    const userToken = `ghu_${'u'.repeat(24)}`;
    const serverToken = `ghs_${'s'.repeat(24)}`;
    const opaqueToken = 'Z'.repeat(48);
    const result = await completionService().complete({
      task: task(),
      taskEnvelope,
      claim: {
        terminalSource: 'callback',
        status: 'failed',
        summary: `Bearer secret-token ${jwt} ${oauthToken} ${'x'.repeat(30_000)}`,
        error: 'OPENAI_API_KEY=sk-secret-value',
        blockers: [
          {
            code: 'credential-blocker',
            summary: `Leaked ${userToken}`,
            detail: `Opaque ${opaqueToken}`,
            retryable: false,
          },
        ],
        evidence: [
          {
            id: 'provider-claim',
            kind: 'other',
            summary: `Authorization: Basic dXNlcjpwYXNz ${serverToken}`,
            reference: 'https://example.invalid/result',
            requirementIds: [],
          },
        ],
        continuation: {
          provider: 'openclaw',
          kind: 'session',
          reference: `session:${opaqueToken}`,
        },
      },
    });

    expect(result.summary.length).toBeLessThanOrEqual(20_000);
    expect(result.summary).not.toContain('secret-token');
    expect(result.error).not.toContain('sk-secret-value');
    expect(result.evidence.find((entry) => entry.id === 'provider-claim')).toMatchObject({
      source: 'provider',
      verified: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secret-token|sk-secret-value|dXNlcjpwYXNz|eyJhbGci|gho_|ghu_|ghs_|ZZZZZZ/
    );
  });
});
