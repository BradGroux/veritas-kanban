import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import type { FeatureSettings } from '@veritas-kanban/shared';
import { auditLog, type AuditEvent } from './audit-service.js';
import {
  safeFetch,
  validateWebhookUrl,
  type UrlValidationOptions,
} from '../utils/url-validation.js';
import { getRuntimeDir } from '../utils/paths.js';

export type OutboundEndpointType =
  | 'broadcast-webhook'
  | 'lifecycle-hook-webhook'
  | 'transition-hook-webhook'
  | 'policy-webhook'
  | 'squad-webhook'
  | 'openclaw-wake'
  | 'openclaw-gateway'
  | 'failure-alert-webhook';

export type OutboundDeliveryStatus = 'success' | 'failed' | 'blocked' | 'timeout' | 'skipped';

export interface OutboundEndpointAuth {
  type: 'none' | 'hmac-sha256' | 'bearer' | 'custom-header';
  secretRef?: string;
  headerName?: string;
  hasSecret?: boolean;
}

export interface OutboundEndpointOwner {
  source: 'feature-settings' | 'env' | 'policy' | 'hook' | 'runtime';
  resourceId?: string;
}

export interface OutboundEndpointInput {
  id: string;
  type: OutboundEndpointType;
  displayName: string;
  url: string;
  enabled?: boolean;
  auth?: OutboundEndpointAuth;
  owner: OutboundEndpointOwner;
  validationOptions?: UrlValidationOptions;
}

export interface OutboundEndpointRecord {
  id: string;
  type: OutboundEndpointType;
  displayName: string;
  url: string;
  enabled: boolean;
  auth: OutboundEndpointAuth;
  owner: OutboundEndpointOwner;
  validationPolicy: UrlValidationOptions;
  validation: {
    valid: boolean;
    reason?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OutboundDeliveryRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: RequestInit['body'];
  timeoutMs?: number;
  responseBodyLimit?: number;
  retryOf?: string;
  attempt?: number;
}

export interface OutboundDeliveryAttempt {
  id: string;
  endpointId: string;
  endpointType: OutboundEndpointType;
  displayName: string;
  method: string;
  sanitizedUrl: string;
  status: OutboundDeliveryStatus;
  responseStatus?: number;
  responseClass?: string;
  durationMs: number;
  retryOf?: string;
  attempt: number;
  error?: string;
  startedAt: string;
  completedAt: string;
}

export interface OutboundDeliveryResult {
  ok: boolean;
  status: OutboundDeliveryStatus;
  attemptId: string;
  responseStatus?: number;
  responseText?: string;
  error?: string;
}

export interface OutboundIntegrationServiceOptions {
  storageDir?: string;
  persist?: boolean;
  audit?: (event: AuditEvent) => Promise<void>;
}

const DEFAULT_AUTH: OutboundEndpointAuth = { type: 'none' };
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DELIVERIES = 500;

export class OutboundIntegrationService {
  private readonly storageDir: string;
  private readonly persist: boolean;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private loaded = false;
  private endpoints = new Map<string, OutboundEndpointRecord>();
  private deliveries: OutboundDeliveryAttempt[] = [];

  constructor(options: OutboundIntegrationServiceOptions = {}) {
    this.storageDir = options.storageDir || path.join(getRuntimeDir(), 'outbound-integrations');
    this.persist = options.persist ?? process.env.VITEST !== 'true';
    this.audit = options.audit || auditLog;
  }

