import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import net, { type Server as NetServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { EgressPolicyService } from '../services/egress-policy-service.js';
import {
  RunEgressGatewayService,
  type RunEgressGatewayApprovalRequest,
  type RunEgressGatewayApprovalResult,
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
      protocols: ['http', 'connect', 'ws', 'socks5'],
    });
    expect(JSON.stringify(gateway.evidence)).not.toContain(proxy.password);
    expect(gateway.environment.ALL_PROXY).toMatch(/^socks5h:\/\/veritas:/);
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
      socket.end(
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

  it('opens an authenticated SOCKS5 tunnel with the same pinned policy decision', async () => {
    const echo = net.createServer((socket) => socket.pipe(socket));
    const echoPort = await listen(echo);
    const audit = vi.fn();
    const gateway = await startGateway({
      runId: 'run-egress-socks',
      onDecision: audit,
    });

    const tunnel = await connectSocksTunnel(gateway, '127.0.0.1', echoPort);
    await expect(roundTrip(tunnel, 'through-socks')).resolves.toBe('through-socks');
    tunnel.destroy();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          protocol: 'socks',
          decision: 'allow',
        }),
      })
    );

    const restricted = await startGateway({
      runId: 'run-egress-socks-restricted',
      allowedMethods: ['GET'],
    });
    await expect(connectSocksTunnel(restricted, '127.0.0.1', echoPort)).rejects.toMatchObject({
      replyCode: 0x02,
    });
    await expect(
      connectSocksTunnel(gateway, '127.0.0.1', echoPort, 'invalid-token')
    ).rejects.toMatchObject({
      authStatus: 0x01,
    });
  });

  it('uses an operator upstream proxy without exposing its credentials in evidence', async () => {
    const destination = http.createServer((_request, response) => response.end('via-upstream'));
    const destinationPort = await listen(destination);
    const observed: Array<{ authority: string; authorization?: string }> = [];
    const upstream = http.createServer();
    upstream.on('connect', (request, clientSocket, head) => {
      observed.push({
        authority: request.url ?? '',
        authorization:
          typeof request.headers['proxy-authorization'] === 'string'
            ? request.headers['proxy-authorization']
            : undefined,
      });
      const authority = new URL(`http://${request.url}`);
      const destinationSocket = net.connect(Number(authority.port), authority.hostname);
      destinationSocket.once('connect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) destinationSocket.write(head);
        clientSocket.pipe(destinationSocket);
        destinationSocket.pipe(clientSocket);
      });
      destinationSocket.once('error', () => clientSocket.destroy());
    });
    const upstreamPort = await listen(upstream);
    const gateway = await startGateway({
      runId: 'run-egress-upstream',
      upstreamProxyUrl: `http://proxy-user:proxy-pass@127.0.0.1:${upstreamPort}`,
    });

    await expect(
      proxyRequest(gateway, `http://127.0.0.1:${destinationPort}/`, 'GET')
    ).resolves.toMatchObject({
      statusCode: 200,
      body: 'via-upstream',
    });
    expect(observed).toEqual([
      {
        authority: `127.0.0.1:${destinationPort}`,
        authorization: `Basic ${Buffer.from('proxy-user:proxy-pass').toString('base64')}`,
      },
    ]);
    expect(gateway.evidence.upstreamMode).toBe('http-connect');
    expect(JSON.stringify(gateway.evidence)).not.toContain('proxy-pass');
  });

  it('pauses approval-eligible requests and never lets approval override an explicit deny', async () => {
    const upstream = http.createServer((_request, response) => response.end('approved-egress'));
    const upstreamPort = await listen(upstream);
    const onApprovalRequired = vi.fn(async (): Promise<RunEgressGatewayApprovalResult> => ({
      approvalId: 'runapproval_network',
      approved: true,
    }));
    const audit = vi.fn();
    const approvedGateway = await startGateway({
      runId: 'run-egress-approved',
      defaultEgress: 'deny',
      allowedHosts: [],
      allowApprovals: true,
      onApprovalRequired,
      onDecision: audit,
    });

    await expect(
      proxyRequest(
        approvedGateway,
        `http://127.0.0.1:${upstreamPort}/approved?secret=not-audited`,
        'GET'
      )
    ).resolves.toMatchObject({
      statusCode: 200,
      body: 'approved-egress',
    });
    expect(onApprovalRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: upstreamPort,
        path: '/approved',
        decision: expect.objectContaining({
          decision: 'block',
          reason: 'default-deny',
          approvalEligible: true,
        }),
      })
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          decision: 'allow',
          reason: 'allowed-by-approval',
          policyReason: 'default-deny',
          approvalId: 'runapproval_network',
        }),
      })
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain('not-audited');

    const deniedApproval = vi.fn();
    const deniedGateway = await startGateway({
      runId: 'run-egress-denied',
      defaultEgress: 'allow',
      deniedHosts: ['127.0.0.1'],
      allowApprovals: true,
      onApprovalRequired: deniedApproval,
    });
    await expect(
      proxyRequest(deniedGateway, `http://127.0.0.1:${upstreamPort}/`, 'GET')
    ).resolves.toMatchObject({
      statusCode: 403,
      body: expect.stringContaining('denied-host'),
    });
    expect(deniedApproval).not.toHaveBeenCalled();
  });
});

