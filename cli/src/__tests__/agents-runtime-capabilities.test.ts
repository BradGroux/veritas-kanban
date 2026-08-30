import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const { mockApi, mockFindTask } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockFindTask: vi.fn(),
}));

vi.mock('../utils/api.js', () => ({ api: mockApi }));
vi.mock('../utils/find.js', () => ({ findTask: mockFindTask }));

import { registerAgentCommands } from '../commands/agents.js';

const temporaryRoots: string[] = [];

function expectLaunchBody(expected: Record<string, unknown>): void {
  const [url, request] = mockApi.mock.calls.at(-1) as [string, { method: string; body: string }];
  const { idempotencyKey, ...body } = JSON.parse(request.body) as Record<string, unknown>;
  expect(url).toBe('/api/agents/task_1/start');
  expect(request.method).toBe('POST');
  expect(idempotencyKey).toMatch(/^vk-cli:task_1:[0-9a-f-]{36}$/);
  expect(body).toEqual(expected);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe('vk agent runtime capability controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindTask.mockResolvedValue({
      id: 'task_1',
      type: 'code',
      git: { worktreePath: '/tmp/task_1' },
    });
    mockApi.mockImplementation(async (url: string) =>
      url.endsWith('/status')
        ? { running: true, attemptId: 'attempt_1' }
        : { attemptId: 'attempt_1' }
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('forwards required runtime capabilities to the launch API', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      [
        'start',
        'task_1',
        '--agent',
        'codex',
        '--phase',
        'implement',
        '--parent-attempt',
        'attempt_parent',
        '--require-capability',
        'tool.mcp',
        'output.structured',
        '--json',
      ],
      { from: 'user' }
    );

    expectLaunchBody({
      agent: 'codex',
      phase: 'implement',
      requiredRuntimeCapabilities: ['tool.mcp', 'output.structured'],
      parentAttemptId: 'attempt_parent',
    });
  });

  it('previews one explicit phase against exact parent launch evidence', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      [
        'launch-preview',
        'task_1',
        '--agent',
        'codex',
        '--phase',
        'plan',
        '--parent-attempt',
        'attempt_parent',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/launch-preview', {
      method: 'POST',
      body: JSON.stringify({
        agent: 'codex',
        profileId: undefined,
        phase: 'plan',
        requiredRuntimeCapabilities: undefined,
        commitPolicy: undefined,
        parentAttemptId: 'attempt_parent',
      }),
    });
  });

  it('forwards an explicit run commit policy', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      ['start', 'task_1', '--agent', 'codex', '--commit-policy', 'forbidden', '--json'],
      { from: 'user' }
    );

    expectLaunchBody({
      agent: 'codex',
      commitPolicy: 'forbidden',
    });
  });

  it('surfaces authoritative fail-closed stop errors from the API', async () => {
    mockApi
      .mockResolvedValueOnce({ running: true, attemptId: 'attempt_1' })
      .mockRejectedValueOnce(
        new Error('Provider runtime does not support stop run: run.stop is unsupported.')
      );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      _code?: number | string | null
    ) => {
      throw new Error('process.exit called');
    }) as typeof process.exit);
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    try {
      await expect(program.parseAsync(['stop', 'task_1'], { from: 'user' })).rejects.toThrow(
        'process.exit called'
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('run.stop is unsupported'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('binds stop requests to the attempt returned by status', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(['stop', 'task_1', '--json'], { from: 'user' });

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/agents/task_1/status');
    expect(mockApi).toHaveBeenNthCalledWith(2, '/api/agents/task_1/stop', {
      method: 'POST',
      body: JSON.stringify({ attemptId: 'attempt_1' }),
    });
  });

  it('binds recovery cancellation to the exact persisted parent attempt', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      ['agent:cancel-recovery', 'task_1', '--attempt', 'attempt_parent', '--json'],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/recovery/cancel', {
      method: 'POST',
      body: JSON.stringify({ attemptId: 'attempt_parent' }),
    });
  });

  it('reads durable phase state for one exact attempt', async () => {
    mockApi.mockResolvedValueOnce({ current: null, history: [] });
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      ['agent:phase', 'task_1', '--attempt', 'attempt_1', '--limit', '25', '--json'],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/phase?attemptId=attempt_1&limit=25');
  });

  it('reads the versioned access projection for one exact attempt', async () => {
    mockApi.mockResolvedValueOnce({
      current: { schemaVersion: 'run-access-summary/v1', status: 'complete' },
      history: [],
    });
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(['agent:access', 'task_1', '--attempt', 'attempt_1', '--json'], {
      from: 'user',
    });

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/access?attemptId=attempt_1');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"schemaVersion": "run-access-summary/v1"')
    );
  });

  it('previews and applies the exact server-owned Run Access revision', async () => {
    const evidenceDigest = `sha256:${'a'.repeat(64)}`;
    const manifestDigest = `sha256:${'b'.repeat(64)}`;
    const requestRevision = `sha256:${'c'.repeat(64)}`;
    const accessDigest = `sha256:${'d'.repeat(64)}`;
    mockApi
      .mockResolvedValueOnce({
        phase: {
          transitionSequence: 2,
          effectiveEvidence: { digest: evidenceDigest },
          manifestDigest,
        },
      })
      .mockResolvedValueOnce({ current: { digest: accessDigest }, history: [] })
      .mockResolvedValueOnce({
        schemaVersion: 'run-access-change-preview/v1',
        requestId: 'access-change-1',
        requestRevision,
        targetPhase: 'publish',
        authorityDelta: { entries: [] },
        enforcement: { state: 'ready', blockers: [] },
      })
      .mockResolvedValueOnce({
        transition: { status: 'applied', record: { sequence: 3 } },
      });
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      [
        'agent:change-access',
        'task_1',
        '--attempt',
        'attempt_1',
        '--target-phase',
        'publish',
        '--reason',
        'Publish the reviewed release.',
        '--request',
        'access-change-1',
        '--apply',
        '--json',
      ],
      { from: 'user' }
    );

    const body = {
      attemptId: 'attempt_1',
      requestId: 'access-change-1',
      operation: 'transition-phase',
      targetPhase: 'publish',
      reason: 'Publish the reviewed release.',
      expectedAccessSummaryDigest: accessDigest,
      expectedSequence: 2,
      expectedPhaseEvidenceDigest: evidenceDigest,
      expectedManifestDigest: manifestDigest,
    };
    expect(mockApi).toHaveBeenNthCalledWith(3, '/api/agents/task_1/access/changes/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(mockApi).toHaveBeenNthCalledWith(4, '/api/agents/task_1/access/changes', {
      method: 'POST',
      body: JSON.stringify({ ...body, requestRevision }),
    });
  });

  it('renders the redacted access summary and blockers for operators', async () => {
    mockApi.mockResolvedValueOnce({
      current: {
        status: 'blocked',
        identity: {
          attemptId: 'attempt_1',
          selectedHost: null,
          transitionSequence: 3,
        },
        filesystem: { sandboxMode: 'workspace-write' },
        network: { policy: 'denied' },
        tools: [{ decision: 'allow' }, { decision: 'approval' }, { decision: 'deny' }],
        approvals: { toolCount: 1 },
        integrations: [{ definitionId: 'github' }],
        blockers: [{ code: 'host-unavailable', message: 'No eligible host is ready.' }],
        digest: `sha256:${'a'.repeat(64)}`,
      },
      history: [{ digest: `sha256:${'b'.repeat(64)}` }],
    });
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(['agent:access', 'task_1', '--attempt', 'attempt_1'], {
      from: 'user',
    });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Run access: blocked'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Host: unavailable'));
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Tools: 1 allowed, 1 approval, 1 denied')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('host-unavailable: No eligible host is ready.')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Prior immutable versions: 1')
    );
  });

  it('surfaces access projection failures without printing partial authority', async () => {
    mockApi.mockRejectedValueOnce(new Error('Access evidence is unavailable.'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as typeof process.exit);
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    try {
      await expect(
        program.parseAsync(['agent:access', 'task_1', '--attempt', 'attempt_1'], {
          from: 'user',
        })
      ).rejects.toThrow('process.exit called');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Access evidence is unavailable.')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('binds the first phase transition to exact evidence and manifest provenance', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-phase-cli-'));
    temporaryRoots.push(root);
    const fromPath = path.join(root, 'from.json');
    const targetPath = path.join(root, 'target.json');
    const fromEvidence = { digest: `sha256:${'1'.repeat(64)}` };
    const targetEvidence = { digest: `sha256:${'2'.repeat(64)}` };
    await fs.writeFile(fromPath, JSON.stringify(fromEvidence));
    await fs.writeFile(targetPath, JSON.stringify(targetEvidence));
    mockApi.mockResolvedValueOnce({ current: null, history: [] }).mockResolvedValueOnce({
      status: 'applied',
      current: null,
      targetEvidenceDigest: targetEvidence.digest,
    });
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      [
        'agent:transition-phase',
        'task_1',
        '--attempt',
        'attempt_1',
        '--operation',
        'phase-op-1',
        '--from-evidence',
        fromPath,
        '--target-evidence',
        targetPath,
        '--manifest',
        `sha256:${'3'.repeat(64)}`,
        '--reason',
        'Approved plan is ready.',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenNthCalledWith(2, '/api/agents/task_1/phase/transitions', {
      method: 'POST',
      body: JSON.stringify({
        attemptId: 'attempt_1',
        operationId: 'phase-op-1',
        expectedSequence: 0,
        expectedPhaseEvidenceDigest: fromEvidence.digest,
        expectedManifestDigest: `sha256:${'3'.repeat(64)}`,
        reason: 'Approved plan is ready.',
        fromEvidence,
        targetEvidence,
      }),
    });
  });

  it('rejects partially numeric phase approval lifetimes before transition', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-phase-cli-'));
    temporaryRoots.push(root);
    const fromPath = path.join(root, 'from.json');
    const targetPath = path.join(root, 'target.json');
    await fs.writeFile(fromPath, JSON.stringify({ digest: `sha256:${'1'.repeat(64)}` }));
    await fs.writeFile(targetPath, JSON.stringify({ digest: `sha256:${'2'.repeat(64)}` }));
    mockApi.mockResolvedValueOnce({ current: null, history: [] });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as typeof process.exit);
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    try {
      await expect(
        program.parseAsync(
          [
            'agent:transition-phase',
            'task_1',
            '--attempt',
            'attempt_1',
            '--operation',
            'phase-op-1',
            '--from-evidence',
            fromPath,
            '--target-evidence',
            targetPath,
            '--manifest',
            `sha256:${'3'.repeat(64)}`,
            '--reason',
            'Approved plan is ready.',
            '--approval-ttl-ms',
            '1000x',
          ],
          { from: 'user' }
        )
      ).rejects.toThrow('process.exit called');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('--approval-ttl-ms must be an integer')
      );
      expect(mockApi).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('decides an exact phase approval with revision and action-hash guards', async () => {
    const approval = {
      id: 'runapproval_000000000001',
      revision: 4,
      actionHash: 'a'.repeat(64),
      status: 'pending',
    };
    mockApi.mockResolvedValueOnce(approval).mockResolvedValueOnce({
      ...approval,
      revision: 5,
      status: 'approved',
    });
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      [
        'agent:decide-phase-approval',
        approval.id,
        '--decision',
        'approve',
        '--note',
        'Expansion reviewed.',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenNthCalledWith(2, `/api/run-approvals/${approval.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: 'approved',
        expectedRevision: 4,
        expectedActionHash: approval.actionHash,
        note: 'Expansion reviewed.',
      }),
    });
  });

  it('starts a native history fork from an explicit source attempt and turn', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      [
        'agent:fork',
        'task_1',
        '--source-attempt',
        'attempt_parent',
        '--message',
        'Explore the alternate fix',
        '--fork-turn',
        'turn_7',
        '--phase',
        'explore',
        '--require-capability',
        'tool.mcp',
        '--json',
      ],
      { from: 'user' }
    );

    const [url, request] = mockApi.mock.calls.at(-1) as [string, { method: string; body: string }];
    const { idempotencyKey, ...body } = JSON.parse(request.body) as Record<string, unknown>;

    expect(url).toBe('/api/agents/task_1/conversation/fork');
    expect(request.method).toBe('POST');
    expect(idempotencyKey).toMatch(
      /^vk-cli:task_1:conversation:fork:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(body).toEqual({
      sourceAttemptId: 'attempt_parent',
      message: 'Explore the alternate fix',
      forkTurnId: 'turn_7',
      phase: 'explore',
      requiredRuntimeCapabilities: ['tool.mcp'],
    });
  });

  it('binds compact controls to the exact active attempt', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(['agent:compact', 'task_1', '--attempt', 'attempt_1', '--json'], {
      from: 'user',
    });

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/conversation/compact', {
      method: 'POST',
      body: JSON.stringify({ attemptId: 'attempt_1' }),
    });
  });

  it('forwards attempt and manifest provenance when completing a run', async () => {
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);
    const digest = `sha256:${'a'.repeat(64)}`;

    await program.parseAsync(
      [
        'agents:complete',
        'task_1',
        '--attempt-id',
        'attempt_1',
        '--manifest-digest',
        digest,
        '--summary',
        'Done',
      ],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/complete', {
      method: 'POST',
      body: JSON.stringify({
        attemptId: 'attempt_1',
        providerRuntimeManifestDigest: digest,
        success: true,
        summary: 'Done',
        error: undefined,
      }),
    });
  });

  it('scans the exact task workspace execution inventory', async () => {
    mockApi.mockResolvedValueOnce({
      inventory: {
        identity: { digest: `sha256:${'1'.repeat(64)}` },
        digest: `sha256:${'2'.repeat(64)}`,
        projectPolicy: { maximumTrust: 'restricted' },
        entries: [],
      },
    });
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(['workspace-trust', 'scan', 'task_1', '--json'], {
      from: 'user',
    });

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/workspace-trust');
  });

  it('records and revokes exact-inventory workspace decisions', async () => {
    mockApi.mockResolvedValue({
      id: 'workspace-decision-1',
      mode: 'trusted',
    });
    const digest = `sha256:${'3'.repeat(64)}`;
    const program = new Command();
    program.exitOverride();
    registerAgentCommands(program);

    await program.parseAsync(
      [
        'workspace-trust',
        'decide',
        'task_1',
        '--mode',
        'trusted',
        '--inventory',
        digest,
        '--reason',
        'Reviewed exact inventory',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/workspace-trust/decisions', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'trusted',
        inventoryDigest: digest,
        reason: 'Reviewed exact inventory',
        expiresAt: undefined,
      }),
    });

    await program.parseAsync(
      [
        'workspace-trust',
        'revoke',
        'task_1',
        '--inventory',
        digest,
        '--reason',
        'Authorization withdrawn',
        '--json',
      ],
      { from: 'user' }
    );

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/workspace-trust/revoke', {
      method: 'POST',
      body: JSON.stringify({
        inventoryDigest: digest,
        reason: 'Authorization withdrawn',
      }),
    });
  });
});
