import { describe, expect, it } from 'vitest';
import type {
  ConversationLifecycleRecord,
  RunLaunchManifest,
  TaskAttempt,
  TaskEnvelope,
} from '@veritas-kanban/shared';
import { ConversationLifecycleService } from '../services/conversation-lifecycle-service.js';

const NOW = new Date('2026-07-24T12:00:00.000Z');

function service() {
  return new ConversationLifecycleService(() => NOW);
}

function manifest(
  overrides: {
    provider?: string;
    adapter?: string;
    protocolVersion?: string;
    runtimeMaterialDigest?: string;
    model?: string;
    worktreeId?: string;
    baseCommit?: string;
  } = {}
): RunLaunchManifest {
  return {
    taskEnvelope: {
      schemaVersion: 'task-envelope/v1',
      digest: 'sha256:task-envelope',
      materialDigest: 'sha256:task-envelope-material',
    },
    providerRuntime: {
      provider: overrides.provider ?? 'codex-app-server',
      adapter: overrides.adapter ?? 'codex-app-server',
      protocolVersion: overrides.protocolVersion ?? 'codex-app-server-jsonrpc/v2',
      materialDigest: overrides.runtimeMaterialDigest ?? 'sha256:runtime-material',
    },
    providerRequirements: { required: [], capabilities: [] },
    harnessSupport: {
      profileId: 'codex-app-server',
      adapterId: 'codex-app-server',
      transport: 'app-server',
      supportTier: 'certified',
    },
    routing: {
      requestedAgent: 'codex-app-server',
      selectedAgent: 'codex-app-server',
      selectedHost: 'local',
      reason: 'test',
      fallbackAgent: null,
      fallbackAllowed: false,
    },
    runtime: {
      model: overrides.model ?? 'gpt-5.6',
      command: 'codex',
      args: [],
      workingDirectory: 'task-worktree',
      worktree: 'required',
      environmentKeys: ['PATH'],
      credentialReferences: [],
    },
    instructions: [],
    sandbox: {
      effective: {
        sandboxMode: 'workspace-write',
        networkAccessEnabled: false,
        environmentKeys: ['PATH'],
        credentialReferences: [],
      },
    },
    tools: {
      allowed: [],
      denied: [],
      policyIds: [],
      mcpServers: [],
      enforcement: 'not-required',
    },
    permissions: {
      level: 'specialist',
      required: [],
      enforcement: 'not-required',
    },
    resources: { skills: [], shared: [], enforcement: 'not-required' },
    requiredHealthChecks: [],
    budget: { enabled: false },
    workspaceTrust: { status: 'trusted', source: 'test' },
    workspace: {
      worktreeId: overrides.worktreeId ?? 'worktree-a',
      worktreeManifestId: overrides.worktreeId ?? 'worktree-a',
      repo: 'BradGroux/veritas-kanban',
      branch: 'feat/source',
      baseBranch: 'main',
      resolvedBaseCommit: overrides.baseCommit ?? 'abc123',
      baseResolutionSource: 'remote',
    },
  } as RunLaunchManifest;
}

function taskEnvelope(
  overrides: { commitPolicy?: 'forbidden' | 'allowed' | 'required' } = {}
): TaskEnvelope {
  return {
    commitPolicy: overrides.commitPolicy ?? 'allowed',
    allowedSideEffects: [],
  } as TaskEnvelope;
}

function attempt(overrides: Partial<TaskAttempt> = {}): TaskAttempt {
  return {
    id: 'attempt-source',
    agent: 'codex',
    status: 'complete',
    provider: 'codex-app-server',
    model: 'gpt-5.6',
    threadId: 'thread-source',
    providerRuntimeManifest: {
      provider: 'codex-app-server',
      adapter: 'codex-app-server',
    },
    taskEnvelope: taskEnvelope(),
    runLaunchManifest: manifest(),
    ...overrides,
  } as TaskAttempt;
}

