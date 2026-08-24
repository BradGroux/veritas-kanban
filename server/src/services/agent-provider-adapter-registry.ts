import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type {
  AdmissionLaunchSource,
  AgentConfig,
  ExecutableAgentProvider,
  ExecutionTreeIdentity,
  ProviderRuntimeManifest,
  RunLaunchManifest,
  SandboxPolicyDryRunResult,
  Task,
  TaskAttempt,
  ConversationLifecycleRecord,
} from '@veritas-kanban/shared';
import type { AcpStdioControl } from './acp-stdio-adapter.js';
import type { AgentProviderProbeContext } from './provider-runtime-resolution.js';
import {
  getProviderRuntimeAdapterDefinition,
  type ProviderRuntimeAdapterDefinition,
  type ProviderRuntimeSurface,
} from './provider-runtime-adapter-registry.js';
import {
  getProviderRunEventMapper,
  type ProviderRunEventMapper,
} from './provider-run-event-mappers.js';
import {
  renderAcpStdioTaskEnvelope,
  renderClaudeCodeTaskEnvelope,
  renderCodexAppServerTaskEnvelope,
  renderCodexCliTaskEnvelope,
  renderCodexSdkTaskEnvelope,
  renderHermesTaskEnvelope,
  renderOpenClawTaskEnvelope,
  type ProviderTaskEnvelopeRenderInput,
  type ProviderTaskEnvelopeTransport,
} from './provider-task-envelope-renderer.js';

export interface AgentProviderAdmissionEvidence {
  schemaVersion: 'provider-admission-evidence/v1';
  source: AdmissionLaunchSource;
  outcome: 'admitted' | 'queued-dispatch';
  reservationId: string;
  queueEntryId?: string;
  executionTree: ExecutionTreeIdentity;
}

export interface AgentProviderStartContext {
  task: Task;
  agentConfig?: AgentConfig;
  transport: ProviderTaskEnvelopeTransport;
  logPath: string;
  attemptId: string;
  startedAt: string;
  emitter: EventEmitter;
  attempt: TaskAttempt;
  sandboxPolicy?: SandboxPolicyDryRunResult;
  runLaunchManifest: RunLaunchManifest;
  conversation: ConversationLifecycleRecord;
  admission: AgentProviderAdmissionEvidence;
}

export interface ProviderAdapterPendingRun {
  taskId: string;
  attemptId: string;
  process?: ChildProcessWithoutNullStreams;
  abortController?: AbortController;
  codexAppServerControl?: {
    interrupt(): Promise<void>;
    close(): void;
  };
  acpControl?: Pick<AcpStdioControl, 'cancel' | 'close'>;
  openclawSessionKey?: string;
}

export interface AgentProviderStopContext {
  taskId: string;
  pending: ProviderAdapterPendingRun;
}

export interface AgentProviderAdapter {
  id: ExecutableAgentProvider;
  label: string;
  renderTaskEnvelope(input: ProviderTaskEnvelopeRenderInput): ProviderTaskEnvelopeTransport;
  probe(context: AgentProviderProbeContext): Promise<ProviderRuntimeManifest>;
  runEventMapper: ProviderRunEventMapper;
  start(context: AgentProviderStartContext): Promise<void> | void;
  stop(context: AgentProviderStopContext): Promise<void> | void;
}

export interface AgentProviderAdapterHost {
  probe(
    provider: ExecutableAgentProvider,
    context: AgentProviderProbeContext,
    definition: ProviderRuntimeAdapterDefinition
  ): Promise<ProviderRuntimeManifest>;
  probeAcp(
    context: AgentProviderProbeContext,
    definition: ProviderRuntimeAdapterDefinition
  ): Promise<ProviderRuntimeManifest>;
  assertTransport(
    provider: ExecutableAgentProvider,
    transport: ProviderTaskEnvelopeTransport,
    manifest: RunLaunchManifest
  ): void;
  getPending(taskId: string): ProviderAdapterPendingRun | undefined;
  startCodexCli(context: AgentProviderStartContext): Promise<void>;
  startCodexSdk(
    context: AgentProviderStartContext,
    abortController: AbortController
  ): Promise<void>;
  handleCodexSdkError(
    context: AgentProviderStartContext,
    abortController: AbortController,
    error: unknown
  ): Promise<void>;
  startCodexAppServer(context: AgentProviderStartContext): Promise<void>;
  startAcpStdio(context: AgentProviderStartContext): Promise<void>;
  startClaudeCode(context: AgentProviderStartContext): Promise<void>;
  startHermesCli(context: AgentProviderStartContext): Promise<void>;
  startOpenClaw(context: AgentProviderStartContext): Promise<void>;
  warn(details: Record<string, unknown>, message: string): void;
}

type TaskEnvelopeRenderer = (
  input: ProviderTaskEnvelopeRenderInput
) => ProviderTaskEnvelopeTransport;

