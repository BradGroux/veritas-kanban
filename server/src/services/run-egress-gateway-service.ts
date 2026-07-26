import { createHash, randomBytes } from 'node:crypto';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import net, { type Socket } from 'node:net';
import { URL } from 'node:url';
import {
  RUN_EGRESS_GATEWAY_EVIDENCE_SCHEMA_VERSION,
  type RunEgressDecision,
  type RunEgressGatewayEvidence,
  type RunEgressPolicy,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import { EgressPolicyService, getEgressPolicyService } from './egress-policy-service.js';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CONNECTIONS = 64;
export const RUN_EGRESS_PROXY_ENVIRONMENT_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
] as const;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export interface RunEgressGatewayAuditEvent {
  gatewayId: string;
  runKey: string;
  occurredAt: string;
  decision: RunEgressDecision;
}

export interface StartRunEgressGatewayInput {
  runId: string;
  policy: RunEgressPolicy;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxConnections?: number;
  onDecision?: (event: RunEgressGatewayAuditEvent) => Promise<void> | void;
}

export interface RunEgressGatewayHandle {
  gatewayId: string;
  environment: Record<(typeof RUN_EGRESS_PROXY_ENVIRONMENT_KEYS)[number], string>;
  evidence: RunEgressGatewayEvidence;
  stop(): Promise<RunEgressGatewayEvidence>;
}

interface ActiveGateway {
  runId: string;
  server: http.Server;
  sockets: Set<Socket>;
  evidence: RunEgressGatewayEvidence;
  environment: RunEgressGatewayHandle['environment'];
  stop(): Promise<RunEgressGatewayEvidence>;
}

export class RunEgressGatewayService {
  private readonly activeByRunId = new Map<string, ActiveGateway>();
  private readonly activeByGatewayId = new Map<string, ActiveGateway>();

