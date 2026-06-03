import { createLogger } from '../lib/logger.js';
import type { UrlValidationOptions } from '../utils/url-validation.js';
import { getOutboundIntegrationService } from './outbound-integration-service.js';

const log = createLogger('openclaw-workflow-adapter');

export interface OpenClawWorkflowToolFilter {
  allowed?: string[];
  denied?: string[];
}

export interface OpenClawWorkflowSpawnInput {
  workflowId: string;
  runId: string;
  stepId: string;
  taskId?: string;
  agentId: string;
  agentName?: string;
  model?: string;
  prompt: string;
  sessionMode: 'fresh' | 'reuse';
  contextMode: 'minimal' | 'full' | 'custom';
  cleanup: 'delete' | 'keep';
  timeoutSeconds: number;
  taskContext?: unknown;
  toolFilter?: OpenClawWorkflowToolFilter;
}

export interface OpenClawWorkflowSessionInput {
  workflowId: string;
  runId: string;
  stepId: string;
  taskId?: string;
  agentId: string;
  sessionKey: string;
  prompt: string;
  timeoutSeconds: number;
  toolFilter?: OpenClawWorkflowToolFilter;
}

export interface OpenClawWorkflowCleanupInput {
  workflowId: string;
  runId: string;
  stepId: string;
  taskId?: string;
  agentId: string;
  sessionKey: string;
}

export interface OpenClawWorkflowSessionResult {
  sessionKey: string;
  runId?: string;
  status?: string;
  output?: string;
  error?: string;
  raw?: unknown;
}

export interface OpenClawWorkflowAdapter {
  spawn(input: OpenClawWorkflowSpawnInput): Promise<OpenClawWorkflowSessionResult>;
  send(input: OpenClawWorkflowSessionInput): Promise<OpenClawWorkflowSessionResult>;
  wait(input: OpenClawWorkflowSessionInput): Promise<OpenClawWorkflowSessionResult>;
  cleanup(input: OpenClawWorkflowCleanupInput): Promise<void>;
}

export interface HttpOpenClawWorkflowAdapterOptions {
  gatewayUrl?: string;
  token?: string;
  sessionKey?: string;
  requestTimeoutMs?: number;
  validationOptions?: UrlValidationOptions;
}

export class HttpOpenClawWorkflowAdapter implements OpenClawWorkflowAdapter {
  private readonly gatewayUrl: string;
  private readonly token?: string;
  private readonly sessionKey: string;
  private readonly requestTimeoutMs: number;
  private readonly validationOptions: UrlValidationOptions;

  constructor(options: HttpOpenClawWorkflowAdapterOptions = {}) {
    this.gatewayUrl = (
      options.gatewayUrl ||
      process.env.OPENCLAW_GATEWAY_URL ||
      process.env.CLAWDBOT_GATEWAY ||
      process.env.CLAWDBOT_GATEWAY_URL ||
      'http://127.0.0.1:18789'
    ).replace(/\/+$/, '');
    this.token =
      options.token || process.env.OPENCLAW_GATEWAY_TOKEN || process.env.CLAWDBOT_GATEWAY_TOKEN;
    this.sessionKey = options.sessionKey || process.env.OPENCLAW_GATEWAY_SESSION_KEY || 'main';
    this.requestTimeoutMs = options.requestTimeoutMs || 30_000;
    this.validationOptions = {
      allowHttp: true,
      allowLocalhost: true,
      allowPrivateIp: process.env.OPENCLAW_GATEWAY_ALLOW_PRIVATE === 'true',
      ...options.validationOptions,
    };
  }

  async spawn(input: OpenClawWorkflowSpawnInput): Promise<OpenClawWorkflowSessionResult> {
    const args: Record<string, unknown> = {
      task: input.prompt,
      taskName: this.buildTaskName(input),
      label: this.buildLabel(input),
      runtime: 'subagent',
      agentId: input.agentId,
      runTimeoutSeconds: input.timeoutSeconds,
      mode: 'session',
      cleanup: input.cleanup,
      context: input.contextMode === 'full' ? 'fork' : 'isolated',
    };

    if (input.model) args.model = input.model;

    const result = await this.invokeTool('sessions_spawn', args, input.timeoutSeconds);
    const sessionKey =
      this.readString(result, 'childSessionKey') || this.readString(result, 'sessionKey');

    if (!sessionKey) {
      throw new Error('OpenClaw sessions_spawn did not return a child session key');
    }

    return {
      sessionKey,
      runId: this.readString(result, 'runId'),
      status: this.readString(result, 'status') || 'accepted',
      output: this.extractOutput(result),
      error: this.readString(result, 'error'),
      raw: result,
    };
  }

  async send(input: OpenClawWorkflowSessionInput): Promise<OpenClawWorkflowSessionResult> {
    const result = await this.invokeTool(
      'sessions_send',
      {
        sessionKey: input.sessionKey,
        message: input.prompt,
        timeoutSeconds: input.timeoutSeconds,
      },
      input.timeoutSeconds
    );

    return {
      sessionKey: this.readString(result, 'sessionKey') || input.sessionKey,
      runId: this.readString(result, 'runId'),
      status: this.readString(result, 'status') || 'completed',
      output: this.extractOutput(result),
      error: this.readString(result, 'error'),
      raw: result,
    };
  }

