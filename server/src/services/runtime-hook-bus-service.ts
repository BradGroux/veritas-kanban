import type {
  RuntimeHookDefinition,
  RuntimeHookDispatchResult,
  RuntimeHookDryRunEntry,
  RuntimeHookDryRunResult,
  RuntimeHookEnvelope,
  RuntimeHookEvidenceReference,
  RuntimeHookHandler,
  RuntimeHookHandlerResult,
  RuntimeHookOutcome,
  RuntimeHookOutcomeRecorder,
  RuntimeHookScope,
} from '@veritas-kanban/shared';
import { RUNTIME_HOOK_SCHEMA_VERSION, isBlockingRuntimeHookEvent } from '@veritas-kanban/shared';
import { ValidationError } from '../middleware/error-handler.js';
import {
  RuntimeHookDefinitionSchema,
  RuntimeHookDryRunResultSchema,
  RuntimeHookEnvelopeSchema,
  RuntimeHookOutcomeSchema,
} from '../schemas/runtime-hook-schemas.js';
import {
  containsUnredactedProviderRuntimeSecret,
  sanitizeProviderRuntimeDiagnostic,
} from '../utils/provider-runtime-manifest-sanitize.js';
import {
  getRunEventJournalService,
  type RunEventJournalService,
} from './run-event-journal-service.js';

const SCOPE_ORDER: Record<RuntimeHookScope['kind'], number> = {
  global: 0,
  workspace: 1,
  profile: 2,
  workflow: 3,
  run: 4,
};

export interface RuntimeHookBusOptions {
  definitions?: RuntimeHookDefinition[];
  handlers?: Record<string, RuntimeHookHandler>;
  recorder?: RuntimeHookOutcomeRecorder;
  now?: () => Date;
  clockMs?: () => number;
}

export class RuntimeHookBusService {
  private readonly definitions = new Map<string, RuntimeHookDefinition>();
  private readonly handlers = new Map<string, RuntimeHookHandler>();
  private readonly active = new Set<string>();
  private readonly recorder?: RuntimeHookOutcomeRecorder;
  private readonly now: () => Date;
  private readonly clockMs: () => number;

  constructor(options: RuntimeHookBusOptions = {}) {
    this.recorder = options.recorder;
    this.now = options.now ?? (() => new Date());
    this.clockMs = options.clockMs ?? Date.now;
    for (const [handlerId, handler] of Object.entries(options.handlers ?? {})) {
      this.registerHandler(handlerId, handler);
    }
    for (const definition of options.definitions ?? []) {
      this.registerDefinition(definition);
    }
  }

  registerHandler(handlerId: string, handler: RuntimeHookHandler): void {
    assertIdentifier(handlerId, 'handler ID');
    this.handlers.set(handlerId, handler);
  }

  registerDefinition(input: RuntimeHookDefinition): RuntimeHookDefinition {
    const definition = RuntimeHookDefinitionSchema.parse(input);
    this.definitions.set(definition.id, structuredClone(definition));
    return structuredClone(definition);
  }

  setDefinitionEnabled(id: string, enabled: boolean): RuntimeHookDefinition {
    const current = this.definitions.get(id);
    if (!current) throw new ValidationError(`Runtime hook ${id} does not exist.`);
    return this.registerDefinition({ ...current, enabled });
  }

  listDefinitions(): RuntimeHookDefinition[] {
    return [...this.definitions.values()].map((definition) => structuredClone(definition));
  }

  dryRun(input: RuntimeHookEnvelope): RuntimeHookDryRunResult {
    const envelope = this.parseEnvelope(input);
    const effectiveHooks = this.effectiveDefinitions(envelope).map<RuntimeHookDryRunEntry>(
      (definition) => {
        const blocking = isBlockingRuntimeHookEvent(definition.event);
        const handlerRegistered = this.handlers.has(definition.handlerId);
        const blocker =
          blocking && !handlerRegistered && definition.failurePolicy === 'fail-closed'
            ? `Handler ${definition.handlerId} is not registered.`
            : undefined;
        return {
          hookId: definition.id,
          handlerId: definition.handlerId,
          scope: structuredClone(definition.scope),
          order: definition.order,
          blocking,
          handlerRegistered,
          ...(blocker ? { blocker } : {}),
        };
      }
    );
    const blockers = effectiveHooks.flatMap((entry) => (entry.blocker ? [entry.blocker] : []));
    return RuntimeHookDryRunResultSchema.parse({
      schemaVersion: RUNTIME_HOOK_SCHEMA_VERSION,
      eventId: envelope.eventId,
      event: envelope.event,
      effectiveHooks,
      wouldBlock: blockers.length > 0,
      blockers,
    });
  }

