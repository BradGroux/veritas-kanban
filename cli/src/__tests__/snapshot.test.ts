import { describe, expect, it, vi } from 'vitest';
import { buildRuntimeSnapshot, formatRuntimeSnapshotMarkdown } from '../commands/snapshot.js';

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function snapshotFetch(routes: Record<string, Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const response = routes[`${url.pathname}${url.search}`] ?? routes[url.pathname];
    if (!response) {
      return jsonResponse({ error: `No fixture for ${url.pathname}` }, 404);
    }
    return response.clone();
  }) as unknown as typeof fetch;
}

const baseRoutes: Record<string, Response> = {
  '/api/health': jsonResponse({ ok: true, version: '4.3.2', uptimeMs: 1000 }),
  '/api/config/repos': jsonResponse([
    {
      name: 'veritas-kanban',
      path: '/Users/bradgroux/Projects/veritas-kanban',
      defaultBranch: 'main',
    },
  ]),
  '/api/projects': jsonResponse([
    { id: 'vk', label: 'Veritas Kanban', isHidden: false },
    { id: 'ops', label: 'Ops', isHidden: true },
  ]),
  '/api/sprints': jsonResponse([{ id: 'v5', label: 'v5 GA', isHidden: false }]),
  '/api/config/agents': jsonResponse([
    {
      type: 'codex',
      name: 'Codex',
      command: '/Users/bradgroux/.local/bin/codex --api-key sk-testsecret1234567890',
      enabled: true,
      provider: 'openai',
      model: 'gpt-5',
    },
    {
      type: 'hermes',
      name: 'Hermes',
      command: 'hermes',
      enabled: false,
      provider: 'hermes',
      model: 'planner',
    },
  ]),
  '/api/agent/status': jsonResponse({
    status: 'working',
    activeTask: 'task-1',
    activeTaskTitle: 'Do not export active task title',
    subAgentCount: 1,
    activeAgents: [
      {
        agent: 'codex',
        status: 'working',
        taskId: 'task-1',
        taskTitle: 'Do not export active agent title',
        startedAt: '2026-06-04T08:00:00.000Z',
      },
      {
        agent: 'reviewer',
        status: 'thinking',
        taskId: 'task-2',
        taskTitle: 'Do not export reviewer title',
        startedAt: '2026-06-04T08:01:00.000Z',
      },
    ],
    lastUpdated: '2026-06-04T08:02:00.000Z',
  }),
  '/api/agents/routing': jsonResponse({
    enabled: true,
    defaultAgent: 'codex',
    defaultModel: 'gpt-5',
    fallbackOnFailure: true,
    rules: [
      {
        id: 'rule-codex',
        name: 'Codex default',
        agent: 'codex',
        model: 'gpt-5',
        fallback: 'hermes',
        enabled: true,
      },
    ],
  }),
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
      openclawGatewayUrl: 'http://127.0.0.1:18789/gateway/private-path',
    },
  }),
  '/api/prompt-registry': jsonResponse([
    { id: 'build_plan', name: 'Build Plan', category: 'planning', version: 3 },
  ]),
  '/api/tasks?view=summary': jsonResponse(
    [
      {
        id: 'task-1',
        status: 'todo',
        priority: 'high',
        type: 'feature',
        title: 'Do not export this title',
        description: 'Contains sk-testsecret1234567890 and vk_private1234567890',
      },
      { id: 'task-2', status: 'todo', priority: 'low', type: 'bug' },
      { id: 'task-3', status: 'done', priority: 'high', type: 'feature' },
    ],
    200,
    { 'x-veritas-task-identity-conflicts': '2' }
  ),
  '/api/maintenance/summary': jsonResponse({
    mode: 'local',
    storageMode: 'sqlite',
    health: [
      {
        id: 'storage',
        state: 'fail',
        detail: 'Path /Users/bradgroux/Projects/veritas-kanban/server/storage failed',
      },
      { id: 'logs', state: 'warn', detail: 'Token sk-testsecret1234567890 was redacted' },
    ],
    logs: [{ id: 'server', exists: true, redacted: true }],
  }),
};

