import type { Event, VerifiedEvent } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools';
import type { BuzzExternalCoordinate } from '@veritas-kanban/shared';
import { EnvironmentCredentialSecretSource } from './credential-broker-service.js';
import {
  NostrToolsBuzzEventSigner,
  NostrToolsBuzzNip98Signer,
  type BuzzNip98Signer,
  type BuzzNostrEventSigner,
} from './buzz-nip98-signer.js';
import {
  normalizeBuzzEndpoints,
  validateBuzzAuthTag,
  type BuzzProbeConfig,
} from './buzz-compatibility-service.js';
import { redactString } from '../lib/redact.js';
import { safeFetch, type UrlValidationOptions } from '../utils/url-validation.js';

export const BUZZ_MESSAGE_KIND = 9;
export const BUZZ_EDIT_KIND = 40_003;
export const BUZZ_DELETE_KIND = 9_005;
export const BUZZ_DELETE_COMPAT_KIND = 5;
export const BUZZ_SUBSCRIBED_KINDS = [
  BUZZ_MESSAGE_KIND,
  BUZZ_EDIT_KIND,
  BUZZ_DELETE_KIND,
  BUZZ_DELETE_COMPAT_KIND,
] as const;

const MAX_EVENT_BYTES = 256 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const EVENT_ID_PATTERN = /^[a-f0-9]{64}$/;
const CHANNEL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BuzzOutboundMessage {
  channelId: string;
  content: string;
  idempotencyKey: string;
  rootEventId?: string;
  parentEventId?: string;
}

export interface BuzzPreparedMessage {
  event: VerifiedEvent;
  coordinate: BuzzExternalCoordinate;
}

export interface BuzzSubmitResult {
  status: 'accepted' | 'rejected' | 'delivery_unknown';
  eventId: string;
  detail?: string;
}

export interface BuzzInboundEvent {
  event: VerifiedEvent;
  coordinate: BuzzExternalCoordinate;
  content: string;
  targetEventId?: string;
}

interface BuzzCommunicationServiceOptions {
  fetch?: (
    url: string,
    init?: RequestInit,
    validationOptions?: UrlValidationOptions
  ) => Promise<Response | null>;
  resolveSecret?: (reference: string) => Promise<string | undefined>;
  nip98Signer?: BuzzNip98Signer;
  eventSigner?: BuzzNostrEventSigner;
  now?: () => Date;
  timeoutMs?: number;
}

function sanitizeDetail(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return redactString(raw)
    .replace(/nsec1[a-z0-9]+/gi, '[REDACTED]')
    .replace(/\b[a-f0-9]{64,128}\b/gi, '[REDACTED]')
    .slice(0, 500);
}

function extractTag(tags: string[][], name: string): string | undefined {
  return tags.find((tag) => tag[0] === name && typeof tag[1] === 'string')?.[1];
}

function threadCoordinate(tags: string[][]): {
  rootEventId?: string;
  parentEventId?: string;
} {
  let rootEventId: string | undefined;
  let parentEventId: string | undefined;
  for (const tag of tags) {
    if (tag[0] !== 'e' || !EVENT_ID_PATTERN.test(tag[1] ?? '')) continue;
    if (tag[3] === 'root') rootEventId = tag[1];
    if (tag[3] === 'reply') parentEventId = tag[1];
  }
  if (!rootEventId && parentEventId) rootEventId = parentEventId;
  return { rootEventId, parentEventId };
}

function targetEventId(tags: string[][]): string | undefined {
  return tags.find((tag) => tag[0] === 'e' && EVENT_ID_PATTERN.test(tag[1] ?? ''))?.[1];
}

function validationOptions(config: BuzzProbeConfig): UrlValidationOptions {
  return {
    allowHttp: config.relayHttpUrl.startsWith('http://'),
    allowLocalhost: Boolean(config.allowLocalhost),
    allowPrivateNetwork: Boolean(config.allowPrivateNetwork),
    logFailures: false,
  };
}

async function readBoundedBody(response: Response, limit = MAX_EVENT_BYTES): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new Error('Buzz response exceeded the configured size limit');
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

export function buildBuzzMessageDeepLink(input: {
  channelId: string;
  eventId: string;
  rootEventId?: string;
}): string {
  const params = new URLSearchParams({ channel: input.channelId, id: input.eventId });
  if (input.rootEventId) params.set('thread', input.rootEventId);
  return `buzz://message?${params.toString()}`;
}

