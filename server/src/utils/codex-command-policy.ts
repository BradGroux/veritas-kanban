const DEFAULT_CODEX_COMMAND = 'codex';
const CODEX_EXECUTABLE_ENV_KEYS = ['VERITAS_CODEX_EXECUTABLE', 'CODEX_PATH'] as const;
const UNSAFE_OVERRIDE_ENV = 'VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES';
const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

export interface CodexAgentMarker {
  id?: string;
  agentId?: string;
  name?: string;
  role?: string;
  provider?: string;
  command?: string;
}

export interface CodexCommandPolicyEvaluation {
  allowed: boolean;
  command?: string;
  codexPathOverride?: string;
  reason?: string;
  configuredCommands: string[];
  unsafeOverridesEnabled: boolean;
}

export function isCodexWorkflowAgent(agent: CodexAgentMarker | null | undefined): boolean {
  if (!agent) return false;
  const marker = [agent.provider, agent.id, agent.agentId, agent.name, agent.role, agent.command]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return marker.includes('codex');
}

export function configuredCodexExecutableCommands(env: NodeJS.ProcessEnv = process.env): string[] {
  return CODEX_EXECUTABLE_ENV_KEYS.map((key) => env[key]?.trim()).filter((value): value is string =>
    Boolean(value)
  );
}

export function unsafeCodexCommandOverridesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY_ENV_VALUES.has((env[UNSAFE_OVERRIDE_ENV] ?? '').trim().toLowerCase());
}

export function evaluateCodexCommandPolicy(
  command: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): CodexCommandPolicyEvaluation {
  const normalized = command?.trim();
  const configuredCommands = configuredCodexExecutableCommands(env);
  const unsafeOverridesEnabled = unsafeCodexCommandOverridesEnabled(env);

  if (!normalized || normalized === DEFAULT_CODEX_COMMAND) {
    return {
      allowed: true,
      command: normalized,
      configuredCommands,
      unsafeOverridesEnabled,
    };
  }

  if (unsafeOverridesEnabled || configuredCommands.includes(normalized)) {
    return {
      allowed: true,
      command: normalized,
      codexPathOverride: normalized,
      configuredCommands,
      unsafeOverridesEnabled,
    };
  }

  return {
    allowed: false,
    command: normalized,
    configuredCommands,
    unsafeOverridesEnabled,
    reason:
      'Codex command overrides must be "codex", match VERITAS_CODEX_EXECUTABLE/CODEX_PATH, or be explicitly enabled with VERITAS_ALLOW_UNSAFE_CODEX_COMMAND_OVERRIDES=1.',
  };
}

export function assertAllowedCodexCommandOverride(
  command: string | undefined,
  subject: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const evaluation = evaluateCodexCommandPolicy(command, env);
  if (!evaluation.allowed) {
    throw new Error(`${subject}: ${evaluation.reason}`);
  }
  return evaluation.codexPathOverride;
}
