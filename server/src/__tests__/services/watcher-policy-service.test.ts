import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '../../services/audit-service.js';
import { WatcherPolicyService } from '../../services/watcher-policy-service.js';
import type { WatcherContinuationSettings } from '@veritas-kanban/shared';

function enabledSettings(
  patch: Partial<WatcherContinuationSettings> = {}
): WatcherContinuationSettings {
  return {
    enabled: true,
    globalKillSwitch: false,
    defaultMode: 'auto',
    maxContinuationsPerRun: 3,
    spendCapUsd: 5,
    riskClasses: [
      'destructive_command',
      'credential_reference',
      'recent_test_failure',
      'provider_error',
      'policy_violation',
    ],
    dispatchDenyPatterns: [],
    policies: [],
    ...patch,
  };
}

describe('WatcherPolicyService', () => {
  it('blocks by default because watcher continuations are disabled and killed', async () => {
    const service = new WatcherPolicyService({
      auditWriter: vi.fn<(_: AuditEvent) => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await service.evaluateContinuation({ runId: 'run-1', agent: 'codex' });

    expect(result.decision).toBe('block');
    expect(result.reasons).toContain('Watcher continuations are disabled.');
    expect(result.auditLogged).toBe(true);
  });

  it('enforces the global kill switch before allowing clean continuations', async () => {
    const service = new WatcherPolicyService({
      settings: enabledSettings({ globalKillSwitch: true }),
      auditWriter: vi.fn<(_: AuditEvent) => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await service.evaluateContinuation({ runId: 'run-1', agent: 'codex' });

    expect(result.decision).toBe('block');
    expect(result.reasons).toContain('Global watcher kill switch is active.');
  });

  it('allows clean auto continuations that are inside dispatch and cap limits', async () => {
    const service = new WatcherPolicyService({
      settings: enabledSettings(),
      auditWriter: vi.fn<(_: AuditEvent) => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await service.evaluateContinuation({
      runId: 'run-1',
      agent: 'codex',
      project: 'core',
      prompt: 'Continue with the next non-destructive test fix.',
      continuationCount: 1,
      monthlySpendUsd: 1,
    });

    expect(result.decision).toBe('allow');
    expect(result.riskClasses).toEqual([]);
  });

  it('requires approval for risky auto continuations instead of bypassing risk classes', async () => {
    const service = new WatcherPolicyService({
      settings: enabledSettings(),
      auditWriter: vi.fn<(_: AuditEvent) => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await service.evaluateContinuation({
      runId: 'run-1',
      agent: 'codex',
      command: 'git reset --hard HEAD',
      continuationCount: 0,
    });

    expect(result.decision).toBe('require_approval');
    expect(result.riskClasses).toContain('destructive_command');
    expect(result.riskLevel).toBe('critical');
  });

  it('escalates ask_on_risk policies and records the matched project/agent policy', async () => {
    const service = new WatcherPolicyService({
      settings: enabledSettings({
        defaultMode: 'auto',
        policies: [
          {
            id: 'core-codex',
            enabled: true,
            project: 'core',
            agent: 'codex',
            mode: 'ask_on_risk',
          },
        ],
      }),
      auditWriter: vi.fn<(_: AuditEvent) => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await service.evaluateContinuation({
      runId: 'run-1',
      project: 'core',
      agent: 'codex',
      hasRecentTestFailures: true,
    });

    expect(result.decision).toBe('require_approval');
    expect(result.matchedPolicyId).toBe('core-codex');
    expect(result.riskClasses).toContain('recent_test_failure');
  });

  it('blocks dispatch-filtered continuation payloads', async () => {
    const service = new WatcherPolicyService({
      settings: enabledSettings({ dispatchDenyPatterns: ['rotate production secret'] }),
      auditWriter: vi.fn<(_: AuditEvent) => Promise<void>>().mockResolvedValue(undefined),
    });

    const result = await service.evaluateContinuation({
      runId: 'run-1',
      prompt: 'Please rotate production secret and keep going.',
    });

    expect(result.decision).toBe('block');
    expect(result.evidence.map((item) => item.code)).toContain('dispatch_filter');
  });

  it('blocks continuation and spend caps to prevent runaway loops', async () => {
    const service = new WatcherPolicyService({
      settings: enabledSettings({ maxContinuationsPerRun: 2, spendCapUsd: 10 }),
      auditWriter: vi.fn<(_: AuditEvent) => Promise<void>>().mockResolvedValue(undefined),
    });

    const continuationCap = await service.evaluateContinuation({
      runId: 'run-1',
      continuationCount: 2,
      monthlySpendUsd: 1,
    });
    const spendCap = await service.evaluateContinuation({
      runId: 'run-2',
      continuationCount: 0,
      monthlySpendUsd: 10,
    });

    expect(continuationCap.decision).toBe('block');
    expect(continuationCap.evidence.map((item) => item.code)).toContain('continuation_cap');
    expect(spendCap.decision).toBe('block');
    expect(spendCap.evidence.map((item) => item.code)).toContain('spend_cap');
  });

  it('writes redacted audit details without prompt or command payloads', async () => {
    const auditWriter = vi.fn<(_: AuditEvent) => Promise<void>>().mockResolvedValue(undefined);
    const service = new WatcherPolicyService({
      settings: enabledSettings(),
      auditWriter,
    });

    await service.evaluateContinuation(
      {
        runId: 'run-1',
        taskId: 'task-1',
        project: 'core',
        agent: 'codex',
        prompt: 'Use token super-secret-value to continue.',
        command: 'echo super-secret-value',
      },
      { actor: 'agent-key' }
    );

    expect(auditWriter).toHaveBeenCalledOnce();
    const auditEvent = auditWriter.mock.calls[0][0];
    expect(auditEvent.action).toBe('watcher.continuation.evaluate');
    expect(JSON.stringify(auditEvent.details)).not.toContain('super-secret-value');
    expect(auditEvent.details).toMatchObject({
      decision: 'require_approval',
      riskClasses: ['credential_reference'],
      runId: 'run-1',
      taskId: 'task-1',
      project: 'core',
      agent: 'codex',
    });
  });
});
