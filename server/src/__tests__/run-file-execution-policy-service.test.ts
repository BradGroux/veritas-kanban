import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RunFileProvenanceApprovalEvidence,
  RunFileProvenanceQuery,
  RunFileProvenanceResponse,
  RunFileProvenanceSource,
} from '@veritas-kanban/shared';
import {
  RunFileExecutionPolicyService,
  type RunFileExecutionEvaluationInput,
} from '../services/run-file-execution-policy-service.js';

const roots: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(sourceByPath: Record<string, RunFileProvenanceSource> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vk-file-execution-'));
  roots.push(root);
  const provenance = {
    approvalEvidence: vi.fn(async (query: RunFileProvenanceQuery) => {
      const source = sourceByPath[query.relativePath];
      return {
        schemaVersion: 'run-file-provenance-approval-evidence/v1',
        status: source ? 'exact' : 'unknown',
        query,
        currentRecordId: source ? `record_${query.relativePath.replaceAll('/', '_')}` : null,
        currentRecordDigest: source ? digest('b') : null,
        chainDigests: source ? [digest('b')] : [],
        gapCodes: [],
        generatedAt: '2026-08-30T12:00:00.000Z',
        digest: source ? digest('c') : digest('d'),
      } satisfies RunFileProvenanceApprovalEvidence;
    }),
    resolve: vi.fn(async (query: RunFileProvenanceQuery) => {
      const source = sourceByPath[query.relativePath];
      return {
        schemaVersion: 'run-file-provenance-response/v1',
        status: source ? 'exact' : 'unknown',
        query,
        current: source
          ? {
              id: `record_${query.relativePath.replaceAll('/', '_')}`,
              digest: digest('b'),
              source,
            }
          : null,
        chain: [],
        gaps: [],
        generatedAt: '2026-08-30T12:00:00.000Z',
      } as RunFileProvenanceResponse;
    }),
  };
  const git = vi.fn(() => ({
    raw: vi.fn(async () => 'same-object\n'),
  }));
  const service = new RunFileExecutionPolicyService({ provenance, git });
  return { root, provenance, git, service };
}

function input(root: string, command: string, args: string[]): RunFileExecutionEvaluationInput {
  return {
    workspaceId: 'workspace_1',
    taskId: 'task_1',
    rootObjectiveId: 'objective_1',
    executionNodeId: 'node_1',
    runId: 'run_1',
    attemptId: 'attempt_1',
    workflowStepId: null,
    launchManifestDigest: digest('a'),
    phaseEvidenceDigest: digest('e'),
    worktreeRoot: root,
    baseline: {
      capturedAt: '2026-08-30T11:00:00.000Z',
      headSha: 'f'.repeat(40),
      dirty: false,
      files: [],
    },
    request: {
      requestId: 'terminal-request-1',
      command,
      args,
      mode: 'pipe',
      startMode: 'background',
      environmentKeys: [],
    },
  };
}

describe('RunFileExecutionPolicyService', () => {
  it('binds an unchanged baseline interpreter script without raising the human-only floor', async () => {
    const { root, service } = await fixture();
    await writeFile(path.join(root, 'script.mjs'), 'console.log("baseline")');

    const evidence = await service.evaluate(input(root, process.execPath, ['script.mjs']));

    expect(evidence).toMatchObject({
      schemaVersion: 'run-file-execution-approval-evidence/v1',
      decision: 'standard-approval',
      reasonCode: 'baseline-only',
      references: [
        {
          kind: 'interpreter-script',
          relativePath: 'script.mjs',
          source: 'repository-baseline',
          provenanceStatus: 'launch-baseline',
          decision: 'standard-approval',
        },
      ],
    });
    expect(evidence.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('requires a human decision for downloaded bytes and binds loaders and scripts separately', async () => {
    const { root, service } = await fixture({
      'loader.mjs': 'downloaded-external',
      'script.mjs': 'agent-created',
    });
    await writeFile(path.join(root, 'loader.mjs'), 'export {};');
    await writeFile(path.join(root, 'script.mjs'), 'console.log("run")');

    const evidence = await service.evaluate(
      input(root, process.execPath, ['--loader', './loader.mjs', './script.mjs'])
    );

    expect(evidence).toMatchObject({
      decision: 'human-approval',
      reasonCode: 'external-or-unknown-file',
    });
    expect(evidence.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'loader-input',
          source: 'downloaded-external',
          decision: 'human-approval',
        }),
        expect.objectContaining({
          kind: 'interpreter-script',
          source: 'agent-created',
          decision: 'standard-approval',
        }),
      ])
    );
  });

  it('enforces a project denial for tool-created executable inputs', async () => {
    const { root, service } = await fixture({ 'task.py': 'tool-created' });
    await writeFile(path.join(root, 'task.py'), 'print("run")');

    const evidence = await service.evaluate({
      ...input(root, 'python3', ['task.py']),
      policy: {
        schemaVersion: 'run-file-execution-policy/v1',
        agentCreated: 'standard-approval',
        commandCreated: 'standard-approval',
        toolCreated: 'deny',
      },
    });

    expect(evidence).toMatchObject({
      decision: 'deny',
      reasonCode: 'project-policy-deny',
      references: [{ source: 'tool-created', decision: 'deny' }],
    });
  });

  it('rejects digest drift when referenced bytes change after approval', async () => {
    const { root, service } = await fixture({ 'script.mjs': 'agent-created' });
    const script = path.join(root, 'script.mjs');
    await writeFile(script, 'console.log("approved")');
    const evaluation = input(root, process.execPath, ['script.mjs']);
    const evidence = await service.evaluate(evaluation);

    await writeFile(script, 'console.log("replaced")');

    await expect(service.revalidate(evaluation, evidence)).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({ code: 'run-file-execution-evidence-drift' }),
    });
  });

  it.runIf(process.platform !== 'win32')(
    'fails closed for symlinked execution inputs',
    async () => {
      const { root, service } = await fixture();
      await writeFile(path.join(root, 'target.mjs'), 'console.log("target")');
      await symlink('target.mjs', path.join(root, 'script.mjs'));

      await expect(
        service.evaluate(input(root, process.execPath, ['script.mjs']))
      ).rejects.toMatchObject({
        statusCode: 409,
        details: expect.objectContaining({ code: 'run-file-execution-unsupported-identity' }),
      });
    }
  );

  it('returns a typed blocker for indirect execution the adapter cannot certify', async () => {
    const { root, service } = await fixture();

    await expect(
      service.evaluate(input(root, process.execPath, ['-e', 'import("./run-produced.mjs")']))
    ).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({ code: 'run-file-execution-unsupported-indirect' }),
    });
    await expect(
      service.evaluate({
        ...input(root, 'python3', ['task.py']),
        request: {
          ...input(root, 'python3', ['task.py']).request,
          environmentKeys: ['PYTHONPATH'],
        },
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({ kind: 'environment-load-path' }),
    });
  });
});
