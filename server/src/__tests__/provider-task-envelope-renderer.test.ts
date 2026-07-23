import { describe, expect, it } from 'vitest';
import type { Task, TaskCommitPolicy } from '@veritas-kanban/shared';
import { providerRuntimeManifestFixture } from './fixtures/provider-runtime-manifest.js';
import {
  TaskEnvelopeService,
  type CompletionEvidenceSource,
} from '../services/task-envelope-service.js';
import {
  renderCodexCliTaskEnvelope,
  renderCodexSdkTaskEnvelope,
  renderHermesTaskEnvelope,
  renderOpenClawTaskEnvelope,
} from '../services/provider-task-envelope-renderer.js';

const createdAt = '2026-07-23T21:00:00.000Z';
const evidenceSource: CompletionEvidenceSource = {
  captureLaunchBaseline: async (_worktreePath, capturedAt) => ({
    capturedAt,
    headSha: 'a'.repeat(40),
    dirty: false,
    files: [],
  }),
};

function task(provider: string): Task {
  return {
    id: 'task_transport',
    title: 'Ship the provider transport',
    description: 'Translate the immutable task contract without changing completion ownership.',
    type: 'code',
    status: 'todo',
    priority: 'high',
    project: 'veritas-kanban',
    created: createdAt,
    updated: createdAt,
    git: {
      repo: 'veritas-kanban',
      branch: `feat/${provider}-transport`,
      baseBranch: 'main',
      worktreePath: '/tmp/veritas-kanban-transport',
    },
    subtasks: [
      {
        id: 'transport-contract',
        title: 'Transport contract',
        completed: false,
        created: createdAt,
        acceptanceCriteria: ['The provider receives the persisted envelope.'],
      },
    ],
    verificationSteps: [
      {
        id: 'provider-snapshot',
        description: 'Run the provider transport snapshot.',
        checked: false,
      },
    ],
  };
}

async function envelope(
  provider: string,
  commitPolicy: TaskCommitPolicy,
  profileInstructions = 'Follow the release checklist.'
) {
  return new TaskEnvelopeService(evidenceSource).build({
    task: task(provider),
    attemptId: 'attempt_transport',
    createdAt,
    worktreePath: '/tmp/veritas-kanban-transport',
    providerRuntimeManifest: providerRuntimeManifestFixture({ provider }),
    commitPolicy,
    profileInstructions,
    networkAccessEnabled: true,
  });
}

