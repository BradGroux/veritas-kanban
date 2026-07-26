import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ProgressWatchdogActionOutcome,
  ProgressWatchdogFinding,
} from '@veritas-kanban/shared';
import { FileRunEventRepository } from '../storage/run-event-repository.js';
import {
  ProgressWatchdogControlService,
  type ProgressWatchdogOverrideAgentControl,
} from '../services/progress-watchdog-control-service.js';
import { RunEventJournalService } from '../services/run-event-journal-service.js';

const directories: string[] = [];
const finding: ProgressWatchdogFinding = {
  schemaVersion: 'progress-watchdog-finding/v1',
  id: 'watchdog_aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa',
  taskId: 'task_1',
  attemptId: 'attempt_1',
  turnId: 'turn_1',
  detector: 'identical-repetition',
  confidence: 'high',
  policyVersion: 1,
  evidenceEventIds: ['runevt_abcdefghijklmnopqr'],
  fingerprintHashes: [`sha256:${'b'.repeat(64)}`],
  suppressedEventIds: [],
  progressSignals: [],
  action: 'pause',
  recoveryBudgetRemaining: { turn: 0, run: 4 },
  createdAt: '2026-07-25T12:00:00.000Z',
};
const action: ProgressWatchdogActionOutcome = {
  schemaVersion: 'progress-watchdog-action/v1',
  findingId: finding.id,
  taskId: finding.taskId,
  attemptId: finding.attemptId,
  turnId: finding.turnId,
  action: 'pause',
  status: 'executed',
  diagnostic: 'Provider stopped.',
  recordedAt: '2026-07-25T12:00:01.000Z',
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function harness(agents?: ProgressWatchdogOverrideAgentControl) {
  const directory = await mkdtemp(path.join(tmpdir(), 'vk-watchdog-control-'));
  directories.push(directory);
  const journal = new RunEventJournalService(new FileRunEventRepository(directory));
  await journal.append({
    taskId: finding.taskId,
    attemptId: finding.attemptId,
    kind: 'progress.watchdog.finding',
    source: { provider: 'system', adapter: 'progress-watchdog' },
    payload: { ...finding },
  });
  await journal.append({
    taskId: finding.taskId,
    attemptId: finding.attemptId,
    kind: 'progress.watchdog.action',
    source: { provider: 'system', adapter: 'progress-watchdog' },
    payload: { ...action },
  });
  return {
    journal,
    service: new ProgressWatchdogControlService(
      journal,
      agents,
      () => new Date('2026-07-25T12:05:00.000Z')
    ),
  };
}

describe('ProgressWatchdogControlService', () => {
  it('inspects typed findings and action outcomes from the causal journal', async () => {
    const { service } = await harness();

    await expect(service.inspect('task_1', 'attempt_1')).resolves.toMatchObject({
      findings: [finding],
      actions: [action],
      overrides: [],
    });
  });

  it('records an idempotent acknowledgement without run mutation', async () => {
    const { service } = await harness();
    const input = {
      taskId: 'task_1',
      attemptId: 'attempt_1',
      findingId: finding.id,
      resolution: 'acknowledge' as const,
      reason: 'Operator reviewed the evidence.',
      actor: 'reviewer',
    };

    const first = await service.override(input);
    const repeated = await service.override(input);

    expect(first).toMatchObject({ status: 'completed', resolution: 'acknowledge' });
    expect(repeated).toEqual(first);
    await expect(service.inspect('task_1', 'attempt_1')).resolves.toMatchObject({
      overrides: [
        expect.objectContaining({ status: 'requested' }),
        expect.objectContaining({ status: 'completed' }),
      ],
    });
  });

  it('resumes a paused conversation with a stable override idempotency key', async () => {
    const resumeConversation = vi.fn(async () => ({ attemptId: 'attempt_2' }));
    const stopAgent = vi.fn(async () => undefined);
    const { service } = await harness({ resumeConversation, stopAgent });

    const result = await service.override({
      taskId: 'task_1',
      attemptId: 'attempt_1',
      findingId: finding.id,
      resolution: 'continue',
      reason: 'Fresh evidence supports a different approach.',
      actor: 'reviewer',
    });

    expect(result).toMatchObject({
      status: 'completed',
      resolution: 'continue',
      launchedAttemptId: 'attempt_2',
    });
    expect(resumeConversation).toHaveBeenCalledWith(
      'task_1',
      'attempt_1',
      expect.stringContaining('materially different approach'),
      {
        overrideReason: 'Fresh evidence supports a different approach.',
        admissionIdempotencyKey: `progress-watchdog-override:${finding.id}`,
      }
    );
    expect(stopAgent).not.toHaveBeenCalled();
  });
});
