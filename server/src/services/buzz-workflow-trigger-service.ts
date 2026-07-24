import path from 'path';
import { nanoid } from 'nanoid';
import type {
  BuzzChannelMapping,
  BuzzWorkflowTriggerAudit,
  BuzzWorkflowTriggerRule,
  BuzzWorkflowTriggerRuleInput,
  RuntimeHookEnvelope,
} from '@veritas-kanban/shared';
import {
  BUZZ_WORKFLOW_TRIGGER_SCHEMA_VERSION,
  RUNTIME_HOOK_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
import { atomicWriteFile, mkdir, readFile } from '../storage/fs-helpers.js';
import { redactString } from '../lib/redact.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { withFileLock } from './file-lock.js';
import {
  getRuntimeHookBusService,
  type RuntimeHookBusService,
} from './runtime-hook-bus-service.js';
import { getWorkflowRunService, type WorkflowRunService } from './workflow-run-service.js';

const MAX_AUDITS = 500;
const HOOK_ID = 'buzz.workflow-trigger.allowlisted/v1';
const HOOK_HANDLER_ID = 'buzz.workflow-trigger.allowlisted';

interface BuzzWorkflowTriggerDispatch {
  causalKey: string;
  workflowId: string;
  status: 'accepted' | 'dispatched' | 'failed';
  runId?: string;
  updatedAt: string;
}

interface BuzzWorkflowTriggerState {
  version: 1;
  rules: Record<string, BuzzWorkflowTriggerRule>;
  dispatches: Record<string, BuzzWorkflowTriggerDispatch>;
  audits: BuzzWorkflowTriggerAudit[];
  updatedAt: string;
}

export interface BuzzWorkflowTriggerEvent {
  adapterId: string;
  mapping: BuzzChannelMapping;
  eventId: string;
  authorPubkey: string;
  content: string;
  occurredAt: string;
  rootEventId?: string;
  echo?: boolean;
}

export interface BuzzWorkflowTriggerServiceOptions {
  storageDir: string;
  persist?: boolean;
  runtimeHooks?: RuntimeHookBusService;
  workflowRuns?: WorkflowRunService;
  now?: () => Date;
}

export class BuzzWorkflowTriggerService {
  private readonly storageDir: string;
  private readonly persist: boolean;
  private readonly runtimeHooks?: RuntimeHookBusService;
  private readonly workflowRuns?: WorkflowRunService;
  private readonly now: () => Date;
  private readonly inFlight = new Map<string, Promise<BuzzWorkflowTriggerAudit>>();
  private loaded = false;
  private hooksReady = false;
  private state: BuzzWorkflowTriggerState;

  constructor(options: BuzzWorkflowTriggerServiceOptions) {
    this.storageDir = options.storageDir;
    this.persist = options.persist ?? true;
    this.runtimeHooks = options.runtimeHooks;
    this.workflowRuns = options.workflowRuns;
    this.now = options.now ?? (() => new Date());
    this.state = this.emptyState();
  }

  async listRules(adapterId?: string): Promise<BuzzWorkflowTriggerRule[]> {
    await this.ensureLoaded();
    return Object.values(this.state.rules)
      .filter((rule) => !adapterId || rule.adapterId === adapterId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((rule) => structuredClone(rule));
  }

  async createRule(
    adapterId: string,
    mapping: BuzzChannelMapping,
    input: BuzzWorkflowTriggerRuleInput,
    createdBy: string
  ): Promise<BuzzWorkflowTriggerRule> {
    validatePathSegment(adapterId);
    await this.ensureLoaded();
    const timestamp = this.now().toISOString();
    const authorPubkey = input.authorPubkey?.trim().toLowerCase();
    const contentIncludes = input.contentIncludes?.trim();
    const rule: BuzzWorkflowTriggerRule = {
      schemaVersion: BUZZ_WORKFLOW_TRIGGER_SCHEMA_VERSION,
      id: `buzz_rule_${nanoid(10)}`,
      adapterId,
      mappingId: mapping.id,
      community: mapping.community,
      channelId: mapping.channelId,
      event: 'message.posted',
      workflowId: input.workflowId.trim(),
      enabled: input.enabled ?? true,
      ...(authorPubkey ? { authorPubkey } : {}),
      ...(contentIncludes ? { contentIncludes } : {}),
      createdBy: createdBy.trim() || 'unknown',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.rules[rule.id] = rule;
    await this.saveState();
    return structuredClone(rule);
  }

  async disableRule(adapterId: string, ruleId: string): Promise<BuzzWorkflowTriggerRule> {
    validatePathSegment(adapterId);
    validatePathSegment(ruleId);
    await this.ensureLoaded();
    const rule = this.state.rules[ruleId];
    if (!rule || rule.adapterId !== adapterId) {
      throw new Error(`Buzz workflow trigger rule ${ruleId} not found`);
    }
    rule.enabled = false;
    rule.updatedAt = this.now().toISOString();
    await this.saveState();
    return structuredClone(rule);
  }

  async listAudits(adapterId?: string, limit = 100): Promise<BuzzWorkflowTriggerAudit[]> {
    await this.ensureLoaded();
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), MAX_AUDITS));
    return this.state.audits
      .filter((audit) => !adapterId || audit.adapterId === adapterId)
      .slice(-safeLimit)
      .reverse()
      .map((audit) => structuredClone(audit));
  }

  async processEvent(event: BuzzWorkflowTriggerEvent): Promise<BuzzWorkflowTriggerAudit[]> {
    await this.ensureLoaded();
    const candidates = Object.values(this.state.rules).filter(
      (rule) => rule.adapterId === event.adapterId && rule.mappingId === event.mapping.id
    );
    const audits: BuzzWorkflowTriggerAudit[] = [];
    for (const rule of candidates) {
      const causalKey = this.causalKey(rule, event.eventId);
      const existing = this.inFlight.get(causalKey);
      if (existing) {
        audits.push(await existing);
        continue;
      }
      const pending = this.processRule(rule, event, causalKey).finally(() => {
        this.inFlight.delete(causalKey);
      });
      this.inFlight.set(causalKey, pending);
      audits.push(await pending);
    }
    return audits;
  }

  private async processRule(
    rule: BuzzWorkflowTriggerRule,
    event: BuzzWorkflowTriggerEvent,
    causalKey: string
  ): Promise<BuzzWorkflowTriggerAudit> {
    if (!rule.enabled || event.rootEventId || !this.matchesPredicates(rule, event)) {
      return this.appendAudit(rule, event, causalKey, 'ignored-policy');
    }
    if (event.echo) {
      return this.appendAudit(rule, event, causalKey, 'echo');
    }

    const dispatch = this.state.dispatches[causalKey];
    if (dispatch?.status === 'dispatched') {
      return this.appendAudit(rule, event, causalKey, 'duplicate', dispatch.runId);
    }

    this.state.dispatches[causalKey] = {
      causalKey,
      workflowId: rule.workflowId,
      status: 'accepted',
      updatedAt: this.now().toISOString(),
    };
    await this.appendAudit(rule, event, causalKey, 'accepted');

    const existingRun = await this.findExistingRun(rule.workflowId, causalKey);
    if (existingRun) {
      return this.recordDispatched(rule, event, causalKey, existingRun.id);
    }

    try {
      this.ensureHooks();
      const hookResult = await this.hooks().dispatch(this.hookEnvelope(rule, event, causalKey));
      if (!hookResult.allowed) {
        this.state.dispatches[causalKey].status = 'failed';
        this.state.dispatches[causalKey].updatedAt = this.now().toISOString();
        return this.appendAudit(
          rule,
          event,
          causalKey,
          'dispatch-failed',
          undefined,
          'Runtime hook policy denied the external workflow trigger.'
        );
      }

      const run = await this.runs().startRun(rule.workflowId, undefined, {
        externalTrigger: {
          schemaVersion: BUZZ_WORKFLOW_TRIGGER_SCHEMA_VERSION,
          provider: 'buzz',
          event: rule.event,
          causalKey,
          ruleId: rule.id,
          adapterId: rule.adapterId,
          mappingId: rule.mappingId,
          community: rule.community,
          channelId: rule.channelId,
          eventId: event.eventId,
          authorPubkey: event.authorPubkey,
          content: event.content,
          occurredAt: event.occurredAt,
        },
      });
      return this.recordDispatched(rule, event, causalKey, run.id);
    } catch (error) {
      this.state.dispatches[causalKey].status = 'failed';
      this.state.dispatches[causalKey].updatedAt = this.now().toISOString();
      return this.appendAudit(
        rule,
        event,
        causalKey,
        'dispatch-failed',
        undefined,
        error instanceof Error
          ? redactString(error.message).slice(0, 500)
          : 'Workflow dispatch failed.'
      );
    }
  }

  private matchesPredicates(
    rule: BuzzWorkflowTriggerRule,
    event: BuzzWorkflowTriggerEvent
  ): boolean {
    if (rule.authorPubkey && rule.authorPubkey !== event.authorPubkey.toLowerCase()) return false;
    if (
      rule.contentIncludes &&
      !event.content.toLowerCase().includes(rule.contentIncludes.toLowerCase())
    ) {
      return false;
    }
    return true;
  }

  private async findExistingRun(
    workflowId: string,
    causalKey: string
  ): Promise<{ id: string } | undefined> {
    const runs = await this.runs().listRuns({ workflowId });
    return runs.find((run) => {
      const trigger = run.context.externalTrigger;
      return (
        trigger &&
        typeof trigger === 'object' &&
        (trigger as { causalKey?: unknown }).causalKey === causalKey
      );
    });
  }

  private async recordDispatched(
    rule: BuzzWorkflowTriggerRule,
    event: BuzzWorkflowTriggerEvent,
    causalKey: string,
    runId: string
  ): Promise<BuzzWorkflowTriggerAudit> {
    this.state.dispatches[causalKey] = {
      causalKey,
      workflowId: rule.workflowId,
      status: 'dispatched',
      runId,
      updatedAt: this.now().toISOString(),
    };
    return this.appendAudit(rule, event, causalKey, 'dispatched', runId);
  }

  private async appendAudit(
    rule: BuzzWorkflowTriggerRule,
    event: BuzzWorkflowTriggerEvent,
    causalKey: string,
    disposition: BuzzWorkflowTriggerAudit['disposition'],
    runId?: string,
    detail?: string
  ): Promise<BuzzWorkflowTriggerAudit> {
    const audit: BuzzWorkflowTriggerAudit = {
      schemaVersion: BUZZ_WORKFLOW_TRIGGER_SCHEMA_VERSION,
      id: `buzz_trigger_audit_${nanoid(10)}`,
      causalKey,
      adapterId: rule.adapterId,
      mappingId: rule.mappingId,
      ruleId: rule.id,
      workflowId: rule.workflowId,
      community: rule.community,
      channelId: rule.channelId,
      eventId: event.eventId,
      disposition,
      occurredAt: this.now().toISOString(),
      ...(runId ? { runId } : {}),
      ...(detail ? { detail } : {}),
    };
    this.state.audits.push(audit);
    this.state.audits = this.state.audits.slice(-MAX_AUDITS);
    await this.saveState();
    return structuredClone(audit);
  }

  private hookEnvelope(
    rule: BuzzWorkflowTriggerRule,
    event: BuzzWorkflowTriggerEvent,
    causalKey: string
  ): RuntimeHookEnvelope {
    return {
      schemaVersion: RUNTIME_HOOK_SCHEMA_VERSION,
      eventId: `buzz-trigger:${event.eventId}:${rule.id}`,
      event: 'workflow.pre-external-trigger',
      occurredAt: event.occurredAt,
      scope: { workflowId: rule.workflowId },
      references: {
        sourceEventId: event.eventId,
        workflowId: rule.workflowId,
        externalEventId: event.eventId,
      },
      metadata: {
        source: 'buzz',
        event: rule.event,
        causalKey,
        ruleId: rule.id,
        adapterId: rule.adapterId,
        mappingId: rule.mappingId,
      },
    };
  }

  private ensureHooks(): void {
    if (this.hooksReady) return;
    const hooks = this.hooks();
    hooks.registerHandler(HOOK_HANDLER_ID, async (envelope) => ({
      decision: envelope.metadata.source === 'buzz' ? 'allow' : 'observe',
    }));
    hooks.registerDefinition({
      schemaVersion: RUNTIME_HOOK_SCHEMA_VERSION,
      id: HOOK_ID,
      event: 'workflow.pre-external-trigger',
      handlerId: HOOK_HANDLER_ID,
      scope: { kind: 'global' },
      enabled: true,
      order: 0,
      timeoutMs: 500,
      failurePolicy: 'fail-closed',
    });
    this.hooksReady = true;
  }

  private hooks(): RuntimeHookBusService {
    return this.runtimeHooks ?? getRuntimeHookBusService();
  }

  private runs(): WorkflowRunService {
    return this.workflowRuns ?? getWorkflowRunService();
  }

  private causalKey(rule: BuzzWorkflowTriggerRule, eventId: string): string {
    return `buzz:${rule.community}:${eventId}:${rule.id}`;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.persist) {
      this.loaded = true;
      return;
    }
    await mkdir(this.storageDir, { recursive: true });
    try {
      const parsed = JSON.parse(
        await readFile(this.statePath, 'utf8')
      ) as Partial<BuzzWorkflowTriggerState>;
      this.state = {
        version: 1,
        rules:
          parsed.rules && typeof parsed.rules === 'object'
            ? (parsed.rules as Record<string, BuzzWorkflowTriggerRule>)
            : {},
        dispatches:
          parsed.dispatches && typeof parsed.dispatches === 'object'
            ? (parsed.dispatches as Record<string, BuzzWorkflowTriggerDispatch>)
            : {},
        audits: Array.isArray(parsed.audits)
          ? (parsed.audits as BuzzWorkflowTriggerAudit[]).slice(-MAX_AUDITS)
          : [],
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : this.now().toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = this.emptyState();
    }
    this.loaded = true;
  }

  private async saveState(): Promise<void> {
    this.state.updatedAt = this.now().toISOString();
    if (!this.persist) return;
    await mkdir(this.storageDir, { recursive: true });
    await withFileLock(this.statePath, async () => {
      await atomicWriteFile(this.statePath, JSON.stringify(this.state, null, 2));
    });
  }

  private get statePath(): string {
    return ensureWithinBase(this.storageDir, path.join(this.storageDir, 'state.json'));
  }

  private emptyState(): BuzzWorkflowTriggerState {
    return {
      version: 1,
      rules: {},
      dispatches: {},
      audits: [],
      updatedAt: this.now().toISOString(),
    };
  }
}
