import type { ClientAuthContext } from '@veritas-kanban/shared';

const LOCAL_AGENT_CAPABILITIES = new Set([
  'desktop:local',
  'agent:run:local',
  'agent:run:unrestricted',
  'local-agent:run',
]);

const LOCAL_CLIENT_MODES = new Set(['desktop-local', 'cli']);

export function clientAllowsLocalAgentControls(authContext: ClientAuthContext | null): boolean {
  if (!authContext) return true;
  if (authContext.authMethod === 'localhost-bypass') return true;
  if (authContext.isLocalhost) return true;

  const capabilities = authContext.capabilities ?? [];
  if (capabilities.some((capability) => LOCAL_AGENT_CAPABILITIES.has(capability))) {
    return true;
  }

  if (!authContext.clientMode) return false;
  return LOCAL_CLIENT_MODES.has(authContext.clientMode);
}

export function describeLocalAgentRestriction(authContext: ClientAuthContext | null): string {
  const mode = authContext?.clientMode ?? 'remote';
  return `Local agent controls are disabled for this ${mode} session. Use a local desktop session or an explicitly allowed device capability to start or stop local agents.`;
}