  async wait(input: OpenClawWorkflowSessionInput): Promise<OpenClawWorkflowSessionResult> {
    const waitPrompt = [
      'Return the final result for this Veritas Kanban workflow step.',
      `Workflow: ${input.workflowId}`,
      `Run: ${input.runId}`,
      `Step: ${input.stepId}`,
      '',
      'If the step is complete, respond with STATUS: done and OUTPUT: followed by the result.',
      'If the step failed, respond with STATUS: failed and OUTPUT: followed by the failure summary.',
    ].join('\n');

    return this.send({
      ...input,
      prompt: waitPrompt,
    });
  }

  async cleanup(input: OpenClawWorkflowCleanupInput): Promise<void> {
    log.debug(
      { runId: input.runId, stepId: input.stepId, sessionKey: input.sessionKey },
      'OpenClaw workflow cleanup delegated to sessions_spawn cleanup policy'
    );
  }

  private async invokeTool(
    tool: 'sessions_spawn' | 'sessions_send',
    args: Record<string, unknown>,
    timeoutSeconds: number
  ): Promise<Record<string, unknown>> {
    const url = `${this.gatewayUrl}/tools/invoke`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const delivery = await getOutboundIntegrationService().deliver(
      {
        id: 'workflow.openclawGateway',
        type: 'openclaw-gateway',
        displayName: 'Workflow OpenClaw gateway',
        url,
        enabled: true,
        auth: {
          type: 'bearer',
          secretRef: this.token ? 'OPENCLAW_GATEWAY_TOKEN' : undefined,
          hasSecret: Boolean(this.token),
        },
        owner: { source: 'runtime', resourceId: 'workflow-step-executor' },
        validationOptions: this.validationOptions,
      },
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool,
          args,
          sessionKey: this.sessionKey,
        }),
        timeoutMs: Math.max(this.requestTimeoutMs, timeoutSeconds * 1000),
        responseBodyLimit: 2 * 1024 * 1024,
      }
    );

    if (delivery.status === 'blocked') {
      throw new Error('OpenClaw gateway URL was blocked by outbound URL policy');
    }
    if (delivery.status === 'timeout') {
      throw new Error(`OpenClaw ${tool} timed out after ${timeoutSeconds}s`);
    }

    const body = this.parseJson(delivery.responseText);

    if (!delivery.ok) {
      throw new Error(
        this.extractError(body) ||
          `OpenClaw gateway returned HTTP ${delivery.responseStatus || 'unknown'}`
      );
    }

    const envelope = this.asRecord(body);
    if (envelope?.ok === false) {
      throw new Error(this.extractError(envelope) || `OpenClaw ${tool} failed`);
    }

    const toolResult = this.unwrapToolResult(envelope?.result ?? body);
    const status = this.readString(toolResult, 'status')?.toLowerCase();
    if (status === 'error' || status === 'failed' || status === 'forbidden') {
      throw new Error(
        this.readString(toolResult, 'error') || `OpenClaw ${tool} returned ${status}`
      );
    }

    return toolResult;
  }

  private parseJson(text: string | undefined): unknown {
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private unwrapToolResult(value: unknown): Record<string, unknown> {
    const record = this.asRecord(value);
    if (!record) return {};

    const details = this.asRecord(record.details);
    if (details) return details;

    const parsedText = this.parseTextPayload(record.text);
    if (parsedText) return parsedText;

    const content = Array.isArray(record.content) ? record.content : [];
    for (const item of content) {
      const itemRecord = this.asRecord(item);
      const parsed = this.parseTextPayload(itemRecord?.text);
      if (parsed) return parsed;
    }

    return record;
  }

  private parseTextPayload(text: unknown): Record<string, unknown> | null {
    if (typeof text !== 'string' || !text.trim()) return null;
    try {
      const parsed = JSON.parse(text);
      return this.asRecord(parsed);
    } catch {
      return { output: text };
    }
  }

  private extractOutput(record: Record<string, unknown>): string | undefined {
    for (const key of ['reply', 'output', 'summary', 'result', 'text']) {
      const value = this.readString(record, key);
      if (value) return value;
    }
    return undefined;
  }

  private extractError(value: unknown): string | undefined {
    const record = this.asRecord(value);
    if (!record) return undefined;

    const direct = this.readString(record, 'message') || this.readString(record, 'error');
    if (direct) return direct;

    const error = this.asRecord(record.error);
    return this.readString(error, 'message') || this.readString(error, 'error');
  }

  private buildTaskName(input: OpenClawWorkflowSpawnInput): string {
    const raw = `${input.workflowId}_${input.stepId}_${input.runId}`
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const candidate = raw || `workflow_${input.stepId}`;
    const withLetter = /^[a-z]/.test(candidate) ? candidate : `w_${candidate}`;
    return withLetter.slice(0, 64);
  }

  private buildLabel(input: OpenClawWorkflowSpawnInput): string {
    return [
      'Veritas workflow',
      input.workflowId,
      input.runId,
      input.stepId,
      input.agentName || input.agentId,
    ]
      .filter(Boolean)
      .join(' / ')
      .slice(0, 180);
  }

  private readString(
    record: Record<string, unknown> | null | undefined,
    key: string
  ): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
