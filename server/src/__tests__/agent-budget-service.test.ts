import { describe, expect, it } from 'vitest';
import { AgentBudgetService } from '../services/agent-budget-service.js';

describe('AgentBudgetService', () => {
  it('merges workspace, agent, workflow, and run budgets using the strictest limits', () => {
    const service = new AgentBudgetService();

    const policy = service.resolve({
      workspaceBudget: {
        enabled: true,
        scope: 'workspace',
        limits: { totalTokens: 100_000, costUsd: 25, retries: 5 },
        softThresholdPercent: 80,
        hardAction: 'require-approval',
      },
      agentBudget: {
        enabled: true,
        scope: 'agent',
        limits: { totalTokens: 80_000, toolCalls: 40 },
        hardAction: 'pause',
      },
      workflowBudget: {
        enabled: true,
        scope: 'workflow',
        limits: { retries: 2, fanOut: 6 },
      },
      runBudget: {
        enabled: true,
        scope: 'run',
        limits: { totalTokens: 50_000, fanOut: 4 },
        softThresholdPercent: 70,
      },
    });

    expect(policy?.limits).toMatchObject({
      totalTokens: 50_000,
      costUsd: 25,
      toolCalls: 40,
      retries: 2,
      fanOut: 4,
    });
    expect(policy?.softThresholdPercent).toBe(70);
    expect(policy?.hardAction).toBe('require-approval');
  });

  it('warns on soft thresholds and records a budget governance trace', () => {
    const service = new AgentBudgetService();
    const policy = service.resolve({
      workspaceBudget: {
        enabled: true,
        limits: { totalTokens: 1000 },
        softThresholdPercent: 75,
        hardAction: 'require-approval',
      },
    });

    const evaluation = service.evaluate(policy, { totalTokens: 800 }, { taskId: 'task-1' });

    expect(evaluation.decision).toBe('warn');
    expect(evaluation.thresholdEvents).toHaveLength(1);
    expect(evaluation.thresholdEvents[0]).toMatchObject({
      metric: 'totalTokens',
      threshold: 'soft',
      action: 'warn',
    });
    expect(evaluation.trace).toMatchObject({
      kind: 'budget-policy',
      outcome: 'warned',
      subject: { taskId: 'task-1', actionType: 'budget.evaluate' },
    });
  });

  it('ignores disabled policies when resolving effective limits', () => {
    const service = new AgentBudgetService();

    const policy = service.resolve({
      workspaceBudget: {
        enabled: true,
        scope: 'workspace',
        limits: { totalTokens: 10_000 },
      },
      agentBudget: {
        enabled: false,
        scope: 'agent',
        limits: { totalTokens: 100, costUsd: 1 },
        hardAction: 'cancel',
      },
    });

    expect(policy?.limits).toMatchObject({ totalTokens: 10_000 });
    expect(policy?.limits?.costUsd).toBeUndefined();
    expect(policy?.hardAction).toBe('require-approval');
  });

  it('requires operator action when a hard threshold is reached', () => {
    const service = new AgentBudgetService();
    const policy = service.resolve({
      workspaceBudget: {
        enabled: true,
        limits: { toolCalls: 3 },
        hardAction: 'cancel',
      },
    });

    const evaluation = service.evaluate(policy, { toolCalls: 3 }, { runId: 'run-1' });

    expect(evaluation.decision).toBe('cancel');
    expect(evaluation.trace).toMatchObject({
      kind: 'budget-policy',
      outcome: 'blocked',
      subject: { runId: 'run-1' },
    });
  });

  it('returns model overrides for explicit downgrade policies', () => {
    const service = new AgentBudgetService();
    const policy = service.resolve({
      workspaceBudget: {
        enabled: true,
        limits: { costUsd: 2 },
        hardAction: 'downgrade',
        downgradeModel: 'gpt-4.1-mini',
      },
    });

    const evaluation = service.evaluate(policy, { costUsd: 2.5 });

    expect(evaluation.decision).toBe('downgrade');
    expect(evaluation.modelOverride).toBe('gpt-4.1-mini');
    expect(evaluation.trace?.outcome).toBe('routed');
  });
});