  async registerEndpoint(input: OutboundEndpointInput): Promise<OutboundEndpointRecord> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const existing = this.endpoints.get(input.id);
    const validationOptions = input.validationOptions || {};
    const validation = validateWebhookUrl(input.url, validationOptions);
    const record: OutboundEndpointRecord = {
      id: input.id,
      type: input.type,
      displayName: input.displayName,
      url: this.sanitizeUrl(input.url),
      enabled: input.enabled ?? true,
      auth: this.sanitizeAuth(input.auth),
      owner: input.owner,
      validationPolicy: validationOptions,
      validation: {
        valid: validation.valid,
        reason: validation.reason,
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const comparableExisting = existing ? { ...existing, updatedAt: record.updatedAt } : null;
    const changed =
      !comparableExisting || JSON.stringify(comparableExisting) !== JSON.stringify(record);
    if (existing && !changed) {
      return existing;
    }

    this.endpoints.set(record.id, record);
    await this.saveEndpoints();
    await this.auditEndpointChange(record, existing);
    return record;
  }

  async deliver(
    endpoint: OutboundEndpointInput,
    request: OutboundDeliveryRequest
  ): Promise<OutboundDeliveryResult> {
    const registered = await this.registerEndpoint(endpoint);
    const method = (request.method || 'POST').toUpperCase();
    const startedAt = new Date().toISOString();
    const start = performance.now();

    if (!registered.enabled) {
      const attempt = await this.recordDelivery({
        endpoint: registered,
        method,
        status: 'skipped',
        startedAt,
        durationMs: Math.round(performance.now() - start),
        retryOf: request.retryOf,
        attempt: request.attempt,
        error: 'Endpoint disabled',
      });
      return {
        ok: false,
        status: 'skipped',
        attemptId: attempt.id,
        error: attempt.error,
      };
    }

    const validation = validateWebhookUrl(endpoint.url, endpoint.validationOptions || {});
    if (!validation.valid) {
      const attempt = await this.recordDelivery({
        endpoint: registered,
        method,
        status: 'blocked',
        startedAt,
        durationMs: Math.round(performance.now() - start),
        retryOf: request.retryOf,
        attempt: request.attempt,
        error: validation.reason || 'URL blocked by outbound URL policy',
      });
      return {
        ok: false,
        status: 'blocked',
        attemptId: attempt.id,
        error: attempt.error,
      };
    }

    const controller = new AbortController();
    const timeoutMs = request.timeoutMs || DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await safeFetch(
        endpoint.url,
        {
          method,
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        },
        endpoint.validationOptions
      );

      if (!response) {
        const attempt = await this.recordDelivery({
          endpoint: registered,
          method,
          status: 'blocked',
          startedAt,
          durationMs: Math.round(performance.now() - start),
          retryOf: request.retryOf,
          attempt: request.attempt,
          error: 'URL blocked by outbound URL policy',
        });
        return {
          ok: false,
          status: 'blocked',
          attemptId: attempt.id,
          error: attempt.error,
        };
      }

      const responseText =
        request.responseBodyLimit && request.responseBodyLimit > 0
          ? await response.text().catch(() => '')
          : undefined;
      const status: OutboundDeliveryStatus = response.ok ? 'success' : 'failed';
      const attempt = await this.recordDelivery({
        endpoint: registered,
        method,
        status,
        startedAt,
        durationMs: Math.round(performance.now() - start),
        retryOf: request.retryOf,
        attempt: request.attempt,
        responseStatus: response.status,
      });

      return {
        ok: response.ok,
        status,
        attemptId: attempt.id,
        responseStatus: response.status,
        responseText: responseText?.slice(0, request.responseBodyLimit),
      };
    } catch (err) {
      const message = this.sanitizeError(err, endpoint.url);
      const status: OutboundDeliveryStatus =
        err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'failed';
      const attempt = await this.recordDelivery({
        endpoint: registered,
        method,
        status,
        startedAt,
        durationMs: Math.round(performance.now() - start),
        retryOf: request.retryOf,
        attempt: request.attempt,
        error: status === 'timeout' ? `Timed out after ${timeoutMs}ms` : message,
      });
      return {
        ok: false,
        status,
        attemptId: attempt.id,
        error: attempt.error,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async listEndpoints(): Promise<OutboundEndpointRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.endpoints.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  async listDeliveries(limit = 100): Promise<OutboundDeliveryAttempt[]> {
    await this.ensureLoaded();
    const safeLimit = Math.max(1, Math.min(limit, MAX_DELIVERIES));
    return this.deliveries.slice(-safeLimit).reverse();
  }

  async syncFeatureSettings(settings: FeatureSettings): Promise<void> {
    const registrations: Array<Promise<OutboundEndpointRecord>> = [];

    for (const [event, hook] of Object.entries(settings.hooks || {})) {
      if (event === 'enabled' || !hook || typeof hook !== 'object') continue;
      const webhook = (hook as { webhook?: string; enabled?: boolean }).webhook;
      if (!webhook) continue;
      registrations.push(
        this.registerEndpoint({
          id: `hooks.${event}`,
          type: 'lifecycle-hook-webhook',
          displayName: `Lifecycle hook ${event}`,
          url: webhook,
          enabled: settings.hooks.enabled && ((hook as { enabled?: boolean }).enabled ?? true),
          owner: { source: 'feature-settings', resourceId: `hooks.${event}` },
        })
      );
    }

    if (settings.squadWebhook?.url) {
      registrations.push(
        this.registerEndpoint({
          id: 'squad.webhook',
          type: 'squad-webhook',
          displayName: 'Squad Chat webhook',
          url: settings.squadWebhook.url,
          enabled: settings.squadWebhook.enabled && settings.squadWebhook.mode !== 'openclaw',
          auth: {
            type: 'hmac-sha256',
            headerName: 'X-VK-Signature',
            secretRef: 'featureSettings.squadWebhook.secret',
            hasSecret: Boolean(settings.squadWebhook.secret),
          },
          owner: { source: 'feature-settings', resourceId: 'squadWebhook.url' },
        })
      );
    }

    if (settings.squadWebhook?.openclawGatewayUrl) {
      registrations.push(
        this.registerEndpoint({
          id: 'squad.openclawWake',
          type: 'openclaw-wake',
          displayName: 'Squad Chat OpenClaw wake',
          url: `${settings.squadWebhook.openclawGatewayUrl.replace(/\/+$/, '')}/tools/invoke`,
          enabled: settings.squadWebhook.enabled && settings.squadWebhook.mode === 'openclaw',
          auth: {
            type: 'bearer',
            secretRef: 'featureSettings.squadWebhook.openclawGatewayToken',
            hasSecret: Boolean(settings.squadWebhook.openclawGatewayToken),
          },
          owner: { source: 'feature-settings', resourceId: 'squadWebhook.openclawGatewayUrl' },
          validationOptions: { allowHttp: true, allowLocalhost: true },
        })
      );
    }

    if (settings.notifications?.webhookUrl) {
      registrations.push(
        this.registerEndpoint({
          id: 'notifications.failureAlert',
          type: 'failure-alert-webhook',
          displayName: 'Failure alert webhook',
          url: settings.notifications.webhookUrl,
          enabled: settings.notifications.enabled && settings.notifications.onAgentFailure,
          owner: { source: 'feature-settings', resourceId: 'notifications.webhookUrl' },
        })
      );
    }

    await Promise.all(registrations);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.persist) {
      this.loaded = true;
      return;
    }

    await fs.mkdir(this.storageDir, { recursive: true });

    try {
      const raw = await fs.readFile(this.endpointsPath, 'utf-8');
      const parsed = JSON.parse(raw) as OutboundEndpointRecord[];
      this.endpoints = new Map(parsed.map((endpoint) => [endpoint.id, endpoint]));
    } catch {
      this.endpoints = new Map();
    }

    try {
      const raw = await fs.readFile(this.deliveriesPath, 'utf-8');
      this.deliveries = JSON.parse(raw) as OutboundDeliveryAttempt[];
      if (this.deliveries.length > MAX_DELIVERIES) {
        this.deliveries = this.deliveries.slice(-MAX_DELIVERIES);
      }
    } catch {
      this.deliveries = [];
    }

    this.loaded = true;
  }

  private get endpointsPath(): string {
    return path.join(this.storageDir, 'endpoints.json');
  }

  private get deliveriesPath(): string {
    return path.join(this.storageDir, 'deliveries.json');
  }

  private async saveEndpoints(): Promise<void> {
    if (!this.persist) return;
    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.writeFile(
      this.endpointsPath,
      JSON.stringify(Array.from(this.endpoints.values()), null, 2),
      'utf-8'
    );
  }

  private async saveDeliveries(): Promise<void> {
    if (!this.persist) return;
    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.writeFile(this.deliveriesPath, JSON.stringify(this.deliveries, null, 2), 'utf-8');
  }

  private async recordDelivery(input: {
    endpoint: OutboundEndpointRecord;
    method: string;
    status: OutboundDeliveryStatus;
    startedAt: string;
    durationMs: number;
    responseStatus?: number;
    retryOf?: string;
    attempt?: number;
    error?: string;
  }): Promise<OutboundDeliveryAttempt> {
    const completedAt = new Date().toISOString();
    const attempt: OutboundDeliveryAttempt = {
      id: `outbound_${Date.now()}_${nanoid(8)}`,
      endpointId: input.endpoint.id,
      endpointType: input.endpoint.type,
      displayName: input.endpoint.displayName,
      method: input.method,
      sanitizedUrl: input.endpoint.url,
      status: input.status,
      responseStatus: input.responseStatus,
      responseClass: this.responseClass(input.responseStatus),
      durationMs: input.durationMs,
      retryOf: input.retryOf,
      attempt: input.attempt || 1,
      error: input.error ? this.sanitizeError(input.error) : undefined,
      startedAt: input.startedAt,
      completedAt,
    };

    this.deliveries.push(attempt);
    if (this.deliveries.length > MAX_DELIVERIES) {
      this.deliveries = this.deliveries.slice(-MAX_DELIVERIES);
    }
    await this.saveDeliveries();
    await this.audit({
      action: 'outbound_endpoint.used',
      actor: 'system',
      resource: input.endpoint.id,
      details: {
        endpointType: input.endpoint.type,
        status: attempt.status,
        responseStatus: attempt.responseStatus,
        responseClass: attempt.responseClass,
        durationMs: attempt.durationMs,
        retryOf: attempt.retryOf,
        error: attempt.error,
      },
    });
    return attempt;
  }

  private async auditEndpointChange(
    record: OutboundEndpointRecord,
    existing?: OutboundEndpointRecord
  ): Promise<void> {
    const action = !existing
      ? 'outbound_endpoint.created'
      : record.enabled
        ? 'outbound_endpoint.changed'
        : 'outbound_endpoint.disabled';
    await this.audit({
      action,
      actor: 'system',
      resource: record.id,
      details: {
        endpointType: record.type,
        displayName: record.displayName,
        owner: record.owner,
        enabled: record.enabled,
        validation: record.validation,
        url: record.url,
        auth: record.auth,
      },
    });
  }

  private sanitizeAuth(auth?: OutboundEndpointAuth): OutboundEndpointAuth {
    if (!auth) return DEFAULT_AUTH;
    return {
      type: auth.type,
      secretRef: auth.secretRef,
      headerName: auth.headerName,
      hasSecret: auth.hasSecret,
    };
  }

  private sanitizeUrl(url: string): string {
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

  private sanitizeError(err: unknown, rawUrl?: string): string {
    let message = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
    if (rawUrl) {
      message = message.split(rawUrl).join(this.sanitizeUrl(rawUrl));
    }

    const replacements: Array<[RegExp, string]> = [
      [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
      [/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]'],
      [/\bghp_[A-Za-z0-9_]{12,}/g, 'ghp_[REDACTED]'],
      [/\bgithub_pat_[A-Za-z0-9_]{12,}/g, 'github_pat_[REDACTED]'],
      [
        /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi,
        '$1=[REDACTED]',
      ],
      [
        /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s"'`,}]+)/gi,
        '$1=[REDACTED]',
      ],
    ];

    for (const [pattern, replacement] of replacements) {
      message = message.replace(pattern, replacement);
    }

    return message.slice(0, 1000);
  }

  private responseClass(status?: number): string | undefined {
    if (!status) return undefined;
    return `${Math.floor(status / 100)}xx`;
  }
}

let outboundIntegrationService: OutboundIntegrationService | null = null;

export function getOutboundIntegrationService(): OutboundIntegrationService {
  if (!outboundIntegrationService) {
    outboundIntegrationService = new OutboundIntegrationService();
  }
  return outboundIntegrationService;
}

export function _resetOutboundIntegrationService(service?: OutboundIntegrationService): void {
  outboundIntegrationService = service || null;
}
