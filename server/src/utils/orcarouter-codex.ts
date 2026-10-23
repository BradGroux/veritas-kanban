import type { AgentConfig } from '@veritas-kanban/shared';

export const ORCAROUTER_CODEX_AGENT_TYPE = 'orcarouter-codex';
export const ORCAROUTER_CODEX_PROFILE_ID = 'orcarouter-codex-cli';
export const ORCAROUTER_CODEX_VERSION = 'codex-cli 0.155.1';
export const ORCAROUTER_BASE_URL = 'https://api.orcarouter.ai/v1';
export const ORCAROUTER_CREDENTIAL_ENV_KEY = 'ORCAROUTER_API_KEY';

export function isOrcaRouterCodexAgent(agent: AgentConfig | undefined): boolean {
  return agent?.type === ORCAROUTER_CODEX_AGENT_TYPE;
}

/** Build only non-secret, system-owned provider configuration for the pinned CLI. */
export function buildOrcaRouterCodexArgs(agent: AgentConfig): string[] {
  if (agent.provider !== 'codex-cli') {
    throw new Error('OrcaRouter requires the codex-cli provider.');
  }
  if (
    !agent.model ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(agent.model)
  ) {
    throw new Error('OrcaRouter requires an explicit provider/model identifier.');
  }
  if (agent.args.length > 1 || (agent.args.length === 1 && agent.args[0] !== 'exec')) {
    throw new Error('OrcaRouter owns its Codex arguments; configure args as ["exec"].');
  }
  const provider = 'model_providers.veritas_orcarouter';
  return [
    'exec',
    '--model',
    agent.model,
    '-c',
    'model_provider="veritas_orcarouter"',
    '-c',
    `${provider}.name="OrcaRouter"`,
    '-c',
    `${provider}.base_url=${JSON.stringify(ORCAROUTER_BASE_URL)}`,
    '-c',
    `${provider}.env_key=${JSON.stringify(ORCAROUTER_CREDENTIAL_ENV_KEY)}`,
    '-c',
    `${provider}.wire_api="responses"`,
    '-c',
    `${provider}.requires_openai_auth=false`,
    '-c',
    `${provider}.supports_websockets=false`,
    '-c',
    `${provider}.stream_max_retries=0`,
  ];
}
