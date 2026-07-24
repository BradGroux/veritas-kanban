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
  'run.follow-up': unsupported('The adapter does not expose provider-native follow-up turns.'),
  'run.steer': unsupported('The adapter does not expose provider-native steering.'),
  'run.fork': unsupported('The adapter does not expose provider-native history forks.'),
  'run.compact': unsupported('The adapter does not expose provider-native compaction.'),
  'run.archive': unsupported('The adapter does not expose provider-native archival.'),
  'run.close': unsupported('The adapter does not expose provider-native conversation closure.'),
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
    'run.reattach': supported(
      'The durable run supervisor validates and reattaches the original Codex process group.'
    ),
    'run.streaming': supported('Codex JSONL output is streamed into run events.'),
    'run.structured-events': supported('Codex CLI emits contract-tested JSONL events.'),
    'run.follow-up': supported('A follow-up starts through `codex exec resume <session-id>`.'),
    'run.interrupt': advisory('Process termination is available; semantic interrupt is not.'),
    'run.resume': supported('Codex CLI resumes a persisted session by its exact ID.'),
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
    'run.follow-up': supported('A follow-up runs on a resumed Codex SDK thread.'),
    'run.interrupt': advisory('Abort is available; semantic interrupt is not wired.'),
    'run.resume': supported('The SDK resumes a persisted thread by its exact ID.'),
    'tool.calls': supported('Codex SDK tool events are parsed and recorded.'),
    'output.structured': advisory('Typed events are available without output-schema enforcement.'),
    'usage.tokens': supported('Codex SDK token usage events are parsed and persisted.'),
    'artifact.write': supported('Codex SDK file events create task deliverable records.'),
    'workspace.worktrees': supported('Codex SDK runs against the task worktree.'),
    'network.disable': supported('The SDK sandbox can disable network access.'),
    'network.block-private': supported('Disabling network access blocks private network ranges.'),
    'network.block-metadata': supported('Disabling network access blocks metadata endpoints.'),
  }),
  'codex-app-server': definition(
    'codex-app-server',
    'Codex app-server',
    'codex-app-server-jsonrpc/v2',
    {
      ...COMMON_SUPPORTED,
      ...CLI_SANDBOX,
      ...NOT_YET_IMPLEMENTED,
      'run.stop': supported(
        'The adapter requests turn/interrupt, closes the supervised stdio connection, and retains a bounded process-kill fallback.'
      ),
      'run.reattach': supported(
        'The durable run supervisor validates and reattaches the app-server process group.'
      ),
      'run.streaming': supported(
        'Validated app-server notifications stream into the causal run journal through terminal turn completion.'
      ),
      'run.structured-events': supported(
        'Every consumed request, response, notification, and provider request is checked against schemas generated by Codex CLI v0.145.0.'
      ),
      'run.follow-up': supported(
        'A follow-up resumes the exact thread and starts a new correlated turn.'
      ),
      'run.steer': supported(
        'The adapter sends turn/steer with exact thread and active-turn preconditions.'
      ),
      'run.interrupt': supported(
        'Task stop uses the correlated thread and turn IDs to send turn/interrupt.'
      ),
      'run.resume': supported(
        'The adapter validates and resumes a persisted thread through thread/resume.'
      ),
      'run.fork': supported(
        'The adapter forks an exact thread and optional last completed turn through thread/fork.'
      ),
      'run.compact': supported('The adapter starts native thread compaction.'),
      'run.archive': supported('The adapter archives the exact provider thread.'),
      'run.close': supported(
        'Veritas closes the local lifecycle after interrupting any active provider turn.'
      ),
      'run.approvals': supported(
        'Provider approval requests are bound to durable Veritas requests and resolved with authenticated compare-and-set decisions.'
      ),
      'run.elicitation': supported(
        'Provider questions and elicitation requests use the same durable broker with bounded, schema-validated responses.'
      ),
      'tool.calls': supported(
        'Command, file, tool, and item lifecycle notifications are journaled and budgeted.'
      ),
      'tool.mcp': supported(
        'Only the immutable run-scoped MCP catalog is injected through thread configuration; inherited servers remain disabled.'
      ),
      'output.structured': advisory(
        'The transport is schema-validated JSON-RPC; caller output-schema enforcement is not yet exposed.'
      ),
      'usage.tokens': supported(
        'Thread token-usage notifications are parsed, persisted, and evaluated against run budgets.'
      ),
      'artifact.write': supported('Completed file-change items create task deliverable evidence.'),
      'workspace.worktrees': supported(
        'The process and app-server thread run in the assigned task worktree.'
      ),
      'environment.allowlist': supported(
        'The adapter uses the safe Codex environment and forces remote-control disablement.'
      ),
      'credential.broker': unsupported(
        'Provider authentication uses the existing safe Codex environment until issue #932 migrates launches to brokered handles.'
      ),
    }
  ),
  'claude-code': definition('claude-code', 'Claude Code', 'claude-code-stream-json/v1', {
    ...COMMON_SUPPORTED,
    ...NOT_YET_IMPLEMENTED,
    'run.stop': supported(
      'The adapter sends SIGTERM to the supervised Claude Code process with a bounded SIGKILL fallback.'
    ),
    'run.reattach': supported(
      'The durable run supervisor validates and reattaches the original Claude Code process group.'
    ),
    'run.streaming': supported(
      'Claude Code stream-json output is drained and journaled through terminal result.'
    ),
    'run.structured-events': supported(
      'Claude Code emits contract-tested stream-json lifecycle records.'
    ),
    'run.follow-up': supported(
      'A follow-up resumes the exact Claude Code session in a new headless invocation.'
    ),
    'run.interrupt': advisory(
      'SIGTERM performs cooperative process interruption; semantic steering is not yet exposed.'
    ),
    'run.resume': supported('Claude Code resumes the exact persisted session with `--resume`.'),
    'run.fork': supported(
      'Claude Code forks a resumed session with `--resume` and `--fork-session`.'
    ),
    'tool.calls': supported(
      'Claude assistant tool-use and user tool-result records are journaled and budgeted.'
    ),
    'tool.mcp': supported(
      'Strict MCP mode exposes only the immutable run-scoped catalog and its allowed tools.'
    ),
    'output.structured': advisory(
      'The adapter validates bounded JSONL stream records without enforcing a caller output schema.'
    ),
    'usage.tokens': supported('Claude terminal usage and cost evidence is parsed and persisted.'),
    'artifact.write': supported('Write and edit tool records create task deliverable evidence.'),
    'workspace.worktrees': supported(
      'Claude Code runs with the task worktree as its working directory.'
    ),
    'filesystem.read': advisory(
      'Claude permission rules restrict tools, while host filesystem enforcement remains provider-dependent.'
    ),
    'filesystem.write': advisory(
      'Claude permission rules restrict writes to the selected static policy; host enforcement remains provider-dependent.'
    ),
    'filesystem.deny-paths': advisory(
      'Sensitive path patterns are denied through Claude permission rules.'
    ),
    'network.disable': advisory(
      'Network tools and Bash are removed when network access is disabled; host egress enforcement remains separate.'
    ),
    'environment.allowlist': supported(
      'The adapter constructs an explicit process environment allowlist.'
    ),
    'credential.broker': unsupported(
      'Claude Code currently receives only explicitly allowlisted environment authentication; brokered handles remain gated by issue #932.'
    ),
  }),
  'acp-stdio': definition('acp-stdio', 'ACP stdio', 'acp/v1', {
    ...COMMON_SUPPORTED,
    ...NOT_YET_IMPLEMENTED,
    'run.stop': supported(
      'The adapter sends session/cancel and closes the supervised ACP process with a bounded kill fallback.'
    ),
    'run.streaming': supported(
      'ACP session/update notifications stream into the causal run journal.'
    ),
    'run.structured-events': supported(
      'The adapter validates stable ACP v1 JSON-RPC lifecycle records.'
    ),
    'run.follow-up': advisory(
      'Follow-up requires the runtime to negotiate session/resume or session/load.'
    ),
    'run.interrupt': supported('The adapter sends session/cancel for the exact ACP session.'),
    'run.resume': advisory(
      'Resume requires the runtime to negotiate session/resume or session/load.'
    ),
    'run.fork': advisory('Fork requires the runtime to negotiate experimental session/fork.'),
    'run.close': advisory('Close requires the runtime to negotiate session/close.'),
    'run.approvals': supported(
      'ACP session/request_permission is bound to the durable approval broker.'
    ),
    'tool.calls': supported('ACP tool_call and tool_call_update records are journaled.'),
    'tool.mcp': supported(
      'An immutable all-allow run catalog is mapped into ACP session setup; partial native catalogs fail closed.'
    ),
    'output.structured': advisory(
      'ACP v1 uses structured transport records, but caller output-schema enforcement is not exposed.'
    ),
    'artifact.write': advisory(
      'ACP tool locations and file updates are recorded, but artifact semantics remain agent-dependent.'
    ),
    'workspace.worktrees': supported('The ACP process runs in the assigned task worktree.'),
    'filesystem.read': advisory(
      'The agent receives the task worktree; filesystem enforcement remains runtime-dependent.'
    ),
    'filesystem.write': advisory(
      'The agent receives the task worktree; filesystem enforcement remains runtime-dependent.'
    ),
    'environment.allowlist': supported(
      'The ACP process receives an explicit environment allowlist.'
    ),
    'credential.broker': unsupported(
      'ACP provider boot and task credentials remain unbrokered until issue #932.'
    ),
  }),
  'hermes-cli': definition('hermes-cli', 'Hermes Agent', 'hermes-one-shot/v1', {
    ...COMMON_SUPPORTED,
    ...CLI_SANDBOX,
    ...NOT_YET_IMPLEMENTED,
    'run.stop': supported('The adapter terminates the supervised Hermes process.'),
    'run.reattach': supported(
      'The durable run supervisor validates and reattaches the original Hermes process group.'
    ),
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
