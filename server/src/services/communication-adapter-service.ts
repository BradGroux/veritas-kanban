import path from 'path';
import { nanoid } from 'nanoid';
import type { VerifiedEvent } from 'nostr-tools';
import type {
  CommunicationAdapterHealth,
  CommunicationAdapterInput,
  CommunicationAdapterRecord,
  CommunicationDeliveryAudit,
  CommunicationDeliveryOperation,
  CommunicationDeliveryStatus,
  CommunicationReplyIngestInput,
  CommunicationReplyIngestResult,
  CommunicationReplyTarget,
  CommunicationSendInput,
  CommunicationSendResult,
  CommunicationThreadMapping,
  BuzzChannelMapping,
  BuzzCursor,
  BuzzExternalCoordinate,
  BuzzRuntimeHealth,
  SquadMessage,
} from '@veritas-kanban/shared';
import {
  BUZZ_COMPATIBILITY_SCHEMA_VERSION,
  BUZZ_PROBE_REVISION,
  BUZZ_TESTED_COMMIT,
  BUZZ_TESTED_RELEASE,
} from '@veritas-kanban/shared';
import { auditLog, type AuditEvent } from './audit-service.js';
import { getChatService, type ChatService } from './chat-service.js';
import {
  getOutboundIntegrationService,
  type OutboundIntegrationService,
} from './outbound-integration-service.js';
import { withFileLock } from './file-lock.js';
import { redactString } from '../lib/redact.js';
import { ensureWithinBase, sanitizeCommentText, validatePathSegment } from '../utils/sanitize.js';
import { getRuntimeDir } from '../utils/paths.js';
import { atomicWriteFile, mkdir, readFile } from '../storage/fs-helpers.js';
import {
  BuzzCompatibilityService,
  fingerprintBuzzPublicKey,
  normalizeBuzzEndpoints,
  type BuzzProbeConfig,
  type NormalizedBuzzEndpoints,
} from './buzz-compatibility-service.js';
import {
  BuzzCommunicationService,
  BUZZ_DELETE_COMPAT_KIND,
  BUZZ_DELETE_KIND,
  BUZZ_EDIT_KIND,
  BUZZ_MESSAGE_KIND,
  parseBuzzInboundEvent,
} from './buzz-communication-service.js';
import {
  DefaultBuzzSubscriptionWorkerFactory,
  type BuzzSubscriptionWorkerFactory,
  type BuzzSubscriptionWorkerHandle,
} from './buzz-subscription-worker.js';
import { broadcastSquadMessage } from './broadcast-service.js';
import {
  buzzAdapterConfigSchema,
  type BuzzAdapterConfig,
} from '../schemas/communication-adapter-schemas.js';

const DEFAULT_ADAPTER_ID = 'msteams-default';
const MAX_DELIVERIES = 500;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_BUZZ_EVENTS = 2_000;
const MAX_BUZZ_PENDING_EVENTS = 250;
const MAX_BUZZ_OUTBOUND_RECORDS = 1_000;

interface InternalCommunicationAdapterRecord extends CommunicationAdapterRecord {
  webhookUrlRaw?: string;
  buzzConfigKey?: string;
}

interface CommunicationAdapterState {
  version: 2;
  adapters: Record<string, InternalCommunicationAdapterRecord>;
  mappings: Record<string, CommunicationThreadMapping>;
  buzzChannelMappings: Record<string, BuzzChannelMapping>;
  buzzCursors: Record<string, BuzzCursor>;
  buzzEvents: Record<string, BuzzEventRecord>;
  buzzPendingEvents: Record<string, BuzzPendingEvent>;
  buzzOutbound: Record<string, BuzzOutboundRecord>;
  buzzRuntime: Record<string, BuzzRuntimeHealth>;
  replyIds: Record<string, string>;
  deliveries: CommunicationDeliveryAudit[];
  updatedAt: string;
}

interface BuzzEventRecord {
  key: string;
  adapterId: string;
  direction: 'inbound' | 'outbound';
  coordinate: BuzzExternalCoordinate;
  squadMessageId?: string;
  deliveryId?: string;
  recordedAt: string;
}

interface BuzzPendingEvent {
  key: string;
  adapterId: string;
  mappingId: string;
  event: VerifiedEvent;
  recordedAt: string;
}

