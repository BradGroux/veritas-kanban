import { describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_HOOK_SCHEMA_VERSION,
  type RuntimeHookDefinition,
  type RuntimeHookEnvelope,
} from '@veritas-kanban/shared';
import {
  RuntimeHookDefinitionSchema,
  RuntimeHookEnvelopeSchema,
} from '../schemas/runtime-hook-schemas.js';
import {
  RunEventRuntimeHookOutcomeRecorder,
  RuntimeHookBusService,
} from '../services/runtime-hook-bus-service.js';
import type { RunEventJournalService } from '../services/run-event-journal-service.js';

const NOW = '2026-07-24T14:00:00.000Z';

function definition(
  id: string,
  overrides: Partial<RuntimeHookDefinition> = {}
): RuntimeHookDefinition {
  return {
    schemaVersion: RUNTIME_HOOK_SCHEMA_VERSION,
    id,
    event: 'tool.pre-use',
    handlerId: id,
    scope: { kind: 'global' },
    enabled: true,
    order: 0,
    timeoutMs: 100,
    failurePolicy: 'fail-closed',
    ...overrides,
  };
}

function envelope(overrides: Partial<RuntimeHookEnvelope> = {}): RuntimeHookEnvelope {
  return {
    schemaVersion: RUNTIME_HOOK_SCHEMA_VERSION,
    eventId: 'hookevt_1',
    event: 'tool.pre-use',
    occurredAt: NOW,
    scope: {
      workspaceId: 'workspace_1',
      profileId: 'profile_1',
      workflowId: 'workflow_1',
      runId: 'run_1',
    },
    references: {
      sourceEventId: 'runevt_source_1',
      taskId: 'task_1',
      attemptId: 'attempt_1',
      toolCallId: 'tool_1',
    },
    metadata: { toolName: 'task.read', policy: 'allowlisted' },
    ...overrides,
  };
}

describe('RuntimeHookBusService', () => {
  it('rejects unknown events, credential fields, oversized metadata, and blocking post-hooks', () => {
    expect(() =>
      RuntimeHookEnvelopeSchema.parse({ ...envelope(), event: 'provider.unknown' })
    ).toThrow();
    expect(() =>
      RuntimeHookEnvelopeSchema.parse({
        ...envelope(),
        metadata: { authorizationToken: 'test-value' },
      })
    ).toThrow(/credential fields/);
    expect(() =>
      RuntimeHookEnvelopeSchema.parse({
        ...envelope(),
        metadata: Object.fromEntries(
          Array.from({ length: 17 }, (_, index) => [`field${index}`, 'x'.repeat(1000)])
        ),
      })
    ).toThrow(/16384 bytes/);
    expect(() =>
      RuntimeHookDefinitionSchema.parse(
        definition('post', {
          event: 'tool.post-use',
          failurePolicy: 'fail-closed',
        })
      )
    ).toThrow(/Passive post-events/);
  });

  it('resolves enabled hooks by scope precedence, order, and ID', () => {
    const bus = new RuntimeHookBusService({
      definitions: [
        definition('run', { scope: { kind: 'run', id: 'run_1' }, order: -10 }),
        definition('workspace-b', {
          scope: { kind: 'workspace', id: 'workspace_1' },
          order: 5,
        }),
        definition('global-b', { order: 10 }),
        definition('global-a', { order: 10 }),
        definition('disabled', { enabled: false, order: -100 }),
        definition('other-profile', {
          scope: { kind: 'profile', id: 'profile_2' },
        }),
      ],
    });

    expect(bus.dryRun(envelope()).effectiveHooks.map((entry) => entry.hookId)).toEqual([
      'global-a',
      'global-b',
      'workspace-b',
      'run',
    ]);
  });

  it('applies pre-event allow, fail-open, and deny decisions in order', async () => {
    const after = vi.fn(async () => ({ decision: 'allow' as const }));
    const bus = new RuntimeHookBusService({
      definitions: [
        definition('allow', { order: 0 }),
        definition('missing-open', { order: 1, failurePolicy: 'fail-open' }),
        definition('deny', { order: 2 }),
        definition('after', { order: 3 }),
      ],
      handlers: {
        allow: async () => ({ decision: 'allow' }),
        deny: async () => ({ decision: 'deny', diagnostic: 'Policy denied the tool.' }),
        after,
      },
    });

    const result = await bus.dispatch(envelope());

    expect(result.allowed).toBe(false);
    expect(result.outcomes.map((outcome) => [outcome.hookId, outcome.disposition])).toEqual([
      ['allow', 'allowed'],
      ['missing-open', 'missing-handler'],
      ['deny', 'denied'],
    ]);
    expect(after).not.toHaveBeenCalled();
  });

  it('keeps post-events passive when a handler attempts to deny', async () => {
    const bus = new RuntimeHookBusService({
      definitions: [
        definition('post', {
          event: 'tool.post-use',
          failurePolicy: 'fail-open',
        }),
      ],
      handlers: {
        post: async () => ({ decision: 'deny' }),
      },
    });

    const result = await bus.dispatch(envelope({ event: 'tool.post-use' }));

    expect(result.allowed).toBe(true);
    expect(result.outcomes[0]).toMatchObject({
      disposition: 'invalid-post-decision',
      blocking: false,
    });
  });

  it('rejects recursive dispatch and bounds fail-closed handler timeouts', async () => {
    let reentrantBus: RuntimeHookBusService;
    reentrantBus = new RuntimeHookBusService({
      definitions: [definition('recursive')],
      handlers: {
        recursive: async (event) => {
          const nested = await reentrantBus.dispatch(event);
          expect(nested.outcomes[0]?.disposition).toBe('reentrant');
          return { decision: nested.allowed ? 'allow' : 'deny' };
        },
      },
    });
    expect((await reentrantBus.dispatch(envelope())).allowed).toBe(false);

    const timeoutBus = new RuntimeHookBusService({
      definitions: [definition('timeout', { timeoutMs: 10 })],
      handlers: {
        timeout: async () => new Promise(() => {}),
      },
    });
    const timedOut = await timeoutBus.dispatch(envelope());
    expect(timedOut).toMatchObject({
      allowed: false,
      outcomes: [{ disposition: 'timed-out', blocking: true }],
    });
  });

  it('keeps dry-run side-effect free and attaches recorder evidence on dispatch', async () => {
    const handler = vi.fn(async () => ({ decision: 'allow' as const }));
    const append = vi.fn(async () => ({
      appended: true,
      event: { eventId: 'runevt_recorded_1', sequence: 7 },
    }));
    const recorder = new RunEventRuntimeHookOutcomeRecorder({
      append,
    } as unknown as RunEventJournalService);
    const bus = new RuntimeHookBusService({
      definitions: [definition('recorded')],
      handlers: { recorded: handler },
      recorder,
    });

    expect(bus.dryRun(envelope())).toMatchObject({
      wouldBlock: false,
      effectiveHooks: [{ hookId: 'recorded', handlerRegistered: true }],
    });
    expect(handler).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();

    const result = await bus.dispatch(envelope());
    expect(handler).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_1',
        attemptId: 'attempt_1',
        causalEventId: 'runevt_source_1',
        kind: 'runtime.hook',
        dedupeKey: 'runtime-hook:hookevt_1:recorded',
      })
    );
    expect(result.outcomes[0]?.evidence).toEqual({
      kind: 'run-event',
      eventId: 'runevt_recorded_1',
      sequence: 7,
    });
  });
});
