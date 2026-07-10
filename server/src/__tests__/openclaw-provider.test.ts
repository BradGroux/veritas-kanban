/**
 * Contract and regression tests for OpenClaw provider adapter.
 *
 * Audited against OpenClaw v2026.6.11 gateway / tool policy contracts.
 *
 * Key invariants tested:
 *   - Each dispatch makes exactly one sessions_spawn request.
 *   - Policy denial surfaces an actionable gateway.tools.allow hint.
 *   - Spawn payloads only contain arguments supported by OpenClaw v2026.6.11.
 *   - Successful sessions_spawn returns and stores a durable session key.
 *   - HTTP acknowledgement timeout is independent of the agent run timeout.
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
  OpenClawTaskSpawnInput,
  OpenClawWorkflowSpawnInput,
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

// ── HttpOpenClawTaskAdapter.spawnTask() ───────────────────────────────────────

describe('HttpOpenClawTaskAdapter.spawnTask()', () => {
  it('surfaces policy denial from the real spawn call with an actionable hint', async () => {
    const delivery = mockDelivery({
      status: 'error',
      ok: false,
      responseStatus: 404,
      responseText: JSON.stringify({ ok: false, message: 'Tool sessions_spawn is not available' }),
    });
    _resetOutboundIntegrationService(delivery);

    const adapter = new HttpOpenClawTaskAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    await expect(adapter.spawnTask(baseInput)).rejects.toThrow(/gateway\.tools\.allow/i);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it('throws when sessions_spawn does not return a session key', async () => {
    _resetOutboundIntegrationService(
      mockDelivery({
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
    const delivery = mockDelivery({
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
    });
    _resetOutboundIntegrationService(delivery);

    const adapter = new HttpOpenClawTaskAdapter({ gatewayUrl: 'http://127.0.0.1:18789' });
    const result = await adapter.spawnTask(baseInput);

    expect(result.sessionKey).toBe('child-session-xyz');
    expect(result.runId).toBe('run-001');
    expect(result.status).toBe('accepted');
    expect(delivery.deliver).toHaveBeenCalledTimes(1);

    const request = vi.mocked(delivery.deliver).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      tool: string;
      args: Record<string, unknown>;
    };
    expect(body.tool).toBe('sessions_spawn');
    expect(body.args).toMatchObject({ mode: 'run', runtime: 'subagent' });
    expect(body.args).not.toHaveProperty('runTimeoutSeconds');
    expect(body.args).not.toHaveProperty('dry_run');
  });

  it('parses text-wrapped MCP payloads returned by sessions_spawn', async () => {
    _resetOutboundIntegrationService(
      mockDelivery({
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
    const delivery = mockDelivery({ status: 'timeout' });
    _resetOutboundIntegrationService(delivery);

    const adapter = new HttpOpenClawTaskAdapter({
      gatewayUrl: 'http://127.0.0.1:18789',
      requestTimeoutMs: 12_345,
    });
    await expect(adapter.spawnTask(baseInput)).rejects.toThrow(/timed out/i);
    expect(vi.mocked(delivery.deliver).mock.calls[0]?.[1].timeoutMs).toBe(12_345);
  });

  it('propagates explicit status: forbidden from tool result', async () => {
    _resetOutboundIntegrationService(
      mockDelivery({
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
    await expect(adapter.spawnTask(baseInput)).rejects.toThrow(/gateway\.tools\.allow/i);
  });
});

describe('HttpOpenClawWorkflowAdapter.spawn()', () => {
  it('uses the v2026.6.11 sessions_spawn contract and acknowledgement timeout', async () => {
    const delivery = mockDelivery({
      status: 'success',
      ok: true,
      responseStatus: 200,
      responseText: JSON.stringify({
        ok: true,
        result: { childSessionKey: 'workflow-child', status: 'accepted' },
      }),
    });
    _resetOutboundIntegrationService(delivery);

    const input: OpenClawWorkflowSpawnInput = {
      workflowId: 'workflow-1',
      runId: 'run-1',
      stepId: 'step-1',
      agentId: 'claude-code',
      prompt: 'Execute workflow step',
      sessionMode: 'fresh',
      contextMode: 'minimal',
      cleanup: 'keep',
      timeoutSeconds: 900,
    };
    const adapter = new HttpOpenClawWorkflowAdapter({
      gatewayUrl: 'http://127.0.0.1:18789',
      requestTimeoutMs: 9_876,
    });
    await expect(adapter.spawn(input)).resolves.toMatchObject({ sessionKey: 'workflow-child' });

    const request = vi.mocked(delivery.deliver).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { args: Record<string, unknown> };
    expect(request?.timeoutMs).toBe(9_876);
    expect(body.args).toMatchObject({ mode: 'run', runtime: 'subagent' });
    expect(body.args).not.toHaveProperty('runTimeoutSeconds');
  });
});
