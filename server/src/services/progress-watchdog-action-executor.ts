import type {
  ConversationLifecycleResult,
  ProgressWatchdogFinding,
  TaskTerminalSource,
} from '@veritas-kanban/shared';
import type { AgentStopOptions, ClawdbotAgentService } from './clawdbot-agent-service.js';
import type { ProgressWatchdogActionExecutor } from './progress-watchdog-coordinator-service.js';

export interface ProgressWatchdogAgentControl {
  sendMessage(
    taskId: string,
    message: string,
    options: {
      actor?: string;
      source?: string;
      expectedAttemptId: string;
    }
  ): Promise<ConversationLifecycleResult>;
  stopAgent(taskId: string, expectedAttemptId: string, options?: AgentStopOptions): Promise<void>;
}

export class AgentProgressWatchdogActionExecutor implements ProgressWatchdogActionExecutor {
  constructor(
    private readonly agents: ProgressWatchdogAgentControl,
    private readonly terminalSource: TaskTerminalSource = 'process'
  ) {}

  async execute(finding: ProgressWatchdogFinding): Promise<{
    status: 'executed' | 'operator-required';
    diagnostic: string;
  }> {
    if (finding.action === 'steer' || finding.action === 'require-observation') {
      const delivery = await this.agents.sendMessage(finding.taskId, recoveryMessage(finding), {
        actor: 'VERITAS Watchdog',
        source: 'progress-watchdog',
        expectedAttemptId: finding.attemptId,
      });
      return delivery.delivered
        ? {
            status: 'executed',
            diagnostic: 'Provider-native steering received the bounded recovery instruction.',
          }
        : {
            status: 'operator-required',
            diagnostic:
              'The instruction was journaled, but this provider has no verified live steering control.',
          };
    }

    if (finding.action === 'pause' || finding.action === 'cancel') {
      await this.agents.stopAgent(finding.taskId, finding.attemptId, {
        actor: 'system',
        source: 'progress-watchdog',
        reason:
          finding.action === 'pause'
            ? `Paused by progress watchdog finding ${finding.id} pending operator review.`
            : `Cancelled by progress watchdog finding ${finding.id}.`,
        terminalSource: this.terminalSource,
      });
      return {
        status: 'executed',
        diagnostic:
          finding.action === 'pause'
            ? 'The active provider was stopped and remains available for operator-reviewed continuation.'
            : 'The active provider was stopped by the configured watchdog policy.',
      };
    }

    return {
      status: 'operator-required',
      diagnostic: `${finding.action} requires the governed run-recovery planner and was not executed implicitly.`,
    };
  }
}

function recoveryMessage(finding: ProgressWatchdogFinding): string {
  if (finding.action === 'require-observation') {
    return [
      'VERITAS progress watchdog detected repeated activity without new durable evidence.',
      'Stop the current approach, inspect the latest observable state, and state one fresh observation or revised plan before another tool call.',
      `Finding: ${finding.id}.`,
    ].join(' ');
  }
  return [
    'VERITAS progress watchdog detected a likely loop.',
    'Change the approach using the latest durable evidence and do not repeat the same action unchanged.',
    `Finding: ${finding.id}.`,
  ].join(' ');
}

export function createAgentProgressWatchdogActionExecutor(
  agents: ClawdbotAgentService
): AgentProgressWatchdogActionExecutor {
  return new AgentProgressWatchdogActionExecutor(agents);
}