describe('vk snapshot', () => {
  it('builds a redacted runtime snapshot with core support sections', async () => {
    const snapshot = await buildRuntimeSnapshot(
      {
        apiBase: 'http://vk.test',
        timeoutMs: 1000,
      },
      {
        fetch: snapshotFetch(baseRoutes),
        env: {},
        now: () => new Date('2026-06-04T08:00:00.000Z'),
        gitSha: async () => 'abc1234',
        cliVersion: async () => '4.3.2',
      }
    );

    expect(snapshot.redacted).toBe(true);
    expect(snapshot.app).toMatchObject({
      cliVersion: '4.3.2',
      serverVersion: '4.3.2',
      gitSha: 'abc1234',
      apiBase: 'http://vk.test',
      apiReachable: true,
    });
    expect(snapshot.projects.repos[0]).toMatchObject({
      name: 'veritas-kanban',
      path: '[redacted path]',
      defaultBranch: 'main',
    });
    expect(snapshot.agents).toMatchObject({ total: 2, enabled: 1 });
    expect(snapshot.agents.status).toMatchObject({
      state: 'working',
      subAgentCount: 1,
      activeAgents: 2,
      activeAgentsByStatus: { working: 1, thinking: 1 },
      activeTaskPresent: true,
      lastUpdated: '2026-06-04T08:02:00.000Z',
    });
    expect(snapshot.routing).toMatchObject({
      enabled: true,
      defaultAgent: 'codex',
      defaultModel: 'gpt-5',
      fallbackOnFailure: true,
      ruleCount: 1,
    });
    expect(snapshot.prompts.count).toBe(1);
    expect(snapshot.tasks).toMatchObject({
      total: 3,
      byStatus: { todo: 2, done: 1 },
      byPriority: { high: 2, low: 1 },
      byType: { feature: 2, bug: 1 },
      duplicateIdentityConflicts: 2,
    });
    expect(snapshot.notifications).toMatchObject({
      notificationsEnabled: true,
      notificationWebhookConfigured: true,
      squadWebhookEnabled: true,
      squadWebhookMode: 'openclaw',
      squadWebhookDestinationConfigured: true,
      lifecycleHooksEnabled: true,
      lifecycleHookActions: 1,
    });
    expect(snapshot.health.failingChecks).toHaveLength(1);
    expect(snapshot.health.warningChecks).toHaveLength(1);
    expect(snapshot.accessIssues).toEqual([]);
  });

  it('does not leak task content, local paths, tokens, or webhook URLs', async () => {
    const snapshot = await buildRuntimeSnapshot(
      {
        apiBase: 'https://vk.example.test/api/private-token?key=secret-token',
        timeoutMs: 1000,
      },
      {
        fetch: snapshotFetch(baseRoutes),
        env: { VK_API_KEY: 'vk_private1234567890' },
        now: () => new Date('2026-06-04T08:00:00.000Z'),
        gitSha: async () => 'abc1234',
        cliVersion: async () => '4.3.2',
      }
    );

    const serialized = JSON.stringify(snapshot);

    expect(snapshot.app.apiBase).toBe('https://vk.example.test');
    expect(serialized).not.toContain('/Users/bradgroux');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('sk-testsecret1234567890');
    expect(serialized).not.toContain('vk_private1234567890');
    expect(serialized).not.toContain('Do not export this title');
    expect(serialized).not.toContain('Do not export active task title');
    expect(serialized).not.toContain('Do not export active agent title');
    expect(serialized).not.toContain('Contains sk-');
    expect(serialized).not.toContain('https://hooks.example.test/path');
    expect(serialized).toContain('[redacted-local-path]');
    expect(serialized).toContain('sk-[REDACTED]');
  });

  it('records partial API failures as sanitized access issues', async () => {
    const routes = {
      ...baseRoutes,
      '/api/maintenance/summary': jsonResponse(
        {
          error: {
            message:
              'Failed at https://hooks.example.test/path/private-token for /Users/bradgroux/app',
          },
        },
        500
      ),
    };

    const snapshot = await buildRuntimeSnapshot(
      {
        apiBase: 'http://vk.test',
        timeoutMs: 1000,
      },
      {
        fetch: snapshotFetch(routes),
        env: {},
        now: () => new Date('2026-06-04T08:00:00.000Z'),
        gitSha: async () => null,
        cliVersion: async () => '4.3.2',
      }
    );

    expect(snapshot.health.maintenanceAvailable).toBe(false);
    expect(snapshot.accessIssues).toEqual([
      {
        section: 'maintenance',
        status: 500,
        error: 'Failed at https://hooks.example.test/[redacted] for [redacted-local-path]',
      },
    ]);
  });

  it('formats a paste-ready markdown snapshot', async () => {
    const snapshot = await buildRuntimeSnapshot(
      { apiBase: 'http://vk.test', timeoutMs: 1000 },
      {
        fetch: snapshotFetch(baseRoutes),
        env: {},
        now: () => new Date('2026-06-04T08:00:00.000Z'),
        gitSha: async () => 'abc1234',
        cliVersion: async () => '4.3.2',
      }
    );

    const markdown = formatRuntimeSnapshotMarkdown(snapshot);

    expect(markdown).toContain('# Veritas Runtime Snapshot');
    expect(markdown).toContain('- CLI version: 4.3.2');
    expect(markdown).toContain('- Total: 3');
    expect(markdown).toContain('- Global status: working');
    expect(markdown).toContain('- Runtime templates: 1');
    expect(markdown).not.toContain('/Users/bradgroux');
    expect(markdown).not.toContain('secret-token');
  });
});
