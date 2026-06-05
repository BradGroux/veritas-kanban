import { describe, expect, it } from 'vitest';
import type { AnyTelemetryEvent, Task } from '@veritas-kanban/shared';
import {
  AgentHealthClassifierService,
  type AgentHealthClassifierInput,
} from '../../services/agent-health-classifier-service.js';
import type { RegisteredAgent } from '../../services/agent-registry-service.js';

const NOW = new Date('2026-06-04T12:00:00Z');

function makeAgent(overrides: Partial<RegisteredAgent> = {}): RegisteredAgent {
  return {
    id: 'codex',
    name: 'Codex',
    capabilities: [],
    status: 'online',
    registeredAt: '2026-06-04T11:00:00Z',
    lastHeartbeat: '2026-06-04T11:59:00Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_20260604_health',
    title: 'Classify agent health',
    description: 'Verify deterministic classifier output',
    type: 'feature',
    status: 'in-progress',
    priority: 'high',
    created: '2026-06-04T09:00:00Z',
    updated: '2026-06-04T10:00:00Z',
    ...overrides,
  };
}

function classify(input: Omit<AgentHealthClassifierInput, 'now'>) {
  return new AgentHealthClassifierService().classify({ ...input, now: NOW })[0];
}

describe('AgentHealthClassifierService', () => {
  it('marks offline or stale agents as blocked with supervisor evidence', () => {
    const result = classify({
      agents: [
        makeAgent({
          status: 'offline',
          lastHeartbeat: '2026-06-04T08:00:00Z',
        }),
      ],
    });

    expect(result).toMatchObject({
      state: 'blocked',
      reasonCode: 'supervisor_unavailable',
      confidence: 0.9,
    });
    expect(result.evidence[0]).toMatchObject({ code: 'supervisor_unavailable' });
  });

  it('marks tasks waiting on feedback as HITL blocked', () => {
    const task = makeTask({
      status: 'blocked',
      blockedReason: { category: 'waiting-on-feedback', note: 'Owner must approve scope' },
    });
    const result = classify({
      agents: [makeAgent({ status: 'busy', currentTaskId: task.id, currentTaskTitle: task.title })],
      tasks: [task],
    });

    expect(result).toMatchObject({
      state: 'blocked',
      reasonCode: 'hitl_pending',
    });
    expect(result.evidence[0]?.message).toBe('Owner must approve scope');
  });

  it('marks repeated run errors as risky with deterministic evidence', () => {
    const telemetryEvents: AnyTelemetryEvent[] = [1, 2, 3].map((index) => ({
      id: `event-${index}`,
      type: 'run.error',
      timestamp: `2026-06-04T11:0${index}:00Z`,
      taskId: 'task_20260604_health',
      agent: 'codex',
      error: 'Provider request failed',
      attemptId: `attempt-${index}`,
    }));

    const result = classify({
      agents: [makeAgent()],
      telemetryEvents,
    });

    expect(result).toMatchObject({
      state: 'risky',
      reasonCode: 'repeated_tool_failures',
      confidence: 0.86,
    });
    expect(result.evidence[0]?.message).toContain('3 run errors');
  });

  it('marks stale busy agents on in-progress tasks as stuck', () => {
    const task = makeTask({ updated: '2026-06-04T08:00:00Z' });
    const result = classify({
      agents: [makeAgent({ status: 'busy', currentTaskId: task.id, currentTaskTitle: task.title })],
      tasks: [task],
    });

    expect(result).toMatchObject({
      state: 'stuck',
      reasonCode: 'no_signal',
      confidence: 0.74,
    });
  });

  it('marks successful runs on active tasks as completion candidates', () => {
    const task = makeTask();
    const result = classify({
      agents: [makeAgent({ status: 'busy', currentTaskId: task.id, currentTaskTitle: task.title })],
      tasks: [task],
      telemetryEvents: [
        {
          id: 'run-complete',
          type: 'run.completed',
          timestamp: '2026-06-04T11:30:00Z',
          taskId: task.id,
          agent: 'codex',
          success: true,
          attemptId: 'attempt-complete',
        },
      ],
    });

    expect(result).toMatchObject({
      state: 'complete_candidate',
      reasonCode: 'explicit_completion_hint',
      confidence: 0.68,
    });
  });

  it('marks clean online agents as healthy without an LLM signal', () => {
    const result = classify({ agents: [makeAgent()] });

    expect(result).toMatchObject({
      state: 'healthy',
      reasonCode: 'active_ok',
      confidence: 0.6,
    });
    expect(result.updatedAt).toBe(NOW.toISOString());
    expect(result.evidence).toHaveLength(1);
  });
});
