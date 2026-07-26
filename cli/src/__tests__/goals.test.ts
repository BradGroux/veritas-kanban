import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());

vi.mock('../utils/api.js', () => ({ api }));

import { registerGoalCommands } from '../commands/goals.js';

const GOAL_ID = 'goal_0123456789abcdef';

describe('vk goals commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  it('lists goals as JSON with bounded filters', async () => {
    api.mockResolvedValue({
      generatedAt: '2026-07-26T02:00:00.000Z',
      goals: [{ id: GOAL_ID, state: 'blocked' }],
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerGoalCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'goals',
      'list',
      '--state',
      'active',
      'blocked',
      '--root-task',
      'task-865',
      '--limit',
      '25',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(
      '/api/goals?state=active&state=blocked&rootTaskId=task-865&limit=25'
    );
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      goals: [{ id: GOAL_ID, state: 'blocked' }],
    });
    output.mockRestore();
  });

  it('creates an evidence-gated task goal', async () => {
    api.mockResolvedValue({ id: GOAL_ID, state: 'active', revision: 1 });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerGoalCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'goals',
      'create',
      '--objective',
      'Deliver durable controls.',
      '--acceptance',
      'REST passes',
      'CLI passes',
      '--requirement',
      'focused-tests|test|Focused tests pass.',
      '--root-task',
      'task-865',
      '--mode',
      'automatic',
      '--max-turns',
      '20',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith('/api/goals', {
      method: 'POST',
      body: JSON.stringify({
        objective: 'Deliver durable controls.',
        constraints: [],
        acceptanceCriteria: ['REST passes', 'CLI passes'],
        root: { kind: 'task', taskId: 'task-865' },
        continuation: { mode: 'automatic', maxTurns: 20 },
        completionRequirements: [
          {
            id: 'focused-tests',
            verificationKind: 'test',
            description: 'Focused tests pass.',
            required: true,
          },
        ],
      }),
    });
    output.mockRestore();
  });

  it('transitions with exact revision and structured completion evidence', async () => {
    api.mockResolvedValue({ id: GOAL_ID, state: 'complete', revision: 3 });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerGoalCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'goals',
      'transition',
      GOAL_ID,
      '--revision',
      '2',
      '--state',
      'complete',
      '--reason',
      'All verification passed.',
      '--evidence-json',
      '[{"requirementId":"focused-tests","evidenceId":"ci-1082","summary":"Passed."}]',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(`/api/goals/${GOAL_ID}/transition`, {
      method: 'POST',
      body: JSON.stringify({
        expectedRevision: 2,
        state: 'complete',
        reason: 'All verification passed.',
        blocker: undefined,
        completionEvidence: [
          {
            requirementId: 'focused-tests',
            evidenceId: 'ci-1082',
            summary: 'Passed.',
          },
        ],
      }),
    });
    output.mockRestore();
  });

  it('links a run to the continuation chain', async () => {
    api.mockResolvedValue({ id: GOAL_ID, state: 'active', revision: 4 });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerGoalCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'goals',
      'link-run',
      GOAL_ID,
      '--revision',
      '3',
      '--task',
      'task-865',
      '--attempt',
      'attempt-3',
      '--conversation',
      'conversation-3',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(`/api/goals/${GOAL_ID}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        expectedRevision: 3,
        taskId: 'task-865',
        attemptId: 'attempt-3',
        conversationId: 'conversation-3',
      }),
    });
    output.mockRestore();
  });

  it('approves and dispatches a bounded conversation rollover', async () => {
    api.mockResolvedValue({
      action: 'dispatched',
      goal: { id: GOAL_ID, revision: 8 },
      continuation: {
        id: 'continuation-rollover',
        kind: 'rollover',
        state: 'dispatched',
        resultAttemptId: 'attempt-8',
      },
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerGoalCommands(program);

    await program.parseAsync([
      'node',
      'vk',
      'goals',
      'rollover',
      GOAL_ID,
      '--revision',
      '7',
      '--json',
    ]);

    expect(api).toHaveBeenCalledWith(`/api/goals/${GOAL_ID}/rollover`, {
      method: 'POST',
      body: JSON.stringify({
        expectedRevision: 7,
      }),
    });
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      action: 'dispatched',
      continuation: { kind: 'rollover', resultAttemptId: 'attempt-8' },
    });
    output.mockRestore();
  });
});