  async dispatch(input: RuntimeHookEnvelope): Promise<RuntimeHookDispatchResult> {
    const envelope = deepFreeze(this.parseEnvelope(input));
    const outcomes: RuntimeHookOutcome[] = [];
    let allowed = true;

    for (const definition of this.effectiveDefinitions(envelope)) {
      const outcome = await this.executeDefinition(definition, envelope);
      outcomes.push(outcome);
      if (outcome.blocking) {
        allowed = false;
        break;
      }
    }

    return {
      schemaVersion: RUNTIME_HOOK_SCHEMA_VERSION,
      eventId: envelope.eventId,
      event: envelope.event,
      allowed,
      outcomes,
    };
  }

  private parseEnvelope(input: RuntimeHookEnvelope): RuntimeHookEnvelope {
    const envelope = RuntimeHookEnvelopeSchema.parse(input);
    if (containsUnredactedProviderRuntimeSecret(JSON.stringify(envelope.metadata))) {
      throw new ValidationError('Runtime hook metadata contains credential material.');
    }
    return structuredClone(envelope);
  }

  private effectiveDefinitions(envelope: RuntimeHookEnvelope): RuntimeHookDefinition[] {
    return [...this.definitions.values()]
      .filter(
        (definition) =>
          definition.enabled &&
          definition.event === envelope.event &&
          scopeMatches(definition.scope, envelope)
      )
      .sort(
        (left, right) =>
          SCOPE_ORDER[left.scope.kind] - SCOPE_ORDER[right.scope.kind] ||
          left.order - right.order ||
          left.id.localeCompare(right.id)
      );
  }

  private async executeDefinition(
    definition: RuntimeHookDefinition,
    envelope: RuntimeHookEnvelope
  ): Promise<RuntimeHookOutcome> {
    const startedAt = this.now().toISOString();
    const startedMs = this.clockMs();
    const activeKey = `${envelope.eventId}:${definition.id}`;
    const handler = this.handlers.get(definition.handlerId);
    let disposition: RuntimeHookOutcome['disposition'];
    let blocking: boolean;
    let diagnostic: string | undefined;

    if (!handler) {
      disposition = 'missing-handler';
      blocking =
        isBlockingRuntimeHookEvent(definition.event) && definition.failurePolicy === 'fail-closed';
      diagnostic = `Handler ${definition.handlerId} is not registered.`;
    } else if (this.active.has(activeKey)) {
      disposition = 'reentrant';
      blocking =
        isBlockingRuntimeHookEvent(definition.event) && definition.failurePolicy === 'fail-closed';
      diagnostic = 'Recursive dispatch of the same event and hook was rejected.';
    } else {
      this.active.add(activeKey);
      const controller = new AbortController();
      try {
        const result = await withTimeout(
          handler(envelope, { signal: controller.signal }),
          definition.timeoutMs,
          controller
        );
        ({ disposition, blocking, diagnostic } = evaluateResult(
          definition,
          assertHandlerResult(result)
        ));
      } catch (error) {
        const timedOut = error instanceof RuntimeHookTimeoutError;
        disposition = timedOut
          ? 'timed-out'
          : definition.failurePolicy === 'fail-closed'
            ? 'failed-closed'
            : 'failed-open';
        blocking =
          isBlockingRuntimeHookEvent(definition.event) &&
          definition.failurePolicy === 'fail-closed';
        diagnostic = timedOut
          ? `Handler exceeded ${definition.timeoutMs}ms.`
          : error instanceof Error
            ? error.message
            : 'Runtime hook handler failed.';
      } finally {
        this.active.delete(activeKey);
      }
    }

    const completedAt = this.now().toISOString();
    const outcome = RuntimeHookOutcomeSchema.parse({
      schemaVersion: RUNTIME_HOOK_SCHEMA_VERSION,
      eventId: envelope.eventId,
      sourceEventId: envelope.references.sourceEventId,
      hookId: definition.id,
      handlerId: definition.handlerId,
      event: envelope.event,
      order: definition.order,
      startedAt,
      completedAt,
      durationMs: Math.max(0, this.clockMs() - startedMs),
      disposition,
      blocking,
      ...(diagnostic ? { diagnostic: sanitizeProviderRuntimeDiagnostic(diagnostic) } : {}),
    });
    const evidence = await this.recorder?.record(envelope, structuredClone(outcome));
    return evidence ? { ...outcome, evidence } : outcome;
  }
}

