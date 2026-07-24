import { describe, expect, it, vi } from 'vitest';
import { formatDoctorReport, runDoctorChecks } from '../commands/doctor.js';

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function doctorFetch(routes: Record<string, Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const response = routes[`${url.pathname}${url.search}`] ?? routes[url.pathname];
    if (!response) {
      return jsonResponse({ error: `No fixture for ${url.pathname}` }, 404);
    }
    return response.clone();
  }) as unknown as typeof fetch;
}

function compatibilityResponse(supportStatuses: unknown[]): Response {
  return jsonResponse({
    schemaVersion: 'harness-compatibility-matrix/v1',
    generatedAt: '2026-06-04T07:00:00.000Z',
    probeRevision: 14,
    digest: 'a'.repeat(64),
    tierDefinitions: {},
    records: [
      {
        profileId: 'openai-codex-app-server',
        testedVersions: ['codex-cli 0.145.0'],
        sourceAvailability: 'open-source',
        certification: { status: 'not-run' },
      },
    ],
    supportStatuses,
  });
}

const baseRoutes: Record<string, Response> = {
  '/api/health': jsonResponse({ ok: true, version: '4.3.2', uptimeMs: 1000 }),
  '/api/auth/context': jsonResponse({
    role: 'admin',
    authMethod: 'localhost-bypass',
    isLocalhost: true,
    permissions: ['*'],
  }),
  '/api/tasks?view=summary&limit=1': jsonResponse([]),
  '/api/config/agents': jsonResponse([
    {
      type: 'codex',
      name: 'Codex',
      command: 'codex',
      enabled: true,
      provider: 'codex-cli',
    },
  ]),
  '/api/config/harness-compatibility': compatibilityResponse([
    {
      agentType: 'codex',
      profileId: 'openai-codex-cli',
      adapterId: 'codex-cli',
      transport: 'process-jsonl',
      supportTier: 'configured',
      reason: 'Certification evidence is not current.',
      failureClass: 'none',
      checkedAt: '2026-06-04T07:00:00.000Z',
      enabled: true,
      executableFound: true,
      authenticated: true,
      diagnosticCommands: ['codex --version', 'codex login status'],
      remediation: ['Run vk doctor.'],
    },
  ]),
  '/api/agents/routing': jsonResponse({
    enabled: true,
    defaultAgent: 'codex',
    fallbackOnFailure: true,
    rules: [],
  }),
  '/api/settings/features': jsonResponse({
    notifications: { enabled: false },
    hooks: { enabled: false },
    squadWebhook: { enabled: false },
  }),
  '/api/prompt-registry': jsonResponse([{ id: 'prompt_one' }]),
  '/api/settings/codex/health': jsonResponse({
    ready: { overall: true, cli: true, sdk: false, cloud: false },
    cli: { installed: true, authenticated: true },
    recommendations: [],
  }),
  '/api/integrations/communication/adapters/buzz-default/health': jsonResponse(
    { error: 'not found' },
    404
  ),
};

