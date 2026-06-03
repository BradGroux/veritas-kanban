import { describe, expect, it } from 'vitest';
import type { ClientAuthContext } from '@veritas-kanban/shared';
import { clientAllowsLocalAgentControls } from '@/lib/client-policy';

function authContext(overrides: Partial<ClientAuthContext> = {}): ClientAuthContext {
  return {
    role: 'read-only',
    isLocalhost: false,
    authMethod: 'device-session',
    permissions: ['workspace:read', 'task:read', 'agent:read'],
    ...overrides,
  };
}

describe('clientAllowsLocalAgentControls', () => {
  it('allows legacy local contexts and localhost bypass', () => {
    expect(clientAllowsLocalAgentControls(null)).toBe(true);
    expect(
      clientAllowsLocalAgentControls(
        authContext({ authMethod: 'localhost-bypass', isLocalhost: true })
      )
    ).toBe(true);
    expect(clientAllowsLocalAgentControls(authContext({ isLocalhost: true }))).toBe(true);
  });

  it('allows explicit local capabilities and local client modes', () => {
    expect(clientAllowsLocalAgentControls(authContext({ capabilities: ['local-agent:run'] }))).toBe(
      true
    );
    expect(clientAllowsLocalAgentControls(authContext({ clientMode: 'desktop-local' }))).toBe(true);
    expect(clientAllowsLocalAgentControls(authContext({ clientMode: 'cli' }))).toBe(true);
  });

  it('blocks remote mobile and unknown client modes by default', () => {
    expect(clientAllowsLocalAgentControls(authContext({ clientMode: 'mobile-pwa' }))).toBe(false);
    expect(clientAllowsLocalAgentControls(authContext({ clientMode: 'desktop-remote' }))).toBe(
      false
    );
    expect(clientAllowsLocalAgentControls(authContext())).toBe(false);
  });
});