const TASK_ENVELOPE_RENDERERS: Record<ExecutableAgentProvider, TaskEnvelopeRenderer> = {
  'codex-cli': renderCodexCliTaskEnvelope,
  'codex-sdk': renderCodexSdkTaskEnvelope,
  'codex-app-server': renderCodexAppServerTaskEnvelope,
  'acp-stdio': renderAcpStdioTaskEnvelope,
  'claude-code': renderClaudeCodeTaskEnvelope,
  'hermes-cli': renderHermesTaskEnvelope,
  openclaw: renderOpenClawTaskEnvelope,
};

/**
 * Owns executable-provider selection and adapter lifecycle semantics. The host
 * supplies orchestration effects; callers learn only the resolved adapter
 * interface and never branch on provider identity themselves.
 */
export class AgentProviderAdapterRegistry {
  constructor(private readonly host: AgentProviderAdapterHost) {}

  resolve(
    provider: ExecutableAgentProvider,
    surface: ProviderRuntimeSurface = 'task'
  ): AgentProviderAdapter {
    const definition = getProviderRuntimeAdapterDefinition(provider, surface);
    return {
      id: definition.id,
      label: definition.label,
      renderTaskEnvelope: TASK_ENVELOPE_RENDERERS[provider],
      probe: (context) =>
        provider === 'acp-stdio'
          ? this.host.probeAcp(context, definition)
          : this.host.probe(provider, context, definition),
      runEventMapper: getProviderRunEventMapper(provider),
      start: (context) => {
        this.host.assertTransport(provider, context.transport, context.runLaunchManifest);
        return this.start(provider, context);
      },
      stop: (context) => this.stop(provider, context),
    };
  }

  private start(
    provider: ExecutableAgentProvider,
    context: AgentProviderStartContext
  ): Promise<void> | void {
    switch (provider) {
      case 'codex-cli':
        return this.host.startCodexCli(context);
      case 'codex-sdk': {
        const abortController = new AbortController();
        const pending = this.host.getPending(context.task.id);
        if (pending) pending.abortController = abortController;
        void this.host
          .startCodexSdk(context, abortController)
          .catch((error: unknown) =>
            this.host.handleCodexSdkError(context, abortController, error)
          );
        return;
      }
      case 'codex-app-server':
        return this.host.startCodexAppServer(context);
      case 'acp-stdio':
        return this.host.startAcpStdio(context);
      case 'claude-code':
        return this.host.startClaudeCode(context);
      case 'hermes-cli':
        return this.host.startHermesCli(context);
      case 'openclaw':
        return this.host.startOpenClaw(context);
    }
  }

  private async stop(
    provider: ExecutableAgentProvider,
    { pending }: AgentProviderStopContext
  ): Promise<void> {
    switch (provider) {
      case 'codex-cli':
        if (pending.process && !pending.process.killed) pending.process.kill('SIGTERM');
        return;
      case 'codex-sdk':
        pending.abortController?.abort();
        return;
      case 'codex-app-server': {
        try {
          await pending.codexAppServerControl?.interrupt();
        } catch (error) {
          this.host.warn(
            { err: error, taskId: pending.taskId },
            'Codex app-server cooperative interrupt failed; closing the supervised process'
          );
        }
        pending.codexAppServerControl?.close();
        const child = pending.process;
        if (!child || child.exitCode != null || child.signalCode != null) return;
        const forcedStop = setTimeout(() => {
          if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
        }, 5_000);
        child.once('close', () => clearTimeout(forcedStop));
        return;
      }
      case 'acp-stdio':
        pending.abortController?.abort();
        await pending.acpControl?.cancel().catch(() => undefined);
        await pending.acpControl?.close().catch(() => undefined);
        return;
      case 'claude-code': {
        const child = pending.process;
        if (!child || child.exitCode != null || child.signalCode != null) return;
        child.kill('SIGTERM');
        const forcedStop = setTimeout(() => {
          if (child.exitCode == null && child.signalCode == null) {
            child.kill('SIGKILL');
            this.host.warn(
              { taskId: pending.taskId },
              '[ClawdbotAgent] Claude Code SIGKILL issued after graceful stop timeout'
            );
          }
        }, 5_000);
        child.once('close', () => clearTimeout(forcedStop));
        return;
      }
      case 'hermes-cli':
        if (pending.process && !pending.process.killed) {
          pending.process.kill('SIGTERM');
          const forcedStop = setTimeout(() => {
            if (pending.process && !pending.process.killed) {
              pending.process.kill('SIGKILL');
              this.host.warn(
                { taskId: pending.taskId },
                '[ClawdbotAgent] Hermes SIGKILL issued after graceful stop timeout'
              );
            }
          }, 5_000);
          pending.process.once('close', () => clearTimeout(forcedStop));
        }
        return;
      case 'openclaw':
        this.host.warn(
          { taskId: pending.taskId, sessionKey: pending.openclawSessionKey },
          '[ClawdbotAgent] OpenClaw stop requested; sub-session will complete via callback'
        );
        return;
    }
  }
}
