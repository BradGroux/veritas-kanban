import WebSocket, { type ClientOptions, type RawData } from 'ws';
import type { LookupFunction } from 'node:net';
import type { BuzzChannelMapping, BuzzCursor, BuzzRuntimeHealth } from '@veritas-kanban/shared';
import { NostrToolsBuzzEventSigner, type BuzzNostrEventSigner } from './buzz-nip98-signer.js';
import { BuzzCommunicationService, BUZZ_SUBSCRIBED_KINDS } from './buzz-communication-service.js';
import { normalizeBuzzEndpoints, type BuzzProbeConfig } from './buzz-compatibility-service.js';
import { resolveOutboundUrl } from '../utils/url-validation.js';
import { redactString } from '../lib/redact.js';

const MAX_FRAME_BYTES = 256 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const REPLAY_OVERLAP_SECONDS = 5;
const MAX_RECONNECT_DELAY_MS = 30_000;

export interface BuzzSubscriptionWorkerConfig {
  adapterId: string;
  probeConfig: BuzzProbeConfig;
  mappings: BuzzChannelMapping[];
  cursors: BuzzCursor[];
}

export interface BuzzSubscriptionWorkerCallbacks {
  onEvent: (mapping: BuzzChannelMapping, event: unknown) => Promise<BuzzCursor | undefined>;
  onHealth: (health: Partial<BuzzRuntimeHealth>) => Promise<void> | void;
}

export interface BuzzSubscriptionWorkerHandle {
  start(): void;
  stop(): Promise<void>;
}

export interface BuzzSubscriptionWorkerFactory {
  create(
    config: BuzzSubscriptionWorkerConfig,
    callbacks: BuzzSubscriptionWorkerCallbacks
  ): BuzzSubscriptionWorkerHandle;
}

interface BuzzSubscriptionWorkerOptions {
  communication?: BuzzCommunicationService;
  eventSigner?: BuzzNostrEventSigner;
  createSocket?: (url: string, options: BuzzSocketOptions) => WebSocket;
  now?: () => Date;
  random?: () => number;
}

type BuzzSocketOptions = ClientOptions & { lookup?: LookupFunction };