describe('vk doctor', () => {
  it('returns a clean report when core setup checks pass', async () => {
    const report = await runDoctorChecks(
      {
        apiBase: 'http://vk.test',
        cwd: '/repo',
        timeoutMs: 1000,
      },
      {
        fetch: doctorFetch(baseRoutes),
        env: {},
        findProjectRoot: async () => '/repo',
        countPromptTemplateFiles: async () => 1,
        resolveCommand: async (command) =>
          command === 'vk' ? '/repo/cli/dist/index.js' : `/usr/bin/${command}`,
        now: () => new Date('2026-06-04T07:00:00.000Z'),
      }
    );

    expect(report.ok).toBe(true);
    expect(report.summary.fail).toBe(0);
    expect(report.checks.find((check) => check.id === 'agents')).toMatchObject({
      status: 'pass',
    });
    expect(report.checks.find((check) => check.id === 'harness-support')).toMatchObject({
      status: 'warn',
      details: expect.objectContaining({
        configured: 1,
      }),
    });
    expect(formatDoctorReport(report)).toContain('Doctor result: clean');
  });

  it('fails for duplicate task IDs and missing enabled agent executables', async () => {
    const routes = {
      ...baseRoutes,
      '/api/tasks?view=summary&limit=1': jsonResponse([], 200, {
        'x-veritas-task-identity-conflicts': '2',
      }),
      '/api/config/agents': jsonResponse([
        {
          type: 'missing-agent',
          name: 'Missing Agent',
          command: 'missing-agent',
          enabled: true,
        },
      ]),
      '/api/agents/routing': jsonResponse({
        enabled: true,
        defaultAgent: 'missing-agent',
        fallbackOnFailure: true,
        rules: [],
      }),
    };

    const report = await runDoctorChecks(
      { apiBase: 'http://vk.test', cwd: '/repo', timeoutMs: 1000 },
      {
        fetch: doctorFetch(routes),
        env: {},
        findProjectRoot: async () => '/repo',
        countPromptTemplateFiles: async () => 0,
        resolveCommand: async (command) => (command === 'vk' ? '/repo/cli/dist/index.js' : null),
        now: () => new Date('2026-06-04T07:00:00.000Z'),
      }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'tasks')).toMatchObject({
      status: 'fail',
    });
    expect(report.checks.find((check) => check.id === 'agents')).toMatchObject({
      status: 'fail',
    });
  });

  it('fails closed for an enabled unsupported harness and preserves safe remediation', async () => {
    const routes = {
      ...baseRoutes,
      '/api/config/harness-compatibility': compatibilityResponse([
        {
          agentType: 'claude-code',
          profileId: 'claude-code',
          transport: 'process-jsonl',
          supportTier: 'unsupported',
          reason: 'No executable adapter is registered.',
          failureClass: 'adapter-unavailable',
          checkedAt: '2026-06-04T07:00:00.000Z',
          enabled: true,
          executableFound: true,
          authenticated: true,
          diagnosticCommands: ['claude --version'],
          remediation: ['Disable this profile or install a supported adapter.'],
        },
      ]),
    };

    const report = await runDoctorChecks(
      { apiBase: 'http://vk.test', cwd: '/repo', timeoutMs: 1000 },
      {
        fetch: doctorFetch(routes),
        env: {},
        findProjectRoot: async () => '/repo',
        countPromptTemplateFiles: async () => 1,
        resolveCommand: async (command) =>
          command === 'vk' ? '/repo/cli/dist/index.js' : `/usr/bin/${command}`,
        now: () => new Date('2026-06-04T07:00:00.000Z'),
      }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'harness-support')).toMatchObject({
      status: 'fail',
      details: {
        blocking: [
          expect.objectContaining({
            profileId: 'claude-code',
            diagnosticCommands: ['claude --version'],
            remediation: ['Disable this profile or install a supported adapter.'],
          }),
        ],
      },
    });
  });

  it('redacts local paths and webhook secrets from support-safe JSON', async () => {
    const routes = {
      ...baseRoutes,
      '/api/settings/features': jsonResponse({
        notifications: {
          enabled: true,
          webhookUrl: 'https://hooks.example.test/path/secret-token',
        },
        hooks: {
          enabled: true,
          onCompleted: {
            enabled: true,
            webhook: 'https://hooks.example.test/hook/private-token',
          },
        },
        squadWebhook: {
          enabled: true,
          mode: 'openclaw',
          openclawGatewayUrl: 'http://127.0.0.1:18789',
        },
      }),
    };

    const report = await runDoctorChecks(
      {
        apiBase: 'http://vk.test',
        cwd: '/Users/bradgroux/Projects/veritas-kanban',
        showPaths: false,
        timeoutMs: 1000,
      },
      {
        fetch: doctorFetch(routes),
        env: {},
        findProjectRoot: async () => '/Users/bradgroux/Projects/veritas-kanban',
        countPromptTemplateFiles: async () => 1,
        resolveCommand: async (command) =>
          command === 'vk'
            ? '/Users/bradgroux/Projects/veritas-kanban/cli/dist/index.js'
            : `/usr/bin/${command}`,
        now: () => new Date('2026-06-04T07:00:00.000Z'),
      }
    );

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('/Users/bradgroux');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('private-token');
    expect(serialized).toContain('[redacted path]');
    expect(report.checks.find((check) => check.id === 'notifications')).toMatchObject({
      status: 'warn',
    });
  });

  it('reports exact Buzz health in human and JSON output', async () => {
    const routes = {
      ...baseRoutes,
      '/api/integrations/communication/adapters/buzz-default/health': jsonResponse({
        adapterId: 'buzz-default',
        status: 'healthy',
        configured: true,
        canSend: false,
        canReceiveReplies: false,
        checkedAt: '2026-07-23T18:00:00.000Z',
        detail:
          'Buzz relay identity, configured signing identity, membership posture, and read capabilities are compatible.',
        reasonCode: 'ok',
        buzz: {
          schemaVersion: 'buzz-compatibility/v1',
          probeRevision: 1,
          testedRelease: '0.4.24',
          testedCommit: '710ed9fff57878a1d69f809b80a6ee0416c53fc4',
          status: 'healthy',
          reasonCode: 'ok',
          detail: 'compatible',
          configuredRelayHttpUrl: 'https://relay.example.test',
          resolvedRelayHttpUrl: 'https://relay.example.test',
          resolvedRelayWebSocketUrl: 'wss://relay.example.test',
          expectedCommunity: 'relay.example.test',
          observedCommunity: 'relay.example.test',
          publicKeyFingerprint: 'abc123abc123',
          checks: {
            relayIdentity: 'verified',
            communityBinding: 'verified',
            configuredIdentity: 'verified',
            authentication: 'verified',
            membership: 'verified',
            channelRead: 'verified',
            messageRead: 'verified',
          },
          commands: [],
          evidenceKey: 'safe-evidence',
          checkedAt: '2026-07-23T18:00:00.000Z',
        },
      }),
    };

    const report = await runDoctorChecks(
      { apiBase: 'http://vk.test', cwd: '/repo', timeoutMs: 1000 },
      {
        fetch: doctorFetch(routes),
        env: {},
        findProjectRoot: async () => '/repo',
        countPromptTemplateFiles: async () => 1,
        resolveCommand: async (command) =>
          command === 'vk' ? '/repo/cli/dist/index.js' : `/usr/bin/${command}`,
        now: () => new Date('2026-07-23T18:00:00.000Z'),
      }
    );

    expect(report.checks.find((check) => check.id === 'buzz')).toMatchObject({
      status: 'pass',
      details: {
        status: 'healthy',
        reasonCode: 'ok',
        expectedCommunity: 'relay.example.test',
        observedCommunity: 'relay.example.test',
        publicKeyFingerprint: 'abc123abc123',
        testedRelease: '0.4.24',
        buzz: {
          checks: {
            channelRead: 'verified',
            messageRead: 'verified',
          },
          evidenceKey: 'safe-evidence',
        },
      },
    });
    expect(formatDoctorReport(report)).toContain('[PASS] Buzz compatibility');
  });

  it('fails doctor for an enabled Buzz membership denial with remediation', async () => {
    const routes = {
      ...baseRoutes,
      '/api/integrations/communication/adapters/buzz-default/health': jsonResponse({
        adapterId: 'buzz-default',
        status: 'not_member',
        configured: true,
        canSend: false,
        canReceiveReplies: false,
        checkedAt: '2026-07-23T18:00:00.000Z',
        detail: 'Buzz authenticated the identity but denied relay membership.',
        reasonCode: 'relay_membership_required',
        remediation: 'Add the public identity as a relay member.',
      }),
    };

    const report = await runDoctorChecks(
      { apiBase: 'http://vk.test', cwd: '/repo', timeoutMs: 1000 },
      {
        fetch: doctorFetch(routes),
        env: {},
        findProjectRoot: async () => '/repo',
        countPromptTemplateFiles: async () => 1,
        resolveCommand: async (command) =>
          command === 'vk' ? '/repo/cli/dist/index.js' : `/usr/bin/${command}`,
        now: () => new Date('2026-07-23T18:00:00.000Z'),
      }
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'buzz')).toMatchObject({
      status: 'fail',
      details: {
        status: 'not_member',
        reasonCode: 'relay_membership_required',
      },
      remediation: 'Add the public identity as a relay member.',
    });
  });
});
