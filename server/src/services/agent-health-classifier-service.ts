import type {
  AgentHealthClassification,
  AgentHealthEvidence,
  AgentHealthReasonCode,
  AgentHealthState,
  AnyTelemetryEvent,
  RunTelemetryEvent,
  Task,
} from '@veritas-kanban/shared';
import type { AgentStatus } from '../routes/agent-status.js';
import type { RegisteredAgent } from './agent-registry-service.js';

export interface AgentHealthClassifierInput {
  agents: RegisteredAgent[];
  tasks?: Task[];
  telemetryEvents?: AnyTelemetryEvent[];
  globalStatus?: AgentStatus;
  now?: Date;
}

const STUCK_BUSY_MS = 2 * 60 * 60 * 1000;
const STALE_HEARTBEAT_MS = 10 * 60 * 1000;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const STATE_RANK: Record<AgentHealthState, number> = {
  healthy: 0,
  complete_candidate: 1,
  stuck: 2,
  risky: 3,
  blocked: 4,
};

export class AgentHealthClassifierService {
  classify(input: AgentHealthClassifierInput): AgentHealthClassification[] {
    const now = input.now ?? new Date();
    const tasks = input.tasks ?? [];
    const telemetryEvents = input.telemetryEvents ?? [];
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const recentEvents = telemetryEvents.filter((event) => isRecent(event.timestamp, now));
    const agents = mergeAgentSubjects(input.agents, input.globalStatus);

    return agents
      .map((agent) => this.classifyAgent(agent, taskById, recentEvents, input.globalStatus, now))
      .sort((a, b) => {
        const stateDelta = STATE_RANK[b.state] - STATE_RANK[a.state];
        if (stateDelta !== 0) return stateDelta;
        return a.subjectId.localeCompare(b.subjectId);
      });
  }

  private classifyAgent(
    agent: RegisteredAgent,
    taskById: Map<string, Task>,
    recentEvents: AnyTelemetryEvent[],
    globalStatus: AgentStatus | undefined,
    now: Date
  ): AgentHealthClassification {
    const agentEvents = recentEvents.filter((event) => eventAgent(event) === agent.id);
    const task = agent.currentTaskId ? taskById.get(agent.currentTaskId) : undefined;
    const evidence: AgentHealthEvidence[] = [];
    const updatedAt = now.toISOString();

    if (agent.status === 'offline' || isStale(agent.lastHeartbeat, now, STALE_HEARTBEAT_MS)) {
      evidence.push({
        code: 'supervisor_unavailable',
        message: 'Agent heartbeat is stale or offline.',
        timestamp: agent.lastHeartbeat,
        taskId: agent.currentTaskId,
        taskTitle: agent.currentTaskTitle,
      });
      return classification(agent, 'blocked', 'supervisor_unavailable', 0.9, evidence, updatedAt);
    }

    const globalActive = globalStatus?.activeAgents?.find(
      (active) => normalize(active.agent) === normalize(agent.id)
    );
    if (globalActive?.status === 'error' || globalStatus?.status === 'error') {
      evidence.push({
        code: 'provider_errors',
        message: globalStatus?.errorMessage || 'Global agent status reports an error state.',
        timestamp: globalStatus?.lastUpdated,
        taskId: globalActive?.taskId ?? agent.currentTaskId,
        taskTitle: globalActive?.taskTitle ?? agent.currentTaskTitle,
      });
      return classification(agent, 'risky', 'provider_errors', 0.82, evidence, updatedAt);
    }

    if (task?.status === 'blocked' && task.blockedReason?.category === 'waiting-on-feedback') {
      evidence.push({
        code: 'hitl_pending',
        message: task.blockedReason.note || 'Current task is waiting on human feedback.',
        timestamp: task.updated,
        taskId: task.id,
        taskTitle: task.title,
      });
      return classification(agent, 'blocked', 'hitl_pending', 0.88, evidence, updatedAt);
    }

    if (task?.status === 'blocked') {
      evidence.push({
        code: 'task_blocked',
        message: task.blockedReason?.note || 'Current task is blocked.',
        timestamp: task.updated,
        taskId: task.id,
        taskTitle: task.title,
      });
      return classification(agent, 'blocked', 'task_blocked', 0.88, evidence, updatedAt);
    }

    const errorEvents = agentEvents.filter((event) => event.type === 'run.error');
    const failedRuns = agentEvents.filter(
      (event) => event.type === 'run.completed' && (event as RunTelemetryEvent).success === false
    );
    const recentTestFailure = [...errorEvents, ...failedRuns].find((event) =>
      /test|assert|spec|vitest|playwright/i.test(eventError(event) ?? '')
    );

    if (errorEvents.length >= 3) {
      const firstError = errorEvents[0];
      evidence.push({
        code: 'repeated_tool_failures',
        message: `${errorEvents.length} run errors recorded in the last 24 hours.`,
        timestamp: firstError?.timestamp,
        runId: firstError ? eventAttemptId(firstError) : undefined,
        taskId: firstError?.taskId,
      });
      return classification(agent, 'risky', 'repeated_tool_failures', 0.86, evidence, updatedAt);
    }

    if (recentTestFailure) {
      evidence.push({
        code: 'recent_test_failures',
        message: 'Recent run failure appears test-related.',
        timestamp: recentTestFailure.timestamp,
        runId: eventAttemptId(recentTestFailure),
        taskId: recentTestFailure.taskId,
      });
      return classification(agent, 'risky', 'recent_test_failures', 0.78, evidence, updatedAt);
    }

    if (errorEvents.length > 0 || failedRuns.length > 0) {
      const event = errorEvents[0] ?? failedRuns[0];
      evidence.push({
        code: 'provider_errors',
        message: eventError(event) || 'Recent run failure recorded.',
        timestamp: event.timestamp,
        runId: eventAttemptId(event),
        taskId: event.taskId,
      });
      return classification(agent, 'risky', 'provider_errors', 0.72, evidence, updatedAt);
    }

    const latestSuccess = agentEvents.find(
      (event) => event.type === 'run.completed' && (event as RunTelemetryEvent).success === true
    );
    if (latestSuccess && task?.status === 'in-progress') {
      evidence.push({
        code: 'explicit_completion_hint',
        message: 'Latest run completed successfully while the task remains in progress.',
        timestamp: latestSuccess.timestamp,
        runId: eventAttemptId(latestSuccess),
        taskId: latestSuccess.taskId,
        taskTitle: task.title,
      });
      return classification(
        agent,
        'complete_candidate',
        'explicit_completion_hint',
        0.68,
        evidence,
        updatedAt
      );
    }

    if (
      agent.status === 'busy' &&
      task &&
      task.status === 'in-progress' &&
      ageMs(task.updated, now) >= STUCK_BUSY_MS
    ) {
      evidence.push({
        code: 'no_signal',
        message: 'Assigned in-progress task has not been updated recently.',
        timestamp: task.updated,
        taskId: task.id,
        taskTitle: task.title,
      });
      return classification(agent, 'stuck', 'no_signal', 0.74, evidence, updatedAt);
    }

    if (agent.status === 'idle' && latestSuccess) {
      evidence.push({
        code: 'idle_after_plan_completion',
        message: 'Agent is idle after a successful run.',
        timestamp: latestSuccess.timestamp,
        runId: eventAttemptId(latestSuccess),
        taskId: latestSuccess.taskId,
      });
      return classification(
        agent,
        'complete_candidate',
        'idle_after_plan_completion',
        0.62,
        evidence,
        updatedAt
      );
    }

    evidence.push({
      code: 'active_ok',
      message:
        agent.status === 'busy'
          ? 'Agent is busy with current signal.'
          : 'No risky signal detected.',
      timestamp: agent.lastHeartbeat,
      taskId: agent.currentTaskId,
      taskTitle: agent.currentTaskTitle,
    });
    return classification(agent, 'healthy', 'active_ok', 0.6, evidence, updatedAt);
  }
}

