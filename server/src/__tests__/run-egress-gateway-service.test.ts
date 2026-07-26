import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import net, { type Server as NetServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { EgressPolicyService } from '../services/egress-policy-service.js';
import {
  RunEgressGatewayService,
  type RunEgressGatewayHandle,
} from '../services/run-egress-gateway-service.js';

const policyService = new EgressPolicyService();
const openGateways: RunEgressGatewayHandle[] = [];
const openServers: Array<http.Server | NetServer> = [];

afterEach(async () => {
  await Promise.all(openGateways.splice(0).map((gateway) => gateway.stop()));
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if ('closeAllConnections' in server) server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

describe('RunEgressGatewayService', () => {
  it('proxies an allowed HTTP request with redacted audit evidence and blocks method drift', async () => {
    const upstreamCalls: string[] = [];
    const upstream = http.createServer((request, response) => {
      upstreamCalls.push(`${request.method} ${request.url}`);
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('gateway-ok');
    });
    const upstreamPort = await listen(upstream);
    const audit = vi.fn();
    const gateway = await startGateway({
      allowedMethods: ['GET'],
      allowedPathPrefixes: ['/allowed'],
      onDecision: audit,
    });
    const target = `http://127.0.0.1:${upstreamPort}/allowed/resource?secret=query-value`;

    await expect(proxyRequest(gateway, target, 'GET')).resolves.toMatchObject({
      statusCode: 200,
      body: 'gateway-ok',
    });
    await expect(proxyRequest(gateway, target, 'POST')).resolves.toMatchObject({
      statusCode: 403,
      body: expect.stringContaining('method-not-allowed'),
    });
    expect(upstreamCalls).toEqual(['GET /allowed/resource?secret=query-value']);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('query-value');
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      gatewayId: gateway.gatewayId,
      runKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      decision: {
        decision: 'allow',
        hostKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
  });

  it('requires run attribution and exposes only hashed durable evidence', async () => {
    const upstream = http.createServer((_request, response) => response.end('unreachable'));
    const upstreamPort = await listen(upstream);
    const gateway = await startGateway();
    const proxy = new URL(gateway.environment.HTTP_PROXY);

    const unauthenticated = await rawProxyRequest({
      proxy,
      target: `http://127.0.0.1:${upstreamPort}/`,
      method: 'GET',
    });
    expect(unauthenticated.statusCode).toBe(407);
    expect(gateway.evidence).toMatchObject({
      state: 'enforced',
      gatewayId: gateway.gatewayId,
      runKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      attributionKey: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      protocols: ['http', 'connect', 'ws'],
    });
    expect(JSON.stringify(gateway.evidence)).not.toContain(proxy.password);
    expect(gateway.environment.NO_PROXY).toBe('');

    await expect(gateway.stop()).resolves.toMatchObject({
      state: 'stopped',
      stoppedAt: expect.any(String),
    });
  });

  it('opens an authenticated CONNECT tunnel only when encrypted policy is enforceable', async () => {
    const echo = net.createServer((socket) => socket.pipe(socket));
    const echoPort = await listen(echo);
    const gateway = await startGateway();

    const tunnel = await connectTunnel(gateway, `127.0.0.1:${echoPort}`);
    expect(tunnel.statusCode).toBe(200);
    await expect(roundTrip(tunnel.socket, 'through-gateway')).resolves.toBe('through-gateway');
    tunnel.socket.destroy();

    const restricted = await startGateway({
      runId: 'run-egress-restricted',
      allowedMethods: ['GET'],
    });
    await expect(connectTunnel(restricted, `127.0.0.1:${echoPort}`)).rejects.toMatchObject({
      statusCode: 403,
      body: expect.stringContaining('tls-inspection-required'),
    });
  });

  it('forwards an allowed plaintext WebSocket upgrade through the same policy boundary', async () => {
    const upstream = http.createServer();
    upstream.on('upgrade', (_request, socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'
      );
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startGateway({
      runId: 'run-egress-websocket',
      allowedMethods: ['GET'],
      allowedPathPrefixes: ['/socket'],
    });

    const response = await websocketUpgrade(
      gateway,
      `ws://127.0.0.1:${upstreamPort}/socket?secret=not-audited`
    );
    expect(response).toContain('101 Switching Protocols');
  });
});

async function startGateway(
  overrides: {
    runId?: string;
    allowedMethods?: string[];
    allowedPathPrefixes?: string[];
    onDecision?: (event: unknown) => void;
  } = {}
): Promise<RunEgressGatewayHandle> {
  const service = new RunEgressGatewayService(policyService);
  const gateway = await service.start({
    runId: overrides.runId ?? `run-egress-${openGateways.length}`,
    policy: policyService.compile({
      defaultEgress: 'deny',
      allowedHosts: ['127.0.0.1'],
      deniedHosts: [],
      allowedMethods: overrides.allowedMethods ?? [],
      allowedPathPrefixes: overrides.allowedPathPrefixes ?? [],
      blockPrivateNetwork: false,
      blockMetadataEndpoints: false,
      blockLoopback: false,
      allowApprovals: false,
      dangerouslyAllowGlobalWildcard: false,
    }),
    requestTimeoutMs: 5_000,
    idleTimeoutMs: 5_000,
    onDecision: overrides.onDecision,
  });
  openGateways.push(gateway);
  return gateway;
}

async function listen(server: http.Server | NetServer): Promise<number> {
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function proxyRequest(
  gateway: RunEgressGatewayHandle,
  target: string,
  method: string
): Promise<{ statusCode: number; body: string }> {
  const proxy = new URL(gateway.environment.HTTP_PROXY);
  return rawProxyRequest({
    proxy,
    target,
    method,
    proxyAuthorization: basicProxyAuthorization(proxy),
  });
}

function rawProxyRequest(input: {
  proxy: URL;
  target: string;
  method: string;
  proxyAuthorization?: string;
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: input.proxy.hostname,
      port: Number(input.proxy.port),
      method: input.method,
      path: input.target,
      headers: {
        ...(input.proxyAuthorization ? { 'Proxy-Authorization': input.proxyAuthorization } : {}),
      },
    });
    request.once('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.once('end', () =>
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    request.once('error', reject);
    request.end();
  });
}

function connectTunnel(
  gateway: RunEgressGatewayHandle,
  authority: string
): Promise<{ statusCode: number; socket: Socket }> {
  const proxy = new URL(gateway.environment.HTTPS_PROXY);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxy.hostname,
      port: Number(proxy.port),
      method: 'CONNECT',
      path: authority,
      headers: { 'Proxy-Authorization': basicProxyAuthorization(proxy) },
    });
    request.once('connect', (response, socket) =>
      resolve({ statusCode: response.statusCode ?? 0, socket })
    );
    request.once('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.once('end', () =>
        reject({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    request.once('error', reject);
    request.end();
  });
}

function roundTrip(socket: Socket, value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once('data', (chunk) => resolve(Buffer.from(chunk).toString('utf8')));
    socket.once('error', reject);
    socket.write(value);
  });
}

function websocketUpgrade(gateway: RunEgressGatewayHandle, target: string): Promise<string> {
  const proxy = new URL(gateway.environment.HTTP_PROXY);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port), proxy.hostname);
    socket.once('connect', () => {
      socket.write(
        `GET ${target} HTTP/1.1\r\n` +
          `Host: ${new URL(target).host}\r\n` +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          `Proxy-Authorization: ${basicProxyAuthorization(proxy)}\r\n` +
          '\r\n'
      );
    });
    socket.once('data', (chunk) => {
      resolve(Buffer.from(chunk).toString('utf8'));
      socket.destroy();
    });
    socket.once('error', reject);
  });
}

function basicProxyAuthorization(proxy: URL): string {
  return `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;
}