interface BuzzOutboundRecord {
  eventId: string;
  adapterId: string;
  event: VerifiedEvent;
  coordinate: BuzzExternalCoordinate;
  target: CommunicationReplyTarget;
  squadMessageId?: string;
  deliveryId: string;
  status: 'queued' | 'accepted' | 'delivery_unknown' | 'rejected';
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationAdapterServiceOptions {
  storageDir?: string;
  persist?: boolean;
  chatService?: ChatService;
  outboundIntegrations?: OutboundIntegrationService;
  buzzCompatibility?: BuzzCompatibilityService;
  buzzCommunication?: BuzzCommunicationService;
  buzzWorkerFactory?: BuzzSubscriptionWorkerFactory;
  audit?: (event: AuditEvent) => Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimOrUndefined(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

interface ValidatedBuzzAdapterConfig {
  config: BuzzAdapterConfig;
  endpoints: NormalizedBuzzEndpoints;
  probeConfig: BuzzProbeConfig;
  configKey: string;
}

export interface BuzzQueryContext {
  probeConfig: BuzzProbeConfig;
  relay: string;
  community: string;
}

function buzzConfigKey(config: BuzzProbeConfig, endpoints: NormalizedBuzzEndpoints): string {
  return JSON.stringify({
    probeRevision: BUZZ_PROBE_REVISION,
    testedRelease: BUZZ_TESTED_RELEASE,
    testedCommit: BUZZ_TESTED_COMMIT,
    relayHttpUrl: endpoints.httpUrl,
    relayWebSocketUrl: endpoints.webSocketUrl,
    expectedCommunity: endpoints.expectedCommunity,
    publicKey: config.publicKey,
    credentialRef: config.credentialRef,
    authTagRef: config.authTagRef,
    allowLocalhost: Boolean(config.allowLocalhost),
    allowPrivateNetwork: Boolean(config.allowPrivateNetwork),
    command: config.command,
  });
}

function validateStoredBuzzConfig(
  adapter: InternalCommunicationAdapterRecord
): ValidatedBuzzAdapterConfig | null {
  const parsed = buzzAdapterConfigSchema.safeParse({
    kind: 'buzz',
    displayName: adapter.displayName,
    enabled: adapter.enabled,
    relayHttpUrl: adapter.relayHttpUrl,
    relayWebSocketUrl: adapter.relayWebSocketUrl,
    expectedCommunity: adapter.expectedCommunity,
    publicKey: adapter.publicKey,
    credentialRef: adapter.credentialRef,
    authTagRef: adapter.authTagRef,
    allowLocalhost: adapter.allowLocalhost,
    allowPrivateNetwork: adapter.allowPrivateNetwork,
    command: adapter.command,
  });
  if (!parsed.success) return null;

  try {
    const endpoints = normalizeBuzzEndpoints({
      relayHttpUrl: parsed.data.relayHttpUrl,
      relayWebSocketUrl: parsed.data.relayWebSocketUrl ?? undefined,
      expectedCommunity: parsed.data.expectedCommunity ?? undefined,
    });
    const probeConfig: BuzzProbeConfig = {
      enabled: parsed.data.enabled ?? true,
      relayHttpUrl: parsed.data.relayHttpUrl,
      relayWebSocketUrl: parsed.data.relayWebSocketUrl ?? undefined,
      expectedCommunity: parsed.data.expectedCommunity ?? undefined,
      publicKey: parsed.data.publicKey.toLowerCase(),
      credentialRef: parsed.data.credentialRef,
      authTagRef: parsed.data.authTagRef ?? undefined,
      allowLocalhost: parsed.data.allowLocalhost,
      allowPrivateNetwork: parsed.data.allowPrivateNetwork,
      command: parsed.data.command ?? undefined,
    };
    return {
      config: parsed.data,
      endpoints,
      probeConfig,
      configKey: buzzConfigKey(probeConfig, endpoints),
    };
  } catch {
    return null;
  }
}

function isCurrentBuzzCompatibility(
  adapter: InternalCommunicationAdapterRecord,
  validated: ValidatedBuzzAdapterConfig
): boolean {
  const compatibility = adapter.compatibility;
  return Boolean(
    compatibility &&
    compatibility.schemaVersion === BUZZ_COMPATIBILITY_SCHEMA_VERSION &&
    compatibility.probeRevision === BUZZ_PROBE_REVISION &&
    compatibility.testedRelease === BUZZ_TESTED_RELEASE &&
    compatibility.testedCommit === BUZZ_TESTED_COMMIT &&
    adapter.buzzConfigKey === validated.configKey
  );
}

function sanitizeUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'buzz:') {
      const channel = parsed.searchParams.get('channel');
      const eventId = parsed.searchParams.get('id');
      const rootEventId = parsed.searchParams.get('thread');
      if (
        parsed.hostname !== 'message' ||
        parsed.username ||
        parsed.password ||
        parsed.hash ||
        !channel ||
        !/^[0-9a-f-]{36}$/i.test(channel) ||
        !eventId ||
        !/^[a-f0-9]{64}$/i.test(eventId) ||
        (rootEventId && !/^[a-f0-9]{64}$/i.test(rootEventId))
      ) {
        return '[invalid-url]';
      }
      const params = new URLSearchParams({
        channel: channel.toLowerCase(),
        id: eventId.toLowerCase(),
      });
      if (rootEventId) params.set('thread', rootEventId.toLowerCase());
      return `buzz://message?${params.toString()}`;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return '[invalid-url]';
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '[invalid-url]';
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactString(message).slice(0, 500);
}

function normalizeTarget(target: CommunicationReplyTarget): CommunicationReplyTarget {
  return {
    kind: target.kind,
    squadMessageId: trimOrUndefined(target.squadMessageId),
    taskId: trimOrUndefined(target.taskId),
    runId: trimOrUndefined(target.runId),
    approvalId: trimOrUndefined(target.approvalId),
    notificationId: trimOrUndefined(target.notificationId),
  };
}

function normalizeBuzzChannelId(value: string): string {
  const channelId = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(channelId)
  ) {
    throw new Error('Buzz channel ID must be a valid UUID');
  }
  return channelId;
}

function isUsableBuzzChannelMapping(
  mapping: BuzzChannelMapping,
  adapterId: string,
  community: string
): boolean {
  try {
    return (
      mapping.adapterId === adapterId &&
      mapping.community.toLowerCase() === community.toLowerCase() &&
      mapping.target.kind === 'squad' &&
      normalizeBuzzChannelId(mapping.channelId) === mapping.channelId.toLowerCase()
    );
  } catch {
    return false;
  }
}

function isUsableBuzzCursor(cursor: BuzzCursor, mappings: BuzzChannelMapping[]): boolean {
  return Boolean(
    Number.isInteger(cursor.createdAt) &&
    cursor.createdAt >= 0 &&
    /^[a-f0-9]{64}$/i.test(cursor.eventId) &&
    mappings.some(
      (mapping) =>
        mapping.adapterId === cursor.adapterId &&
        mapping.community === cursor.community &&
        mapping.channelId === cursor.channelId
    )
  );
}

function buzzEventKey(community: string, eventId: string): string {
  return `${community.toLowerCase()}:${eventId.toLowerCase()}`;
}

function isVeritasBuzzOrigin(event: VerifiedEvent, adapterPublicKey?: string): boolean {
  return (
    Boolean(adapterPublicKey) &&
    event.pubkey === adapterPublicKey &&
    event.tags.some((tag) => tag[0] === 'client' && tag[1] === 'veritas-kanban') &&
    event.tags.some((tag) => tag[0] === 'veritas-id' && Boolean(tag[1]))
  );
}

function buzzCursorKey(adapterId: string, community: string, channelId: string): string {
  return `${adapterId}:${community.toLowerCase()}:${channelId.toLowerCase()}`;
}

function mappingMatchesTarget(
  mapping: BuzzChannelMapping,
  target: CommunicationReplyTarget
): boolean {
  if (mapping.target.kind !== target.kind) return false;
  const keys = ['squadMessageId', 'taskId', 'runId', 'approvalId', 'notificationId'] as const;
  return keys.every((key) => !mapping.target[key] || mapping.target[key] === target[key]);
}

function mappingTargetsOverlap(
  left: CommunicationReplyTarget,
  right: CommunicationReplyTarget
): boolean {
  if (left.kind !== right.kind) return false;
  const keys = ['squadMessageId', 'taskId', 'runId', 'approvalId', 'notificationId'] as const;
  return keys.every((key) => !left[key] || !right[key] || left[key] === right[key]);
}

function targetKey(target: CommunicationReplyTarget): string {
  return [
    target.kind,
    target.squadMessageId,
    target.taskId,
    target.runId,
    target.approvalId,
    target.notificationId,
  ]
    .filter(Boolean)
    .join(':');
}

function stripUnsafeControlCharacters(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('');
}

function cleanInboundMessage(message: string): string {
  return stripUnsafeControlCharacters(sanitizeCommentText(redactString(message)))
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

export class CommunicationAdapterService {
  private readonly storageDir: string;
  private readonly persist: boolean;
  private readonly chatService: ChatService;
  private readonly outboundIntegrations: OutboundIntegrationService;
  private readonly buzzCompatibility: BuzzCompatibilityService;
  private readonly buzzCommunication: BuzzCommunicationService;
  private readonly buzzWorkerFactory: BuzzSubscriptionWorkerFactory;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly buzzWorkers = new Map<string, BuzzSubscriptionWorkerHandle>();
  private readonly buzzWorkerGenerations = new Map<string, number>();
  private loaded = false;
  private state: CommunicationAdapterState = this.emptyState();

  constructor(options: CommunicationAdapterServiceOptions = {}) {
    this.storageDir = options.storageDir || path.join(getRuntimeDir(), 'communication-adapters');
    this.persist = options.persist ?? process.env.VITEST !== 'true';
    this.chatService = options.chatService || getChatService();
    this.outboundIntegrations = options.outboundIntegrations || getOutboundIntegrationService();
    this.buzzCompatibility = options.buzzCompatibility || new BuzzCompatibilityService();
    this.buzzCommunication = options.buzzCommunication || new BuzzCommunicationService();
    this.buzzWorkerFactory =
      options.buzzWorkerFactory || new DefaultBuzzSubscriptionWorkerFactory();
    this.audit = options.audit || auditLog;
  }

  async start(): Promise<void> {
    await this.ensureLoaded();
    for (const adapter of Object.values(this.state.adapters)) {
      if (adapter.kind === 'buzz') await this.refreshBuzzWorker(adapter.id);
    }
  }

  async shutdown(): Promise<void> {
    const adapterIds = [...this.buzzWorkers.keys()];
    await Promise.all(adapterIds.map((adapterId) => this.stopBuzzWorker(adapterId)));
  }

  async listAdapters(): Promise<CommunicationAdapterRecord[]> {
    await this.ensureLoaded();
    return Object.values(this.state.adapters)
      .map((adapter) => this.publicAdapter(adapter))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async getAdapter(adapterId: string): Promise<CommunicationAdapterRecord | null> {
    await this.ensureLoaded();
    const adapter = this.state.adapters[adapterId];
    return adapter ? this.publicAdapter(adapter) : null;
  }

  async getBuzzQueryContext(adapterId: string): Promise<BuzzQueryContext> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const adapter = this.requireAdapter(adapterId);
    if (adapter.kind !== 'buzz') throw new Error('Definition import requires a Buzz adapter');
    if (!adapter.enabled) throw new Error('Buzz adapter is disabled');
    const validated = validateStoredBuzzConfig(adapter);
    if (!validated) throw new Error('Buzz adapter configuration is invalid');
    const health = await this.checkBuzzHealth(adapter);
    if (
      health.status !== 'healthy' ||
      !isCurrentBuzzCompatibility(adapter, validated) ||
      adapter.compatibility?.status !== 'healthy'
    ) {
      throw new Error('Buzz compatibility evidence is missing, stale, or unhealthy');
    }
    return {
      probeConfig: validated.probeConfig,
      relay: validated.endpoints.httpUrl,
      community: validated.endpoints.community,
    };
  }

  async listBuzzChannelMappings(adapterId?: string): Promise<BuzzChannelMapping[]> {
    await this.ensureLoaded();
    return Object.values(this.state.buzzChannelMappings)
      .filter((mapping) => !adapterId || mapping.adapterId === adapterId)
      .sort((a, b) => a.channelId.localeCompare(b.channelId));
  }

  async configureBuzzChannelMapping(
    adapterId: string,
    channelIdInput: string,
    input: { target: CommunicationReplyTarget; enabled?: boolean; actor?: string }
  ): Promise<BuzzChannelMapping> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const adapter = this.requireAdapter(adapterId);
    if (adapter.kind !== 'buzz') throw new Error('Channel mapping requires a Buzz adapter');
    const validated = validateStoredBuzzConfig(adapter);
    if (!validated) throw new Error('Buzz adapter configuration is invalid');
    const channelId = normalizeBuzzChannelId(channelIdInput);
    const target = normalizeTarget(input.target);
    if (target.kind !== 'squad') {
      throw new Error('Buzz communication mappings currently support Squad Chat targets');
    }
    const existing = Object.values(this.state.buzzChannelMappings).find(
      (mapping) =>
        mapping.adapterId === adapterId &&
        mapping.community === validated.endpoints.community &&
        mapping.channelId === channelId
    );
    const conflicting = Object.values(this.state.buzzChannelMappings).find(
      (mapping) =>
        mapping.id !== existing?.id &&
        mapping.adapterId === adapterId &&
        mapping.community === validated.endpoints.community &&
        mapping.enabled &&
        mappingTargetsOverlap(mapping.target, target)
    );
    if (conflicting) {
      throw new Error('The Buzz adapter target is already mapped to another channel');
    }
    const timestamp = nowIso();
    for (const staleMapping of Object.values(this.state.buzzChannelMappings)) {
      if (
        staleMapping.adapterId === adapterId &&
        staleMapping.community !== validated.endpoints.community &&
        staleMapping.enabled &&
        mappingTargetsOverlap(staleMapping.target, target)
      ) {
        staleMapping.enabled = false;
        staleMapping.updatedAt = timestamp;
      }
    }
    const mapping: BuzzChannelMapping = {
      id: existing?.id ?? `buzz_map_${nanoid(10)}`,
      adapterId,
      community: validated.endpoints.community,
      channelId,
      target,
      enabled: input.enabled ?? true,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      createdBy: existing?.createdBy ?? trimOrUndefined(input.actor),
    };
    this.state.buzzChannelMappings[mapping.id] = mapping;
    const delivery = this.recordDelivery({
      adapterId,
      operation: 'configure',
      status: 'success',
      target,
      actor: input.actor,
      buzz: {
        community: mapping.community,
        channelId: mapping.channelId,
      },
      detail: mapping.enabled ? 'Buzz channel mapping enabled.' : 'Buzz channel mapping disabled.',
    });
    await this.saveState();
    await this.auditDelivery(delivery);
    await this.refreshBuzzWorker(adapterId);
    return mapping;
  }

  async disableBuzzChannelMapping(
    adapterId: string,
    channelIdInput: string,
    actor?: string
  ): Promise<BuzzChannelMapping> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const channelId = normalizeBuzzChannelId(channelIdInput);
    const existing = Object.values(this.state.buzzChannelMappings).find(
      (mapping) => mapping.adapterId === adapterId && mapping.channelId === channelId
    );
    if (!existing) throw new Error('Buzz channel mapping not found');
    const mapping = { ...existing, enabled: false, updatedAt: nowIso() };
    this.state.buzzChannelMappings[mapping.id] = mapping;
    const delivery = this.recordDelivery({
      adapterId,
      operation: 'disconnect',
      status: 'success',
      target: mapping.target,
      actor,
      buzz: {
        community: mapping.community,
        channelId: mapping.channelId,
      },
      detail: 'Buzz channel mapping disabled; cursor and event history retained.',
    });
    await this.saveState();
    await this.auditDelivery(delivery);
    await this.refreshBuzzWorker(adapterId);
    return mapping;
  }

