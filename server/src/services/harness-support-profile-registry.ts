import { createHash } from 'node:crypto';
import {
  HARNESS_SUPPORT_PROFILE_SCHEMA_VERSION,
  type AgentConfig,
  type HarnessSupportProfile,
  type HarnessTransport,
} from '@veritas-kanban/shared';
import {
  containsUnredactedProviderRuntimeSecret,
  sanitizeProviderRuntimeDiagnostic,
} from '../utils/provider-runtime-manifest-sanitize.js';
import {
  buildClaudeCodeArgs,
  CLAUDE_CODE_CERTIFIED_VERSION,
  CLAUDE_CODE_CREDENTIAL_ENV_KEYS,
  CLAUDE_CODE_ENVIRONMENT_KEYS,
} from './claude-code-adapter.js';
import {
  buildCodexAppServerArgs,
  CODEX_APP_SERVER_CERTIFIED_VERSION,
} from './codex-app-server-adapter.js';
import {
  BUZZ_AGENT_ACP_VERSION,
  BUZZ_AGENT_CREDENTIAL_ENV_KEYS,
  BUZZ_AGENT_ENVIRONMENT_KEYS,
  BUZZ_AGENT_TESTED_RELEASE,
} from './acp-stdio-adapter.js';

const ALL_PLATFORMS: HarnessSupportProfile['platforms'] = ['darwin', 'linux', 'win32'];
const INVALIDATION_KEYS: HarnessSupportProfile['compatibility']['invalidateOn'] = [
  'provider-version',
  'provider-build',
  'configuration-digest',
  'probe-revision',
];
const PROCESS_ENVIRONMENT_ALLOWLIST = [
  'CI',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'NO_COLOR',
  'PATH',
  'SHELL',
  'SSL_CERT_FILE',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'VK_API_URL',
];

interface ProfileDefinition {
  id: string;
  displayName: string;
  adapterId?: string;
  transport: HarnessTransport;
  auth:
    | { kind: 'command'; commandArgs: string[] }
    | { kind: 'environment'; environmentKeys: string[] }
    | { kind: 'provider-managed' }
    | { kind: 'none' };
  environmentAllowlist?: string[];
  credentialAllowlist?: string[];
  versionArgs?: string[];
  testedVersions?: string[];
  documentationUrl: string;
  remediation: string[];
}

interface RedactedLaunchArgs {
  args: string[];
  containsCredentialMaterial: boolean;
}

interface RedactedCommand {
  command: string;
  containsCredentialMaterial: boolean;
}