export function parseBuzzInboundEvent(
  value: unknown,
  input: { community: string; channelId: string; now?: Date }
): BuzzInboundEvent {
  if (!value || typeof value !== 'object') throw new Error('Buzz event is not an object');
  const candidate = value as Partial<VerifiedEvent>;
  const { id, pubkey, created_at: createdAt, kind, tags, content, sig } = candidate;
  if (
    typeof id !== 'string' ||
    !EVENT_ID_PATTERN.test(id) ||
    typeof pubkey !== 'string' ||
    !EVENT_ID_PATTERN.test(pubkey) ||
    typeof createdAt !== 'number' ||
    !Number.isInteger(createdAt) ||
    typeof kind !== 'number' ||
    typeof content !== 'string' ||
    !Array.isArray(tags) ||
    !tags.every((tag) => Array.isArray(tag) && tag.every((entry) => typeof entry === 'string')) ||
    typeof sig !== 'string' ||
    !/^[a-f0-9]{128}$/i.test(sig)
  ) {
    throw new Error('Buzz event has an invalid Nostr shape');
  }
  // Reconstruct the wire schema so nostr-tools never trusts a cached verification
  // symbol attached by another in-process caller.
  const event: Event = {
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags: tags.map((tag) => [...tag]),
    content,
    sig,
  };
  if (!BUZZ_SUBSCRIBED_KINDS.includes(event.kind as (typeof BUZZ_SUBSCRIBED_KINDS)[number])) {
    throw new Error('Buzz event kind is not allowlisted');
  }
  if (Buffer.byteLength(JSON.stringify(event), 'utf8') > MAX_EVENT_BYTES) {
    throw new Error('Buzz event exceeds the configured size limit');
  }
  if (Buffer.byteLength(event.content, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error('Buzz event content exceeds the supported message limit');
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (event.created_at < 1 || event.created_at > nowSeconds + 300) {
    throw new Error('Buzz event timestamp is outside the accepted range');
  }
  if (!CHANNEL_ID_PATTERN.test(input.channelId)) throw new Error('Buzz channel ID is invalid');
  const channelId = extractTag(event.tags, 'h');
  if (channelId?.toLowerCase() !== input.channelId.toLowerCase()) {
    throw new Error('Buzz event channel does not match the mapped channel');
  }
  if (!verifyEvent(event)) throw new Error('Buzz event signature is invalid');

  const thread = event.kind === BUZZ_MESSAGE_KIND ? threadCoordinate(event.tags) : {};
  const coordinate: BuzzExternalCoordinate = {
    community: input.community,
    channelId: input.channelId.toLowerCase(),
    eventId: event.id,
    authorPubkey: event.pubkey,
    kind: event.kind,
    rootEventId: thread.rootEventId,
    parentEventId: thread.parentEventId,
    externalUrl: buildBuzzMessageDeepLink({
      channelId: input.channelId,
      eventId: event.id,
      rootEventId: thread.rootEventId,
    }),
  };

  return {
    event,
    coordinate,
    content: event.content,
    targetEventId:
      event.kind === BUZZ_EDIT_KIND ||
      event.kind === BUZZ_DELETE_KIND ||
      event.kind === BUZZ_DELETE_COMPAT_KIND
        ? targetEventId(event.tags)
        : undefined,
  };
}

export class BuzzCommunicationService {
  private readonly fetch: NonNullable<BuzzCommunicationServiceOptions['fetch']>;
  private readonly resolveSecret: NonNullable<BuzzCommunicationServiceOptions['resolveSecret']>;
  private readonly nip98Signer: BuzzNip98Signer;
  private readonly eventSigner: BuzzNostrEventSigner;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: BuzzCommunicationServiceOptions = {}) {
    this.fetch = options.fetch ?? safeFetch;
    this.resolveSecret =
      options.resolveSecret ??
      (async (reference) => {
        if (!reference.startsWith('env:')) return undefined;
        return new EnvironmentCredentialSecretSource().resolve({
          kind: 'environment',
          reference: reference.slice(4),
        });
      });
    this.nip98Signer = options.nip98Signer ?? new NostrToolsBuzzNip98Signer();
    this.eventSigner = options.eventSigner ?? new NostrToolsBuzzEventSigner();
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async prepareMessage(
    config: BuzzProbeConfig,
    input: BuzzOutboundMessage
  ): Promise<BuzzPreparedMessage> {
    if (!CHANNEL_ID_PATTERN.test(input.channelId)) throw new Error('Buzz channel ID is invalid');
    if (!input.content.trim()) throw new Error('Buzz message is empty');
    if (Buffer.byteLength(input.content, 'utf8') > MAX_MESSAGE_BYTES) {
      throw new Error('Buzz message exceeds the 64 KiB relay limit');
    }
    if (
      input.rootEventId &&
      (!EVENT_ID_PATTERN.test(input.rootEventId) ||
        !input.parentEventId ||
        !EVENT_ID_PATTERN.test(input.parentEventId))
    ) {
      throw new Error('Buzz reply coordinates are invalid');
    }

    const privateKey = await this.requireSecret(config.credentialRef, 'signing key');
    const tags: string[][] = [['h', input.channelId.toLowerCase()]];
    if (input.rootEventId && input.parentEventId) {
      if (input.rootEventId === input.parentEventId) {
        tags.push(['e', input.rootEventId, '', 'reply']);
      } else {
        tags.push(['e', input.rootEventId, '', 'root']);
        tags.push(['e', input.parentEventId, '', 'reply']);
      }
    }
    tags.push(['client', 'veritas-kanban']);
    tags.push(['veritas-id', input.idempotencyKey]);

    const event = await this.eventSigner.sign({
      privateKey,
      kind: BUZZ_MESSAGE_KIND,
      createdAt: Math.floor(this.now().getTime() / 1000),
      tags,
      content: input.content,
    });
    if (event.pubkey.toLowerCase() !== config.publicKey.toLowerCase()) {
      throw new Error('Buzz signing key does not match the configured public identity');
    }
    const endpoints = normalizeBuzzEndpoints(config);
    const coordinate: BuzzExternalCoordinate = {
      community: endpoints.community,
      channelId: input.channelId.toLowerCase(),
      eventId: event.id,
      authorPubkey: event.pubkey,
      kind: event.kind,
      rootEventId: input.rootEventId,
      parentEventId: input.parentEventId,
      externalUrl: buildBuzzMessageDeepLink({
        channelId: input.channelId,
        eventId: event.id,
        rootEventId: input.rootEventId,
      }),
    };
    return { event, coordinate };
  }

  async submitEvent(config: BuzzProbeConfig, event: VerifiedEvent): Promise<BuzzSubmitResult> {
    const endpoints = normalizeBuzzEndpoints(config);
    const url = `${endpoints.httpUrl}/events`;
    const body = JSON.stringify(event);
    try {
      const response = await this.signedRequest(config, url, body);
      if (!response) {
        return {
          status: 'rejected',
          eventId: event.id,
          detail: 'Buzz relay request was blocked by outbound network policy.',
        };
      }
      const responseBody = await readBoundedBody(response);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(responseBody) as Record<string, unknown>;
      } catch {
        if (response.ok) {
          return {
            status: 'delivery_unknown',
            eventId: event.id,
            detail: 'Buzz returned an unreadable acknowledgement.',
          };
        }
      }
      const responseEventId =
        typeof parsed.event_id === 'string' && EVENT_ID_PATTERN.test(parsed.event_id)
          ? parsed.event_id
          : event.id;
      if (response.ok && parsed.accepted === true && responseEventId === event.id) {
        return { status: 'accepted', eventId: event.id };
      }
      if (response.ok) {
        return {
          status: 'delivery_unknown',
          eventId: event.id,
          detail: 'Buzz returned an acknowledgement that did not confirm this event ID.',
        };
      }
      return {
        status: response.status >= 500 ? 'delivery_unknown' : 'rejected',
        eventId: event.id,
        detail: sanitizeDetail(
          typeof parsed.message === 'string'
            ? parsed.message
            : `Buzz relay returned HTTP ${response.status}.`
        ),
      };
    } catch (error) {
      return {
        status: 'delivery_unknown',
        eventId: event.id,
        detail: sanitizeDetail(error),
      };
    }
  }

  async eventExists(config: BuzzProbeConfig, eventId: string): Promise<boolean | undefined> {
    if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('Buzz event ID is invalid');
    const endpoints = normalizeBuzzEndpoints(config);
    const url = `${endpoints.httpUrl}/query`;
    const body = JSON.stringify([{ ids: [eventId], limit: 1 }]);
    try {
      const response = await this.signedRequest(config, url, body);
      if (!response || !response.ok) return undefined;
      const responseBody = await readBoundedBody(response);
      const parsed = JSON.parse(responseBody) as unknown;
      if (!Array.isArray(parsed)) return undefined;
      return parsed.some(
        (candidate) =>
          candidate &&
          typeof candidate === 'object' &&
          (candidate as { id?: unknown }).id === eventId
      );
    } catch {
      return undefined;
    }
  }

  async resolveCredentials(
    config: BuzzProbeConfig
  ): Promise<{ privateKey: string; authTag?: string }> {
    const privateKey = await this.requireSecret(config.credentialRef, 'signing key');
    const rawAuthTag = config.authTagRef
      ? await this.requireSecret(config.authTagRef, 'NIP-OA auth tag')
      : undefined;
    return {
      privateKey,
      authTag: rawAuthTag ? validateBuzzAuthTag(rawAuthTag) : undefined,
    };
  }

  private async signedRequest(
    config: BuzzProbeConfig,
    url: string,
    body: string
  ): Promise<Response | null> {
    const { privateKey, authTag } = await this.resolveCredentials(config);
    const signed = await this.nip98Signer.sign({
      privateKey,
      method: 'POST',
      url,
      body,
    });
    if (signed.publicKey.toLowerCase() !== config.publicKey.toLowerCase()) {
      throw new Error('Buzz signing key does not match the configured public identity');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      return await this.fetch(
        url,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: signed.authorization,
            'Content-Type': 'application/json',
            ...(authTag ? { 'x-auth-tag': authTag } : {}),
          },
          body,
          signal: controller.signal,
          redirect: 'manual',
        },
        validationOptions(config)
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requireSecret(reference: string, label: string): Promise<string> {
    const value = await this.resolveSecret(reference);
    if (!value) throw new Error(`Buzz ${label} reference is unavailable`);
    return value;
  }
}
