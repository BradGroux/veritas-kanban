import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
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
  SquadMessage,
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

const DEFAULT_ADAPTER_ID = 'msteams-default';
const MAX_DELIVERIES = 500;
const MAX_MESSAGE_LENGTH = 4000;

interface InternalCommunicationAdapterRecord extends CommunicationAdapterRecord {
  webhookUrlRaw?: string;
}

interface CommunicationAdapterState {
  version: 1;
  adapters: Record<string, InternalCommunicationAdapterRecord>;
  mappings: Record<string, CommunicationThreadMapping>;
  replyIds: Record<string, string>;
  deliveries: CommunicationDeliveryAudit[];
  updatedAt: string;
}

export interface CommunicationAdapterServiceOptions {
  storageDir?: string;
  persist?: boolean;
  chatService?: ChatService;
  outboundIntegrations?: OutboundIntegrationService;
  audit?: (event: AuditEvent) => Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimOrUndefined(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
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
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private loaded = false;
  private state: CommunicationAdapterState = this.emptyState();

  constructor(options: CommunicationAdapterServiceOptions = {}) {
    this.storageDir = options.storageDir || path.join(getRuntimeDir(), 'communication-adapters');
    this.persist = options.persist ?? process.env.VITEST !== 'true';
    this.chatService = options.chatService || getChatService();
    this.outboundIntegrations = options.outboundIntegrations || getOutboundIntegrationService();
    this.audit = options.audit || auditLog;
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

  async configureAdapter(
    adapterId: string,
    input: CommunicationAdapterInput
  ): Promise<CommunicationAdapterRecord> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();

    const timestamp = nowIso();
    const existing = this.state.adapters[adapterId];
    const rawWebhook =
      input.webhookUrl !== undefined ? trimOrUndefined(input.webhookUrl) : existing?.webhookUrlRaw;
    const adapter: InternalCommunicationAdapterRecord = {
      id: adapterId,
      kind: input.kind ?? existing?.kind ?? 'msteams',
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
    const timestamp = nowIso();
    const disconnected: InternalCommunicationAdapterRecord = {
      ...adapter,
      enabled: false,
      webhookUrl: undefined,
      webhookUrlRaw: undefined,
      webhookUrlConfigured: false,
      webhookUrlRedacted: false,
      hasCredential: false,
      updatedAt: timestamp,
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
    this.requireAdapter(adapterId);
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
      createdAt: nowIso(),
    };
    this.state.deliveries.push(delivery);
    if (this.state.deliveries.length > MAX_DELIVERIES) {
      this.state.deliveries = this.state.deliveries.slice(-MAX_DELIVERIES);
    }
    return delivery;
  }

  private hasDestination(adapter: InternalCommunicationAdapterRecord): boolean {
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
    const { webhookUrlRaw: _webhookUrlRaw, ...publicRecord } = adapter;
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

    await fs.mkdir(this.storageDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<CommunicationAdapterState>;
      this.state = {
        version: 1,
        adapters:
          parsed.adapters && typeof parsed.adapters === 'object'
            ? (parsed.adapters as Record<string, InternalCommunicationAdapterRecord>)
            : {},
        mappings:
          parsed.mappings && typeof parsed.mappings === 'object'
            ? (parsed.mappings as Record<string, CommunicationThreadMapping>)
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
    await fs.mkdir(this.storageDir, { recursive: true });
    await withFileLock(this.statePath, async () => {
      await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
    });
  }

  private get statePath(): string {
    const filePath = path.join(this.storageDir, 'state.json');
    ensureWithinBase(this.storageDir, filePath);
    return filePath;
  }

  private emptyState(): CommunicationAdapterState {
    return {
      version: 1,
      adapters: {},
      mappings: {},
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
      },
    });
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
