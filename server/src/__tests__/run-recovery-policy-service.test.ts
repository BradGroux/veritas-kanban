import { describe, expect, it } from 'vitest';
import { ZERO_AGENT_BUDGET_USAGE } from '@veritas-kanban/shared';
import { RunRecoveryPolicyService } from '../services/run-recovery-policy-service.js';

describe('RunRecoveryPolicyService', () => {
  it.each([
    ['rate-limit', { status: 'failed', error: 'HTTP 429 rate limited' }],
    ['timeout', { status: 'failed', error: 'Provider timed out after 30s' }],
    ['provider-unavailable', { status: 'failed', error: 'Provider unavailable' }],
    ['transient-transport', { status: 'failed', error: 'ECONNRESET from gateway' }],
    ['invalid-request', { status: 'failed', error: 'Invalid configuration' }],
    ['task-failure', { status: 'failed', error: 'Implementation did not work' }],
    ['verification-failure', { status: 'partial', error: 'Required verification failed' }],
    ['policy-block', { status: 'failed', error: 'Sandbox policy denied launch' }],
    [
      'cancellation',
      {
        status: 'interrupted',
        terminalSource: 'operator-interruption',
        error: 'Stopped by user',
      },
    ],
    [
      'partial-side-effect',
      {
        status: 'failed',
        error: 'ECONNRESET after write',
        sideEffects: [
          {
            kind: 'external-write',
            description: 'Created remote record',
            target: 'record-1',
            authorized: true,
            verified: true,
          },
        ],
      },
    ],
    ['unknown', { status: 'success', summary: 'Unexpected classification input' }],
  ] as const)('classifies %s failures', (expected, evidence) => {
    const policy = new RunRecoveryPolicyService(() => 0.5);
    expect(policy.classify(evidence)).toMatchObject({ classification: expected });
  });

  it('retries only explicitly retryable classes within the configured bound', () => {
    const policy = new RunRecoveryPolicyService(() => 0.5);
    const failure = policy.classify({ status: 'failed', error: 'ECONNRESET from gateway' });
    const decision = policy.decide(failure, baseDecision({ maxRetries: 2 }));

    expect(decision).toMatchObject({
      action: 'retry',
      state: 'scheduled',
      sequence: 1,
      backoffMs: 1_000,
      selectedAgent: 'codex',
    });
  });

  it('falls back after retry exhaustion when the candidate passed policy checks', () => {
    const policy = new RunRecoveryPolicyService(() => 0.5);
    const failure = policy.classify({ status: 'failed', error: 'Provider unavailable' });
    const decision = policy.decide(
      failure,
      baseDecision({
        previousSequence: 1,
        maxRetries: 1,
        fallbackOnFailure: true,
        fallbackAgent: 'claude-code',
        fallbackEligible: true,
      })
    );

    expect(decision).toMatchObject({
      action: 'fallback',
      state: 'scheduled',
      sequence: 2,
      fallbackUsed: true,
      selectedAgent: 'claude-code',
    });
  });

  it('fails closed when a fallback is capability or sandbox incompatible', () => {
    const policy = new RunRecoveryPolicyService(() => 0.5);
    const failure = policy.classify({ status: 'failed', error: 'Provider unavailable' });
    const decision = policy.decide(
      failure,
      baseDecision({
        maxRetries: 0,
        fallbackOnFailure: true,
        fallbackAgent: 'claude-code',
        fallbackEligible: false,
        fallbackReason: 'sandbox preset cannot be enforced',
      })
    );

    expect(decision).toMatchObject({
      action: 'terminal',
      state: 'exhausted',
      handoff: {
        nextActions: expect.arrayContaining([
          'Choose a fallback that satisfies runtime capabilities and sandbox policy.',
        ]),
      },
    });
  });

  it.each([
    ['policy-block', { status: 'failed', error: 'Permission denied by sandbox policy' }],
    ['invalid-request', { status: 'failed', error: 'Invalid configuration' }],
    [
      'partial-side-effect',
      {
        status: 'failed',
        error: 'Transient provider failure after commit',
        sideEffects: [
          {
            kind: 'git-commit',
            description: 'Created commit',
            target: 'abc123',
            authorized: false,
            verified: true,
          },
        ],
      },
    ],
  ] as const)('requires approval for unsafe %s recovery', (_expected, evidence) => {
    const policy = new RunRecoveryPolicyService(() => 0.5);
    const decision = policy.decide(policy.classify(evidence), baseDecision());
    expect(decision).toMatchObject({ action: 'approval', state: 'approval-required' });
  });

  it('never retries explicit cancellation', () => {
    const policy = new RunRecoveryPolicyService(() => 0.5);
    const failure = policy.classify({
      status: 'interrupted',
      terminalSource: 'operator-interruption',
    });
    expect(policy.decide(failure, baseDecision())).toMatchObject({
      action: 'cancelled',
      state: 'cancelled',
      backoffMs: 0,
    });
  });

  it('keeps exponential jitter inside the documented bounds', () => {
    expect(new RunRecoveryPolicyService(() => 0).backoffMs(2)).toBe(1_600);
    expect(new RunRecoveryPolicyService(() => 1).backoffMs(2)).toBe(2_400);
    expect(new RunRecoveryPolicyService(() => 1).backoffMs(32)).toBe(30_000);
  });
});

function baseDecision(overrides: Record<string, unknown> = {}) {
  return {
    rootRunId: 'attempt-root',
    parentRunId: 'attempt-parent',
    selectedAgent: 'codex',
    routingDecision: 'Matched code rule',
    sourceManifestDigest: `sha256:${'a'.repeat(64)}`,
    requiredRuntimeCapabilities: ['run.start'],
    cumulativeBudget: { ...ZERO_AGENT_BUDGET_USAGE },
    previousSequence: 0,
    fallbackUsed: false,
    maxRetries: 1,
    fallbackOnFailure: false,
    ...overrides,
  };
}