  constructor(
    private readonly policyService: EgressPolicyService = getEgressPolicyService(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async start(input: StartRunEgressGatewayInput): Promise<RunEgressGatewayHandle> {
    const runId = input.runId.trim();
    if (!runId) throw new ConflictError('Run-scoped egress gateway requires a run id.');
    const existing = this.activeByRunId.get(runId);
    if (existing) {
      if (existing.evidence.policyHash !== input.policy.policyHash) {
        throw new ConflictError('Run egress gateway already uses a different policy.', {
          gatewayId: existing.evidence.gatewayId,
          policyHash: existing.evidence.policyHash,
        });
      }
      return this.publicHandle(existing);
    }

    const token = randomBytes(32).toString('base64url');
    const gatewayId = `runegress_${createHash('sha256')
      .update(`${runId}:${token}`)
      .digest('hex')
      .slice(0, 32)}`;
    const runKey = identity('run', runId);
    const requestTimeoutMs = boundedDuration(
      input.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      1_000,
      300_000
    );
    const idleTimeoutMs = boundedDuration(
      input.idleTimeoutMs,
      DEFAULT_IDLE_TIMEOUT_MS,
      1_000,
      600_000
    );
    const maxConnections = boundedInteger(input.maxConnections, DEFAULT_MAX_CONNECTIONS, 1, 1_000);
    const sockets = new Set<Socket>();
    const clientSockets = new Set<Socket>();
    const server = http.createServer();
    server.requestTimeout = requestTimeoutMs;
    server.headersTimeout = requestTimeoutMs;
    server.keepAliveTimeout = Math.min(idleTimeoutMs, requestTimeoutMs);

    const context: GatewayRequestContext = {
      gatewayId,
      runKey,
      token,
      policy: input.policy,
      requestTimeoutMs,
      idleTimeoutMs,
      policyService: this.policyService,
      onDecision: input.onDecision,
      now: this.now,
      sockets,
    };
    server.on('request', (request, response) => {
      void handleHttpRequest(context, request, response);
    });
    server.on('connect', (request, socket, head) => {
      void handleConnect(context, request, socket as Socket, head);
    });
    server.on('upgrade', (request, socket, head) => {
      void handleUpgrade(context, request, socket as Socket, head);
    });
    server.on('connection', (socket) => {
      if (clientSockets.size >= maxConnections) {
        socket.destroy();
        return;
      }
      clientSockets.add(socket);
      sockets.add(socket);
      socket.setTimeout(idleTimeoutMs, () => socket.destroy());
      socket.once('close', () => {
        clientSockets.delete(socket);
        sockets.delete(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, LOOPBACK_HOST);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Run egress gateway did not bind a TCP port.');
    }
    const proxyUrl = `http://veritas:${encodeURIComponent(token)}@${LOOPBACK_HOST}:${address.port}`;
    const environment: ActiveGateway['environment'] = {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      all_proxy: proxyUrl,
      NO_PROXY: '',
      no_proxy: '',
    };
    const evidence: RunEgressGatewayEvidence = {
      schemaVersion: RUN_EGRESS_GATEWAY_EVIDENCE_SCHEMA_VERSION,
      gatewayId,
      runKey,
      attributionKey: identity('attribution', token),
      policyHash: input.policy.policyHash,
      state: 'enforced',
      protocols: ['http', 'connect', 'ws'],
      proxyEnvironmentKeys: [...RUN_EGRESS_PROXY_ENVIRONMENT_KEYS],
      startedAt: this.now().toISOString(),
    };
    let stopPromise: Promise<RunEgressGatewayEvidence> | undefined;
    const active: ActiveGateway = {
      runId,
      server,
      sockets,
      evidence,
      environment,
      stop: () => {
        stopPromise ??= this.stopActive(active);
        return stopPromise;
      },
    };
    this.activeByRunId.set(runId, active);
    this.activeByGatewayId.set(gatewayId, active);
    return this.publicHandle(active);
  }

  getEvidence(gatewayId: string): RunEgressGatewayEvidence | null {
    return this.activeByGatewayId.get(gatewayId)?.evidence ?? null;
  }

  async stopRun(runId: string): Promise<RunEgressGatewayEvidence | null> {
    const active = this.activeByRunId.get(runId);
    return active ? active.stop() : null;
  }

  private publicHandle(active: ActiveGateway): RunEgressGatewayHandle {
    return {
      gatewayId: active.evidence.gatewayId,
      environment: { ...active.environment },
      evidence: active.evidence,
      stop: active.stop,
    };
  }

  private async stopActive(active: ActiveGateway): Promise<RunEgressGatewayEvidence> {
    this.activeByRunId.delete(active.runId);
    this.activeByGatewayId.delete(active.evidence.gatewayId);
    for (const socket of active.sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      active.server.close(() => resolve());
      active.server.closeAllConnections?.();
    });
    active.evidence = {
      ...active.evidence,
      state: 'stopped',
      stoppedAt: this.now().toISOString(),
    };
    active.environment = {
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      http_proxy: '',
      https_proxy: '',
      all_proxy: '',
      NO_PROXY: '',
      no_proxy: '',
    };
    return active.evidence;
  }
}

interface GatewayRequestContext {
  gatewayId: string;
  runKey: string;
  token: string;
  policy: RunEgressPolicy;
  requestTimeoutMs: number;
  idleTimeoutMs: number;
  policyService: EgressPolicyService;
  onDecision?: StartRunEgressGatewayInput['onDecision'];
  now: () => Date;
  sockets: Set<Socket>;
}

async function handleHttpRequest(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (!authenticated(request, context.token)) {
    rejectHttp(response, 407, 'proxy-authentication-required');
    return;
  }
  const target = parseProxyUrl(request.url);
  if (!target || target.protocol !== 'http:' || target.username || target.password) {
    rejectHttp(response, 400, 'invalid-destination');
    return;
  }
  const resolution = await context.policyService.resolveAndEvaluate(context.policy, {
    protocol: 'http',
    host: target.hostname,
    port: portFor(target, 80),
    method: request.method,
    path: target.pathname,
  });
  await audit(context, resolution.decision);
  if (resolution.decision.decision === 'block') {
    rejectHttp(response, 403, resolution.decision.reason);
    return;
  }
  const address = resolution.resolvedAddresses[0];
  if (!address) {
    rejectHttp(response, 502, 'destination-resolution-failed');
    return;
  }
  const headers = forwardHeaders(request.headers, target.host, false);
  const upstream = http.request({
    host: address,
    port: portFor(target, 80),
    method: request.method,
    path: `${target.pathname}${target.search}`,
    headers,
    family: net.isIP(address),
    timeout: context.requestTimeoutMs,
  });
  upstream.once('socket', (socket) => {
    context.sockets.add(socket);
    socket.once('close', () => context.sockets.delete(socket));
  });
  upstream.once('response', (upstreamResponse) => {
    response.writeHead(
      upstreamResponse.statusCode ?? 502,
      forwardHeaders(upstreamResponse.headers, undefined, false)
    );
    upstreamResponse.pipe(response);
  });
  upstream.once('timeout', () => upstream.destroy(new Error('Upstream request timed out.')));
  upstream.once('error', () => {
    if (!response.headersSent) rejectHttp(response, 502, 'upstream-failure');
    else response.destroy();
  });
  request.pipe(upstream);
}

async function handleConnect(
  context: GatewayRequestContext,
  request: IncomingMessage,
  client: Socket,
  head: Buffer
): Promise<void> {
  if (!authenticated(request, context.token)) {
    rejectSocket(client, 407, 'proxy-authentication-required');
    return;
  }
  const authority = parseAuthority(request.url);
  if (!authority) {
    rejectSocket(client, 400, 'invalid-destination');
    return;
  }
  const resolution = await context.policyService.resolveAndEvaluate(context.policy, {
    protocol: 'https',
    host: authority.host,
    port: authority.port,
  });
  await audit(context, resolution.decision);
  if (resolution.decision.decision === 'block') {
    rejectSocket(client, 403, resolution.decision.reason);
    return;
  }
  const address = resolution.resolvedAddresses[0];
  if (!address) {
    rejectSocket(client, 502, 'destination-resolution-failed');
    return;
  }
  const upstream = net.connect({
    host: address,
    port: authority.port,
    family: net.isIP(address),
  });
  context.sockets.add(upstream);
  let connected = false;
  upstream.setTimeout(context.idleTimeoutMs, () => upstream.destroy());
  upstream.once('close', () => context.sockets.delete(upstream));
  upstream.once('connect', () => {
    connected = true;
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.once('error', () => {
    if (connected) client.destroy();
    else rejectSocket(client, 502, 'upstream-failure');
  });
}

async function handleUpgrade(
  context: GatewayRequestContext,
  request: IncomingMessage,
  client: Socket,
  head: Buffer
): Promise<void> {
  if (!authenticated(request, context.token)) {
    rejectSocket(client, 407, 'proxy-authentication-required');
    return;
  }
  const target = parseProxyUrl(request.url);
  if (
    !target ||
    !['http:', 'ws:'].includes(target.protocol) ||
    target.username ||
    target.password
  ) {
    rejectSocket(client, 400, 'invalid-destination');
    return;
  }
  const resolution = await context.policyService.resolveAndEvaluate(context.policy, {
    protocol: 'ws',
    host: target.hostname,
    port: portFor(target, 80),
    method: request.method ?? 'GET',
    path: target.pathname,
  });
  await audit(context, resolution.decision);
  if (resolution.decision.decision === 'block') {
    rejectSocket(client, 403, resolution.decision.reason);
    return;
  }
  const address = resolution.resolvedAddresses[0];
  if (!address) {
    rejectSocket(client, 502, 'destination-resolution-failed');
    return;
  }
  const upstream = net.connect({
    host: address,
    port: portFor(target, 80),
    family: net.isIP(address),
  });
  context.sockets.add(upstream);
  let connected = false;
  upstream.setTimeout(context.idleTimeoutMs, () => upstream.destroy());
  upstream.once('close', () => context.sockets.delete(upstream));
  upstream.once('connect', () => {
    connected = true;
    upstream.write(
      `${request.method ?? 'GET'} ${target.pathname}${target.search} HTTP/${request.httpVersion}\r\n`
    );
    for (const [name, value] of Object.entries(
      forwardHeaders(request.headers, target.host, true)
    )) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) upstream.write(`${name}: ${item}\r\n`);
      }
    }
    upstream.write('\r\n');
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.once('error', () => {
    if (connected) client.destroy();
    else rejectSocket(client, 502, 'upstream-failure');
  });
}

async function audit(context: GatewayRequestContext, decision: RunEgressDecision): Promise<void> {
  if (!context.onDecision) return;
  try {
    await context.onDecision({
      gatewayId: context.gatewayId,
      runKey: context.runKey,
      occurredAt: context.now().toISOString(),
      decision,
    });
  } catch {
    // The enforced transport decision remains authoritative if optional audit export is unavailable.
  }
}

function authenticated(request: IncomingMessage, token: string): boolean {
  const header = request.headers['proxy-authorization'];
  if (typeof header !== 'string') return false;
  const bearer = `Bearer ${token}`;
  const basic = `Basic ${Buffer.from(`veritas:${token}`).toString('base64')}`;
  return safeEqual(header, bearer) || safeEqual(header, basic);
}

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return leftDigest.equals(rightDigest);
}

function parseProxyUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function parseAuthority(value: string | undefined): { host: string; port: number } | null {
  if (!value) return null;
  try {
    const parsed = new URL(`http://${value}`);
    const port = portFor(parsed, 443);
    if (parsed.username || parsed.password || parsed.pathname !== '/') return null;
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
}

function portFor(url: URL, fallback: number): number {
  return url.port ? Number.parseInt(url.port, 10) : fallback;
}

function forwardHeaders(
  headers: IncomingHttpHeaders,
  host: string | undefined,
  preserveUpgrade: boolean
): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'proxy-authorization' || lower === 'proxy-connection') continue;
    if (!preserveUpgrade && HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (value === undefined) continue;
    result[lower] = value;
  }
  if (host) result.host = host;
  return result;
}

function rejectHttp(response: ServerResponse, statusCode: number, reason: string): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    ...(statusCode === 407 ? { 'proxy-authenticate': 'Basic realm="veritas-run-egress"' } : {}),
  });
  response.end(JSON.stringify({ error: reason }));
}