  async configureAdapter(
    adapterId: string,
    input: CommunicationAdapterInput
  ): Promise<CommunicationAdapterRecord> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();

    const timestamp = nowIso();
    const existing = this.state.adapters[adapterId];
    const kind = input.kind ?? existing?.kind ?? 'msteams';
    if (existing && input.kind && input.kind !== existing.kind) {
      throw new Error('Communication adapter kind cannot be changed after creation');
    }
    if (kind === 'buzz') {
      const validated = buzzAdapterConfigSchema.parse({ ...input, kind: 'buzz' });
      const configured = await this.configureBuzzAdapter(adapterId, validated, existing, timestamp);
      await this.refreshBuzzWorker(adapterId);
      return configured;
    }

    const rawWebhook =
      input.webhookUrl !== undefined ? trimOrUndefined(input.webhookUrl) : existing?.webhookUrlRaw;
    const adapter: InternalCommunicationAdapterRecord = {
      id: adapterId,
      kind,
      displayName: trimOrUndefined(input.displayName) ?? existing?.displayName ?? 'Microsoft Teams',
      enabled: input.enabled ?? existing?.enabled ?? true,
      deliveryMode: input.deliveryMode ?? existing?.deliveryMode ?? 'manual',
      replyMode: 'ingest-api',
      destinationType: input.destinationType ?? existing?.destinationType ?? 'channel',
      tenantId: trimOrUndefined(input.tenantId) ?? existing?.tenantId,
      teamId: trimOrUndefined(input.teamId) ?? existing?.teamId,
      channelId: trimOrUndefined(input.channelId) ?? existing?.channelId,
      chatId: trimOrUndefined(input.chatId) ?? existing?.chatId,
      webhookUrl: sanitizeUrl(rawWebhook),
      webhookUrlRaw: rawWebhook,
      webhookUrlConfigured: Boolean(rawWebhook),
      webhookUrlRedacted: Boolean(rawWebhook),
      hasCredential: Boolean(input.credential?.trim()) || existing?.hasCredential || false,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastHealth: existing?.lastHealth,
    };

