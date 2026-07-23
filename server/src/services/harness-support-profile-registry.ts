import { createHash } from 'node:crypto';
import {
  HARNESS_SUPPORT_PROFILE_SCHEMA_VERSION,
  type AgentConfig,
  type HarnessSupportProfile,
  type HarnessTransport,
} from '@veritas-kanban/shared';

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
  documentationUrl: string;
  remediation: string[];
}

const DEFINITIONS: Record<string, ProfileDefinition> = {
  'claude-code': unsupported(
    'claude-code',
    'Claude Code',
    'process-jsonl',
    'The Claude Code adapter is tracked by issue #916.'
  ),
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
  const executable = {
    command: agent.command,
    versionArgs: ['--version'],
  };
  const authentication = {
    ...definition.auth,
    nonMutating: true as const,
  };
  const launch = {
    args: [...agent.args],
    workingDirectory: 'task-worktree' as const,
    worktree: 'required' as const,
    environmentAllowlist: [
      ...(definition.transport === 'process-jsonl' ||
      definition.transport === 'process-text' ||
      definition.transport === 'sdk'
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

  return {
    schemaVersion: HARNESS_SUPPORT_PROFILE_SCHEMA_VERSION,
    id: definition.id,
    displayName: definition.displayName,
    ...(definition.adapterId ? { adapterId: definition.adapterId } : {}),
    transport: definition.transport,
    supportTier: executableProfile ? 'configured' : 'unsupported',
    supportReason: executableProfile
      ? 'An explicit executable adapter is registered; live readiness requires a runtime probe.'
      : (definition.remediation[0] ?? 'No executable adapter is registered.'),
    executable,
    authentication,
    compatibility: {
      policy:
        'When testedVersions is populated, require an exact provider-version match; always invalidate certification on runtime drift.',
      testedVersions: [],
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
    remediation: [...definition.remediation],
  };
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
