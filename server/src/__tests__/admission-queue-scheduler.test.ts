import { describe, expect, it } from 'vitest';
import type { AdmissionQueueEntry, AdmissionQueueSelectionEvidence } from '@veritas-kanban/shared';
import {
  rankAdmissionQueueEntries,
  resolveAdmissionQueuePriority,
  workspaceKey,
} from '../services/admission-queue-scheduler.js';

const NOW = '2026-07-25T12:10:00.000Z';
const scheduler = {
  priorityLevels: 4,
  defaultPriority: 1,
  agingIntervalMs: 60_000,
  maxAgePromotion: 3,
  workspaceBurstLimit: 2,
  evaluationLimit: 32,
};

function entry(
  id: string,
  workspaceId: string,
  priority: number,
  enqueueSequence: number,
  createdAt = NOW
): AdmissionQueueEntry {
  return {
    schemaVersion: 'admission-queue-entry/v1',
    id,
    revision: 1,
    state: 'queued',
    enqueueSequence,
    agent: 'codex',
    target: { kind: 'direct', agent: 'codex' },
    priority,
    attemptId: `attempt-${id}`,
    request: {
      schemaVersion: 'admission-request/v1',
      taskId: `task-${id}`,
      rootTaskId: `task-${id}`,
      workspaceId,
      provider: 'codex-cli',
      hostId: 'local-process',
      source: 'direct',
      idempotencyKey: `sha256:${id.padEnd(64, '0').slice(0, 64)}`,
      requested: { runSlots: 1, processSlots: 1, estimatedMemoryMb: 512 },
      requestedAt: createdAt,
    },
    policies: [],
    limitingPolicies: [],
    retryAfterMs: 5_000,
    retryCount: 0,
    maxRetries: 3,
    availableAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  } as AdmissionQueueEntry;
}

function selection(
  id: string,
  workspaceId: string,
  selectedAt: string
): AdmissionQueueSelectionEvidence {
  return {
    schemaVersion: 'admission-queue-selection/v1',
    policyVersion: 'admission-queue-scheduler/v1',
    selectedAt,
    selectedQueueEntryId: id,
    workspaceKey: workspaceKey(workspaceId),
    rawPriority: 1,
    effectivePriority: 1,
    agePromotion: 0,
    ageMs: 0,
    workspaceTurn: 'normal',
    capacityReadiness: 'ready',
    limitingScopes: [],
    conditionalStartFactors: ['queue-eligibility', 'capacity-available'],
    snapshotSize: 1,
    evaluatedCount: 1,
    skipped: [],
  };
}

describe('admission queue scheduler', () => {
  it('selects higher explicit priority before FIFO order', () => {
    const ranked = rankAdmissionQueueEntries({
      entries: [entry('low', 'workspace-a', 0, 1), entry('high', 'workspace-a', 3, 2)],
      history: [],
      now: NOW,
      settings: scheduler,
    });

    expect(ranked.candidates.map((candidate) => candidate.entry.id)).toEqual(['high', 'low']);
    expect(ranked.candidates[0]).toMatchObject({
      rawPriority: 3,
      agePromotion: 0,
      effectivePriority: 3,
    });
  });

  it('promotes old work to the highest level so sustained priority cannot starve it', () => {
    const ranked = rankAdmissionQueueEntries({
      entries: [
        entry('old-low', 'workspace-a', 0, 1, '2026-07-25T12:07:00.000Z'),
        entry('new-critical', 'workspace-a', 3, 2),
      ],
      history: [],
      now: NOW,
      settings: scheduler,
    });

    expect(ranked.candidates.map((candidate) => candidate.entry.id)).toEqual([
      'old-low',
      'new-critical',
    ]);
    expect(ranked.candidates[0]).toMatchObject({
      rawPriority: 0,
      agePromotion: 3,
      effectivePriority: 3,
    });
  });

  it('caps effective priority and applies aging exactly at the interval boundary', () => {
    const ranked = rankAdmissionQueueEntries({
      entries: [
        entry('boundary', 'workspace-a', 1, 1, '2026-07-25T12:09:00.000Z'),
        entry('capped', 'workspace-a', 2, 2, '2026-07-25T12:00:00.000Z'),
      ],
      history: [],
      now: NOW,
      settings: scheduler,
    });

    expect(ranked.candidates.find(({ entry }) => entry.id === 'boundary')).toMatchObject({
      agePromotion: 1,
      effectivePriority: 2,
    });
    expect(ranked.candidates.find(({ entry }) => entry.id === 'capped')).toMatchObject({
      agePromotion: 3,
      effectivePriority: 3,
    });
  });

  it('gives another workspace the next turn after the configured burst', () => {
    const ranked = rankAdmissionQueueEntries({
      entries: [
        entry('busy-critical', 'workspace-a', 3, 1),
        entry('quiet-low', 'workspace-b', 0, 2),
      ],
      history: [
        selection('previous-2', 'workspace-a', '2026-07-25T12:09:30.000Z'),
        selection('previous-1', 'workspace-a', '2026-07-25T12:09:00.000Z'),
      ],
      now: NOW,
      settings: { ...scheduler, workspaceBurstLimit: 2 },
    });

    expect(ranked.candidates[0]).toMatchObject({
      entry: { id: 'quiet-low' },
      workspaceTurn: 'fairness-promoted',
    });
  });

  it('uses enqueue sequence and identity as stable remaining ties', () => {
    const ranked = rankAdmissionQueueEntries({
      entries: [
        entry('z', 'workspace-a', 1, 2),
        entry('b', 'workspace-a', 1, 1),
        entry('a', 'workspace-a', 1, 1),
      ],
      history: [],
      now: NOW,
      settings: scheduler,
    });

    expect(ranked.candidates.map((candidate) => candidate.entry.id)).toEqual(['a', 'b', 'z']);
  });

  it('bounds each deterministic evaluation after ranking the durable queue snapshot', () => {
    const input = {
      entries: [
        entry('first', 'workspace-a', 0, 1),
        entry('second', 'workspace-b', 1, 2),
        entry('outside-bound', 'workspace-c', 3, 3),
      ],
      history: [],
      now: NOW,
      settings: { ...scheduler, evaluationLimit: 2 },
    };

    const first = rankAdmissionQueueEntries(input);
    const replay = rankAdmissionQueueEntries({
      ...input,
      entries: [...input.entries].reverse(),
    });
    expect(first).toEqual(replay);
    expect(first.candidates.map((candidate) => candidate.entry.id)).toEqual([
      'outside-bound',
      'second',
    ]);
    expect(first).toMatchObject({ snapshotSize: 3, evaluatedCount: 2 });
  });

  it('maps task priorities to configured levels and fails closed on invalid settings', () => {
    expect(resolveAdmissionQueuePriority('low', scheduler)).toBe(0);
    expect(resolveAdmissionQueuePriority('medium', scheduler)).toBe(1);
    expect(resolveAdmissionQueuePriority('high', scheduler)).toBe(2);
    expect(resolveAdmissionQueuePriority('critical', scheduler)).toBe(3);
    expect(() =>
      rankAdmissionQueueEntries({
        entries: [],
        history: [],
        now: NOW,
        settings: { ...scheduler, maxAgePromotion: 1 },
      })
    ).toThrow('Invalid admission queue scheduler settings');
  });
});