function safeDetail(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return redactString(raw)
    .replace(/nsec1[a-z0-9]+/gi, '[REDACTED]')
    .replace(/\b[a-f0-9]{64,128}\b/gi, '[REDACTED]')
    .slice(0, 500);
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

function webSocketValidationUrl(webSocketUrl: string): string {
  const parsed = new URL(webSocketUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  return parsed.toString();
}

export class BuzzSubscriptionWorker implements BuzzSubscriptionWorkerHandle {
  private readonly communication: BuzzCommunicationService;
  private readonly eventSigner: BuzzNostrEventSigner;
  private readonly createSocket: NonNullable<BuzzSubscriptionWorkerOptions['createSocket']>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private socket?: WebSocket;
  private stopped = true;
  private terminal = false;
  private authenticated = false;
  private authEventId?: string;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private processing: Promise<void> = Promise.resolve();
  private awaitingPong = false;
  private readonly cursors = new Map<string, BuzzCursor>();

  constructor(
    private readonly config: BuzzSubscriptionWorkerConfig,
    private readonly callbacks: BuzzSubscriptionWorkerCallbacks,
    options: BuzzSubscriptionWorkerOptions = {}
  ) {
    this.communication = options.communication ?? new BuzzCommunicationService();
    this.eventSigner = options.eventSigner ?? new NostrToolsBuzzEventSigner();
    this.createSocket =
      options.createSocket ?? ((url, socketOptions) => new WebSocket(url, socketOptions));
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    for (const cursor of config.cursors) {
      this.cursors.set(cursor.channelId.toLowerCase(), cursor);
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.terminal = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.terminal = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState === WebSocket.OPEN) {
      for (const mapping of this.config.mappings) {
        socket.send(JSON.stringify(['CLOSE', this.subscriptionId(mapping.channelId)]));
      }
      socket.close(1000, 'Adapter disabled');
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
    await this.processing.catch(() => {});
    await this.callbacks.onHealth({
      relayConnected: false,
      subscriptionActive: false,
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.terminal || this.config.mappings.length === 0) return;
    try {
      const endpoints = normalizeBuzzEndpoints(this.config.probeConfig);
      const resolved = await resolveOutboundUrl(webSocketValidationUrl(endpoints.webSocketUrl), {
        allowHttp: endpoints.webSocketUrl.startsWith('ws://'),
        allowLocalhost: Boolean(this.config.probeConfig.allowLocalhost),
        allowPrivateNetwork: Boolean(this.config.probeConfig.allowPrivateNetwork),
        logFailures: false,
      });
      if (!resolved) throw new Error('Buzz WebSocket endpoint was blocked by network policy');
      const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [resolved.resolvedAddress]);
          return;
        }
        callback(null, resolved.resolvedAddress.address, resolved.resolvedAddress.family);
      };
      const socketOptions: BuzzSocketOptions = {
        handshakeTimeout: CONNECT_TIMEOUT_MS,
        maxPayload: MAX_FRAME_BYTES,
        perMessageDeflate: false,
        lookup: pinnedLookup,
      };
      const socket = this.createSocket(endpoints.webSocketUrl, socketOptions);
      this.socket = socket;
      this.authenticated = false;
      this.authEventId = undefined;
      socket.on('open', () => {
        if (this.stopped) {
          socket.close(1000, 'Adapter disabled');
          return;
        }
        this.reconnectAttempts = 0;
        this.startHeartbeat(socket);
        void this.callbacks.onHealth({
          relayConnected: true,
          subscriptionActive: false,
          reconnectAttempts: 0,
          lastConnectedAt: this.now().toISOString(),
          lastError: undefined,
        });
      });
      socket.on('pong', () => {
        this.awaitingPong = false;
      });
      socket.on('message', (data) => {
        this.processing = this.processing
          .then(() => this.handleMessage(socket, rawDataToString(data)))
          .catch(async (error) => {
            await this.callbacks.onHealth({ lastError: safeDetail(error) });
          });
      });
      socket.on('error', (error) => {
        void this.callbacks.onHealth({ lastError: safeDetail(error) });
      });
      socket.on('close', (code, reason) => {
        if (this.socket === socket) this.socket = undefined;
        this.authenticated = false;
        this.stopHeartbeat();
        void this.callbacks.onHealth({
          relayConnected: false,
          subscriptionActive: false,
          lastError:
            code === 1000 && this.stopped
              ? undefined
              : safeDetail(reason.toString('utf8') || `Buzz WebSocket closed with code ${code}`),
        });
        this.scheduleReconnect();
      });
    } catch (error) {
      await this.callbacks.onHealth({
        relayConnected: false,
        subscriptionActive: false,
        lastError: safeDetail(error),
      });
      this.scheduleReconnect();
    }
  }

  private async handleMessage(socket: WebSocket, text: string): Promise<void> {
    if (Buffer.byteLength(text, 'utf8') > MAX_FRAME_BYTES) {
      throw new Error('Buzz WebSocket frame exceeded the configured size limit');
    }
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      throw new Error('Buzz WebSocket sent invalid JSON');
    }
    if (!Array.isArray(frame) || typeof frame[0] !== 'string') {
      throw new Error('Buzz WebSocket sent an invalid NIP-01 frame');
    }
    switch (frame[0]) {
      case 'AUTH':
        if (typeof frame[1] !== 'string' || !frame[1]) {
          throw new Error('Buzz WebSocket AUTH challenge is invalid');
        }
        await this.sendAuth(socket, frame[1]);
        return;
      case 'OK':
        if (
          typeof frame[1] === 'string' &&
          frame[1] === this.authEventId &&
          typeof frame[2] === 'boolean'
        ) {
          if (!frame[2]) {
            this.terminal = true;
            const detail =
              typeof frame[3] === 'string' && frame[3]
                ? frame[3]
                : 'Buzz WebSocket authentication was rejected';
            await this.callbacks.onHealth({ lastError: safeDetail(detail) });
            socket.close(4003, 'Authentication rejected');
            return;
          }
          this.authenticated = true;
          await this.subscribe(socket);
        }
        return;
      case 'EOSE':
        if (typeof frame[1] === 'string' && frame[1].startsWith('vk-buzz-')) {
          await this.callbacks.onHealth({ subscriptionActive: true });
        }
        return;
      case 'EVENT': {
        if (!this.authenticated || typeof frame[1] !== 'string') return;
        const mapping = this.mappingForSubscription(frame[1]);
        if (!mapping) return;
        const cursor = await this.callbacks.onEvent(mapping, frame[2]);
        if (cursor) this.cursors.set(mapping.channelId.toLowerCase(), cursor);
        await this.callbacks.onHealth({ lastEventAt: this.now().toISOString() });
        return;
      }
      case 'CLOSED': {
        const message = typeof frame[2] === 'string' ? frame[2] : 'Subscription closed';
        if (/auth|membership|forbidden|unsupported/i.test(message)) {
          this.terminal = true;
        }
        await this.callbacks.onHealth({
          subscriptionActive: false,
          lastError: safeDetail(message),
        });
        socket.close(
          this.terminal ? 4003 : 1012,
          this.terminal ? 'Subscription rejected' : 'Subscription interrupted'
        );
        return;
      }
      case 'NOTICE':
        await this.callbacks.onHealth({
          lastError: safeDetail(typeof frame[1] === 'string' ? frame[1] : 'Buzz relay notice'),
        });
        return;
      default:
        return;
    }
  }

  private async sendAuth(socket: WebSocket, challenge: string): Promise<void> {
    const endpoints = normalizeBuzzEndpoints(this.config.probeConfig);
    const { privateKey, authTag } = await this.communication.resolveCredentials(
      this.config.probeConfig
    );
    const tags: string[][] = [
      ['relay', endpoints.webSocketUrl],
      ['challenge', challenge],
    ];
    if (authTag) tags.push(JSON.parse(authTag) as string[]);
    const event = await this.eventSigner.sign({
      privateKey,
      kind: 22_242,
      createdAt: Math.floor(this.now().getTime() / 1000),
      tags,
      content: '',
    });
    if (event.pubkey.toLowerCase() !== this.config.probeConfig.publicKey.toLowerCase()) {
      throw new Error('Buzz WebSocket signing key does not match the configured identity');
    }
    this.authEventId = event.id;
    socket.send(JSON.stringify(['AUTH', event]));
  }

  private async subscribe(socket: WebSocket): Promise<void> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    for (const mapping of this.config.mappings) {
      const cursor = this.cursors.get(mapping.channelId.toLowerCase());
      const since = cursor
        ? Math.max(0, cursor.createdAt - REPLAY_OVERLAP_SECONDS)
        : Math.max(0, nowSeconds - REPLAY_OVERLAP_SECONDS);
      socket.send(
        JSON.stringify([
          'REQ',
          this.subscriptionId(mapping.channelId),
          {
            kinds: [...BUZZ_SUBSCRIBED_KINDS],
            '#h': [mapping.channelId],
            since,
          },
        ])
      );
    }
    await this.callbacks.onHealth({
      subscriptionActive: false,
      mappedChannels: this.config.mappings.length,
    });
  }

  private mappingForSubscription(subscriptionId: string): BuzzChannelMapping | undefined {
    return this.config.mappings.find(
      (mapping) => this.subscriptionId(mapping.channelId) === subscriptionId
    );
  }

  private subscriptionId(channelId: string): string {
    return `vk-buzz-${channelId}`;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.terminal || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const ceiling = Math.min(
      MAX_RECONNECT_DELAY_MS,
      1_000 * 2 ** Math.min(this.reconnectAttempts - 1, 5)
    );
    const delay = Math.max(250, Math.floor(this.random() * ceiling));
    void this.callbacks.onHealth({ reconnectAttempts: this.reconnectAttempts });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.awaitingPong = false;
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (this.awaitingPong) {
        socket.terminate();
        return;
      }
      this.awaitingPong = true;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.awaitingPong = false;
  }
}

export class DefaultBuzzSubscriptionWorkerFactory implements BuzzSubscriptionWorkerFactory {
  create(
    config: BuzzSubscriptionWorkerConfig,
    callbacks: BuzzSubscriptionWorkerCallbacks
  ): BuzzSubscriptionWorkerHandle {
    return new BuzzSubscriptionWorker(config, callbacks);
  }
}
