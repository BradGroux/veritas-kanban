import { describe, expect, it } from 'vitest';
import type {
  ProgressWatchdogPolicy,
  RunEventEnvelope,
  RunEventJsonValue,
} from '@veritas-kanban/shared';
import { RUN_EVENT_SCHEMA_VERSION } from '@veritas-kanban/shared';
import {
  DEFAULT_PROGRESS_WATCHDOG_POLICY,
  ProgressWatchdogService,
} from '../services/progress-watchdog-service.js';

function event(
  sequence: number,
  kind: string,
  payload: Record<string, RunEventJsonValue> = {},
  options: {
    hash?: string;
    receivedAt?: string;
    taskId?: string;
    attemptId?: string;
    turnId?: string;
  } = {}
): RunEventEnvelope {
  return {
    schemaVersion: RUN_EVENT_SCHEMA_VERSION,
    eventId: `event_${sequence}`,
    taskId: options.taskId ?? 'task_1',
    runId: options.attemptId ?? 'attempt_1',
    attemptId: options.attemptId ?? 'attempt_1',
    turnId: options.turnId ?? 'turn_1',
    sequence,
    receivedAt:
      options.receivedAt ??
      new Date(Date.parse('2026-07-25T12:00:00.000Z') + sequence * 1_000).toISOString(),
    kind,
    source: { provider: 'system', adapter: 'test' },
    redaction: {
      status: 'none',
      fields: [],
      originalBytes: 0,
      persistedBytes: 0,
    },
    payload,
    payloadHash: `sha256:${options.hash ?? String(sequence).padStart(64, '0')}`,
  };
}

function policy(overrides: Partial<ProgressWatchdogPolicy> = {}): ProgressWatchdogPolicy {
  return {
    ...DEFAULT_PROGRESS_WATCHDOG_POLICY,
    ...overrides,
    recovery: {
      ...DEFAULT_PROGRESS_WATCHDOG_POLICY.recovery,
      ...overrides.recovery,
    },
  };
}

