import { describe, expect, it } from 'vitest';
import type { ExecutableAgentProvider, RunToolCatalog } from '@veritas-kanban/shared';
import {
  RUN_TOOL_BRIDGE_ENV_KEY,
  RunToolBridgeService,
  runToolBridgeSupport,
} from '../services/run-tool-bridge-service.js';
import { buildSafeCodexEnv } from '../utils/codex-env.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const HANDLE = `vkbridge_${'h'.repeat(43)}`;

function service(now = new Date('2026-07-24T12:00:00.000Z')) {
  return new RunToolBridgeService({
    now: () => now,
    randomHandle: () => HANDLE,
    ttlMs: 60_000,
    entrypoint: '/opt/veritas/server/runtime/run-tool-bridge.mjs',
    apiUrl: 'http://127.0.0.1:3001',
  });
}

function binding() {
  return {
    taskId: 'task-970',
    attemptId: 'attempt-970',
    catalogDigest: DIGEST,
    runLaunchManifestDigest: `sha256:${'b'.repeat(64)}`,
  };
}

describe('RunToolBridgeService', () => {
  it('binds opaque authority to the exact run evidence and allowed method', () => {
    const bridge = service();
    const launch = bridge.issue(binding());

    expect(bridge.authorize(launch.handle, 'catalog.read', binding())).toMatchObject({
      ...binding(),
      handleId: expect.stringMatching(/^vkbridge_[a-f0-9]{16}$/),
      allowedMethods: ['catalog.read', 'tool.call'],
    });
    expect(() => bridge.authorize(launch.handle, 'tool.call', { taskId: 'task-other' })).toThrow(
      /taskId does not match/
    );
    expect(() =>
      bridge.authorize(launch.handle, 'tool.call', { attemptId: 'attempt-other' })
    ).toThrow(/attemptId does not match/);
    expect(() =>
      bridge.authorize(launch.handle, 'tool.call', {
        catalogDigest: `sha256:${'c'.repeat(64)}`,
      })
    ).toThrow(/catalogDigest does not match/);
  });

  it('rejects revoked, expired, and restart-stale handles', () => {
    const bridge = service();
    const launch = bridge.issue(binding());
    expect(bridge.revokeRun(binding().taskId, binding().attemptId)).toBe(1);
    expect(() => bridge.authorize(launch.handle, 'catalog.read')).toThrow(/stale or revoked/);

    let clock = new Date('2026-07-24T12:00:00.000Z');
    const expiring = new RunToolBridgeService({
      now: () => clock,
      randomHandle: () => `vkbridge_${'e'.repeat(43)}`,
      ttlMs: 1,
      entrypoint: '/opt/veritas/server/runtime/run-tool-bridge.mjs',
      apiUrl: 'https://veritas.example',
    });
    const expiringLaunch = expiring.issue(binding());
    clock = new Date('2026-07-24T12:00:01.000Z');
    expect(() => expiring.authorize(expiringLaunch.handle, 'catalog.read')).toThrow(/expired/);

    const oldLaunch = service().issue(binding());
    expect(() => service().authorize(oldLaunch.handle, 'catalog.read')).toThrow(/stale or revoked/);
  });

  it('uses one value-free bridge contract across Codex, Claude Code, and ACP adapters', () => {
    const bridge = service();
    const launch = bridge.issue(binding());
    const codex = bridge.codexConfig(launch);
    const codexCli = bridge.codexCliOverride(launch);
    const claude = bridge.claudeServer(launch);
    const acp = bridge.acpServer(launch);
    const environment = bridge.launchEnvironment(
      buildSafeCodexEnv({
        OPENAI_API_KEY: 'provider-auth',
        TASK_CREDENTIAL_TOKEN: 'task-credential-sensitive-value',
      }),
      launch
    );
    const serialized = JSON.stringify({ codex, codexCli, claude, acp, environment });

    expect(serialized).toContain(HANDLE);
    expect(serialized).toContain(RUN_TOOL_BRIDGE_ENV_KEY);
    expect(serialized).toContain('/opt/veritas/server/runtime/run-tool-bridge.mjs');
    expect(serialized).toContain('get_run_tool_catalog');
    expect(serialized).toContain('call_run_tool');
    expect(serialized).not.toContain('task-credential-sensitive-value');
    expect(codexCli).not.toContain(HANDLE);
  });

  it('publishes an explicit adapter table and fails closed for unverified injection', () => {
    const expected: Record<ExecutableAgentProvider, boolean> = {
      'codex-cli': true,
      'codex-sdk': true,
      'codex-app-server': true,
      'claude-code': true,
      'acp-stdio': true,
      'hermes-cli': false,
      openclaw: false,
    };

    expect(
      Object.fromEntries(
        Object.keys(expected).map((provider) => [
          provider,
          runToolBridgeSupport(provider as ExecutableAgentProvider).supported,
        ])
      )
    ).toEqual(expected);
  });

  it('detects credential-bound catalogs and rejects insecure remote API URLs', () => {
    const bridge = service();
    const catalog = {
      entries: [{ status: 'ready', credentialBindings: [{ credentialReference: 'ref' }] }],
    } as RunToolCatalog;
    expect(bridge.requiresBridge(catalog)).toBe(true);
    expect(
      () =>
        new RunToolBridgeService({
          apiUrl: 'http://veritas.example',
          entrypoint: '/opt/veritas/server/runtime/run-tool-bridge.mjs',
        })
    ).toThrow(/HTTPS or loopback HTTP/);
  });
});
