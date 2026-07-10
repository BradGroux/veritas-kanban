/**
 * Contract and regression tests for OpenClaw provider adapter.
 *
 * Audited against OpenClaw v2026.6.11 gateway / tool policy contracts.
 *
 * Key invariants tested:
 *   - Preflight detects gateway unreachability before a task is marked active.
 *   - Policy denial (sessions_spawn blocked) surfaces a configuration hint.
 *   - Successful sessions_spawn returns and stores a durable session key.
 *   - Timeout and HTTP errors propagate correctly.
 *
 * @smoke describe blocks require a live OpenClaw v2026.6.11 gateway configured
 *   via OPENCLAW_GATEWAY_URL (and optionally OPENCLAW_GATEWAY_TOKEN).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HttpOpenClawWorkflowAdapter,
  HttpOpenClawTaskAdapter,
} from '../services/openclaw-workflow-adapter.js';
import type {
  OpenClawGatewayPreflightResult,
  OpenClawTaskSpawnInput,
} from '../services/openclaw-workflow-adapter.js';
import { _resetOutboundIntegrationService } from '../services/outbound-integration-service.js';
import type { OutboundIntegrationService } from '../services/outbound-integration-service.js';

// ── Helper to inject a mock delivery function ─────────────────────────────────

function mockDelivery(...responses: Array<Record<string, unknown>>): OutboundIntegrationService {
  const queue = [...responses];
  return {
    deliver: vi.fn().mockImplementation(() => {
      const next = queue.shift();
      return Promise.resolve(next ?? { status: 'error', ok: false, responseStatus: 500 });
    }),
  } as unknown as OutboundIntegrationService;
}

const PREFLIGHT_OK = {
  status: 'success',
  ok: true,
  responseStatus: 200,
  responseText: JSON.stringify({ ok: true, result: { status: 'dry_run_ok' } }),
};

const baseInput: OpenClawTaskSpawnInput = {
  taskId: 'task-abc',
  attemptId: 'attempt-001',
  agentId: 'claude-code',
  agentName: 'ClaudeCode',
  prompt: 'Complete the task',
  timeoutSeconds: 60,
};

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  _resetOutboundIntegrationService();
  vi.restoreAllMocks();
});

// ── Preflight: gateway unreachable ────────────────────────────────────────────

describe('HttpOpenClawWorkflowAdapter.preflight()', () => {
  it('returns reachable: false when outbound delivery is blocked', async () => {
    _resetOutboundIntegrationService(mockDelivery({ status: 'blocked' }));

    const adapter = new HttpOpenClawWorkflowAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result: OpenClawGatewayPreflightResult = await adapter.preflight();

    expect(result.reachable).toBe(false);
    expect(result.sessionsSpawnAllowed).toBe(false);
    expect(result.error).toMatch(/blocked/i);
  });

  it('returns reachable: false on timeout', async () => {
    _resetOutboundIntegrationService(mockDelivery({ status: 'timeout' }));

    const adapter = new HttpOpenClawWorkflowAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result = await adapter.preflight();

    expect(result.reachable).toBe(false);
    expect(result.error).toMatch(/timeout|respond/i);
  });

  it('returns reachable: false when delivery fails before an HTTP response exists', async () => {
    _resetOutboundIntegrationService(
      mockDelivery({ status: 'failed', error: 'connect ECONNREFUSED 127.0.0.1:18789' })
    );

    const adapter = new HttpOpenClawWorkflowAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result = await adapter.preflight();

    expect(result.reachable).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('surfaces policy denial with a configHint when HTTP 403 is returned', async () => {
    _resetOutboundIntegrationService(
      mockDelivery({
        status: 'error',
        ok: false,
        responseStatus: 403,
        responseText: JSON.stringify({ ok: false, message: 'Tool sessions_spawn is not allowed' }),
      })
    );

    const adapter = new HttpOpenClawWorkflowAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result = await adapter.preflight();

    expect(result.reachable).toBe(true);
    expect(result.sessionsSpawnAllowed).toBe(false);
    expect(result.configHint).toBeDefined();
    expect(result.configHint).toMatch(/sessions_spawn/i);
    expect(result.configHint).toMatch(/Tool Policy/i);
  });

  it('surfaces policy denial when gateway returns ok: false at envelope level', async () => {
    _resetOutboundIntegrationService(
      mockDelivery({
        status: 'success',
        ok: false,
        responseStatus: 200,
        responseText: JSON.stringify({ ok: false, error: 'sessions_spawn denied by policy' }),
      })
    );

    const adapter = new HttpOpenClawWorkflowAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result = await adapter.preflight();

    expect(result.sessionsSpawnAllowed).toBe(false);
    expect(result.configHint).toBeDefined();
  });

  it('returns sessionsSpawnAllowed: true when dry_run call succeeds', async () => {
    _resetOutboundIntegrationService(mockDelivery(PREFLIGHT_OK));

    const adapter = new HttpOpenClawWorkflowAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result = await adapter.preflight();

    expect(result.reachable).toBe(true);
    expect(result.sessionsSpawnAllowed).toBe(true);
    expect(result.sessionsSendAllowed).toBe(true);
  });
});

// ── HttpOpenClawTaskAdapter.spawnTask() ───────────────────────────────────────

describe('HttpOpenClawTaskAdapter.spawnTask()', () => {
  it('throws with configHint when preflight shows sessions_spawn is blocked', async () => {
    _resetOutboundIntegrationService(
      mockDelivery({
        status: 'error',
        ok: false,
        responseStatus: 403,
        responseText: JSON.stringify({ ok: false, message: 'sessions_spawn is denied' }),
      })
    );

    const adapter = new HttpOpenClawTaskAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    await expect(adapter.spawnTask(baseInput)).rejects.toThrow(/sessions_spawn/i);
  });

  it('throws when sessions_spawn does not return a session key', async () => {
    _resetOutboundIntegrationService(
      mockDelivery(PREFLIGHT_OK, {
        status: 'success',
        ok: true,
        responseStatus: 200,
        responseText: JSON.stringify({ ok: true, result: {} }),
      })
    );

    const adapter = new HttpOpenClawTaskAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    await expect(adapter.spawnTask(baseInput)).rejects.toThrow(/session key/i);
  });

  it('returns OpenClawTaskSpawnResult with sessionKey on successful dispatch', async () => {
    _resetOutboundIntegrationService(
      mockDelivery(PREFLIGHT_OK, {
        status: 'success',
        ok: true,
        responseStatus: 200,
        responseText: JSON.stringify({
          ok: true,
          result: {
            childSessionKey: 'child-session-xyz',
            runId: 'run-001',
            status: 'accepted',
          },
        }),
      })
    );

    const adapter = new HttpOpenClawTaskAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result = await adapter.spawnTask(baseInput);

    expect(result.sessionKey).toBe('child-session-xyz');
    expect(result.runId).toBe('run-001');
    expect(result.status).toBe('accepted');
  });

  it('parses text-wrapped MCP payloads returned by sessions_spawn', async () => {
    _resetOutboundIntegrationService(
      mockDelivery(PREFLIGHT_OK, {
        status: 'success',
        ok: true,
        responseStatus: 200,
        responseText: JSON.stringify({
          ok: true,
          result: {
            content: [
              {
                text: JSON.stringify({
                  childSessionKey: 'child-session-from-text',
                  runId: 'run-text-001',
                  status: 'accepted',
                }),
              },
            ],
          },
        }),
      })
    );

    const adapter = new HttpOpenClawTaskAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result = await adapter.spawnTask(baseInput);

    expect(result.sessionKey).toBe('child-session-from-text');
    expect(result.runId).toBe('run-text-001');
  });

  it('propagates timeout error from invokeTool', async () => {
    _resetOutboundIntegrationService(mockDelivery(PREFLIGHT_OK, { status: 'timeout' }));

    const adapter = new HttpOpenClawTaskAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    await expect(adapter.spawnTask(baseInput)).rejects.toThrow(/timed out/i);
  });

  it('propagates explicit status: forbidden from tool result', async () => {
    _resetOutboundIntegrationService(
      mockDelivery(PREFLIGHT_OK, {
        status: 'success',
        ok: true,
        responseStatus: 200,
        responseText: JSON.stringify({
          ok: true,
          result: { status: 'forbidden', error: 'Not allowed by operator policy' },
        }),
      })
    );

    const adapter = new HttpOpenClawTaskAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    await expect(adapter.spawnTask(baseInput)).rejects.toThrow(/forbidden|Not allowed/i);
  });
});

// ── @smoke — credential-gated live gateway tests ──────────────────────────────

describe.skipIf(!process.env.OPENCLAW_SMOKE_TEST)(
  '@smoke OpenClaw v2026.6.11 live preflight',
  () => {
    it('preflight reaches the configured gateway', async () => {
      const adapter = new HttpOpenClawWorkflowAdapter();
      const result = await adapter.preflight();
      expect(result.reachable).toBe(true);
    });

    it('reports accurate sessions_spawn policy status', async () => {
      const adapter = new HttpOpenClawWorkflowAdapter();
      const result = await adapter.preflight();
      expect(typeof result.sessionsSpawnAllowed).toBe('boolean');
      if (!result.sessionsSpawnAllowed) {
        expect(result.configHint).toBeDefined();
        console.info('[smoke] sessions_spawn is denied; configHint:', result.configHint);
      }
    });
  }
);