describe('ProgressWatchdogService', () => {
  it('detects identical redacted tool fingerprints without persisting arguments', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(
        sequence,
        'tool.started',
        {
          toolName: 'read_file',
          arguments: { path: '/Users/private/source.ts', token: '[REDACTED]' },
        },
        { hash: 'a'.repeat(64) }
      )
    );

    const result = service.evaluate({ events });
    const finding = result.findings.find((item) => item.detector === 'identical-repetition');

    expect(finding).toMatchObject({
      confidence: 'medium',
      action: 'require-observation',
      evidenceEventIds: ['event_1', 'event_2', 'event_3'],
    });
    expect(JSON.stringify(finding)).not.toContain('/Users/private');
    expect(JSON.stringify(finding)).not.toContain('token');
  });

  it('detects bounded multi-step cycles', () => {
    const service = new ProgressWatchdogService();
    const events = Array.from({ length: 6 }, (_, index) =>
      event(
        index + 1,
        'tool.started',
        { toolName: index % 2 ? 'test' : 'edit' },
        {
          hash: (index % 2 ? 'b' : 'a').repeat(64),
        }
      )
    );

    const finding = service
      .evaluate({ events, policy: policy({ cycleMaxLength: 2 }) })
      .findings.find((item) => item.detector === 'multi-step-cycle');

    expect(finding?.evidenceEventIds).toHaveLength(6);
    expect(finding?.fingerprintHashes).toHaveLength(2);
  });

  it('detects repeated failed edits to the same file', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(sequence, 'tool.completed', {
        toolName: 'apply_patch',
        path: '/workspace/src/app.ts',
        success: false,
      })
    );

    const finding = service
      .evaluate({ events })
      .findings.find((item) => item.detector === 'failed-file-edit');

    expect(finding?.evidenceEventIds).toEqual(['event_1', 'event_2', 'event_3']);
    expect(JSON.stringify(finding)).not.toContain('/workspace/src/app.ts');
  });

  it('normalizes repeated error classes even when diagnostics differ', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(
        sequence,
        'run.error',
        {
          errorClass: 'transport-timeout',
          message: `private diagnostic ${sequence}`,
        },
        { hash: String(sequence).repeat(64).slice(0, 64) }
      )
    );

    const finding = service
      .evaluate({ events })
      .findings.find((item) => item.detector === 'identical-repetition');

    expect(finding?.evidenceEventIds).toEqual(['event_1', 'event_2', 'event_3']);
    expect(JSON.stringify(finding)).not.toContain('private diagnostic');
  });

  it('fingerprints assistant tails without persisting assistant text', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(sequence, 'message.assistant', {
        content: `private prefix ${sequence}: ${'same tail '.repeat(80)}`,
      })
    );

    const finding = service
      .evaluate({ events })
      .findings.find((item) => item.detector === 'identical-repetition');

    expect(finding?.evidenceEventIds).toEqual(['event_1', 'event_2', 'event_3']);
    expect(JSON.stringify(finding)).not.toContain('unresolved operation');
  });

  it('does not classify repeated verification with changed output as a cycle', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].flatMap((sequence) => [
      event(sequence * 2 - 1, 'command.started', {
        command: 'pnpm test exact-file.test.ts',
      }),
      event(sequence * 2, 'command.completed', {
        status: 'success',
        outputHash: `sha256:${String(sequence).repeat(64).slice(0, 64)}`,
      }),
    ]);

    expect(service.evaluate({ events }).findings).toEqual([]);
  });

  it('detects sustained activity without durable progress', () => {
    const service = new ProgressWatchdogService();
    const events = Array.from({ length: 8 }, (_, index) =>
      event(
        index + 1,
        'tool.started',
        { toolName: `tool_${index}` },
        {
          hash: String(index + 1)
            .repeat(64)
            .slice(0, 64),
          receivedAt: new Date(
            Date.parse('2026-07-25T12:00:00.000Z') + index * 20_000
          ).toISOString(),
        }
      )
    );

    const finding = service
      .evaluate({ events })
      .findings.find((item) => item.detector === 'no-durable-progress');

    expect(finding).toMatchObject({ confidence: 'low', action: 'warn' });
  });

  it('detects sustained token spend without waiting for the wall-time threshold', () => {
    const service = new ProgressWatchdogService();
    const events = Array.from({ length: 8 }, (_, index) =>
      event(index + 1, 'usage.updated', {
        totalTokens: 3_000,
        costUsd: 0.1,
      })
    );

    const finding = service
      .evaluate({ events })
      .findings.find((item) => item.detector === 'no-durable-progress');

    expect(finding).toMatchObject({ confidence: 'low', action: 'warn' });
  });

  it('resets the active detector window after genuine progress', () => {
    const service = new ProgressWatchdogService();
    const events = [
      ...[1, 2, 3].map((sequence) =>
        event(sequence, 'tool.started', { toolName: 'read_file' }, { hash: 'a'.repeat(64) })
      ),
      event(4, 'file.changed', { durableProgress: 'workspace-delta' }),
      event(5, 'tool.started', { toolName: 'read_file' }, { hash: 'a'.repeat(64) }),
      event(6, 'tool.started', { toolName: 'read_file' }, { hash: 'a'.repeat(64) }),
    ];

    const result = service.evaluate({ events });

    expect(result.progressResetSequence).toBe(4);
    expect(result.findings).toEqual([]);
  });

  it('does not treat its own journal records or automated steering as progress', () => {
    const service = new ProgressWatchdogService();
    const events = [
      event(1, 'tool.started', { toolName: 'read_file' }, { hash: 'a'.repeat(64) }),
      event(2, 'progress.watchdog.finding', { findingId: 'watchdog_1' }),
      event(3, 'message.operator', {
        content: 'Collect a fresh observation before continuing.',
        source: 'progress-watchdog',
      }),
      event(4, 'tool.started', { toolName: 'read_file' }, { hash: 'a'.repeat(64) }),
      event(5, 'tool.started', { toolName: 'read_file' }, { hash: 'a'.repeat(64) }),
    ];

    const finding = service
      .evaluate({ events })
      .findings.find((item) => item.detector === 'identical-repetition');

    expect(finding?.evidenceEventIds).toEqual(['event_1', 'event_4', 'event_5']);
  });

  it('suppresses declared repetition while its lease stays within the rate bound', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(
        sequence,
        'tool.started',
        {
          toolName: 'poll_status',
          expectedRepetition: {
            leaseId: 'lease_1',
            startsAt: '2026-07-25T12:00:00.000Z',
            expiresAt: '2026-07-25T12:05:00.000Z',
            maxEventsPerMinute: 5,
            allowedKinds: ['tool.started'],
          },
        },
        { hash: 'a'.repeat(64) }
      )
    );

    const result = service.evaluate({
      events,
      evaluatedAt: '2026-07-25T12:03:00.000Z',
    });

    expect(result.findings).toEqual([]);
    expect(result.suppressedEventIds).toEqual(['event_1', 'event_2', 'event_3']);
  });

  it('stops suppressing expected repetition after the declared rate is exceeded', () => {
    const service = new ProgressWatchdogService();
    const events = Array.from({ length: 6 }, (_, index) =>
      event(
        index + 1,
        'tool.started',
        {
          toolName: 'poll_status',
          expectedRepetition: {
            leaseId: 'lease_1',
            startsAt: '2026-07-25T12:00:00.000Z',
            expiresAt: '2026-07-25T12:05:00.000Z',
            maxEventsPerMinute: 2,
          },
        },
        { hash: 'a'.repeat(64) }
      )
    );

    const result = service.evaluate({
      events,
      evaluatedAt: '2026-07-25T12:03:00.000Z',
    });

    expect(result.suppressedEventIds).toEqual(['event_1', 'event_2']);
    expect(result.findings.some((item) => item.detector === 'identical-repetition')).toBe(true);
  });

  it('does not honor repetition leases for event kinds excluded by policy', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(
        sequence,
        'run.error',
        {
          errorClass: 'transient',
          expectedRepetition: {
            leaseId: 'lease_1',
            startsAt: '2026-07-25T12:00:00.000Z',
            expiresAt: '2026-07-25T12:05:00.000Z',
            maxEventsPerMinute: 5,
          },
        },
        { hash: 'a'.repeat(64) }
      )
    );

    const result = service.evaluate({
      events,
      evaluatedAt: '2026-07-25T12:03:00.000Z',
    });

    expect(result.suppressedEventIds).toEqual([]);
    expect(result.findings.some((item) => item.detector === 'identical-repetition')).toBe(true);
  });

  it('stops suppressing expected repetition after its deadline', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(
        sequence,
        'tool.started',
        {
          toolName: 'poll_status',
          expectedRepetition: {
            leaseId: 'lease_1',
            startsAt: '2026-07-25T12:00:00.000Z',
            expiresAt: '2026-07-25T12:01:00.000Z',
            maxEventsPerMinute: 5,
          },
        },
        { hash: 'a'.repeat(64) }
      )
    );

    const result = service.evaluate({
      events,
      evaluatedAt: '2026-07-25T12:03:00.000Z',
    });

    expect(result.suppressedEventIds).toEqual([]);
    expect(result.findings.some((item) => item.detector === 'identical-repetition')).toBe(true);
  });

  it('rejects expected repetition leases longer than the policy cap', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(
        sequence,
        'tool.started',
        {
          toolName: 'poll_status',
          expectedRepetition: {
            leaseId: 'lease_1',
            startsAt: '2026-07-25T12:00:00.000Z',
            expiresAt: '2026-07-25T14:00:00.000Z',
            maxEventsPerMinute: 5,
          },
        },
        { hash: 'a'.repeat(64) }
      )
    );

    const result = service.evaluate({
      events,
      evaluatedAt: '2026-07-25T12:03:00.000Z',
    });

    expect(result.suppressedEventIds).toEqual([]);
    expect(result.findings.some((item) => item.detector === 'identical-repetition')).toBe(true);
  });

  it('pauses instead of recursively recovering after action budget exhaustion', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(sequence, 'tool.started', { toolName: 'read_file' }, { hash: 'a'.repeat(64) })
    );

    const finding = service.evaluate({
      events,
      recoveryUsage: {
        turnId: 'turn_1',
        automatedActionsThisTurn: 2,
        automatedActionsThisRun: 2,
      },
    }).findings[0];

    expect(finding).toMatchObject({
      action: 'pause',
      recoveryBudgetRemaining: { turn: 0, run: 4 },
    });
  });

  it('produces a stable finding identity across repeated evaluation', () => {
    const service = new ProgressWatchdogService();
    const events = [1, 2, 3].map((sequence) =>
      event(sequence, 'tool.started', { toolName: 'read_file' }, { hash: 'a'.repeat(64) })
    );

    const first = service.evaluate({
      events,
      evaluatedAt: '2026-07-25T12:03:00.000Z',
    }).findings[0];
    const repeated = service.evaluate({
      events,
      evaluatedAt: '2026-07-25T12:04:00.000Z',
    }).findings[0];

    expect(repeated.id).toBe(first.id);
  });

  it('rejects mixed task attempts', () => {
    const service = new ProgressWatchdogService();

    expect(() =>
      service.evaluate({
        events: [
          event(1, 'tool.started'),
          event(2, 'tool.started', {}, { attemptId: 'attempt_2' }),
        ],
      })
    ).toThrow('must belong to one task attempt');
  });
});