describe('provider task-envelope renderers', () => {
  it('renders an OpenClaw callback transport from a required-commit envelope', async () => {
    const taskEnvelope = await envelope('openclaw', 'required');

    const transport = renderOpenClawTaskEnvelope({
      taskEnvelope,
      profileInstructions: 'Follow the release checklist.',
      checkpoint: {
        step: 2,
        timestamp: '2026-07-23T20:45:00.000Z',
        resumeCount: 1,
        state: { next: 'dispatch' },
      },
    });

    expect(transport).toMatchObject({
      schemaVersion: 'provider-task-envelope-transport/v1',
      provider: 'openclaw',
      taskEnvelopeDigest: taskEnvelope.digest,
      callbackPosture: 'veritas-http',
      completionNormalization: 'harness',
    });
    expect(Object.isFrozen(transport)).toBe(true);
    expect(transport.content).toContain('Required: create at least one new commit');
    expect(transport.content).toContain('## Profile Instructions (agent profile)');
    expect(transport.content).toContain('## Resume Context (task checkpoint)');
    expect(transport.content).toContain(
      '- Launch HEAD: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`'
    );
    expect(transport.content).toContain(
      '- Required `provider-output` `terminal-state`: Harness-verified provider terminal state from the native transport.'
    );
    expect(transport.content).toContain(
      'POST http://localhost:3001/api/agents/task_transport/complete'
    );
    expect(transport.content).toContain(
      `"providerRuntimeManifestDigest":"${taskEnvelope.launchManifest.digest}"`
    );
    expect(transport.content).toContain(
      'No native structured-output support is assumed; Veritas validates and normalizes the callback.'
    );
    expect(transport.content).toMatchSnapshot();
  });

  it('renders a callback-free Codex CLI transport from a forbidden-commit envelope', async () => {
    const taskEnvelope = await envelope('codex-cli', 'forbidden');

    const transport = renderCodexCliTaskEnvelope({ taskEnvelope });

    expect(transport).toMatchObject({
      provider: 'codex-cli',
      taskEnvelopeDigest: taskEnvelope.digest,
      callbackPosture: 'harness-owned',
      completionNormalization: 'harness',
    });
    expect(transport.content).toContain(
      'Forbidden: do not create a commit. Leave permitted worktree changes uncommitted.'
    );
    expect(transport.content).toContain('## Completion (Codex CLI process)');
    expect(transport.content).toContain(
      'Return the final response through the process output captured by Veritas.'
    );
    expect(transport.content).not.toContain('/api/agents/task_transport/complete');
    expect(transport.content).toContain(
      'No native structured-output support is assumed; Veritas validates and normalizes process output.'
    );
    expect(transport.content).toMatchSnapshot();
  });

  it('renders a callback-free Codex SDK transport from an allowed-commit envelope', async () => {
    const taskEnvelope = await envelope('codex-sdk', 'allowed');

    const transport = renderCodexSdkTaskEnvelope({ taskEnvelope });

    expect(transport).toMatchObject({
      provider: 'codex-sdk',
      callbackPosture: 'harness-owned',
      completionNormalization: 'harness',
    });
    expect(transport.content).toContain(
      'Allowed: a commit is permitted, but successful completion does not require one.'
    );
    expect(transport.content).toContain('## Completion (Codex SDK stream)');
    expect(transport.content).toContain(
      'Return the final response through the SDK event stream captured by Veritas.'
    );
    expect(transport.content).not.toContain('/api/agents/task_transport/complete');
    expect(transport.content).toMatchSnapshot();
  });

  it('renders a callback-free Hermes scripted transport', async () => {
    const taskEnvelope = await envelope('hermes-cli', 'required');

    const transport = renderHermesTaskEnvelope({ taskEnvelope });

    expect(transport).toMatchObject({
      provider: 'hermes-cli',
      callbackPosture: 'harness-owned',
      completionNormalization: 'harness',
    });
    expect(transport.content).toContain('## Completion (Hermes scripted process)');
    expect(transport.content).toContain(
      'Return the final response through scripted stdout captured by Veritas.'
    );
    expect(transport.content).not.toContain('/api/agents/task_transport/complete');
    expect(transport.content).toMatchSnapshot();
  });

  it('fails closed when the envelope identity does not match the selected transport', async () => {
    const taskEnvelope = await envelope('openclaw', 'allowed');

    expect(() => renderCodexCliTaskEnvelope({ taskEnvelope })).toThrow(
      'Task envelope transport mismatch: expected codex-cli, received provider openclaw with adapter openclaw'
    );
  });

  it('bounds profile instructions and checkpoint state', async () => {
    const oversizedProfile = 'p'.repeat(20_001);
    const taskEnvelope = await envelope('openclaw', 'allowed', oversizedProfile);
    const transport = renderOpenClawTaskEnvelope({
      taskEnvelope,
      profileInstructions: oversizedProfile,
      checkpoint: {
        step: 3,
        timestamp: createdAt,
        state: { payload: 's'.repeat(20_001) },
      },
    });

    expect(transport.content.match(/\[truncated by Veritas\]/g)).toHaveLength(2);
    expect(transport.content).not.toContain(oversizedProfile);
    const constraintsSection = transport.content
      .split('## Constraints\n\n')[1]
      ?.split('\n\n## Workspace')[0]
      ?.trim();
    expect(constraintsSection).toBe(
      '- Operate only inside the assigned worktree: /tmp/veritas-kanban-transport'
    );
  });
});
