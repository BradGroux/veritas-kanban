import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ProgressWatchdogAction,
  ProgressWatchdogFinding,
  ProgressWatchdogPolicy,
  RunEventAppendInput,
} from '@veritas-kanban/shared';
import { FileRunEventRepository } from '../storage/run-event-repository.js';
import {
  ProgressWatchdogCoordinatorService,
  type ProgressWatchdogActionExecutor,
} from '../services/progress-watchdog-coordinator-service.js';
import { RunEventJournalService } from '../services/run-event-journal-service.js';
import { DEFAULT_PROGRESS_WATCHDOG_POLICY } from '../services/progress-watchdog-service.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function harness(
  options: {
    executor?: ProgressWatchdogActionExecutor;
    policy?: ProgressWatchdogPolicy;
  } = {}
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'vk-progress-watchdog-'));
  directories.push(directory);
  const journal = new RunEventJournalService(new FileRunEventRepository(directory));
  const coordinator = new ProgressWatchdogCoordinatorService({
    journal,
    executor: options.executor,
    policy: options.policy,
    now: () => new Date('2026-07-25T12:05:00.000Z'),
  });
  coordinator.start();
  return { coordinator, journal };
}

function toolEvent(sequence: number, turnId = 'turn_1'): RunEventAppendInput {
  return {
    taskId: 'task_1',
    attemptId: 'attempt_1',
    turnId,
    kind: 'tool.started',
    source: { provider: 'codex-cli', adapter: 'codex-cli' },
    payload: {
      toolName: 'read_file',
      arguments: { path: '/workspace/private.ts', sequence },
      stableFingerprint: 'same',
    },
  };
}

async function events(journal: RunEventJournalService) {
  return (
    await journal.list({
      taskId: 'task_1',
      attemptId: 'attempt_1',
      limit: 500,
    })
  ).events;
}

describe('ProgressWatchdogCoordinatorService', () => {
  it('journals an attributed finding and executes its bounded action once', async () => {
    const execute = vi.fn(async (_finding: ProgressWatchdogFinding) => ({
      status: 'executed' as const,
      diagnostic: 'Fresh observation requested.',
    }));
    const { coordinator, journal } = await harness({ executor: { execute } });

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const input = toolEvent(sequence);
      input.payload = { toolName: 'read_file', arguments: { path: '/workspace/private.ts' } };
      await journal.append(input);
      await coordinator.flush();
    }

    const recorded = await events(journal);
    const finding = recorded.find((event) => event.kind === 'progress.watchdog.finding');
    const action = recorded.find((event) => event.kind === 'progress.watchdog.action');

    expect(finding?.payload).toMatchObject({
      detector: 'identical-repetition',
      action: 'require-observation',
      evidenceEventIds: expect.any(Array),
    });
    expect(JSON.stringify(finding?.payload)).not.toContain('/workspace/private.ts');
    expect(action?.payload).toMatchObject({
      findingId: finding?.payload.id,
      status: 'executed',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('records operator-required when no automatic executor owns the selected action', async () => {
    const { coordinator, journal } = await harness();

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const input = toolEvent(sequence);
      input.payload = { toolName: 'read_file' };
      await journal.append(input);
      await coordinator.flush();
    }

    const action = (await events(journal)).find(
      (event) => event.kind === 'progress.watchdog.action'
    );
    expect(action?.payload).toMatchObject({
      action: 'require-observation',
      status: 'operator-required',
    });
  });

  it('uses durable action history to pause after the per-turn budget is exhausted', async () => {
    const selected: ProgressWatchdogAction[] = [];
    const execute = vi.fn(async (finding: ProgressWatchdogFinding) => {
      selected.push(finding.action);
      return { status: 'executed' as const, diagnostic: `${finding.action} executed.` };
    });
    const policy: ProgressWatchdogPolicy = {
      ...DEFAULT_PROGRESS_WATCHDOG_POLICY,
      identicalRepetitionThreshold: 2,
      recovery: {
        ...DEFAULT_PROGRESS_WATCHDOG_POLICY.recovery,
        maxAutomatedActionsPerTurn: 1,
      },
    };
    const { coordinator, journal } = await harness({ executor: { execute }, policy });

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const input = toolEvent(sequence);
      input.payload = { toolName: 'read_file' };
      await journal.append(input);
      await coordinator.flush();
    }

    expect(selected).toEqual(['require-observation', 'pause']);
    const actions = (await events(journal)).filter(
      (event) => event.kind === 'progress.watchdog.action'
    );
    expect(actions).toHaveLength(2);
    expect(actions[1].payload).toMatchObject({
      action: 'pause',
      status: 'executed',
    });
  });

  it('rehydrates prior journal actions before evaluating a new event', async () => {
    const firstActions: ProgressWatchdogAction[] = [];
    const first = await harness({
      executor: {
        async execute(finding) {
          firstActions.push(finding.action);
          return { status: 'executed', diagnostic: 'First coordinator action.' };
        },
      },
      policy: {
        ...DEFAULT_PROGRESS_WATCHDOG_POLICY,
        identicalRepetitionThreshold: 2,
        recovery: {
          ...DEFAULT_PROGRESS_WATCHDOG_POLICY.recovery,
          maxAutomatedActionsPerTurn: 1,
        },
      },
    });
    for (let sequence = 1; sequence <= 2; sequence += 1) {
      const input = toolEvent(sequence);
      input.payload = { toolName: 'read_file' };
      await first.journal.append(input);
      await first.coordinator.flush();
    }
    first.coordinator.stop();

    const execute = vi.fn(async (finding: ProgressWatchdogFinding) => ({
      status: 'executed' as const,
      diagnostic: `${finding.action} after restart.`,
    }));
    const restarted = new ProgressWatchdogCoordinatorService({
      journal: first.journal,
      executor: { execute },
      policy: {
        ...DEFAULT_PROGRESS_WATCHDOG_POLICY,
        identicalRepetitionThreshold: 2,
        recovery: {
          ...DEFAULT_PROGRESS_WATCHDOG_POLICY.recovery,
          maxAutomatedActionsPerTurn: 1,
        },
      },
    });
    restarted.start();
    const input = toolEvent(3);
    input.payload = { toolName: 'read_file' };
    await first.journal.append(input);
    await restarted.flush();

    expect(firstActions).toEqual(['require-observation']);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ action: 'pause' }));
  });
});