    this.state.adapters[adapterId] = adapter;
    const delivery = this.recordDelivery({
      adapterId,
      operation: 'configure',
      status: 'success',
    });
    await this.saveState();
    await this.auditAdapter('communication_adapter.configured', adapter, delivery);
    return this.publicAdapter(adapter);
  }

  async disconnectAdapter(adapterId: string): Promise<CommunicationAdapterRecord> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const adapter = this.requireAdapter(adapterId);
    if (adapter.kind === 'buzz') await this.stopBuzzWorker(adapterId);
    const timestamp = nowIso();
    const disconnected: InternalCommunicationAdapterRecord = {
      ...adapter,
      enabled: false,
      ...(adapter.kind === 'msteams'
        ? {
            webhookUrl: undefined,
            webhookUrlRaw: undefined,
            webhookUrlConfigured: false,
            webhookUrlRedacted: false,
            hasCredential: false,
          }
        : {}),
      updatedAt: timestamp,
      lastHealth: undefined,
      compatibility: undefined,
    };
    this.state.adapters[adapterId] = disconnected;
    const delivery = this.recordDelivery({
      adapterId,
      operation: 'disconnect',
      status: 'success',
    });
    await this.saveState();
    await this.auditAdapter('communication_adapter.disconnected', disconnected, delivery);
    return this.publicAdapter(disconnected);
  }

  async checkHealth(adapterId: string): Promise<CommunicationAdapterHealth> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const adapter = this.requireAdapter(adapterId);
    if (adapter.kind === 'buzz') {
      return this.checkBuzzHealth(adapter);
    }
    const configured = this.hasDestination(adapter);
    const health: CommunicationAdapterHealth = {
      adapterId,
      status: !adapter.enabled ? 'disabled' : configured ? 'ok' : 'warning',
      configured,
      canSend: adapter.enabled && configured,
      canReceiveReplies: adapter.enabled && configured && adapter.replyMode === 'ingest-api',
      checkedAt: nowIso(),
      detail: !adapter.enabled
        ? 'Adapter is disabled.'
        : configured
          ? 'Adapter can send through the configured delivery path and receive replies through the ingest API.'
          : 'Configure a Teams destination or webhook before sending messages.',
    };

    adapter.lastHealth = health;
    adapter.updatedAt = health.checkedAt;
    this.recordDelivery({
      adapterId,
      operation: 'health',
      status: health.status === 'ok' ? 'success' : 'skipped',
    });
    await this.saveState();
    return health;
  }

  async send(adapterId: string, input: CommunicationSendInput): Promise<CommunicationSendResult> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const adapter = this.requireAdapter(adapterId);
    if (adapter.kind === 'buzz') {
      return this.sendBuzz(adapter, input);
    }
    const target = normalizeTarget(input.target);
    const externalThreadId =
      trimOrUndefined(input.externalThreadId) ?? this.buildExternalThreadId(adapterId, target);
    const mapping = this.upsertMapping({
      adapterId,
      externalThreadId,
      externalUrl: trimOrUndefined(input.externalUrl),
      target,
      createdBy: trimOrUndefined(input.actor),
    });

    if (!adapter.enabled || !this.hasDestination(adapter)) {
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'send',
        status: 'blocked',
        target,
        externalThreadId,
        error: !adapter.enabled ? 'Adapter disabled' : 'Adapter destination missing',
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping };
    }

    const delivery = await this.deliverOutbound(adapter, input, mapping);
    await this.saveState();
    await this.auditDelivery(delivery);
    return { delivery, mapping };
  }

  async ingestReply(
    adapterId: string,
    input: CommunicationReplyIngestInput
  ): Promise<CommunicationReplyIngestResult> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const adapter = this.requireAdapter(adapterId);
    const externalThreadId = trimOrUndefined(input.externalThreadId);
    if (!externalThreadId) {
      throw new Error('externalThreadId is required');
    }
    if (adapter.kind === 'buzz') {
      const timestamp = nowIso();
      const mapping: CommunicationThreadMapping = {
        id: `map_${nanoid(10)}`,
        adapterId,
        externalThreadId,
        externalUrl: sanitizeUrl(input.externalUrl),
        target: normalizeTarget(input.target ?? { kind: 'squad' }),
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: trimOrUndefined(input.actor),
      };
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'reply-ingest',
        status: 'blocked',
        target: mapping.target,
        externalThreadId,
        actor: input.actor,
        error:
          'Manual Buzz reply ingestion is disabled; replies arrive through the authenticated relay subscription.',
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping, squadMessageId: '' };
    }

    const existing = this.findMapping(adapterId, externalThreadId);
    const target = normalizeTarget(input.target ?? existing?.target ?? { kind: 'squad' });
    if (!adapter.enabled) {
      const timestamp = nowIso();
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'reply-ingest',
        status: 'blocked',
        target,
        externalThreadId,
        actor: input.actor,
        error: 'Adapter disabled',
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return {
        delivery,
        mapping: existing ?? {
          id: `map_${nanoid(10)}`,
          adapterId,
          externalThreadId,
          externalUrl: sanitizeUrl(input.externalUrl),
          target,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: trimOrUndefined(input.actor),
        },
        squadMessageId: '',
      };
    }

    const mapping = this.upsertMapping({
      adapterId,
      externalThreadId,
      externalUrl: trimOrUndefined(input.externalUrl) ?? existing?.externalUrl,
      target,
      createdBy: trimOrUndefined(input.actor),
    });
    const replyKey = input.externalReplyId
      ? `${adapterId}:${externalThreadId}:${input.externalReplyId}`
      : undefined;
    const existingReplyMessageId = replyKey ? this.state.replyIds[replyKey] : undefined;
    if (existingReplyMessageId) {
      const squadMessage = await this.findSquadMessage(existingReplyMessageId);
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'reply-ingest',
        status: 'skipped',
        target,
        externalThreadId,
        actor: input.actor,
        squadMessageId: existingReplyMessageId,
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return {
        delivery,
        mapping,
        squadMessageId: existingReplyMessageId,
        squadMessage,
      };
    }

    const cleanedMessage = cleanInboundMessage(input.message);
    if (!cleanedMessage) {
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'reply-ingest',
        status: 'blocked',
        target,
        externalThreadId,
        actor: input.actor,
        error: 'Reply message is empty after sanitization',
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping, squadMessageId: '' };
    }

    const squadMessage = await this.chatService.sendSquadMessage(
      {
        agent: input.actor,
        message: cleanedMessage,
        replyToId: target.squadMessageId,
        taskId: target.taskId,
        runId: target.runId,
        decision: target.kind === 'approval' ? true : undefined,
        tags: ['external-reply', `adapter:${adapter.kind}`, `target:${target.kind}`],
      },
      input.displayName
    );

    if (replyKey) {
      this.state.replyIds[replyKey] = squadMessage.id;
    }

    const delivery = this.recordDelivery({
      adapterId,
      operation: 'reply-ingest',
      status: 'success',
      target,
      externalThreadId,
      actor: input.actor,
      squadMessageId: squadMessage.id,
    });

    await this.saveState();
    await this.auditDelivery(delivery);
    return { delivery, mapping, squadMessageId: squadMessage.id, squadMessage };
  }

  async pollReplies(
    adapterId: string
  ): Promise<{ delivery: CommunicationDeliveryAudit; replies: [] }> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const adapter = this.requireAdapter(adapterId);
    if (adapter.kind === 'buzz') {
      const delivery = await this.reconcileBuzzDeliveries(adapter);
      return { delivery, replies: [] };
    }
    const delivery = this.recordDelivery({
      adapterId,
      operation: 'poll',
      status: 'skipped',
      error: 'Reply polling is adapter-defined; this adapter uses the ingest API.',
    });
    await this.saveState();
    await this.auditDelivery(delivery);
    return { delivery, replies: [] };
  }

  async listMappings(adapterId?: string): Promise<CommunicationThreadMapping[]> {
    await this.ensureLoaded();
    return Object.values(this.state.mappings)
      .filter((mapping) => !adapterId || mapping.adapterId === adapterId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listDeliveries(limit = 100, adapterId?: string): Promise<CommunicationDeliveryAudit[]> {
    await this.ensureLoaded();
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), MAX_DELIVERIES));
    return this.state.deliveries
      .filter((delivery) => !adapterId || delivery.adapterId === adapterId)
      .slice(-safeLimit)
      .reverse();
  }

  async ingestBuzzEvent(
    adapterId: string,
    mappingInput: BuzzChannelMapping,
    rawEvent: unknown
  ): Promise<CommunicationDeliveryAudit> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const adapter = this.requireAdapter(adapterId);
    if (adapter.kind !== 'buzz' || !adapter.enabled) {
      throw new Error('Buzz adapter is not enabled');
    }
    const mapping = this.state.buzzChannelMappings[mappingInput.id];
    if (
      !mapping ||
      !mapping.enabled ||
      mapping.adapterId !== adapterId ||
      mapping.channelId !== mappingInput.channelId
    ) {
      throw new Error('Buzz channel mapping is not active');
    }

    let inbound;
    try {
      inbound = parseBuzzInboundEvent(rawEvent, {
        community: mapping.community,
        channelId: mapping.channelId,
      });
    } catch (error) {
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'event-ingest',
        status: 'ignored',
        target: mapping.target,
        error: sanitizeError(error),
        buzz: { community: mapping.community, channelId: mapping.channelId },
        detail: 'Malformed or unsupported Buzz event ignored.',
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return delivery;
    }

    const coordinate = inbound.coordinate;
    const eventId = inbound.event.id;
    const key = buzzEventKey(mapping.community, eventId);
    const outbound = this.state.buzzOutbound[eventId];
    const adapterOrigin = isVeritasBuzzOrigin(inbound.event, adapter.publicKey);
    const existing = this.state.buzzEvents[key];
    if (existing && !outbound && !adapterOrigin) {
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'event-ingest',
        status: 'replayed',
        target: mapping.target,
        squadMessageId: existing.squadMessageId,
        actor: coordinate.authorPubkey,
        buzz: coordinate,
        detail: 'Buzz overlap replay deduplicated by community and event ID.',
      });
      await this.auditDelivery(delivery);
      this.commitBuzzCursor(mapping, inbound.event);
      await this.saveState();
      await this.replayPendingBuzzReplies(adapterId, mapping, eventId);
      return delivery;
    }

    delete this.state.buzzPendingEvents[key];
    if (outbound || adapterOrigin) {
      this.recordBuzzEvent({
        key,
        adapterId,
        direction: 'outbound',
        coordinate,
        squadMessageId: outbound?.squadMessageId,
        deliveryId: outbound?.deliveryId,
        recordedAt: nowIso(),
      });
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'event-ingest',
        status: 'ignored',
        target: outbound?.target ?? mapping.target,
        squadMessageId: outbound?.squadMessageId,
        actor: coordinate.authorPubkey,
        buzz: coordinate,
        detail: 'Adapter-originated Buzz event suppressed to prevent a reply loop.',
      });
      await this.auditDelivery(delivery);
      this.commitBuzzCursor(mapping, inbound.event);
      await this.saveState();
      return delivery;
    }

    if (
      inbound.event.kind === BUZZ_EDIT_KIND ||
      inbound.event.kind === BUZZ_DELETE_KIND ||
      inbound.event.kind === BUZZ_DELETE_COMPAT_KIND
    ) {
      this.recordBuzzEvent({
        key,
        adapterId,
        direction: 'inbound',
        coordinate,
        recordedAt: nowIso(),
      });
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'event-ingest',
        status: 'ignored',
        target: mapping.target,
        actor: coordinate.authorPubkey,
        buzz: coordinate,
        detail:
          inbound.event.kind === BUZZ_EDIT_KIND
            ? `Buzz edit for ${inbound.targetEventId ?? 'unknown target'} retained as audit metadata; Squad Chat has no edit projection contract.`
            : `Buzz deletion for ${inbound.targetEventId ?? 'unknown target'} retained as audit metadata; local content was not removed.`,
      });
      await this.auditDelivery(delivery);
      this.commitBuzzCursor(mapping, inbound.event);
      await this.saveState();
      return delivery;
    }

    if (inbound.event.kind !== BUZZ_MESSAGE_KIND) {
      throw new Error('Buzz event kind is not supported by the message projection');
    }
    const replyReference = coordinate.rootEventId
      ? this.state.buzzEvents[buzzEventKey(mapping.community, coordinate.rootEventId)]
      : undefined;
    const replyToId = coordinate.rootEventId
      ? replyReference?.squadMessageId
      : mapping.target.squadMessageId;
    if (coordinate.rootEventId && !replyToId) {
      this.state.buzzPendingEvents[key] = {
        key,
        adapterId,
        mappingId: mapping.id,
        event: inbound.event,
        recordedAt: nowIso(),
      };
      this.trimBuzzPendingEvents();
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'event-ingest',
        status: 'queued',
        target: mapping.target,
        actor: coordinate.authorPubkey,
        buzz: coordinate,
        detail: 'Buzz reply queued until its mapped root event is available.',
      });
      await this.auditDelivery(delivery);
      await this.saveState();
      return delivery;
    }

    const cleanedMessage = cleanInboundMessage(inbound.content);
    if (!cleanedMessage) {
      const delivery = this.recordDelivery({
        adapterId,
        operation: 'event-ingest',
        status: 'ignored',
        target: mapping.target,
        actor: coordinate.authorPubkey,
        buzz: coordinate,
        detail: 'Buzz message was empty after sanitization.',
      });
      await this.auditDelivery(delivery);
      this.commitBuzzCursor(mapping, inbound.event);
      await this.saveState();
      return delivery;
    }

    const squadMessage = await this.chatService.sendSquadMessage(
      {
        id: `msg_buzz_${eventId}`,
        timestamp: new Date(inbound.event.created_at * 1000).toISOString(),
        agent: 'BUZZ',
        message: cleanedMessage,
        replyToId,
        taskId: mapping.target.taskId,
        runId: mapping.target.runId,
        links: coordinate.externalUrl
          ? [{ href: coordinate.externalUrl, label: 'Open in Buzz' }]
          : undefined,
        decision: mapping.target.kind === 'approval' ? true : undefined,
        tags: ['external-reply', 'adapter:buzz', `buzz-channel:${mapping.channelId}`],
        external: {
          provider: 'buzz',
          adapterId,
          community: mapping.community,
          channelId: mapping.channelId,
          messageId: eventId,
          authorId: coordinate.authorPubkey,
          kind: coordinate.kind,
          url: coordinate.externalUrl,
        },
      },
      `Buzz ${coordinate.authorPubkey?.slice(0, 12) ?? 'member'}`
    );

    this.recordBuzzEvent({
      key,
      adapterId,
      direction: 'inbound',
      coordinate,
      squadMessageId: squadMessage.id,
      recordedAt: nowIso(),
    });
    const externalThreadId = coordinate.rootEventId ?? eventId;
    this.upsertMapping({
      adapterId,
      externalThreadId,
      externalUrl: coordinate.externalUrl,
      target: {
        ...mapping.target,
        squadMessageId: coordinate.rootEventId ? replyToId : squadMessage.id,
      },
      createdBy: coordinate.authorPubkey,
      buzz: coordinate,
    });
    this.state.replyIds[`${adapterId}:${externalThreadId}:${eventId}`] = squadMessage.id;
    const delivery = this.recordDelivery({
      adapterId,
      operation: 'event-ingest',
      status: 'success',
      target: mapping.target,
      externalThreadId,
      squadMessageId: squadMessage.id,
      actor: coordinate.authorPubkey,
      buzz: coordinate,
      detail: coordinate.rootEventId
        ? 'Buzz reply projected into its Squad Chat thread.'
        : 'Buzz root message projected into Squad Chat.',
    });
    await this.auditDelivery(delivery);
    this.commitBuzzCursor(mapping, inbound.event);
    await this.saveState();
    broadcastSquadMessage(squadMessage);
    await this.replayPendingBuzzReplies(adapterId, mapping, eventId);
    return delivery;
  }

  private async sendBuzz(
    adapter: InternalCommunicationAdapterRecord,
    input: CommunicationSendInput
  ): Promise<CommunicationSendResult> {
    const target = normalizeTarget(input.target);
    const validated = validateStoredBuzzConfig(adapter);
    const channelMapping = Object.values(this.state.buzzChannelMappings).find(
      (mapping) =>
        mapping.adapterId === adapter.id && mapping.enabled && mappingMatchesTarget(mapping, target)
    );
    const placeholderThreadId =
      trimOrUndefined(input.externalThreadId) ??
      channelMapping?.channelId ??
      this.buildExternalThreadId(adapter.id, target);
    let mapping = this.upsertMapping({
      adapterId: adapter.id,
      externalThreadId: placeholderThreadId,
      externalUrl: trimOrUndefined(input.externalUrl),
      target,
      createdBy: trimOrUndefined(input.actor),
    });
    const compatibilityReady = Boolean(
      validated &&
      isCurrentBuzzCompatibility(adapter, validated) &&
      adapter.compatibility?.status === 'healthy'
    );
    if (!adapter.enabled || !validated || !compatibilityReady || !channelMapping) {
      const error = !adapter.enabled
        ? 'Buzz adapter disabled'
        : !validated
          ? 'Buzz adapter configuration invalid'
          : !compatibilityReady
            ? 'Buzz compatibility evidence is missing, stale, or unhealthy'
            : 'Buzz channel mapping missing for the requested target';
      const delivery = this.recordDelivery({
        adapterId: adapter.id,
        operation: 'send',
        status: 'blocked',
        target,
        externalThreadId: mapping.externalThreadId,
        actor: input.actor,
        error,
        buzz: channelMapping
          ? {
              community: channelMapping.community,
              channelId: channelMapping.channelId,
            }
          : undefined,
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping };
    }

    const replyToSquadMessageId = trimOrUndefined(input.replyToSquadMessageId);
    const parentRecord = replyToSquadMessageId
      ? Object.values(this.state.buzzEvents).find(
          (record) =>
            record.adapterId === adapter.id && record.squadMessageId === replyToSquadMessageId
        )
      : undefined;
    if (replyToSquadMessageId && !parentRecord?.coordinate.eventId) {
      const delivery = this.recordDelivery({
        adapterId: adapter.id,
        operation: 'send',
        status: 'blocked',
        target,
        externalThreadId: mapping.externalThreadId,
        actor: input.actor,
        error: 'Buzz reply root mapping is missing',
        buzz: {
          community: channelMapping.community,
          channelId: channelMapping.channelId,
        },
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping };
    }

    const message = stripUnsafeControlCharacters(input.message).trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) {
      const delivery = this.recordDelivery({
        adapterId: adapter.id,
        operation: 'send',
        status: 'blocked',
        target,
        externalThreadId: mapping.externalThreadId,
        actor: input.actor,
        error: 'Buzz message is empty after sanitization',
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping };
    }
    const unresolvedOutboundCount = Object.values(this.state.buzzOutbound).filter(
      (record) =>
        record.adapterId === adapter.id &&
        (record.status === 'queued' || record.status === 'delivery_unknown')
    ).length;
    if (unresolvedOutboundCount >= MAX_BUZZ_OUTBOUND_RECORDS) {
      const delivery = this.recordDelivery({
        adapterId: adapter.id,
        operation: 'send',
        status: 'blocked',
        target,
        externalThreadId: mapping.externalThreadId,
        actor: input.actor,
        error: 'Buzz unresolved delivery queue is full; reconcile before sending more messages.',
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping };
    }
    const delivery = this.recordDelivery({
      adapterId: adapter.id,
      operation: 'send',
      status: 'queued',
      target,
      externalThreadId: mapping.externalThreadId,
      actor: input.actor,
      buzz: {
        community: channelMapping.community,
        channelId: channelMapping.channelId,
      },
      detail: 'Signed Buzz event persisted before relay submission.',
    });
    try {
      const parentEventId = parentRecord?.coordinate.eventId;
      const rootEventId = parentRecord
        ? (parentRecord.coordinate.rootEventId ?? parentEventId)
        : undefined;
      const prepared = await this.buzzCommunication.prepareMessage(validated.probeConfig, {
        channelId: channelMapping.channelId,
        content: message,
        idempotencyKey: delivery.id,
        rootEventId,
        parentEventId,
      });
      delivery.buzz = prepared.coordinate;
      delivery.externalThreadId = rootEventId ?? prepared.event.id;
      mapping = this.upsertMapping({
        adapterId: adapter.id,
        externalThreadId: delivery.externalThreadId,
        externalUrl: prepared.coordinate.externalUrl,
        target,
        createdBy: trimOrUndefined(input.actor),
        buzz: prepared.coordinate,
      });
      const timestamp = nowIso();
      const outbound: BuzzOutboundRecord = {
        eventId: prepared.event.id,
        adapterId: adapter.id,
        event: prepared.event,
        coordinate: prepared.coordinate,
        target,
        squadMessageId: target.squadMessageId,
        deliveryId: delivery.id,
        status: 'queued',
        attemptCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.state.buzzOutbound[prepared.event.id] = outbound;
      this.recordBuzzEvent({
        key: buzzEventKey(channelMapping.community, prepared.event.id),
        adapterId: adapter.id,
        direction: 'outbound',
        coordinate: prepared.coordinate,
        squadMessageId: target.squadMessageId,
        deliveryId: delivery.id,
        recordedAt: timestamp,
      });
      await this.saveState();

      outbound.attemptCount += 1;
      const result = await this.buzzCommunication.submitEvent(
        validated.probeConfig,
        prepared.event
      );
      outbound.updatedAt = nowIso();
      if (result.status === 'accepted') {
        outbound.status = 'accepted';
        delivery.status = 'success';
        delivery.detail = 'Buzz relay accepted the signed event.';
        delivery.error = undefined;
      } else if (result.status === 'delivery_unknown') {
        outbound.status = 'delivery_unknown';
        delivery.status = 'delivery_unknown';
        delivery.detail = 'Buzz delivery is ambiguous and will be reconciled by event ID.';
        delivery.error = result.detail;
      } else {
        outbound.status = 'rejected';
        delivery.status = 'failed';
        delivery.error = result.detail ?? 'Buzz relay rejected the signed event.';
      }
      this.updateLastBuzzSend(adapter.id, delivery);
      this.trimBuzzOutboundRecords();
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping };
    } catch (error) {
      delivery.status = 'failed';
      delivery.error = sanitizeError(error);
      delivery.detail = 'Buzz event preparation failed before relay submission.';
      this.updateLastBuzzSend(adapter.id, delivery);
      await this.saveState();
      await this.auditDelivery(delivery);
      return { delivery, mapping };
    }
  }

  private async reconcileBuzzDeliveries(
    adapter: InternalCommunicationAdapterRecord
  ): Promise<CommunicationDeliveryAudit> {
    const validated = validateStoredBuzzConfig(adapter);
    if (
      !validated ||
      !isCurrentBuzzCompatibility(adapter, validated) ||
      adapter.compatibility?.status !== 'healthy'
    ) {
      const delivery = this.recordDelivery({
        adapterId: adapter.id,
        operation: 'reconcile',
        status: 'blocked',
        error: 'Healthy, current Buzz compatibility evidence is required for reconciliation.',
      });
      await this.saveState();
      await this.auditDelivery(delivery);
      return delivery;
    }
    const candidates = Object.values(this.state.buzzOutbound)
      .filter(
        (record) =>
          record.adapterId === adapter.id &&
          (record.status === 'queued' || record.status === 'delivery_unknown')
      )
      .slice(0, 25);
    let accepted = 0;
    let ambiguous = 0;
    let rejected = 0;
    for (const record of candidates) {
      const eventMapping = Object.values(this.state.buzzChannelMappings).find(
        (mapping) =>
          mapping.adapterId === adapter.id &&
          mapping.community === record.coordinate.community &&
          mapping.channelId === record.coordinate.channelId &&
          isUsableBuzzChannelMapping(mapping, adapter.id, validated.endpoints.community)
      );
      let persistedEventIsValid = false;
      if (eventMapping) {
        try {
          const parsed = parseBuzzInboundEvent(record.event, {
            community: eventMapping.community,
            channelId: eventMapping.channelId,
          });
          persistedEventIsValid =
            parsed.event.id === record.eventId &&
            parsed.event.pubkey.toLowerCase() === validated.probeConfig.publicKey.toLowerCase();
        } catch {
          persistedEventIsValid = false;
        }
      }
      if (!persistedEventIsValid) {
        record.status = 'rejected';
        record.updatedAt = nowIso();
        const linkedDelivery = this.state.deliveries.find(
          (delivery) => delivery.id === record.deliveryId
        );
        if (linkedDelivery) {
          linkedDelivery.status = 'failed';
          linkedDelivery.error = 'Persisted Buzz event failed validation and was not retried.';
        }
        rejected += 1;
        continue;
      }
      const exists = await this.buzzCommunication.eventExists(
        validated.probeConfig,
        record.eventId
      );
      const linkedDelivery = this.state.deliveries.find(
        (delivery) => delivery.id === record.deliveryId
      );
      if (exists === true) {
        record.status = 'accepted';
        record.updatedAt = nowIso();
        if (linkedDelivery) {
          linkedDelivery.status = 'success';
          linkedDelivery.error = undefined;
          linkedDelivery.detail = 'Ambiguous Buzz delivery reconciled by event ID.';
        }
        accepted += 1;
        continue;
      }
      if (exists === false) {
        if (!eventMapping?.enabled) {
          const linkedDelivery = this.state.deliveries.find(
            (delivery) => delivery.id === record.deliveryId
          );
          if (linkedDelivery) {
            linkedDelivery.detail =
              'Buzz event was absent, but its channel mapping is disabled; it was not resubmitted.';
          }
          ambiguous += 1;
          continue;
        }
        record.attemptCount += 1;
        const result = await this.buzzCommunication.submitEvent(
          validated.probeConfig,
          record.event
        );
        record.updatedAt = nowIso();
        record.status =
          result.status === 'accepted'
            ? 'accepted'
            : result.status === 'rejected'
              ? 'rejected'
              : 'delivery_unknown';
        if (linkedDelivery) {
          linkedDelivery.status =
            result.status === 'accepted'
              ? 'success'
              : result.status === 'rejected'
                ? 'failed'
                : 'delivery_unknown';
          linkedDelivery.error = result.detail;
          linkedDelivery.detail =
            result.status === 'accepted'
              ? 'Buzz event safely resubmitted after an event-ID absence check.'
              : 'Buzz delivery remains unresolved after reconciliation.';
        }
        if (result.status === 'accepted') accepted += 1;
        else if (result.status === 'rejected') rejected += 1;
        else ambiguous += 1;
        continue;
      }
      ambiguous += 1;
    }
    const delivery = this.recordDelivery({
      adapterId: adapter.id,
      operation: 'reconcile',
      status:
        rejected > 0
          ? 'failed'
          : ambiguous > 0
            ? 'delivery_unknown'
            : candidates.length > 0
              ? 'success'
              : 'skipped',
      detail:
        candidates.length === 0
          ? 'No ambiguous Buzz deliveries required reconciliation.'
          : `Buzz reconciliation accepted ${accepted}, rejected ${rejected}, and left ${ambiguous} delivery or deliveries unresolved.`,
    });
    this.updateLastBuzzSend(adapter.id, delivery);
    this.trimBuzzOutboundRecords();
    await this.saveState();
    await this.auditDelivery(delivery);
    return delivery;
  }

  private async deliverOutbound(
    adapter: InternalCommunicationAdapterRecord,
    input: CommunicationSendInput,
    mapping: CommunicationThreadMapping
  ): Promise<CommunicationDeliveryAudit> {
    const target = normalizeTarget(input.target);
    if (adapter.deliveryMode !== 'webhook' || !adapter.webhookUrlRaw) {
      return this.recordDelivery({
        adapterId: adapter.id,
        operation: 'send',
        status: 'queued',
        target,
        externalThreadId: mapping.externalThreadId,
      });
    }

    const outbound = await this.outboundIntegrations.deliver(
      {
        id: `communication.${adapter.id}`,
        type: 'communication-adapter-webhook',
        displayName: adapter.displayName,
        url: adapter.webhookUrlRaw,
        enabled: adapter.enabled,
        owner: { source: 'runtime', resourceId: `communication.${adapter.id}` },
      },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adapterId: adapter.id,
          kind: adapter.kind,
          target,
          message: input.message,
          externalThreadId: mapping.externalThreadId,
          externalUrl: mapping.externalUrl,
          actor: input.actor ?? 'veritas',
        }),
        responseBodyLimit: 1024,
      }
    );

    return this.recordDelivery({
      adapterId: adapter.id,
      operation: 'send',
      status: outbound.ok ? 'success' : outbound.status === 'blocked' ? 'blocked' : 'failed',
      target,
      externalThreadId: mapping.externalThreadId,
      error: outbound.error,
    });
  }

  private buildExternalThreadId(adapterId: string, target: CommunicationReplyTarget): string {
    const key = targetKey(target);
    if (key) return `${adapterId}:${key}`;
    return `${adapterId}:thread:${nanoid(8)}`;
  }

  private findMapping(
    adapterId: string,
    externalThreadId: string
  ): CommunicationThreadMapping | undefined {
    return Object.values(this.state.mappings).find(
      (mapping) => mapping.adapterId === adapterId && mapping.externalThreadId === externalThreadId
    );
  }

  private upsertMapping(input: {
    adapterId: string;
    externalThreadId: string;
    externalUrl?: string;
    target: CommunicationReplyTarget;
    createdBy?: string;
    buzz?: BuzzExternalCoordinate;
  }): CommunicationThreadMapping {
    const existing = this.findMapping(input.adapterId, input.externalThreadId);
    const timestamp = nowIso();
    const mapping: CommunicationThreadMapping = {
      id: existing?.id ?? `map_${nanoid(10)}`,
      adapterId: input.adapterId,
      externalThreadId: input.externalThreadId,
      externalUrl: sanitizeUrl(input.externalUrl),
      target: input.target,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      createdBy: existing?.createdBy ?? input.createdBy,
      buzz: input.buzz ?? existing?.buzz,
    };
    this.state.mappings[mapping.id] = mapping;
    return mapping;
  }

  private recordDelivery(input: {
    adapterId: string;
    operation: CommunicationDeliveryOperation;
    status: CommunicationDeliveryStatus;
    target?: CommunicationReplyTarget;
    externalThreadId?: string;
    squadMessageId?: string;
    actor?: string;
    error?: string;
    detail?: string;
    buzz?: BuzzExternalCoordinate;
  }): CommunicationDeliveryAudit {
    const delivery: CommunicationDeliveryAudit = {
      id: `comm_${nanoid(10)}`,
      adapterId: input.adapterId,
      operation: input.operation,
      status: input.status,
      target: input.target,
      externalThreadId: input.externalThreadId,
      squadMessageId: input.squadMessageId,
      actor: input.actor,
      error: input.error ? sanitizeError(input.error) : undefined,
      detail: input.detail ? sanitizeError(input.detail) : undefined,
      buzz: input.buzz,
      createdAt: nowIso(),
    };
    this.state.deliveries.push(delivery);
    if (this.state.deliveries.length > MAX_DELIVERIES) {
      this.state.deliveries = this.state.deliveries.slice(-MAX_DELIVERIES);
    }
    return delivery;
  }

  private recordBuzzEvent(record: BuzzEventRecord): void {
    this.state.buzzEvents[record.key] = record;
    const records = Object.values(this.state.buzzEvents);
    if (records.length <= MAX_BUZZ_EVENTS) return;
    records
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .slice(0, records.length - MAX_BUZZ_EVENTS)
      .forEach((candidate) => delete this.state.buzzEvents[candidate.key]);
  }

  private trimBuzzPendingEvents(): void {
    const records = Object.values(this.state.buzzPendingEvents);
    if (records.length <= MAX_BUZZ_PENDING_EVENTS) return;
    records
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .slice(0, records.length - MAX_BUZZ_PENDING_EVENTS)
      .forEach((candidate) => delete this.state.buzzPendingEvents[candidate.key]);
  }

  private trimBuzzOutboundRecords(): void {
    const records = Object.values(this.state.buzzOutbound);
    if (records.length <= MAX_BUZZ_OUTBOUND_RECORDS) return;
    const removable = records
      .filter((record) => record.status === 'accepted' || record.status === 'rejected')
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const record of removable) {
      if (Object.keys(this.state.buzzOutbound).length <= MAX_BUZZ_OUTBOUND_RECORDS) break;
      delete this.state.buzzOutbound[record.eventId];
    }
  }

  private commitBuzzCursor(mapping: BuzzChannelMapping, event: VerifiedEvent): void {
    const key = buzzCursorKey(mapping.adapterId, mapping.community, mapping.channelId);
    const existing = this.state.buzzCursors[key];
    const shouldAdvance =
      !existing ||
      event.created_at > existing.createdAt ||
      (event.created_at === existing.createdAt && event.id.localeCompare(existing.eventId) > 0);
    if (!shouldAdvance) return;
    this.state.buzzCursors[key] = {
      adapterId: mapping.adapterId,
      community: mapping.community,
      channelId: mapping.channelId,
      createdAt: event.created_at,
      eventId: event.id,
      committedAt: nowIso(),
    };
  }

  private async replayPendingBuzzReplies(
    adapterId: string,
    mapping: BuzzChannelMapping,
    resolvedEventId: string
  ): Promise<void> {
    const pending = Object.values(this.state.buzzPendingEvents)
      .filter(
        (record) =>
          record.adapterId === adapterId &&
          record.mappingId === mapping.id &&
          record.event.tags.some(
            (tag) =>
              tag[0] === 'e' &&
              tag[1] === resolvedEventId &&
              (tag[3] === 'root' || tag[3] === 'reply')
          )
      )
      .sort(
        (a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id)
      );
    for (const record of pending) {
      await this.ingestBuzzEvent(adapterId, mapping, record.event);
    }
  }

  private updateLastBuzzSend(adapterId: string, delivery: CommunicationDeliveryAudit): void {
    const current = this.state.buzzRuntime[adapterId] ?? {
      relayConnected: false,
      subscriptionActive: false,
      mappedChannels: 0,
      reconnectAttempts: 0,
    };
    this.state.buzzRuntime[adapterId] = {
      ...current,
      lastSendAt: delivery.createdAt,
      lastSendStatus: delivery.status,
    };
  }

  private async refreshBuzzWorker(adapterId: string): Promise<void> {
    await this.stopBuzzWorker(adapterId);
    const adapter = this.state.adapters[adapterId];
    if (!adapter || adapter.kind !== 'buzz') return;
    const validated = validateStoredBuzzConfig(adapter);
    const mappings = Object.values(this.state.buzzChannelMappings).filter(
      (mapping) =>
        mapping.enabled &&
        validated &&
        isUsableBuzzChannelMapping(mapping, adapterId, validated.endpoints.community)
    );
    const generation = (this.buzzWorkerGenerations.get(adapterId) ?? 0) + 1;
    this.buzzWorkerGenerations.set(adapterId, generation);
    const baseRuntime: BuzzRuntimeHealth = {
      relayConnected: false,
      subscriptionActive: false,
      mappedChannels: mappings.length,
      reconnectAttempts: 0,
    };
    this.state.buzzRuntime[adapterId] = {
      ...baseRuntime,
      lastSendAt: this.state.buzzRuntime[adapterId]?.lastSendAt,
      lastSendStatus: this.state.buzzRuntime[adapterId]?.lastSendStatus,
    };
    if (
      !validated ||
      !adapter.enabled ||
      mappings.length === 0 ||
      !isCurrentBuzzCompatibility(adapter, validated) ||
      adapter.compatibility?.status !== 'healthy'
    ) {
      this.applyBuzzRuntimeHealth(adapterId);
      await this.saveState();
      return;
    }
    const worker = this.buzzWorkerFactory.create(
      {
        adapterId,
        probeConfig: validated.probeConfig,
        mappings,
        cursors: Object.values(this.state.buzzCursors).filter(
          (cursor) => cursor.adapterId === adapterId && isUsableBuzzCursor(cursor, mappings)
        ),
      },
      {
        onEvent: async (mapping, event) => {
          if (this.buzzWorkerGenerations.get(adapterId) !== generation) return;
          await this.ingestBuzzEvent(adapterId, mapping, event);
          return this.state.buzzCursors[
            buzzCursorKey(mapping.adapterId, mapping.community, mapping.channelId)
          ];
        },
        onHealth: async (patch) => {
          if (this.buzzWorkerGenerations.get(adapterId) !== generation) return;
          this.state.buzzRuntime[adapterId] = {
            ...(this.state.buzzRuntime[adapterId] ?? baseRuntime),
            ...patch,
            mappedChannels: mappings.length,
          };
          this.applyBuzzRuntimeHealth(adapterId);
          await this.saveState();
        },
      }
    );
    this.buzzWorkers.set(adapterId, worker);
    this.applyBuzzRuntimeHealth(adapterId);
    await this.saveState();
    worker.start();
  }

  private async stopBuzzWorker(adapterId: string): Promise<void> {
    this.buzzWorkerGenerations.set(adapterId, (this.buzzWorkerGenerations.get(adapterId) ?? 0) + 1);
    const worker = this.buzzWorkers.get(adapterId);
    this.buzzWorkers.delete(adapterId);
    if (worker) await worker.stop();
  }

  private applyBuzzRuntimeHealth(adapterId: string): void {
    const adapter = this.state.adapters[adapterId];
    if (!adapter || adapter.kind !== 'buzz') return;
    const runtime = this.state.buzzRuntime[adapterId];
    if (!runtime) return;
    const compatibility = adapter.compatibility;
    const compatibilityHealthy = compatibility?.status === 'healthy';
    const cursor = Object.values(this.state.buzzCursors)
      .filter((candidate) => candidate.adapterId === adapterId)
      .sort((a, b) => b.createdAt - a.createdAt || b.eventId.localeCompare(a.eventId))[0];
    runtime.cursorLagSeconds = cursor
      ? Math.max(0, Math.floor(Date.now() / 1000) - cursor.createdAt)
      : undefined;
    const status = !adapter.enabled
      ? 'disabled'
      : !compatibilityHealthy
        ? (compatibility?.status ?? 'degraded')
        : runtime.lastError || !runtime.subscriptionActive
          ? 'degraded'
          : 'healthy';
    adapter.lastHealth = {
      adapterId,
      status,
      configured: true,
      canSend: Boolean(adapter.enabled && compatibilityHealthy && runtime.mappedChannels > 0),
      canReceiveReplies: Boolean(
        adapter.enabled && compatibilityHealthy && runtime.subscriptionActive
      ),
      checkedAt: nowIso(),
      detail: !adapter.enabled
        ? 'Buzz adapter is disabled; mappings and cursor state are retained.'
        : !compatibilityHealthy
          ? (compatibility?.detail ?? 'Buzz compatibility evidence is unavailable.')
          : runtime.subscriptionActive
            ? `Buzz relay subscription is active for ${runtime.mappedChannels} mapped channel or channels.`
            : runtime.mappedChannels === 0
              ? 'Configure a Buzz channel mapping to enable send and receive.'
              : runtime.lastError
                ? `Buzz worker is degraded: ${runtime.lastError}`
                : 'Buzz worker is connecting and authenticating.',
      reasonCode: compatibility?.reasonCode,
      remediation:
        runtime.lastError && compatibilityHealthy
          ? 'Review relay authorization, channel membership, and WebSocket reachability, then resave or recheck the adapter.'
          : compatibility?.remediation,
      buzz: compatibility,
      buzzRuntime: { ...runtime },
    };
    adapter.updatedAt = adapter.lastHealth.checkedAt;
  }

  private hasDestination(adapter: InternalCommunicationAdapterRecord): boolean {
    if (adapter.kind === 'buzz') return false;
    if (adapter.deliveryMode === 'webhook') {
      return Boolean(adapter.webhookUrlRaw);
    }
    if (adapter.destinationType === 'direct') {
      return Boolean(adapter.chatId);
    }
    return Boolean(adapter.channelId || adapter.teamId);
  }

  private requireAdapter(adapterId: string): InternalCommunicationAdapterRecord {
    const adapter = this.state.adapters[adapterId];
    if (!adapter) {
      throw new Error(`Communication adapter ${adapterId} not found`);
    }
    return adapter;
  }

  private publicAdapter(adapter: InternalCommunicationAdapterRecord): CommunicationAdapterRecord {
    if (adapter.kind === 'buzz') {
      const validated = validateStoredBuzzConfig(adapter);
      if (!validated) {
        return {
          id: adapter.id,
          kind: 'buzz',
          displayName: 'Buzz',
          enabled: false,
          deliveryMode: 'manual',
          replyMode: 'ingest-api',
          destinationType: 'channel',
          hasCredential: false,
          createdAt: adapter.createdAt,
          updatedAt: adapter.updatedAt,
        };
      }
      const config = validated.config;
      return {
        id: adapter.id,
        kind: 'buzz',
        displayName: config.displayName ?? 'Buzz',
        enabled: config.enabled ?? true,
        deliveryMode: 'manual',
        replyMode: 'ingest-api',
        destinationType: 'channel',
        hasCredential: true,
        relayHttpUrl: config.relayHttpUrl,
        relayWebSocketUrl: config.relayWebSocketUrl ?? undefined,
        expectedCommunity: config.expectedCommunity ?? undefined,
        publicKey: config.publicKey.toLowerCase(),
        publicKeyFingerprint: fingerprintBuzzPublicKey(config.publicKey),
        credentialRef: config.credentialRef,
        authTagRef: config.authTagRef ?? undefined,
        authTagConfigured: Boolean(config.authTagRef),
        allowLocalhost: config.allowLocalhost,
        allowPrivateNetwork: config.allowPrivateNetwork,
        command: config.command ?? undefined,
        compatibility: isCurrentBuzzCompatibility(adapter, validated)
          ? adapter.compatibility
          : undefined,
        lastHealth: isCurrentBuzzCompatibility(adapter, validated) ? adapter.lastHealth : undefined,
        createdAt: adapter.createdAt,
        updatedAt: adapter.updatedAt,
      };
    }
    const {
      webhookUrlRaw: _webhookUrlRaw,
      buzzConfigKey: _buzzConfigKey,
      ...publicRecord
    } = adapter;
    return {
      ...publicRecord,
      webhookUrl: adapter.webhookUrlRaw ? sanitizeUrl(adapter.webhookUrlRaw) : undefined,
      webhookUrlConfigured: Boolean(adapter.webhookUrlRaw),
      webhookUrlRedacted: Boolean(adapter.webhookUrlRaw),
      hasCredential: Boolean(adapter.hasCredential),
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.persist) {
      this.loaded = true;
      return;
    }

    await mkdir(this.storageDir, { recursive: true });
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<CommunicationAdapterState>;
      this.state = {
        version: 2,
        adapters:
          parsed.adapters && typeof parsed.adapters === 'object'
            ? (parsed.adapters as Record<string, InternalCommunicationAdapterRecord>)
            : {},
        mappings:
          parsed.mappings && typeof parsed.mappings === 'object'
            ? (parsed.mappings as Record<string, CommunicationThreadMapping>)
            : {},
        buzzChannelMappings:
          parsed.buzzChannelMappings && typeof parsed.buzzChannelMappings === 'object'
            ? (parsed.buzzChannelMappings as Record<string, BuzzChannelMapping>)
            : {},
        buzzCursors:
          parsed.buzzCursors && typeof parsed.buzzCursors === 'object'
            ? (parsed.buzzCursors as Record<string, BuzzCursor>)
            : {},
        buzzEvents:
          parsed.buzzEvents && typeof parsed.buzzEvents === 'object'
            ? (parsed.buzzEvents as Record<string, BuzzEventRecord>)
            : {},
        buzzPendingEvents:
          parsed.buzzPendingEvents && typeof parsed.buzzPendingEvents === 'object'
            ? (parsed.buzzPendingEvents as Record<string, BuzzPendingEvent>)
            : {},
        buzzOutbound:
          parsed.buzzOutbound && typeof parsed.buzzOutbound === 'object'
            ? (parsed.buzzOutbound as Record<string, BuzzOutboundRecord>)
            : {},
        buzzRuntime:
          parsed.buzzRuntime && typeof parsed.buzzRuntime === 'object'
            ? (parsed.buzzRuntime as Record<string, BuzzRuntimeHealth>)
            : {},
        replyIds:
          parsed.replyIds && typeof parsed.replyIds === 'object'
            ? (parsed.replyIds as Record<string, string>)
            : {},
        deliveries: Array.isArray(parsed.deliveries)
          ? (parsed.deliveries as CommunicationDeliveryAudit[]).slice(-MAX_DELIVERIES)
          : [],
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.state = this.emptyState();
    }
    this.loaded = true;
  }

  private async saveState(): Promise<void> {
    this.state.updatedAt = nowIso();
    if (!this.persist) return;
    await mkdir(this.storageDir, { recursive: true });
    await withFileLock(this.statePath, async () => {
      await atomicWriteFile(this.statePath, JSON.stringify(this.state, null, 2));
    });
  }

  private get statePath(): string {
    const filePath = path.join(this.storageDir, 'state.json');
    ensureWithinBase(this.storageDir, filePath);
    return filePath;
  }

  private emptyState(): CommunicationAdapterState {
    return {
      version: 2,
      adapters: {},
      mappings: {},
      buzzChannelMappings: {},
      buzzCursors: {},
      buzzEvents: {},
      buzzPendingEvents: {},
      buzzOutbound: {},
      buzzRuntime: {},
      replyIds: {},
      deliveries: [],
      updatedAt: nowIso(),
    };
  }

  private async findSquadMessage(messageId: string): Promise<SquadMessage | undefined> {
    const messages = await this.chatService.getSquadMessages({ includeSystem: true, limit: 500 });
    return messages.find((message) => message.id === messageId);
  }

  private async auditAdapter(
    action: string,
    adapter: InternalCommunicationAdapterRecord,
    delivery: CommunicationDeliveryAudit
  ): Promise<void> {
    await this.audit({
      action,
      actor: 'system',
      resource: adapter.id,
      details: {
        adapter: this.publicAdapter(adapter),
        delivery,
      },
    });
  }

  private async auditDelivery(delivery: CommunicationDeliveryAudit): Promise<void> {
    await this.audit({
      action: `communication_adapter.${delivery.operation}`,
      actor: delivery.actor ?? 'system',
      resource: delivery.adapterId,
      details: {
        status: delivery.status,
        target: delivery.target,
        externalThreadId: delivery.externalThreadId,
        squadMessageId: delivery.squadMessageId,
        error: delivery.error,
        detail: delivery.detail,
        buzz: delivery.buzz,
      },
    });
  }

  private async configureBuzzAdapter(
    adapterId: string,
    input: BuzzAdapterConfig,
    existing: InternalCommunicationAdapterRecord | undefined,
    timestamp: string
  ): Promise<CommunicationAdapterRecord> {
    const relayHttpUrl = trimOrUndefined(input.relayHttpUrl) ?? existing?.relayHttpUrl;
    const publicKey = (trimOrUndefined(input.publicKey) ?? existing?.publicKey)?.toLowerCase();
    const credentialRef = trimOrUndefined(input.credentialRef) ?? existing?.credentialRef;
    if (!relayHttpUrl || !publicKey || !credentialRef) {
      throw new Error('Buzz relayHttpUrl, publicKey, and credentialRef are required');
    }
    const relayWebSocketUrl =
      input.relayWebSocketUrl !== undefined
        ? trimOrUndefined(input.relayWebSocketUrl)
        : existing?.relayWebSocketUrl;
    const expectedCommunity =
      input.expectedCommunity !== undefined
        ? trimOrUndefined(input.expectedCommunity)
        : existing?.expectedCommunity;
    const authTagRef =
      input.authTagRef !== undefined ? trimOrUndefined(input.authTagRef) : existing?.authTagRef;
    const endpoints = normalizeBuzzEndpoints({
      relayHttpUrl,
      relayWebSocketUrl,
      expectedCommunity,
    });
    const command = input.command !== undefined ? input.command : existing?.command;
    const allowLocalhost = input.allowLocalhost ?? existing?.allowLocalhost ?? false;
    const allowPrivateNetwork = input.allowPrivateNetwork ?? existing?.allowPrivateNetwork ?? false;
    const probeConfig: BuzzProbeConfig = {
      enabled: input.enabled ?? existing?.enabled ?? true,
      relayHttpUrl: endpoints.configuredHttpUrl.trim(),
      relayWebSocketUrl: endpoints.configuredWebSocketUrl?.trim(),
      expectedCommunity,
      publicKey,
      credentialRef,
      authTagRef,
      allowLocalhost,
      allowPrivateNetwork,
      command: command ?? undefined,
    };
    const nextBuzzConfigKey = buzzConfigKey(probeConfig, endpoints);
    const evidenceIsCurrent =
      existing?.buzzConfigKey === nextBuzzConfigKey &&
      existing.compatibility?.probeRevision === BUZZ_PROBE_REVISION &&
      existing.compatibility.testedRelease === BUZZ_TESTED_RELEASE &&
      existing.compatibility.testedCommit === BUZZ_TESTED_COMMIT;
    const adapter: InternalCommunicationAdapterRecord = {
      id: adapterId,
      kind: 'buzz',
      displayName: trimOrUndefined(input.displayName) ?? existing?.displayName ?? 'Buzz',
      enabled: input.enabled ?? existing?.enabled ?? true,
      deliveryMode: 'manual',
      replyMode: 'ingest-api',
      destinationType: 'channel',
      hasCredential: true,
      relayHttpUrl: probeConfig.relayHttpUrl,
      relayWebSocketUrl: probeConfig.relayWebSocketUrl,
      expectedCommunity,
      publicKey,
      publicKeyFingerprint: fingerprintBuzzPublicKey(publicKey),
      credentialRef,
      authTagRef,
      authTagConfigured: Boolean(authTagRef),
      allowLocalhost,
      allowPrivateNetwork,
      command: command ?? undefined,
      buzzConfigKey: nextBuzzConfigKey,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastHealth: evidenceIsCurrent ? existing?.lastHealth : undefined,
      compatibility: evidenceIsCurrent ? existing?.compatibility : undefined,
    };

    this.state.adapters[adapterId] = adapter;
    const delivery = this.recordDelivery({
      adapterId,
      operation: 'configure',
      status: 'success',
    });
    await this.saveState();
    await this.auditAdapter('communication_adapter.configured', adapter, delivery);
    return this.publicAdapter(adapter);
  }

  private async checkBuzzHealth(
    adapter: InternalCommunicationAdapterRecord
  ): Promise<CommunicationAdapterHealth> {
    const validated = validateStoredBuzzConfig(adapter);
    if (!validated) {
      const health: CommunicationAdapterHealth = {
        adapterId: adapter.id,
        status: 'misconfigured',
        configured: false,
        canSend: false,
        canReceiveReplies: false,
        checkedAt: nowIso(),
        detail: 'The persisted Buzz configuration is invalid and was quarantined.',
        reasonCode: 'configuration_invalid',
        remediation: 'Resave a complete reference-only Buzz connection configuration.',
      };
      adapter.enabled = false;
      adapter.command = undefined;
      adapter.lastHealth = health;
      adapter.compatibility = undefined;
      adapter.updatedAt = health.checkedAt;
      this.recordDelivery({
        adapterId: adapter.id,
        operation: 'health',
        status: 'failed',
        error: health.detail,
      });
      await this.saveState();
      return health;
    }

    if (!validated.probeConfig.enabled) {
      const health: CommunicationAdapterHealth = {
        adapterId: adapter.id,
        status: 'disabled',
        configured: Boolean(adapter.relayHttpUrl && adapter.publicKey && adapter.credentialRef),
        canSend: false,
        canReceiveReplies: false,
        checkedAt: nowIso(),
        detail: 'Buzz adapter is disabled. Configuration references are retained.',
        reasonCode: 'adapter_disabled',
        remediation: 'Enable the adapter to run a read-only compatibility probe.',
      };
      adapter.lastHealth = health;
      adapter.compatibility = undefined;
      adapter.updatedAt = health.checkedAt;
      this.recordDelivery({
        adapterId: adapter.id,
        operation: 'health',
        status: 'skipped',
      });
      await this.saveState();
      return health;
    }

    if (!adapter.relayHttpUrl || !adapter.publicKey || !adapter.credentialRef) {
      const health: CommunicationAdapterHealth = {
        adapterId: adapter.id,
        status: 'misconfigured',
        configured: false,
        canSend: false,
        canReceiveReplies: false,
        checkedAt: nowIso(),
        detail: 'Buzz relay URL, public key, or credential reference is missing.',
        reasonCode: 'configuration_missing',
        remediation: 'Save a complete reference-only Buzz connection configuration.',
      };
      adapter.lastHealth = health;
      adapter.compatibility = undefined;
      adapter.updatedAt = health.checkedAt;
      this.recordDelivery({
        adapterId: adapter.id,
        operation: 'health',
        status: 'failed',
        error: health.detail,
      });
      await this.saveState();
      return health;
    }

    const compatibility = await this.buzzCompatibility.probe(validated.probeConfig);
    const health: CommunicationAdapterHealth = {
      adapterId: adapter.id,
      status: compatibility.status,
      configured: true,
      canSend: false,
      canReceiveReplies: false,
      checkedAt: compatibility.checkedAt,
      detail: compatibility.detail,
      reasonCode: compatibility.reasonCode,
      remediation: compatibility.remediation,
      buzz: compatibility,
    };
    adapter.compatibility = compatibility;
    adapter.lastHealth = health;
    adapter.updatedAt = health.checkedAt;
    this.recordDelivery({
      adapterId: adapter.id,
      operation: 'health',
      status: compatibility.status === 'healthy' ? 'success' : 'failed',
      error: compatibility.status === 'healthy' ? undefined : compatibility.detail,
    });
    await this.saveState();
    await this.refreshBuzzWorker(adapter.id);
    return adapter.lastHealth ?? health;
  }
}

let communicationAdapterService: CommunicationAdapterService | null = null;

export function getCommunicationAdapterService(): CommunicationAdapterService {
  if (!communicationAdapterService) {
    communicationAdapterService = new CommunicationAdapterService();
  }
  return communicationAdapterService;
}

export function resetCommunicationAdapterServiceForTests(): void {
  communicationAdapterService = null;
}

export { DEFAULT_ADAPTER_ID };