export function getAgentHealthClassifierService(): AgentHealthClassifierService {
  return new AgentHealthClassifierService();
}

function classification(
  agent: RegisteredAgent,
  state: AgentHealthState,
  reasonCode: AgentHealthReasonCode,
  confidence: number,
  evidence: AgentHealthEvidence[],
  updatedAt: string
): AgentHealthClassification {
  return {
    subjectId: `agent:${agent.id}`,
    subjectType: 'agent',
    agent: agent.id,
    taskId: agent.currentTaskId,
    taskTitle: agent.currentTaskTitle,
    state,
    reasonCode,
    explanation: explanationFor(state, reasonCode),
    confidence,
    evidence,
    updatedAt,
  };
}

function explanationFor(state: AgentHealthState, reasonCode: AgentHealthReasonCode): string {
  switch (reasonCode) {
    case 'supervisor_unavailable':
      return 'Agent supervisor or heartbeat is unavailable.';
    case 'task_blocked':
      return 'Agent is attached to a blocked task.';
    case 'repeated_tool_failures':
      return 'Agent has repeated recent run errors.';
    case 'recent_test_failures':
      return 'Agent has recent test-related failures.';
    case 'provider_errors':
      return 'Agent has recent provider or runtime errors.';
    case 'no_signal':
      return 'Agent appears stuck with no recent task progress signal.';
    case 'explicit_completion_hint':
      return 'Agent run completed successfully but the task has not moved forward.';
    case 'idle_after_plan_completion':
      return 'Agent is idle after completing a recent run.';
    case 'hitl_pending':
      return 'Agent is waiting on human input.';
    case 'active_ok':
      return state === 'healthy' ? 'Agent has no risky signal.' : 'Agent is active.';
  }
}

function mergeAgentSubjects(
  agents: RegisteredAgent[],
  globalStatus: AgentStatus | undefined
): RegisteredAgent[] {
  const byId = new Map<string, RegisteredAgent>();
  for (const agent of agents) {
    byId.set(agent.id, agent);
  }

  const activeAgents = globalStatus?.activeAgents ?? [];
  for (const active of activeAgents) {
    if (byId.has(active.agent)) continue;
    byId.set(active.agent, {
      id: active.agent,
      name: active.agent,
      capabilities: [],
      status: active.status === 'idle' ? 'idle' : 'busy',
      registeredAt: active.startedAt,
      lastHeartbeat: globalStatus?.lastUpdated ?? active.startedAt,
      currentTaskId: active.taskId,
      currentTaskTitle: active.taskTitle,
    });
  }

  return Array.from(byId.values());
}

function eventAgent(event: AnyTelemetryEvent): string | undefined {
  return 'agent' in event && typeof event.agent === 'string' ? event.agent : undefined;
}

function eventError(event: AnyTelemetryEvent): string | undefined {
  if ('error' in event && typeof event.error === 'string') return event.error;
  return undefined;
}

function eventAttemptId(event: AnyTelemetryEvent): string | undefined {
  return 'attemptId' in event && typeof event.attemptId === 'string' ? event.attemptId : undefined;
}

function isRecent(timestamp: string, now: Date): boolean {
  return ageMs(timestamp, now) <= RECENT_WINDOW_MS;
}

function isStale(timestamp: string, now: Date, thresholdMs: number): boolean {
  return ageMs(timestamp, now) > thresholdMs;
}

function ageMs(timestamp: string, now: Date): number {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now.getTime() - parsed);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
