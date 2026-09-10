import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { waitForOpenClawRun } from '../utils/openclaw-gateway-rpc.js';
import { HttpOpenClawTaskAdapter } from '../services/openclaw-workflow-adapter.js';

const servers: WebSocketServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function gateway(
  options: {
    deny?: boolean;
    missingMethod?: boolean;
    wrongRun?: boolean;
    version?: string;
    disconnect?: boolean;
    malformed?: boolean;
  } = {}
) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  server.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'test-nonce', ts: 100 },
      })
    );
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      requests.push(frame);
      if (frame.method === 'connect')
        socket.send(
          JSON.stringify({
            type: 'res',
            id: frame.id,
            ok: !options.deny,
            error: options.deny ? { message: 'token=do-not-echo' } : undefined,
            payload: {
              type: 'hello-ok',
              protocol: 4,
              server: { version: options.version ?? '2026.9.2' },
              features: { methods: options.missingMethod ? [] : ['agent.wait'] },
            },
          })
        );
      else if (options.malformed) socket.send('invalid token=do-not-echo');
      else if (options.disconnect) socket.close();
      else
        socket.send(
          JSON.stringify({
            type: 'res',
            id: frame.id,
            ok: true,
            payload: {
              runId: options.wrongRun ? 'other-run' : frame.params.runId,
              status: 'timeout',
            },
          })
        );
    });
  });
  return {
    gatewayUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token: 'test-only-gateway-secret',
    validationOptions: { allowHttp: true, allowLocalhost: true },
    requests,
  };
}
describe('authenticated OpenClaw gateway RPC', () => {
  it('authenticates server-side and requests only the exact bound run', async () => {
    const config = await gateway();
    await expect(waitForOpenClawRun(config, 'bound-run', 0)).resolves.toEqual({
      version: '2026.9.2',
      result: { runId: 'bound-run', status: 'timeout' },
    });
    expect(config.requests[0].params.auth).toEqual({ token: config.token });
    expect(config.requests[0].params.scopes).toEqual(['operator.write']);
    expect(config.requests[1]).toMatchObject({
      method: 'agent.wait',
      params: { runId: 'bound-run', timeoutMs: 0 },
    });
    expect(JSON.stringify(config.requests[1])).not.toContain(config.token);
  });
  it.each([
    [{ deny: true }, /authentication failed/],
    [{ missingMethod: true }, /does not advertise/],
    [{ wrongRun: true }, /identity does not match/],
    [{ disconnect: true }, /disconnected/],
  ] as const)('fails closed for %j', async (opts, error) => {
    await expect(waitForOpenClawRun(await gateway(opts), 'bound-run', 0)).rejects.toThrow(error);
  });
  it('rejects missing authentication before connecting', async () => {
    await expect(
      waitForOpenClawRun({ gatewayUrl: 'http://127.0.0.1:1' }, 'bound-run', 0)
    ).rejects.toThrow(/server-owned/);
  });
  it('rejects URL-carried credentials without exposing them', async () => {
    await expect(
      waitForOpenClawRun(
        { ...(await gateway()), gatewayUrl: 'http://user:secret@127.0.0.1:1' },
        'bound-run',
        0
      )
    ).rejects.toThrow();
  });
  it('readiness rejects gateways before terminal reply snapshot support', async () => {
    await expect(
      new HttpOpenClawTaskAdapter(await gateway({ version: '2026.6.11' })).probeCompletion()
    ).rejects.toThrow(/2026.9.2/);
  });
  it('does not echo malformed gateway response content', async () => {
    await expect(
      waitForOpenClawRun(await gateway({ malformed: true }), 'bound-run', 0)
    ).rejects.toThrow('OpenClaw completion gateway returned an invalid protocol response.');
  });
  it('rejects cleartext remote completion before sending authentication', async () => {
    await expect(
      waitForOpenClawRun(
        {
          gatewayUrl: 'http://10.0.0.1:18789',
          token: 'fixture',
          validationOptions: { allowHttp: true, allowPrivateIp: true },
        },
        'bound-run',
        0
      )
    ).rejects.toThrow('OpenClaw completion requires HTTPS for a remote gateway.');
  });
  it('readiness verifies authenticated permission and records gateway version', async () => {
    const config = await gateway();
    await expect(new HttpOpenClawTaskAdapter(config).probeCompletion()).resolves.toEqual({
      gatewayUrl: config.gatewayUrl,
      version: '2026.9.2',
    });
  });
});
