import { z } from 'zod';
import type { Task, TaskAttempt } from '@veritas-kanban/shared';
import type { ProviderTerminalClaim } from './provider-completion-service.js';
import { HttpOpenClawTaskAdapter } from './openclaw-workflow-adapter.js';
import type { OpenClawWaitResult } from '../utils/openclaw-gateway-rpc.js';
import { digestRunLaunchValue } from '../utils/run-launch-manifest-digest.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('openclaw-completion');

export type OpenClawRunBinding = NonNullable<TaskAttempt['openclawRun']>;

export function openClawCompletionProbeSource(gatewayUrl: string): string {
  return `openclaw-gateway:agent.wait@${digestRunLaunchValue(gatewayUrl)}`;
}

const reportSchema = z
  .object({
    schemaVersion: z.literal('veritas-openclaw-completion/v1'),
    status: z.enum(['success', 'failed', 'blocked']),
    summary: z.string().trim().min(1).max(20_000),
    error: z.string().max(20_000).optional(),
  })
  .strict();

/** Only a terminal reply from agent.wait is eligible; session history is never proof. */
export function normalizeOpenClawTerminal(
  result: OpenClawWaitResult
): ProviderTerminalClaim | null {
  if (!result.endedAt || result.status === 'pending' || result.yielded) return null;
  if (result.status === 'error' || result.status === 'timeout') {
    return {
      terminalSource: 'remote-session',
      status: 'failed',
      error: result.error || 'OpenClaw run failed or exceeded its execution timeout.',
    };
  }
  const text =
    result.terminalReply?.disposition === 'visible' ? result.terminalReply.text : undefined;
  try {
    const report = reportSchema.parse(
      JSON.parse((text ?? '').trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'))
    );
    return {
      terminalSource: 'remote-session',
      status: report.status,
      summary: report.summary,
      error: report.error,
    };
  } catch {
    return {
      terminalSource: 'remote-session',
      status: 'blocked',
      error:
        'OpenClaw ended without a valid completion report. Inspect the child session and resolve the result manually.',
    };
  }
}

export function assertOpenClawRunBinding(task: Task, binding: OpenClawRunBinding): void {
  const attempt = task.attempt;
  if (
    binding.schemaVersion !== 'openclaw-task-run/v1' ||
    !binding.runId ||
    !binding.sessionKey ||
    task.id !== binding.taskId ||
    attempt?.id !== binding.attemptId ||
    attempt.provider !== 'openclaw' ||
    attempt.sessionKey !== binding.sessionKey ||
    attempt.openclawRun?.runId !== binding.runId ||
    attempt.openclawRun.gatewayUrl !== binding.gatewayUrl ||
    attempt.openclawRun.gatewayVersion !== binding.gatewayVersion ||
    attempt.openclawRun.observeUntil !== binding.observeUntil ||
    attempt.providerRuntimeManifest?.digest !== binding.providerRuntimeManifestDigest ||
    attempt.providerRuntimeManifest.providerVersion !== binding.gatewayVersion ||
    attempt.providerRuntimeManifest.probe.source !==
      openClawCompletionProbeSource(binding.gatewayUrl) ||
    attempt.taskEnvelope?.digest !== binding.taskEnvelopeDigest ||
    attempt.taskEnvelope.workspace.workspaceId !== binding.workspaceId ||
    attempt.runLaunchManifest?.digest !== binding.runLaunchManifestDigest ||
    !Number.isFinite(Date.parse(binding.observeUntil))
  )
    throw new Error(
      'OpenClaw terminal observation does not match the persisted workspace, task, attempt, session, and launch evidence.'
    );
}

interface OpenClawCompletionHost {
  getTask(taskId: string): Promise<Task | null>;
  complete(binding: OpenClawRunBinding, claim: ProviderTerminalClaim): Promise<void>;
  requireRecovery(binding: OpenClawRunBinding, reason: string): Promise<void>;
}

/** Owns observation only; attempt lifecycle remains the sole completion authority. */
export class OpenClawCompletionService {
  private readonly monitors = new Map<string, AbortController>();
  constructor(
    private readonly host: OpenClawCompletionHost,
    private readonly adapterFactory = () => new HttpOpenClawTaskAdapter(),
    private readonly now = () => Date.now()
  ) {}

  async canRecover(task: Task): Promise<boolean> {
    const binding = task.attempt?.openclawRun;
    if (!binding) return false;
    try {
      assertOpenClawRunBinding(task, binding);
      const adapter = this.adapterFactory();
      adapter.assertGatewayBinding(binding.gatewayUrl);
      const { version, result } = await adapter.waitForRun(binding.runId, 0);
      return (
        version === binding.gatewayVersion &&
        (this.now() < Date.parse(binding.observeUntil) ||
          normalizeOpenClawTerminal(result) !== null)
      );
    } catch {
      return false;
    }
  }

  start(binding: OpenClawRunBinding): void {
    const key = `${binding.taskId}:${binding.attemptId}`;
    if (this.monitors.has(key)) return;
    const controller = new AbortController();
    this.monitors.set(key, controller);
    void this.observe(binding, controller.signal)
      .catch(async () => {
        if (!controller.signal.aborted) {
          await this.host.requireRecovery(
            binding,
            'OpenClaw terminal observation failed. Restore the bound gateway and restart Veritas to retry observation.'
          );
        }
      })
      .catch(() => {
        log.warn(
          { taskId: binding.taskId, attemptId: binding.attemptId },
          'Could not persist OpenClaw recovery state; the durable run binding remains available for reconciliation.'
        );
      })
      .finally(() => {
        if (this.monitors.get(key) === controller) this.monitors.delete(key);
      });
  }

  stop(taskId: string, attemptId: string): void {
    this.monitors.get(`${taskId}:${attemptId}`)?.abort();
  }

  private async observe(binding: OpenClawRunBinding, signal: AbortSignal): Promise<void> {
    const adapter = this.adapterFactory();
    adapter.assertGatewayBinding(binding.gatewayUrl);
    while (!signal.aborted) {
      const task = await this.host.getTask(binding.taskId);
      if (
        !task ||
        task.attempt?.id !== binding.attemptId ||
        task.attempt.completionResult ||
        task.attempt.status !== 'running'
      )
        return;
      assertOpenClawRunBinding(task, binding);
      const expired = this.now() >= Date.parse(binding.observeUntil);
      const { version, result } = await adapter.waitForRun(
        binding.runId,
        expired ? 0 : 30_000,
        signal
      );
      if (version !== binding.gatewayVersion)
        throw new Error('OpenClaw gateway version changed during the run.');
      const claim = normalizeOpenClawTerminal(result);
      if (claim) {
        const current = await this.host.getTask(binding.taskId);
        if (!current || current.attempt?.completionResult || current.attempt?.status !== 'running')
          return;
        assertOpenClawRunBinding(current, binding);
        await this.host.complete(binding, claim);
        return;
      }
      if (expired) {
        await this.host.requireRecovery(
          binding,
          'OpenClaw supplied no verifiable terminal result before the observation deadline. Inspect the remote run before starting another attempt.'
        );
        return;
      }
      // A queued result can return immediately. Keep bounded pressure on the gateway.
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, 1_000);
        signal.addEventListener('abort', done, { once: true });
        if (signal.aborted) done();
      });
    }
  }
}
