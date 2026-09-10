import { randomUUID } from 'node:crypto';
import type { RequestOptions } from 'node:http';
import WebSocket from 'ws';
import { z } from 'zod';
import { resolveOutboundUrl, type UrlValidationOptions } from './url-validation.js';

const helloSchema = z.object({
  type: z.literal('hello-ok'),
  protocol: z.union([z.literal(3), z.literal(4)]),
  server: z.object({ version: z.string().min(1) }),
  features: z.object({ methods: z.array(z.string()) }),
});

export const openClawWaitResultSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(['ok', 'error', 'timeout', 'pending']),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  error: z.string().optional(),
  yielded: z.boolean().optional(),
  terminalReply: z.object({ disposition: z.string(), text: z.string().optional() }).nullish(),
});

export type OpenClawWaitResult = z.infer<typeof openClawWaitResultSchema>;

export interface OpenClawGatewayRpcOptions {
  gatewayUrl: string;
  token?: string;
  validationOptions?: UrlValidationOptions;
}

/** A bounded, server-only RPC connection. Never forwards a gateway credential to a child. */
export async function waitForOpenClawRun(
  options: OpenClawGatewayRpcOptions,
  runId: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ version: string; result: OpenClawWaitResult }> {
  if (!options.token) {
    throw new Error('OpenClaw completion requires a server-owned OPENCLAW_GATEWAY_TOKEN.');
  }
  const resolved = await resolveOutboundUrl(options.gatewayUrl, options.validationOptions);
  if (!resolved) throw new Error('OpenClaw completion gateway URL was blocked by outbound policy.');
  const url = new URL(resolved.url);
  const address = resolved.resolvedAddress.address;
  if (url.protocol !== 'https:' && address !== '::1' && !/^127\./.test(address)) {
    throw new Error('OpenClaw completion requires HTTPS for a remote gateway.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('OpenClaw gateway URL must not contain credentials, a query, or a fragment.');
  }
  // Protect the authenticated connection from DNS rebinding; ws must use the address
  // validated above, while retaining the hostname for TLS certificate verification.
  const lookup: NonNullable<RequestOptions['lookup']> = (_hostname, opts, callback) => {
    const cb = typeof opts === 'function' ? opts : callback;
    if (typeof opts === 'object' && opts?.all) cb(null, [resolved.resolvedAddress]);
    else cb(null, resolved.resolvedAddress.address, resolved.resolvedAddress.family);
  };
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      lookup,
      followRedirects: false,
      maxPayload: 2 * 1024 * 1024,
      handshakeTimeout: 10_000,
    });
    const connectId = randomUUID();
    const waitId = randomUUID();
    let version: string | undefined;
    let connecting = false;
    let settled = false;
    const finish = (error?: Error, result?: OpenClawWaitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.terminate();
      if (error) reject(error);
      else if (version && result) resolve({ version, result });
      else reject(new Error('OpenClaw completion response was incomplete.'));
    };
    const abort = () => finish(new Error('OpenClaw completion observation was cancelled.'));
    const timer = setTimeout(
      () => finish(new Error('OpenClaw completion gateway request timed out.')),
      timeoutMs + 15_000
    );
    signal?.addEventListener('abort', abort, { once: true });
    socket.on('error', () => finish(new Error('OpenClaw completion gateway connection failed.')));
    socket.on('close', () => finish(new Error('OpenClaw completion gateway disconnected.')));
    socket.on('message', (data) => {
      try {
        const frame = JSON.parse(data.toString());
        if (frame.type === 'event' && frame.event === 'connect.challenge' && !connecting) {
          connecting = true;
          socket.send(
            JSON.stringify({
              type: 'req',
              id: connectId,
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 4,
                client: {
                  id: 'gateway-client',
                  displayName: 'Veritas Kanban',
                  version: '1',
                  platform: process.platform,
                  mode: 'backend',
                },
                role: 'operator',
                scopes: ['operator.write'],
                caps: [],
                auth: { token: options.token },
              },
            })
          );
          return;
        }
        if (frame.type !== 'res') return;
        if (frame.id === connectId && !version) {
          if (frame.ok !== true) {
            // Do not echo untrusted gateway errors: they can contain credentials.
            throw new Error(
              'OpenClaw completion authentication failed; authorize the server gateway connection before launching tasks.'
            );
          }
          const hello = helloSchema.parse(frame.payload);
          if (!hello.features.methods.includes('agent.wait')) {
            throw new Error('OpenClaw gateway does not advertise agent.wait completion support.');
          }
          version = hello.server.version;
          socket.send(
            JSON.stringify({
              type: 'req',
              id: waitId,
              method: 'agent.wait',
              params: { runId, timeoutMs },
            })
          );
        } else if (frame.id === waitId && version) {
          if (frame.ok !== true)
            throw new Error('OpenClaw agent.wait is unavailable or unauthorized.');
          const result = openClawWaitResultSchema.parse(frame.payload);
          if (result.runId !== runId)
            throw new Error('OpenClaw completion run identity does not match the dispatched run.');
          finish(undefined, result);
        }
      } catch (error) {
        finish(
          error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError
            ? new Error('OpenClaw completion gateway returned an invalid protocol response.')
            : (error as Error)
        );
      }
    });
  });
}