const DEFINITIONS: Record<string, ProfileDefinition> = {
  'buzz-agent': {
    id: 'buzz-agent',
    displayName: 'Buzz Agent',
    adapterId: 'acp-stdio',
    transport: 'acp',
    auth: {
      kind: 'environment',
      environmentKeys: [...BUZZ_AGENT_CREDENTIAL_ENV_KEYS],
    },
    environmentAllowlist: [...BUZZ_AGENT_ENVIRONMENT_KEYS],
    credentialAllowlist: [...BUZZ_AGENT_CREDENTIAL_ENV_KEYS],
    versionArgs: [],
    testedVersions: [`buzz-agent ${BUZZ_AGENT_ACP_VERSION}`],
    documentationUrl: '/docs/AGENT-PROVIDERS.md#buzz-agent-acp',
    remediation: [
      `Install buzz-agent from Buzz ${BUZZ_AGENT_TESTED_RELEASE}; Veritas does not install Buzz or Rust.`,
      'Set BUZZ_AGENT_PROVIDER and the matching model and authentication environment keys, then run `vk doctor`.',
      'Do not configure buzz-acp here; it is the inverse relay-side ACP client.',
    ],
  },
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    adapterId: 'claude-code',
    transport: 'process-jsonl',
    auth: { kind: 'command', commandArgs: ['auth', 'status'] },
    environmentAllowlist: [...CLAUDE_CODE_ENVIRONMENT_KEYS],
    credentialAllowlist: [...CLAUDE_CODE_CREDENTIAL_ENV_KEYS],
    testedVersions: [CLAUDE_CODE_CERTIFIED_VERSION],
    documentationUrl: '/docs/AGENT-PROVIDERS.md#claude-code-v21218',
    remediation: [
      'Install Claude Code v2.1.218 and run `claude auth status`.',
      'Configure explicit bare-mode authentication such as ANTHROPIC_API_KEY, then run `vk doctor`.',
    ],
  },
  amp: unsupported('amp', 'Amp', 'process-text', 'No executable Amp adapter is registered.'),
  copilot: unsupported(
    'github-copilot-cli',
    'GitHub Copilot CLI',
    'acp',
    'The GitHub Copilot CLI ACP adapter is tracked by issue #917.'
  ),
  gemini: unsupported(
    'gemini-cli',
    'Gemini CLI',
    'process-text',
    'No executable Gemini CLI adapter is registered.'
  ),
  codex: executable(
    'openai-codex-cli',
    'OpenAI Codex CLI',
    'codex-cli',
    'process-jsonl',
    ['login', 'status'],
    ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    ['CODEX_HOME', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT']
  ),
  'codex-sdk': executable(
    'openai-codex-sdk',
    'OpenAI Codex SDK',
    'codex-sdk',
    'sdk',
    ['login', 'status'],
    ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    ['CODEX_HOME', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT']
  ),
  'codex-app-server': {
    id: 'openai-codex-app-server',
    displayName: 'OpenAI Codex app-server',
    adapterId: 'codex-app-server',
    transport: 'app-server',
    auth: { kind: 'command', commandArgs: ['login', 'status'] },
    environmentAllowlist: [
      'CODEX_HOME',
      'OPENAI_BASE_URL',
      'OPENAI_ORG_ID',
      'OPENAI_ORGANIZATION',
      'OPENAI_PROJECT',
    ],
    credentialAllowlist: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    testedVersions: [CODEX_APP_SERVER_CERTIFIED_VERSION],
    documentationUrl: '/docs/AGENT-PROVIDERS.md#openai-codex-app-server-v01450',
    remediation: [
      'Install Codex CLI v0.145.0 and run `codex login status`.',
      'Remove custom app-server arguments; Veritas owns the strict stdio launch contract.',
    ],
  },
  'codex-cloud': unsupported(
    'openai-codex-cloud',
    'OpenAI Codex Cloud',
    'unsupported',
    'Codex Cloud is configurable but has no task execution adapter.'
  ),
  hermes: executable(
    'hermes-cli',
    'Hermes Agent',
    'hermes-cli',
    'process-text',
    [],
    ['HERMES_API_KEY', 'ANTHROPIC_API_KEY'],
    ['HERMES_CONFIG_DIR']
  ),
  'ollama-local': unsupported(
    'ollama-local',
    'Ollama Local',
    'unsupported',
    'Ollama Local is configurable but has no task execution adapter.'
  ),
  'ollama-cloud': unsupported(
    'ollama-cloud',
    'Ollama Cloud',
    'unsupported',
    'Ollama Cloud is configurable but has no task execution adapter.'
  ),
  'lm-studio-local': unsupported(
    'lm-studio-local',
    'LM Studio Local',
    'unsupported',
    'LM Studio Local is configurable but has no task execution adapter.'
  ),
};

const PROVIDER_DEFINITIONS: Record<string, ProfileDefinition> = {
  openclaw: executable(
    'openclaw',
    'OpenClaw',
    'openclaw',
    'http-tools',
    [],
    ['CLAWDBOT_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_TOKEN'],
    [
      'CLAWDBOT_GATEWAY',
      'CLAWDBOT_GATEWAY_URL',
      'OPENCLAW_GATEWAY_ALLOW_PRIVATE',
      'OPENCLAW_GATEWAY_SESSION_KEY',
      'OPENCLAW_GATEWAY_URL',
      'OPENCLAW_GATEWAY_VERSION',
    ]
  ),
  'codex-cli': DEFINITIONS.codex,
  'codex-sdk': DEFINITIONS['codex-sdk'],
  'codex-app-server': DEFINITIONS['codex-app-server'],
  'claude-code': DEFINITIONS['claude-code'],
  'acp-stdio': executable('acp-stdio', 'ACP stdio agent', 'acp-stdio', 'acp', [], [], []),
  'hermes-cli': DEFINITIONS.hermes,
};

export function normalizeHarnessSupportProfile(agent: AgentConfig): HarnessSupportProfile {
  const definition =
    DEFINITIONS[agent.type] ??
    (agent.provider ? PROVIDER_DEFINITIONS[agent.provider] : undefined) ??
    unsupported(
      `custom:${agent.type}`,
      agent.name,
      'unsupported',
      'No executable provider adapter is registered for this agent profile.'
    );

  const executableProfile = Boolean(definition.adapterId);
  const redactedCommand = redactCommand(agent.command);
  const redactedLaunchArgs = redactLaunchArgs(agent.args);
  const unsafeLaunchConfiguration =
    redactedCommand.containsCredentialMaterial || redactedLaunchArgs.containsCredentialMaterial;
  let providerLaunchError: string | undefined;
  let normalizedProviderArgs = redactedLaunchArgs.args;
  if (definition.adapterId === 'claude-code' && !unsafeLaunchConfiguration) {
    try {
      normalizedProviderArgs = buildClaudeCodeArgs({
        prompt: '<prompt>',
        model: agent.model,
        extraArgs: agent.args,
        sandboxMode: 'workspace-write',
        networkAccessEnabled: true,
      }).slice(0, -1);
    } catch (error) {
      providerLaunchError =
        error instanceof Error ? error.message : 'Claude Code launch configuration is unsafe.';
    }
  }
  if (definition.adapterId === 'codex-app-server' && !unsafeLaunchConfiguration) {
    try {
      normalizedProviderArgs = buildCodexAppServerArgs(agent.args);
    } catch (error) {
      providerLaunchError =
        error instanceof Error ? error.message : 'Codex app-server launch configuration is unsafe.';
    }
  }
  const executable = {
    command: redactedCommand.command,
    versionArgs: definition.versionArgs ?? ['--version'],
  };
  const authentication = {
    ...definition.auth,
    nonMutating: true as const,
  };
  const launch = {
    args: normalizedProviderArgs,
    workingDirectory: 'task-worktree' as const,
    worktree: 'required' as const,
    environmentAllowlist: [
      ...(definition.transport === 'process-jsonl' ||
      definition.transport === 'process-text' ||
      definition.transport === 'sdk' ||
      definition.transport === 'app-server' ||
      definition.transport === 'acp'
        ? PROCESS_ENVIRONMENT_ALLOWLIST
        : []),
      ...(definition.environmentAllowlist ?? []),
    ],
    credentialAllowlist: [...(definition.credentialAllowlist ?? [])],
  };
  const configurationDigest = digestConfiguration({
    profileId: definition.id,
    adapterId: definition.adapterId,
    transport: definition.transport,
    executable,
    authentication,
    platforms: ALL_PLATFORMS,
    launch,
  });
  const unsafeConfigurationReason =
    'Credential material is not allowed in harness launch commands or arguments.';
  const unsafeConfigurationRemediation =
    'Remove credential values from launch arguments and use an allowlisted environment key or run-scoped credential reference.';

  return {
    schemaVersion: HARNESS_SUPPORT_PROFILE_SCHEMA_VERSION,
    id: definition.id,
    displayName: definition.displayName,
    ...(definition.adapterId ? { adapterId: definition.adapterId } : {}),
    transport: definition.transport,
    supportTier: !executableProfile
      ? 'unsupported'
      : unsafeLaunchConfiguration || providerLaunchError
        ? 'degraded'
        : 'configured',
    supportReason: !executableProfile
      ? (definition.remediation[0] ?? 'No executable adapter is registered.')
      : unsafeLaunchConfiguration || providerLaunchError
        ? (providerLaunchError ?? unsafeConfigurationReason)
        : 'An explicit executable adapter is registered; live readiness requires a runtime probe.',
    executable,
    authentication,
    compatibility: {
      policy:
        'When testedVersions is populated, require an exact provider-version match; always invalidate certification on runtime drift.',
      testedVersions: [...(definition.testedVersions ?? [])],
      invalidateOn: [...INVALIDATION_KEYS],
      configurationDigest,
    },
    platforms: [...ALL_PLATFORMS],
    launch,
    conformance: {
      fixtureSet: `${definition.id}/v1`,
      status: 'not-run',
    },
    documentationUrl: definition.documentationUrl,
    remediation: [
      ...(unsafeLaunchConfiguration ? [unsafeConfigurationRemediation] : []),
      ...(providerLaunchError
        ? ['Remove ungoverned Claude Code launch flags and use Veritas policy fields instead.']
        : []),
      ...definition.remediation,
    ],
  };
}

function redactCommand(command: string): RedactedCommand {
  const containsDiagnosticSecret = containsUnredactedProviderRuntimeSecret(command);
  const sanitized = containsDiagnosticSecret ? sanitizeProviderRuntimeDiagnostic(command) : command;
  const redacted = redactLaunchArgs(sanitized.trim().split(/\s+/));
  return containsDiagnosticSecret || redacted.containsCredentialMaterial
    ? {
        command: redacted.args.join(' '),
        containsCredentialMaterial: true,
      }
    : {
        command,
        containsCredentialMaterial: false,
      };
}

function redactLaunchArgs(args: string[]): RedactedLaunchArgs {
  const redacted: string[] = [];
  let redactNext = false;
  let containsCredentialMaterial = false;

  for (const arg of args) {
    if (redactNext) {
      redacted.push('[REDACTED]');
      redactNext = false;
      containsCredentialMaterial = true;
      continue;
    }

    const normalized = arg.trim();
    const credentialArgument = normalized.match(
      /^(--?(?:api[-_]?key|access[-_]?token|auth[-_]?token|token|secret|password|authorization|credentials?))(?:=(.*))?$/i
    );
    if (credentialArgument) {
      const [, flag, inlineValue] = credentialArgument;
      redacted.push(inlineValue === undefined ? flag : `${flag}=[REDACTED]`);
      redactNext = inlineValue === undefined;
      containsCredentialMaterial = true;
      continue;
    }

    if (containsUnredactedProviderRuntimeSecret(arg)) {
      redacted.push(sanitizeProviderRuntimeDiagnostic(arg));
      containsCredentialMaterial = true;
      continue;
    }

    redacted.push(arg);
  }

  return { args: redacted, containsCredentialMaterial };
}

function digestConfiguration(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function executable(
  id: string,
  displayName: string,
  adapterId: string,
  transport: HarnessTransport,
  commandArgs: string[],
  credentialAllowlist: string[],
  environmentAllowlist: string[] = []
): ProfileDefinition {
  return {
    id,
    displayName,
    adapterId,
    transport,
    auth: commandArgs.length
      ? { kind: 'command', commandArgs }
      : credentialAllowlist.length
        ? { kind: 'environment', environmentKeys: credentialAllowlist }
        : { kind: 'provider-managed' },
    credentialAllowlist,
    environmentAllowlist,
    documentationUrl: '/docs/AGENT-PROVIDERS.md',
    remediation: ['Run `vk doctor` and resolve the reported harness readiness checks.'],
  };
}

function unsupported(
  id: string,
  displayName: string,
  transport: HarnessTransport,
  reason: string
): ProfileDefinition {
  return {
    id,
    displayName,
    transport,
    auth: { kind: 'none' },
    documentationUrl: '/docs/AGENT-PROVIDERS.md#support-tiers',
    remediation: [reason],
  };
}
