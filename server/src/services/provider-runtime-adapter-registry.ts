import type {
  ExecutableAgentProvider,
  ProviderRuntimeCapabilityEvidence,
} from '@veritas-kanban/shared';
import {
  buildProviderRuntimeCapabilities,
  type ProviderRuntimeCapabilityOverrides,
} from './provider-runtime-manifest-service.js';

export interface ProviderRuntimeAdapterDefinition {
  id: ExecutableAgentProvider;
  label: string;
  protocolVersion: string;
  capabilities: ProviderRuntimeCapabilityEvidence[];
}

export type ProviderRuntimeSurface = 'task' | 'workflow';

const COMMON_SUPPORTED: ProviderRuntimeCapabilityOverrides = {
  'run.start': supported('The adapter has a contract-tested launch path.'),
  'run.status': supported('Veritas tracks adapter run status.'),
  'run.logs': supported('Veritas persists adapter run logs.'),
  'run.complete': supported('The adapter records a terminal run result.'),
};

const CLI_SANDBOX: ProviderRuntimeCapabilityOverrides = {
  'filesystem.read': supported('The launch sandbox grants bounded filesystem reads.'),
  'filesystem.write': supported('The launch sandbox grants bounded workspace writes.'),
  'environment.allowlist': supported('The adapter receives an allowlisted environment.'),
};

const NOT_YET_IMPLEMENTED: ProviderRuntimeCapabilityOverrides = {
  'run.follow-up': unsupported('Provider-neutral follow-up turns are tracked by issue #856.'),
  'run.steer': unsupported('Provider-neutral steering is tracked by issue #856.'),
  'run.fork': unsupported('Provider-neutral conversation forks are tracked by issue #856.'),
  'run.reattach': unsupported('Durable provider reattachment is tracked by issue #853.'),
  'run.approvals': unsupported('Provider-native approvals are tracked by issue #852.'),
  'run.elicitation': unsupported('Provider-native elicitation is tracked by issue #852.'),
};