export class RunEventRuntimeHookOutcomeRecorder implements RuntimeHookOutcomeRecorder {
  constructor(private readonly journal: RunEventJournalService = getRunEventJournalService()) {}

  async record(
    envelope: RuntimeHookEnvelope,
    outcome: RuntimeHookOutcome
  ): Promise<RuntimeHookEvidenceReference | undefined> {
    const { taskId, attemptId, sourceEventId } = envelope.references;
    if (!taskId || !attemptId) return undefined;
    const result = await this.journal.append({
      taskId,
      attemptId,
      causalEventId: sourceEventId,
      kind: 'runtime.hook',
      source: { provider: 'system', adapter: 'runtime-hook-bus' },
      payload: {
        schemaVersion: outcome.schemaVersion,
        hookId: outcome.hookId,
        handlerId: outcome.handlerId,
        event: outcome.event,
        order: outcome.order,
        disposition: outcome.disposition,
        blocking: outcome.blocking,
        durationMs: outcome.durationMs,
        ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
      },
      dedupeKey: `runtime-hook:${outcome.eventId}:${outcome.hookId}`,
    });
    return {
      kind: 'run-event',
      eventId: result.event.eventId,
      sequence: result.event.sequence,
    };
  }
}

function evaluateResult(
  definition: RuntimeHookDefinition,
  result: RuntimeHookHandlerResult
): Pick<RuntimeHookOutcome, 'disposition' | 'blocking' | 'diagnostic'> {
  if (!isBlockingRuntimeHookEvent(definition.event) && result.decision === 'deny') {
    return {
      disposition: 'invalid-post-decision',
      blocking: false,
      diagnostic: 'Passive post-event handlers cannot deny or mutate completed outcomes.',
    };
  }
  if (result.decision === 'deny') {
    return {
      disposition: 'denied',
      blocking: true,
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
    };
  }
  return {
    disposition: 'allowed',
    blocking: false,
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
  };
}

function scopeMatches(scope: RuntimeHookScope, envelope: RuntimeHookEnvelope): boolean {
  if (scope.kind === 'global') return true;
  const key = `${scope.kind}Id` as keyof RuntimeHookEnvelope['scope'];
  return envelope.scope[key] === scope.id;
}

async function withTimeout(
  promise: Promise<RuntimeHookHandlerResult>,
  timeoutMs: number,
  controller: AbortController
): Promise<RuntimeHookHandlerResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new RuntimeHookTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class RuntimeHookTimeoutError extends Error {}

function assertHandlerResult(result: RuntimeHookHandlerResult): RuntimeHookHandlerResult {
  if (
    !result ||
    !['allow', 'deny', 'observe'].includes(result.decision) ||
    (result.diagnostic !== undefined && typeof result.diagnostic !== 'string')
  ) {
    throw new ValidationError('Runtime hook handler returned an invalid result.');
  }
  return result;
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value)) {
    throw new ValidationError(`Invalid runtime hook ${label}.`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

let runtimeHookBusService: RuntimeHookBusService | undefined;

export function getRuntimeHookBusService(): RuntimeHookBusService {
  runtimeHookBusService ??= new RuntimeHookBusService({
    recorder: new RunEventRuntimeHookOutcomeRecorder(),
  });
  return runtimeHookBusService;
}

export function resetRuntimeHookBusServiceForTests(): void {
  runtimeHookBusService = undefined;
}
