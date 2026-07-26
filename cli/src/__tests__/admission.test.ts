import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());

vi.mock('../utils/api.js', () => ({ api }));

import { registerAdmissionCommands } from '../commands/admission.js';

describe('vk admission commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  it('lists reservations as JSON with all operator filters preserved', async () => {
    api.mockResolvedValue({
      generatedAt: '2026-07-25T10:00:00.000Z',
      reservations: [{ id: 'admission_1', state: 'active' }],
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'admission',
      'list',
      '--workspace',
      'workspace-a',
      '--workflow-run',
      'run_1234567890_abcdef',
      '--workflow-step',
      'execute',
      '--root-reservation',
      'admission_root',
      '--root-objective',
      'objective-a',
      '--node',
      'node-child',
      '--parent-node',
      'node-root',
      '--state',
      'active',
      'released',
      '--limit',
      '25',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(
      '/api/admission?workspaceId=workspace-a&workflowRunId=run_1234567890_abcdef&workflowStepId=execute&rootReservationId=admission_root&rootObjectiveId=objective-a&nodeId=node-child&parentNodeId=node-root&state=active&state=released&limit=25'
    );
    expect(JSON.parse(String(output.mock.calls[0][0]))).toEqual({
      generatedAt: '2026-07-25T10:00:00.000Z',
      reservations: [{ id: 'admission_1', state: 'active' }],
    });
    output.mockRestore();
  });

  it('inspects one reservation as JSON', async () => {
    api.mockResolvedValue({ id: 'admission_1', state: 'released' });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync(['node', 'vk', 'admission', 'get', 'admission_1', '--json']);

    expect(api).toHaveBeenCalledWith('/api/admission/admission_1');
    expect(JSON.parse(String(output.mock.calls[0][0]))).toEqual({
      id: 'admission_1',
      state: 'released',
    });
    output.mockRestore();
  });

  it('inspects an aggregate execution tree as JSON', async () => {
    api.mockResolvedValue({
      schemaVersion: 'execution-tree-budget-summary/v1',
      rootObjectiveId: 'objective-a',
      contributors: [],
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'admission',
      'tree',
      'objective-a',
      '--limit',
      '25',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith('/api/admission/tree/objective-a?limit=25');
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      rootObjectiveId: 'objective-a',
    });
    output.mockRestore();
  });

  it('shows durable execution-tree control in human output', async () => {
    api.mockResolvedValue({
      schemaVersion: 'execution-tree-budget-summary/v1',
      rootObjectiveId: 'objective-a',
      control: {
        schemaVersion: 'execution-tree-control/v1',
        rootObjectiveId: 'objective-a',
        state: 'cancelled',
        trigger: 'operator',
        reason: 'Operator stopped runaway expansion.',
        idempotencyKey: 'sha256:cancelled',
        recordedAt: '2026-07-25T12:00:00.000Z',
      },
      committed: {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: 0,
        runtimeSeconds: 0,
        idleRuntimeSeconds: 0,
        costUsd: 0,
        retries: 0,
        fanOut: 0,
      },
      reserved: {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: 0,
        runtimeSeconds: 0,
        idleRuntimeSeconds: 0,
        costUsd: 0,
        retries: 0,
        fanOut: 0,
      },
      policies: [],
      contributors: [],
      contributorCount: 0,
      truncated: false,
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync(['node', 'vk', 'admission', 'tree', 'objective-a']);

    expect(output.mock.calls.map(([line]) => String(line)).join('\n')).toContain(
      'control=cancelled trigger=operator'
    );
    expect(output.mock.calls.map(([line]) => String(line)).join('\n')).toContain(
      'Operator stopped runaway expansion.'
    );
    output.mockRestore();
  });

  it('cancels one queued launch with a stable idempotency identity', async () => {
    api.mockResolvedValue({
      schemaVersion: 'execution-tree-cancellation/v1',
      scope: 'queued-launch',
      queueEntry: { id: 'admission_queue_1', state: 'terminal' },
      reservationReleased: true,
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'admission',
      'queue',
      'cancel',
      'admission_queue_1',
      '--reason',
      'Operator cancelled the queued launch.',
      '--idempotency-key',
      'cancel-queue-entry-123',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith('/api/admission/queue/admission_queue_1/cancel', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'Operator cancelled the queued launch.',
        idempotencyKey: 'cancel-queue-entry-123',
      }),
    });
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      scope: 'queued-launch',
      queueEntry: { state: 'terminal' },
    });
    output.mockRestore();
  });

  it('cancels an execution tree and reports remaining verified runs', async () => {
    api.mockResolvedValue({
      schemaVersion: 'execution-tree-cancellation/v1',
      scope: 'execution-tree',
      rootObjectiveId: 'objective-a',
      queueEntriesCancelled: 2,
      interruptedAttempts: 1,
      runningAttempts: [],
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'admission',
      'cancel-tree',
      'objective-a',
      '--reason',
      'Operator cancelled runaway expansion.',
      '--idempotency-key',
      'cancel-execution-tree-123',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith('/api/admission/tree/objective-a/cancel', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'Operator cancelled runaway expansion.',
        idempotencyKey: 'cancel-execution-tree-123',
      }),
    });
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      scope: 'execution-tree',
      queueEntriesCancelled: 2,
      interruptedAttempts: 1,
    });
    output.mockRestore();
  });

  it('resumes an eligible execution tree with a stable idempotency identity', async () => {
    api.mockResolvedValue({
      schemaVersion: 'execution-tree-control/v1',
      rootObjectiveId: 'objective-a',
      state: 'resumed',
      resumedAt: '2026-07-25T12:00:00.000Z',
      resumeReason: 'Operator confirmed pressure cleared.',
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'admission',
      'resume-tree',
      'objective-a',
      '--reason',
      'Operator confirmed pressure cleared.',
      '--idempotency-key',
      'resume-execution-tree-123',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith('/api/admission/tree/objective-a/resume', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'Operator confirmed pressure cleared.',
        idempotencyKey: 'resume-execution-tree-123',
      }),
    });
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      state: 'resumed',
      rootObjectiveId: 'objective-a',
    });
    output.mockRestore();
  });

  it('lists the admission queue as JSON with all operator filters preserved', async () => {
    api.mockResolvedValue({
      schemaVersion: 'admission-queue-list/v1',
      generatedAt: '2026-07-25T12:00:00.000Z',
      conditional: true,
      depth: {
        global: { current: 2, limit: 1_000 },
        workspaces: [],
      },
      pagination: { page: 2, limit: 25, total: 26, hasMore: false },
      entries: [{ id: 'admission_queue_1', state: 'queued', position: 26 }],
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'admission',
      'queue',
      'list',
      '--workspace',
      'workspace-a',
      '--root-objective',
      'objective-a',
      '--node',
      'node-a',
      '--source',
      'workflow',
      '--state',
      'queued',
      'requeued',
      '--priority',
      '3',
      '--limiting-scope',
      'provider',
      '--min-age',
      '60000',
      '--max-age',
      '3600000',
      '--page',
      '2',
      '--limit',
      '25',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(
      '/api/admission/queue?workspaceId=workspace-a&rootObjectiveId=objective-a&nodeId=node-a&source=workflow&state=queued&state=requeued&priority=3&limitingScope=provider&minAgeMs=60000&maxAgeMs=3600000&page=2&limit=25'
    );
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      schemaVersion: 'admission-queue-list/v1',
      conditional: true,
      entries: [{ id: 'admission_queue_1', position: 26 }],
    });
    output.mockRestore();
  });

  it('inspects one admission queue entry as JSON', async () => {
    api.mockResolvedValue({
      schemaVersion: 'admission-queue-inspection/v1',
      generatedAt: '2026-07-25T12:00:00.000Z',
      conditional: true,
      depth: {
        global: { current: 1, limit: 1_000 },
        workspaces: [],
      },
      entry: {
        schemaVersion: 'admission-queue-inspection/v1',
        id: 'admission_queue_1',
        state: 'leased',
        readiness: 'reserved',
      },
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'admission',
      'queue',
      'get',
      'admission_queue_1',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith('/api/admission/queue/admission_queue_1');
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      schemaVersion: 'admission-queue-inspection/v1',
      entry: { id: 'admission_queue_1', readiness: 'reserved' },
    });
    output.mockRestore();
  });

  it('prints compact conditional queue output without an exact start promise', async () => {
    api.mockResolvedValue({
      schemaVersion: 'admission-queue-list/v1',
      generatedAt: '2026-07-25T12:00:00.000Z',
      conditional: true,
      depth: {
        global: { current: 1, limit: 1_000 },
        workspaces: [],
      },
      pagination: {
        page: 1,
        limit: 1,
        total: 1,
        hasMore: false,
        snapshotTruncated: false,
      },
      entries: [
        {
          schemaVersion: 'admission-queue-inspection/v1',
          id: 'admission_queue_1',
          state: 'queued',
          position: 1,
          rawPriority: 1,
          effectivePriority: 2,
          agePromotion: 1,
          ageMs: 60_000,
          readiness: 'conditional',
          lease: { posture: 'none' },
          limitingPolicies: [],
          conditionalStartFactors: ['capacity-recheck'],
          launch: {
            source: 'direct',
            target: 'direct',
            taskKey: `sha256:${'a'.repeat(64)}`,
            rootTaskKey: `sha256:${'b'.repeat(64)}`,
            workspaceKey: `sha256:${'c'.repeat(64)}`,
            provider: 'codex-cli',
            hostKey: `sha256:${'d'.repeat(64)}`,
          },
          retry: {
            count: 0,
            maximum: 3,
            availableAt: '2026-07-25T12:00:00.000Z',
          },
          createdAt: '2026-07-25T11:59:00.000Z',
          updatedAt: '2026-07-25T11:59:00.000Z',
        },
      ],
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerAdmissionCommands(program);

    await program.parseAsync(['node', 'vk', 'admission', 'queue', 'list', '--limit', '1']);

    const rendered = output.mock.calls.map(([line]) => String(line)).join('\n');
    expect(rendered).toContain('priority=1->2 readiness=conditional');
    expect(rendered).toContain('Conditional snapshot at 2026-07-25T12:00:00.000Z');
    expect(rendered).not.toMatch(/\bETA\b|starts? at|start time/i);
    output.mockRestore();
  });
});