const DEFINITIONS: Record<ExecutableAgentProvider, ProviderRuntimeAdapterDefinition> = {
  'codex-cli': definition('codex-cli', 'Codex CLI', 'codex-exec-json/v1', {
    ...COMMON_SUPPORTED,
    ...CLI_SANDBOX,
    ...NOT_YET_IMPLEMENTED,
    'run.stop': supported('The adapter terminates the supervised Codex process.'),
    'run.streaming': supported('Codex JSONL output is streamed into run events.'),
    'run.structured-events': supported('Codex CLI emits contract-tested JSONL events.'),
    'run.interrupt': advisory('Process termination is available; semantic interrupt is not.'),
    'run.resume': unsupported('Codex CLI resume is not wired into task execution.'),
    'tool.calls': supported('Codex tool events are parsed and recorded.'),
    'output.structured': advisory(
      'Structured events are available without output-schema enforcement.'
    ),
    'usage.tokens': supported('Codex token usage events are parsed and persisted.'),
    'artifact.write': supported('Codex file events create task deliverable records.'),
    'workspace.worktrees': supported('Codex runs with the task worktree as its working directory.'),
  }),
  'codex-sdk': definition('codex-sdk', 'Codex SDK', 'openai-codex-sdk/v1', {
    ...COMMON_SUPPORTED,
    ...CLI_SANDBOX,
    ...NOT_YET_IMPLEMENTED,
    'run.stop': supported('The adapter aborts the active Codex SDK run.'),
    'run.streaming': supported('Codex SDK thread events are streamed into run events.'),
    'run.structured-events': supported('Codex SDK emits typed thread events.'),
    'run.interrupt': advisory('Abort is available; semantic interrupt is not wired.'),
    'run.resume': advisory(
      'Thread identity is retained, but task-level resume is not yet exposed.'
    ),
    'tool.calls': supported('Codex SDK tool events are parsed and recorded.'),
    'output.structured': advisory('Typed events are available without output-schema enforcement.'),
    'usage.tokens': supported('Codex SDK token usage events are parsed and persisted.'),
    'artifact.write': supported('Codex SDK file events create task deliverable records.'),
    'workspace.worktrees': supported('Codex SDK runs against the task worktree.'),
    'network.disable': supported('The SDK sandbox can disable network access.'),
    'network.block-private': supported('Disabling network access blocks private network ranges.'),
    'network.block-metadata': supported('Disabling network access blocks metadata endpoints.'),
  }),
  'hermes-cli': definition('hermes-cli', 'Hermes Agent', 'hermes-one-shot/v1', {
    ...COMMON_SUPPORTED,
    ...CLI_SANDBOX,
    ...NOT_YET_IMPLEMENTED,
    'run.stop': supported('The adapter terminates the supervised Hermes process.'),
    'run.streaming': supported('Hermes stdout and diagnostics are streamed into the run log.'),
    'run.structured-events': unsupported(
      'Hermes currently runs through its one-shot text interface.'
    ),
    'run.interrupt': advisory('Process termination is available; semantic interrupt is not.'),
    'run.resume': unsupported('Hermes session resume is not implemented.'),
    'output.structured': unsupported('The one-shot Hermes interface returns text output.'),
    'usage.tokens': unsupported('The Hermes adapter does not receive token usage events.'),
    'artifact.write': unknown('Hermes artifact events have not been verified.'),
    'workspace.worktrees': supported(
      'Hermes runs with the task worktree as its working directory.'
    ),
    'filesystem.read': advisory(
      'Hermes starts in the worktree without an enforceable read boundary.'
    ),
    'filesystem.write': advisory(
      'Hermes starts in the worktree without an enforceable write boundary.'
    ),
  }),
  openclaw: definition('openclaw', 'OpenClaw', 'openclaw-tools/v1', {
    ...COMMON_SUPPORTED,
    ...NOT_YET_IMPLEMENTED,
    'run.stop': unsupported('OpenClaw does not expose a task-session stop API.'),
    'run.streaming': unknown('Task-session streaming has not been conformance tested.'),
    'run.structured-events': unknown('OpenClaw task event normalization is tracked by issue #850.'),
    'run.interrupt': unsupported(
      'OpenClaw does not expose task-session interrupt through this adapter.'
    ),
    'run.resume': unsupported('OpenClaw task-session resume is not wired into task execution.'),
    'tool.calls': advisory(
      'OpenClaw agents may use tools, but Veritas does not yet enforce the tool set.'
    ),
    'output.structured': unknown('Structured output has not been conformance tested.'),
    'usage.tokens': unknown('Token usage is not returned by the current task adapter.'),
    'artifact.write': unknown('OpenClaw task-session artifact persistence is not implemented.'),
    'workspace.worktrees': advisory('The worktree is delegated in the prompt, not host-enforced.'),
    'filesystem.read': advisory('Filesystem scope is delegated to the OpenClaw runtime.'),
    'filesystem.write': advisory('Workspace write scope is delegated to the OpenClaw runtime.'),
    'network.allowlist': advisory('OpenClaw network policy is external to this adapter.'),
    'environment.allowlist': advisory('Environment filtering is external to this adapter.'),
    'credential.broker': advisory('Credentials are governed by the external OpenClaw runtime.'),
  }),
};

export function getProviderRuntimeAdapterDefinition(
  provider: ExecutableAgentProvider,
  surface: ProviderRuntimeSurface = 'task'
): ProviderRuntimeAdapterDefinition {
  const base = DEFINITIONS[provider];
  if (provider !== 'openclaw' || surface !== 'workflow') return base;

  const overrides: ProviderRuntimeCapabilityOverrides = {
    'run.follow-up': supported(
      'The workflow adapter sends follow-up prompts to an existing OpenClaw session.'
    ),
    'run.reattach': advisory(
      'The workflow adapter reuses a persisted session key, subject to external session retention.'
    ),
    'artifact.write': {
      state: 'supported',
      source: 'host-enforced',
      reason: 'Veritas persists the adapter final response as a workflow output artifact.',
    },
  };
  return {
    ...base,
    protocolVersion: 'openclaw-workflow-session/v1',
    capabilities: base.capabilities.map((capability) => {
      const override = overrides[capability.id as keyof ProviderRuntimeCapabilityOverrides];
      return override ? { ...capability, ...override } : capability;
    }),
  };
}

function definition(
  id: ExecutableAgentProvider,
  label: string,
  protocolVersion: string,
  overrides: ProviderRuntimeCapabilityOverrides
): ProviderRuntimeAdapterDefinition {
  return {
    id,
    label,
    protocolVersion,
    capabilities: buildProviderRuntimeCapabilities(overrides),
  };
}

function supported(reason: string) {
  return posture('supported', reason);
}

function advisory(reason: string) {
  return posture('advisory', reason);
}

function unsupported(reason: string) {
  return posture('unsupported', reason);
}

function unknown(reason: string) {
  return posture('unknown', reason);
}

function posture(state: 'supported' | 'advisory' | 'unsupported' | 'unknown', reason: string) {
  return { state, reason, source: 'contract-test' as const };
}