function rejectSocket(socket: Socket, statusCode: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${statusCode} ${http.STATUS_CODES[statusCode] ?? 'Rejected'}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: application/json\r\n' +
      `${statusCode === 407 ? 'Proxy-Authenticate: Basic realm="veritas-run-egress"\r\n' : ''}` +
      '\r\n' +
      JSON.stringify({ error: reason })
  );
}

function boundedDuration(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return boundedDuration(value, fallback, minimum, maximum);
}

function identity(kind: string, value: string): string {
  return `sha256:${createHash('sha256').update(`${kind}:${value}`).digest('hex')}`;
}

let service: RunEgressGatewayService | undefined;

export function getRunEgressGatewayService(): RunEgressGatewayService {
  service ??= new RunEgressGatewayService();
  return service;
}

export function runEgressPolicyRequiresGateway(policy: RunEgressPolicy): boolean {
  if (
    policy.defaultEgress === 'deny' &&
    policy.allowedHosts.length === 0 &&
    !policy.allowApprovals
  ) {
    return false;
  }
  if (
    policy.defaultEgress === 'allow' &&
    policy.deniedHosts.length === 0 &&
    policy.allowedMethods.length === 0 &&
    policy.allowedPathPrefixes.length === 0 &&
    !policy.blockPrivateNetwork &&
    !policy.blockMetadataEndpoints &&
    !policy.blockLoopback
  ) {
    return false;
  }
  return true;
}
