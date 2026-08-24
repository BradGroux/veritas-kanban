import { createHash, randomBytes } from 'node:crypto';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import net, { type Server as NetServer, type Socket } from 'node:net';
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
export const RUN_EGRESS_UPSTREAM_PROXY_ENV_KEY = 'VERITAS_EGRESS_UPSTREAM_PROXY' as const;
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

export interface RunEgressGatewayApprovalRequest {
  gatewayId: string;
  runKey: string;
  protocol: RunEgressDecision['protocol'];
  host: string;
  port: number;
  method?: string;
  /** Path only. Query strings and fragments are never included. */
  path?: string;
  decision: RunEgressDecision;
  signal: AbortSignal;
}

export interface RunEgressGatewayApprovalResult {
  approvalId: string;
  approved: boolean;
}

export interface StartRunEgressGatewayInput {
  runId: string;
  policy: RunEgressPolicy;
  /** Optional operator-managed HTTP proxy. Credentials remain memory-only. */
  upstreamProxyUrl?: string;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxConnections?: number;
  onDecision?: (event: RunEgressGatewayAuditEvent) => Promise<void> | void;
  onApprovalRequired?: (
    request: RunEgressGatewayApprovalRequest
  ) => Promise<RunEgressGatewayApprovalResult>;
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
  socksServer: NetServer;
  sockets: Set<Socket>;
  evidence: RunEgressGatewayEvidence;
  environment: RunEgressGatewayHandle['environment'];
  abortController: AbortController;
  upstreamKey: string;
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
    const upstream = parseUpstreamProxy(input.upstreamProxyUrl);
    const upstreamKey = upstream?.key ?? identity('upstream-proxy', 'direct');
    const existing = this.activeByRunId.get(runId);
    if (existing) {
      if (
        existing.evidence.policyHash !== input.policy.policyHash ||
        existing.upstreamKey !== upstreamKey
      ) {
        throw new ConflictError('Run egress gateway already uses a different policy or upstream.', {
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
    const abortController = new AbortController();
    const server = http.createServer();
    const socksServer = net.createServer();
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
      upstream,
      onDecision: input.onDecision,
      onApprovalRequired: input.onApprovalRequired,
      signal: abortController.signal,
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
      registerClientSocket(socket, clientSockets, sockets, maxConnections, idleTimeoutMs);
    });
    socksServer.on('connection', (socket) => {
      if (!registerClientSocket(socket, clientSockets, sockets, maxConnections, idleTimeoutMs)) {
        return;
      }
      void handleSocksConnection(context, socket);
    });

    await listenLoopback(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Run egress gateway did not bind a TCP port.');
    }
    try {
      await listenLoopback(socksServer);
    } catch (error) {
      server.close();
      server.closeAllConnections?.();
      throw error;
    }
    const socksAddress = socksServer.address();
    if (!socksAddress || typeof socksAddress === 'string') {
      server.close();
      server.closeAllConnections?.();
      socksServer.close();
      throw new Error('Run egress SOCKS gateway did not bind a TCP port.');
    }
    const proxyUrl = `http://veritas:${encodeURIComponent(token)}@${LOOPBACK_HOST}:${address.port}`;
    const socksProxyUrl = `socks5h://veritas:${encodeURIComponent(token)}@${LOOPBACK_HOST}:${socksAddress.port}`;
    const environment: ActiveGateway['environment'] = {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      ALL_PROXY: socksProxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      all_proxy: socksProxyUrl,
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
      protocols: ['http', 'connect', 'ws', 'socks5'],
      upstreamMode: upstream ? 'http-connect' : 'direct',
      proxyEnvironmentKeys: [...RUN_EGRESS_PROXY_ENVIRONMENT_KEYS],
      startedAt: this.now().toISOString(),
    };
    let stopPromise: Promise<RunEgressGatewayEvidence> | undefined;
    const active: ActiveGateway = {
      runId,
      server,
      socksServer,
      sockets,
      evidence,
      environment,
      abortController,
      upstreamKey,
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
    active.abortController.abort(new Error('Run egress gateway stopped.'));
    for (const socket of active.sockets) socket.destroy();
    await Promise.all([closeServer(active.server), closeServer(active.socksServer)]);
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
  upstream?: UpstreamProxy;
  onDecision?: StartRunEgressGatewayInput['onDecision'];
  onApprovalRequired?: StartRunEgressGatewayInput['onApprovalRequired'];
  signal: AbortSignal;
  now: () => Date;
  sockets: Set<Socket>;
}

interface UpstreamProxy {
  key: string;
  host: string;
  port: number;
  authorization?: string;
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
  const decision = await withApprovalIdlePause(request.socket, context.idleTimeoutMs, () =>
    authorizeBlockedRequest(context, {
      protocol: 'http',
      host: target.hostname,
      port: portFor(target, 80),
      method: request.method,
      path: target.pathname,
      decision: resolution.decision,
    })
  );
  await audit(context, decision);
  if (decision.decision === 'block') {
    rejectHttp(response, 403, decision.reason);
    return;
  }
  const address = resolution.resolvedAddresses[0];
  if (!address) {
    rejectHttp(response, 502, 'destination-resolution-failed');
    return;
  }
  let transport: Awaited<ReturnType<typeof openPinnedTransport>>;
  try {
    transport = await openPinnedTransport(context, address, portFor(target, 80));
  } catch {
    rejectHttp(response, 502, 'upstream-failure');
    return;
  }
  if (transport.head.length > 0) transport.socket.unshift(transport.head);
  const headers = forwardHeaders(request.headers, target.host, false);
  const upstream = http.request({
    host: address,
    port: portFor(target, 80),
    method: request.method,
    path: `${target.pathname}${target.search}`,
    headers,
    family: net.isIP(address),
    timeout: context.requestTimeoutMs,
    agent: false,
    createConnection: () => transport.socket,
  });
  upstream.once('response', (upstreamResponse) => {
    response.writeHead(
      normalizeUpstreamStatusCode(upstreamResponse.statusCode),
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
  const decision = await withApprovalIdlePause(client, context.idleTimeoutMs, () =>
    authorizeBlockedRequest(context, {
      protocol: 'https',
      host: authority.host,
      port: authority.port,
      decision: resolution.decision,
    })
  );
  await audit(context, decision);
  if (decision.decision === 'block') {
    rejectSocket(client, 403, decision.reason);
    return;
  }
  const address = resolution.resolvedAddresses[0];
  if (!address) {
    rejectSocket(client, 502, 'destination-resolution-failed');
    return;
  }
  let transport: Awaited<ReturnType<typeof openPinnedTransport>>;
  try {
    transport = await openPinnedTransport(context, address, authority.port);
  } catch {
    rejectSocket(client, 502, 'upstream-failure');
    return;
  }
  const upstream = transport.socket;
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (transport.head.length > 0) client.write(transport.head);
  if (head.length > 0) upstream.write(head);
  client.pipe(upstream);
  upstream.pipe(client);
  upstream.once('error', () => client.destroy());
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
  const decision = await withApprovalIdlePause(client, context.idleTimeoutMs, () =>
    authorizeBlockedRequest(context, {
      protocol: 'ws',
      host: target.hostname,
      port: portFor(target, 80),
      method: request.method ?? 'GET',
      path: target.pathname,
      decision: resolution.decision,
    })
  );
  await audit(context, decision);
  if (decision.decision === 'block') {
    rejectSocket(client, 403, decision.reason);
    return;
  }
  const address = resolution.resolvedAddresses[0];
  if (!address) {
    rejectSocket(client, 502, 'destination-resolution-failed');
    return;
  }
  let transport: Awaited<ReturnType<typeof openPinnedTransport>>;
  try {
    transport = await openPinnedTransport(context, address, portFor(target, 80));
  } catch {
    rejectSocket(client, 502, 'upstream-failure');
    return;
  }
  const upstream = transport.socket;
  upstream.write(
    `${request.method ?? 'GET'} ${target.pathname}${target.search} HTTP/${request.httpVersion}\r\n`
  );
  const headers = forwardHeaders(request.headers, target.host, true);
  for (let index = 0; index < headers.length; index += 2) {
    const name = headers[index];
    const value = headers[index + 1];
    if (name !== undefined && value !== undefined) upstream.write(`${name}: ${value}\r\n`);
  }
  upstream.write('\r\n');
  if (transport.head.length > 0) client.write(transport.head);
  if (head.length > 0) upstream.write(head);
  client.pipe(upstream);
  upstream.pipe(client);
  upstream.once('error', () => client.destroy());
}

async function handleSocksConnection(
  context: GatewayRequestContext,
  client: Socket
): Promise<void> {
  const reader = new SocketByteReader(client);
  try {
    const greeting = await reader.readExactly(2);
    if (greeting[0] !== 0x05 || greeting[1] === 0) {
      client.end(Buffer.from([0x05, 0xff]));
      return;
    }
    const methods = await reader.readExactly(greeting[1]);
    if (!methods.includes(0x02)) {
      client.end(Buffer.from([0x05, 0xff]));
      return;
    }
    client.write(Buffer.from([0x05, 0x02]));

    const authHeader = await reader.readExactly(2);
    if (authHeader[0] !== 0x01 || authHeader[1] === 0) {
      client.end(Buffer.from([0x01, 0x01]));
      return;
    }
    const username = (await reader.readExactly(authHeader[1])).toString('utf8');
    const passwordLength = (await reader.readExactly(1))[0] ?? 0;
    if (passwordLength === 0) {
      client.end(Buffer.from([0x01, 0x01]));
      return;
    }
    const password = (await reader.readExactly(passwordLength)).toString('utf8');
    if (!safeEqual(username, 'veritas') || !safeEqual(password, context.token)) {
      client.end(Buffer.from([0x01, 0x01]));
      return;
    }
    client.write(Buffer.from([0x01, 0x00]));

    const requestHeader = await reader.readExactly(4);
    if (requestHeader[0] !== 0x05 || requestHeader[2] !== 0x00) {
      endSocks(client, 0x01);
      return;
    }
    if (requestHeader[1] !== 0x01) {
      endSocks(client, 0x07);
      return;
    }
    const host = await readSocksHost(reader, requestHeader[3] ?? 0);
    if (!host) {
      endSocks(client, 0x08);
      return;
    }
    const port = (await reader.readExactly(2)).readUInt16BE(0);
    const resolution = await context.policyService.resolveAndEvaluate(context.policy, {
      protocol: 'socks',
      host,
      port,
    });
    const decision = await withApprovalIdlePause(client, context.idleTimeoutMs, () =>
      authorizeBlockedRequest(context, {
        protocol: 'socks',
        host,
        port,
        decision: resolution.decision,
      })
    );
    await audit(context, decision);
    if (decision.decision === 'block') {
      endSocks(client, 0x02);
      return;
    }
    const address = resolution.resolvedAddresses[0];
    if (!address) {
      endSocks(client, 0x04);
      return;
    }

    const transport = await openPinnedTransport(context, address, port);
    const upstream = transport.socket;
    client.write(socksReply(0x00));
    const remainder = reader.release();
    client.on('error', () => client.destroy());
    upstream.on('error', () => client.destroy());
    if (transport.head.length > 0) client.write(transport.head);
    if (remainder.length > 0) upstream.write(remainder);
    client.pipe(upstream);
    upstream.pipe(client);
  } catch {
    reader.release();
    if (!client.destroyed) endSocks(client, 0x01);
  }
}

class SocketByteReader {
  private buffer = Buffer.alloc(0);
  private requestedBytes = 0;
  private resolveRead?: (value: Buffer) => void;
  private rejectRead?: (error: Error) => void;
  private released = false;

  constructor(private readonly socket: Socket) {
    socket.on('data', this.onData);
    socket.once('close', this.onClose);
  }

  readExactly(size: number): Promise<Buffer> {
    if (!Number.isSafeInteger(size) || size < 1 || size > 65_535) {
      return Promise.reject(new Error('Invalid SOCKS frame length.'));
    }
    if (this.released || this.resolveRead) {
      return Promise.reject(new Error('SOCKS frame reader is unavailable.'));
    }
    if (this.buffer.length >= size) return Promise.resolve(this.take(size));
    this.requestedBytes = size;
    return new Promise<Buffer>((resolve, reject) => {
      this.resolveRead = resolve;
      this.rejectRead = reject;
    });
  }

  release(): Buffer {
    if (this.released) return Buffer.alloc(0);
    this.released = true;
    this.socket.off('data', this.onData);
    this.socket.off('close', this.onClose);
    const buffered = this.buffer;
    this.buffer = Buffer.alloc(0);
    return buffered;
  }

  private readonly onData = (chunk: Buffer): void => {
    if (this.released) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 65_535) {
      this.rejectPending(new Error('SOCKS handshake exceeded the supported size.'));
      this.socket.destroy();
      return;
    }
    if (!this.resolveRead || this.buffer.length < this.requestedBytes) return;
    const value = this.take(this.requestedBytes);
    const resolve = this.resolveRead;
    this.resolveRead = undefined;
    this.rejectRead = undefined;
    this.requestedBytes = 0;
    resolve(value);
  };

  private readonly onClose = (): void => {
    this.rejectPending(new Error('SOCKS client disconnected during negotiation.'));
  };

  private take(size: number): Buffer {
    const value = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return value;
  }

  private rejectPending(error: Error): void {
    const reject = this.rejectRead;
    this.resolveRead = undefined;
    this.rejectRead = undefined;
    this.requestedBytes = 0;
    reject?.(error);
  }
}

async function readSocksHost(
  reader: SocketByteReader,
  addressType: number
): Promise<string | null> {
  if (addressType === 0x01) {
    return [...(await reader.readExactly(4))].join('.');
  }
  if (addressType === 0x03) {
    const length = (await reader.readExactly(1))[0] ?? 0;
    if (length === 0) return null;
    return (await reader.readExactly(length)).toString('utf8').toLowerCase();
  }
  if (addressType === 0x04) {
    const address = await reader.readExactly(16);
    const groups: string[] = [];
    for (let offset = 0; offset < address.length; offset += 2) {
      groups.push(address.readUInt16BE(offset).toString(16));
    }
    return groups.join(':');
  }
  return null;
}

function socksReply(code: number): Buffer {
  return Buffer.from([0x05, code, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

function endSocks(socket: Socket, code: number): void {
  if (!socket.destroyed) socket.end(socksReply(code));
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

async function authorizeBlockedRequest(
  context: GatewayRequestContext,
  input: Omit<RunEgressGatewayApprovalRequest, 'gatewayId' | 'runKey' | 'signal'>
): Promise<RunEgressDecision> {
  if (
    input.decision.decision !== 'block' ||
    !input.decision.approvalEligible ||
    !context.onApprovalRequired ||
    context.signal.aborted
  ) {
    return input.decision;
  }
  const policyReason = input.decision.reason;
  if (
    policyReason === 'allowed-by-default' ||
    policyReason === 'allowed-by-host-rule' ||
    policyReason === 'allowed-by-approval'
  ) {
    return input.decision;
  }
  try {
    const result = await context.onApprovalRequired({
      gatewayId: context.gatewayId,
      runKey: context.runKey,
      ...input,
      signal: context.signal,
    });
    if (!result.approved) {
      return { ...input.decision, approvalId: result.approvalId };
    }
    return {
      ...input.decision,
      decision: 'allow',
      reason: 'allowed-by-approval',
      approvalEligible: false,
      approvalId: result.approvalId,
      policyReason,
    };
  } catch {
    return input.decision;
  }
}

async function withApprovalIdlePause<T>(
  socket: Socket,
  idleTimeoutMs: number,
  action: () => Promise<T>
): Promise<T> {
  socket.setTimeout(0);
  try {
    return await action();
  } finally {
    if (!socket.destroyed) socket.setTimeout(idleTimeoutMs, () => socket.destroy());
  }
}

async function openPinnedTransport(
  context: GatewayRequestContext,
  address: string,
  port: number
): Promise<{ socket: Socket; head: Buffer }> {
  const upstream = context.upstream;
  const socket = net.connect({
    host: upstream?.host ?? address,
    port: upstream?.port ?? port,
    ...(upstream ? {} : { family: net.isIP(address) }),
  });
  context.sockets.add(socket);
  socket.setTimeout(context.idleTimeoutMs, () => socket.destroy());
  socket.once('close', () => context.sockets.delete(socket));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  if (!upstream) return { socket, head: Buffer.alloc(0) };

  const authority = formatAuthority(address, port);
  socket.write(
    `CONNECT ${authority} HTTP/1.1\r\n` +
      `Host: ${authority}\r\n` +
      'Connection: keep-alive\r\n' +
      (upstream.authorization ? `Proxy-Authorization: ${upstream.authorization}\r\n` : '') +
      '\r\n'
  );
  const response = await readHttpResponseHead(socket);
  if (response.statusCode !== 200) {
    socket.destroy();
    throw new Error(`Upstream proxy rejected CONNECT with status ${response.statusCode}.`);
  }
  return { socket, head: response.head };
}

function readHttpResponseHead(socket: Socket): Promise<{ statusCode: number; head: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Upstream proxy disconnected during CONNECT.'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 16 * 1024) {
        cleanup();
        socket.destroy();
        reject(new Error('Upstream proxy response headers exceeded the supported size.'));
        return;
      }
      const boundary = buffer.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      const firstLine = buffer.subarray(0, boundary).toString('latin1').split('\r\n', 1)[0] ?? '';
      const match = /^HTTP\/1\.[01] ([1-5]\d{2})(?:\s|$)/.exec(firstLine);
      socket.pause();
      cleanup();
      if (!match) {
        socket.destroy();
        reject(new Error('Upstream proxy returned an invalid CONNECT response.'));
        return;
      }
      resolve({
        statusCode: Number(match[1]),
        head: buffer.subarray(boundary + 4),
      });
    };
    socket.on('data', onData);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
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

function parseUpstreamProxy(value: string | undefined): UpstreamProxy | undefined {
  const source = value?.trim();
  if (!source) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new ConflictError('Run egress upstream proxy URL is invalid.');
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    throw new ConflictError(
      'Run egress upstream proxy must be an HTTP origin without a path, query, or fragment.'
    );
  }
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConflictError('Run egress upstream proxy port is invalid.');
  }
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new ConflictError('Run egress upstream proxy credentials have invalid encoding.');
  }
  return {
    key: identity('upstream-proxy', parsed.toString()),
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port,
    ...(username || password
      ? {
          authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        }
      : {}),
  };
}

function formatAuthority(host: string, port: number): string {
  return `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
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

function normalizeUpstreamStatusCode(statusCode: number | undefined): number {
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode)) return 502;
  return statusCode >= 100 && statusCode <= 599 ? statusCode : 502;
}

function forwardHeaders(
  headers: IncomingHttpHeaders,
  host: string | undefined,
  preserveUpgrade: boolean
): string[] {
  const result: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'proxy-authorization' || lower === 'proxy-connection') continue;
    if (!preserveUpgrade && HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.push(lower, item);
    } else {
      result.push(lower, value);
    }
  }
  if (host) result.push('host', host);
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

function registerClientSocket(
  socket: Socket,
  clientSockets: Set<Socket>,
  sockets: Set<Socket>,
  maxConnections: number,
  idleTimeoutMs: number
): boolean {
  if (clientSockets.size >= maxConnections) {
    socket.destroy();
    return false;
  }
  clientSockets.add(socket);
  sockets.add(socket);
  socket.setTimeout(idleTimeoutMs, () => socket.destroy());
  socket.once('close', () => {
    clientSockets.delete(socket);
    sockets.delete(socket);
  });
  return true;
}

function listenLoopback(server: http.Server | NetServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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
}

function closeServer(server: http.Server | NetServer): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    if ('closeAllConnections' in server) server.closeAllConnections();
  });
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