async function startGateway(
  overrides: {
    runId?: string;
    defaultEgress?: 'allow' | 'deny';
    allowedHosts?: string[];
    deniedHosts?: string[];
    allowedMethods?: string[];
    allowedPathPrefixes?: string[];
    allowApprovals?: boolean;
    upstreamProxyUrl?: string;
    onDecision?: (event: unknown) => void;
    onApprovalRequired?: (
      request: RunEgressGatewayApprovalRequest
    ) => Promise<RunEgressGatewayApprovalResult>;
  } = {}
): Promise<RunEgressGatewayHandle> {
  const service = new RunEgressGatewayService(policyService);
  const gateway = await service.start({
    runId: overrides.runId ?? `run-egress-${openGateways.length}`,
    policy: policyService.compile({
      defaultEgress: overrides.defaultEgress ?? 'deny',
      allowedHosts: overrides.allowedHosts ?? ['127.0.0.1'],
      deniedHosts: overrides.deniedHosts ?? [],
      allowedMethods: overrides.allowedMethods ?? [],
      allowedPathPrefixes: overrides.allowedPathPrefixes ?? [],
      blockPrivateNetwork: false,
      blockMetadataEndpoints: false,
      blockLoopback: false,
      allowApprovals: overrides.allowApprovals ?? false,
      dangerouslyAllowGlobalWildcard: false,
    }),
    requestTimeoutMs: 5_000,
    idleTimeoutMs: 5_000,
    upstreamProxyUrl: overrides.upstreamProxyUrl,
    onDecision: overrides.onDecision,
    onApprovalRequired: overrides.onApprovalRequired,
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
    request.once('connect', (response, socket, head) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode === 200) {
        resolve({ statusCode, socket });
        return;
      }
      const chunks = head.length > 0 ? [Buffer.from(head)] : [];
      socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      socket.once('end', () =>
        reject({
          statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
      socket.once('error', reject);
      socket.resume();
    });
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

async function connectSocksTunnel(
  gateway: RunEgressGatewayHandle,
  host: string,
  port: number,
  passwordOverride?: string
): Promise<Socket> {
  const proxy = new URL(gateway.environment.ALL_PROXY);
  const socket = net.connect(Number(proxy.port), proxy.hostname);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write(Buffer.from([0x05, 0x01, 0x02]));
  expect(await readSocketBytes(socket, 2)).toEqual(Buffer.from([0x05, 0x02]));

  const username = Buffer.from(proxy.username);
  const password = Buffer.from(passwordOverride ?? proxy.password);
  socket.write(
    Buffer.concat([
      Buffer.from([0x01, username.length]),
      username,
      Buffer.from([password.length]),
      password,
    ])
  );
  const auth = await readSocketBytes(socket, 2);
  if (auth[1] !== 0x00) {
    socket.destroy();
    throw { authStatus: auth[1] };
  }

  const address = Buffer.from(host.split('.').map(Number));
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01]), address, portBytes]));
  const reply = await readSocketBytes(socket, 10);
  if (reply[1] !== 0x00) {
    socket.destroy();
    throw { replyCode: reply[1] };
  }
  return socket;
}

function readSocketBytes(socket: Socket, size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    socket.once('data', (chunk) => resolve(Buffer.from(chunk).subarray(0, size)));
    socket.once('error', reject);
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
