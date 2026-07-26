import { describe, expect, it, vi } from 'vitest';
import type { ProgressWatchdogFinding } from '@veritas-kanban/shared';
import {
  AgentProgressWatchdogActionExecutor,
  type ProgressWatchdogAgentControl,
} from '../services/progress-watchdog-action-executor.js';

function finding(action: ProgressWatchdogFinding['action']): ProgressWatchdogFinding {
  return {
    schemaVersion: 'progress-watchdog-finding/v1',
    id: 'watchdog_aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa',
    taskId: 'task_1',
    attemptId: 'attempt_1',
    turnId: 'turn_1',
    detector: 'identical-repetition',
    confidence: 'medium',
    policyVersion: 1,
    evidenceEventIds: ['event_1', 'event_2', 'event_3'],
    fingerprintHashes: [`sha256:${'a'.repeat(64)}`],
    suppressedEventIds: [],
    progressSignals: [],
    action,
    recoveryBudgetRemaining: { turn: 1, run: 5 },
    createdAt: '2026-07-25T12:00:00.000Z',
  };
}

function control(delivered = true): {
  agents: ProgressWatchdogAgentControl;
  sendMessage: ReturnType<typeof vi.fn>;
  stopAgent: ReturnType<typeof vi.fn>;
} {
  const sendMessage = vi.fn(async () => ({
    action: 'steer' as const,
    taskId: 'task_1',
    attemptId: 'attempt_1',
    delivered,
    note: delivered ? 'delivered' : 'recorded only',
    conversation: {
      schemaVersion: 'conversation-lifecycle/v1' as const,
      mode: 'fresh' as const,
      intent: 'fresh' as const,
      conversationId: 'conversation_1',
      state: 'active' as const,
      contextWindow: {
        posture: 'unknown' as const,
        measuredAt: '2026-07-25T12:00:00.000Z',
      },
      createdAt: '2026-07-25T12:00:00.000Z',
      updatedAt: '2026-07-25T12:00:00.000Z',
    },
  }));
  const stopAgent = vi.fn(async () => undefined);
  return {
    agents: { sendMessage, stopAgent },
    sendMessage,
    stopAgent,
  };
}

describe('AgentProgressWatchdogActionExecutor', () => {
  it('delivers a bounded fresh-observation instruction through native steering', async () => {
    const { agents, sendMessage } = control();
    const executor = new AgentProgressWatchdogActionExecutor(agents);

    await expect(executor.execute(finding('require-observation'))).resolves.toMatchObject({
      status: 'executed',
    });
    expect(sendMessage).toHaveBeenCalledWith(
      'task_1',
      expect.stringContaining('fresh observation'),
      {
        actor: 'VERITAS Watchdog',
        source: 'progress-watchdog',
        expectedAttemptId: 'attempt_1',
      }
    );
  });

  it('fails closed to operator review when native steering is unavailable', async () => {
    const { agents } = control(false);
    const executor = new AgentProgressWatchdogActionExecutor(agents);

    await expect(executor.execute(finding('steer'))).resolves.toMatchObject({
      status: 'operator-required',
    });
  });

  it('stops an active provider with watchdog attribution for pause', async () => {
    const { agents, stopAgent } = control();
    const executor = new AgentProgressWatchdogActionExecutor(agents);

    await expect(executor.execute(finding('pause'))).resolves.toMatchObject({
      status: 'executed',
    });
    expect(stopAgent).toHaveBeenCalledWith('task_1', 'attempt_1', {
      actor: 'system',
      source: 'progress-watchdog',
      reason:
        'Paused by progress watchdog finding watchdog_aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa pending operator review.',
      terminalSource: 'process',
    });
  });

  it('does not bypass the governed recovery planner for retry or fallback', async () => {
    const { agents } = control();
    const executor = new AgentProgressWatchdogActionExecutor(agents);

    await expect(executor.execute(finding('retry'))).resolves.toMatchObject({
      status: 'operator-required',
    });
    await expect(executor.execute(finding('fallback'))).resolves.toMatchObject({
      status: 'operator-required',
    });
  });
});