describe('ConversationLifecycleService', () => {
  it('resolves a legacy durable thread without inheriting transient authority', () => {
    const source = service().source(
      attempt({
        sessionKey: 'transient-session-key',
        runSupervisorId: 'transient-supervisor',
      }),
      'resume'
    );
    const record = service().create('resume', source);

    expect(record).toMatchObject({
      schemaVersion: 'conversation-lifecycle/v1',
      mode: 'resume',
      intent: 'resume',
      conversationId: 'thread-source',
      parentConversationId: 'thread-source',
      parentAttemptId: 'attempt-source',
      state: 'active',
    });
    expect(record).not.toHaveProperty('sessionKey');
    expect(record).not.toHaveProperty('runSupervisorId');
  });

  it('recovers persisted lifecycle identity after restart and derives legacy identity once', () => {
    const lifecycle = service();
    const persisted = lifecycle.create('resume', lifecycle.source(attempt(), 'resume'));
    expect(lifecycle.recover(attempt({ conversation: persisted }))).toBe(persisted);
    expect(lifecycle.recover(attempt({ threadId: undefined }), 'supervisor-session')).toMatchObject(
      {
        mode: 'fresh',
        intent: 'fresh',
        conversationId: 'supervisor-session',
      }
    );
  });

  it('fails closed when source history is missing, active, closed, or lacks launch evidence', () => {
    expect(() => service().source(undefined, 'resume')).toThrow('not found');
    expect(() => service().source(attempt({ status: 'running' }), 'resume')).toThrow(
      'terminal source'
    );
    expect(() => service().source(attempt({ status: 'pending' }), 'resume')).toThrow(
      'terminal source'
    );
    expect(() =>
      service().source(
        attempt({
          conversation: {
            ...service().create('fresh'),
            conversationId: 'closed-thread',
            state: 'closed',
          },
        }),
        'resume'
      )
    ).toThrow('closed');
    expect(() =>
      service().source(
        attempt({
          conversation: {
            ...service().create('fresh'),
            conversationId: 'archived-thread',
            state: 'archived',
          },
        }),
        'fork'
      )
    ).toThrow('archived');
    expect(() =>
      service().source(attempt({ providerRuntimeManifest: undefined }), 'resume')
    ).toThrow('runtime, task, and launch evidence');
  });

  it('persists fork ancestry and the selected turn boundary', () => {
    const source = service().source(attempt(), 'fork');
    expect(service().create('fork', source, 'turn-42')).toMatchObject({
      mode: 'fork',
      parentConversationId: 'thread-source',
      parentAttemptId: 'attempt-source',
      forkTurnId: 'turn-42',
    });
  });

  it('accepts an exact resume baseline and a same-baseline forked worktree', () => {
    const lifecycle = service();
    const source = lifecycle.source(attempt(), 'resume');
    expect(() =>
      lifecycle.assertCompatible(source, manifest(), taskEnvelope(), 'resume')
    ).not.toThrow();
    expect(() =>
      lifecycle.assertCompatible(
        source,
        manifest({ worktreeId: 'worktree-child' }),
        taskEnvelope(),
        'fork'
      )
    ).not.toThrow();
  });

  it.each([
    ['provider', manifest({ provider: 'claude-code' })],
    ['runtime evidence', manifest({ runtimeMaterialDigest: 'sha256:changed-runtime' })],
    ['model', manifest({ model: 'gpt-5.5' })],
    ['base commit', manifest({ baseCommit: 'def456' })],
    ['resume worktree', manifest({ worktreeId: 'worktree-child' })],
  ])('rejects incompatible %s evidence', (_label, target) => {
    const lifecycle = service();
    const source = lifecycle.source(attempt(), 'resume');
    expect(() => lifecycle.assertCompatible(source, target, taskEnvelope(), 'resume')).toThrow(
      'incompatible'
    );
  });

  it('rejects resume when the current launch policy changes', () => {
    const lifecycle = service();
    const source = lifecycle.source(attempt(), 'resume');
    expect(() =>
      lifecycle.assertCompatible(
        source,
        manifest(),
        taskEnvelope({ commitPolicy: 'forbidden' }),
        'resume'
      )
    ).toThrow('incompatible');
  });

  it('binds provider conversation, turn, and item identities', () => {
    const record = service().bind(service().create('fresh'), {
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
    });
    expect(record).toMatchObject({
      conversationId: 'thread-1',
      currentTurnId: 'turn-1',
      lastItemId: 'item-1',
    });
  });

  it.each([
    [500, 1_000, 'healthy'],
    [760, 1_000, 'nearing-limit'],
    [950, 1_000, 'critical'],
    [500, undefined, 'unknown'],
  ] as const)('calculates context posture for %s/%s tokens', (used, limit, posture) => {
    const record = service().recordContext(service().create('fresh'), used, limit);
    expect(record.contextWindow).toMatchObject({
      usedTokens: used,
      posture,
      measuredAt: NOW.toISOString(),
    });
  });

  it.each(['compacted', 'archived', 'closed'] as const)(
    'records the %s terminal lifecycle timestamp',
    (state) => {
      const record = service().transition(
        service().create('fresh'),
        state
      ) as ConversationLifecycleRecord;
      expect(record.state).toBe(state);
      expect(record[`${state}At` as 'compactedAt']).toBe(NOW.toISOString());
    }
  );

  it('preserves durable history identity and context evidence during compaction', () => {
    const lifecycle = service();
    const record = lifecycle.recordContext(
      lifecycle.bind(lifecycle.create('fork', lifecycle.source(attempt(), 'fork'), 'turn-4'), {
        conversationId: 'thread-child',
        turnId: 'turn-5',
        itemId: 'item-8',
      }),
      800,
      1_000
    );
    expect(lifecycle.transition(record, 'compacted')).toMatchObject({
      conversationId: 'thread-child',
      currentTurnId: 'turn-5',
      lastItemId: 'item-8',
      parentConversationId: 'thread-source',
      forkTurnId: 'turn-4',
      contextWindow: { usedTokens: 800, limitTokens: 1_000 },
      state: 'compacted',
    });
  });
});
