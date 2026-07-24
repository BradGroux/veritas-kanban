import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RUN_EVENT_KINDS,
  RUN_EVENT_SCHEMA_VERSION,
  type RunEventAppendInput,
  type RunEventEnvelope,
} from '@veritas-kanban/shared';
import { FileRunEventRepository } from '../storage/run-event-repository.js';
import type { RunEventRepository } from '../storage/interfaces.js';
import { SqliteRunEventRepository } from '../storage/sqlite/run-event-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SQLITE_BASE_MIGRATIONS } from '../storage/sqlite/migrations.js';
import { RunEventJournalService } from '../services/run-event-journal-service.js';
import { getProviderRunEventMapper } from '../services/provider-run-event-mappers.js';
import { RunEventEnvelopeSchema, RunEventKindSchema } from '../schemas/run-event-schemas.js';

const cleanupPaths: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'veritas-run-events-'));
  cleanupPaths.push(directory);
  return directory;
}

function appendInput(overrides: Partial<RunEventAppendInput> = {}): RunEventAppendInput {
  return {
    taskId: 'task_1',
    attemptId: 'attempt_1',
    kind: 'progress',
    source: {
      provider: 'codex-cli',
      adapter: 'codex-cli',
      agent: 'codex',
    },
    payload: { summary: 'working' },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((entry) => rm(entry, { recursive: true })));
});

describe('RunEventJournalService', () => {
  it('allocates ordered cursors, replays after a cursor, and rejects duplicate provider events', async () => {
    const directory = await temporaryDirectory();
    const journal = new RunEventJournalService(new FileRunEventRepository(directory));
    const first = await journal.append(
      appendInput({
        providerEventId: 'provider_event_1',
        payload: { summary: 'first' },
      })
    );
    const duplicate = await journal.append(
      appendInput({
        providerEventId: 'provider_event_1',
        payload: { summary: 'duplicate must not replace the first event' },
      })
    );
    const concurrent = await Promise.all([
      journal.append(appendInput({ payload: { summary: 'second' } })),
      journal.append(appendInput({ payload: { summary: 'third' } })),
    ]);

    expect(first.appended).toBe(true);
    expect(duplicate).toEqual({ event: first.event, appended: false });
    expect(concurrent.map((result) => result.event.sequence).sort((a, b) => a - b)).toEqual([2, 3]);

    const page = await journal.list({
      taskId: 'task_1',
      attemptId: 'attempt_1',
      afterSequence: 1,
      limit: 1,
    });
    expect(page.events).toHaveLength(1);
    expect(page.events[0].sequence).toBe(2);
    expect(page.nextCursor).toBe(2);
    expect(page.hasMore).toBe(true);
  });

  it('redacts structured and embedded secrets before persistence', async () => {
    const directory = await temporaryDirectory();
    const journal = new RunEventJournalService(new FileRunEventRepository(directory));
    const result = await journal.append(
      appendInput({
        payload: {
          authorization: 'Bearer abcdefghijklmnop',
          summary: 'failed with Bearer abcdefghijklmnop',
          nested: { api_key: 'sk-secret-secret-secret' },
          inputTokens: 123,
          outputTokens: 45,
        },
      })
    );

    expect(result.event.redaction.status).toBe('redacted');
    expect(result.event.redaction.fields).toContain('$.authorization');
    expect(JSON.stringify(result.event.payload)).not.toContain('abcdefghijklmnop');
    expect(JSON.stringify(result.event.payload)).not.toContain('sk-secret');
    expect(result.event.payload.inputTokens).toBe(123);
    expect(result.event.payload.outputTokens).toBe(45);

    const raw = await readFile(path.join(directory, 'task_1', 'attempt_1.jsonl'), 'utf-8');
    expect(raw).not.toContain('abcdefghijklmnop');
    expect(raw).not.toContain('sk-secret');
  });

  it('drops payload bodies that remain oversized after bounded normalization', async () => {
    const directory = await temporaryDirectory();
    const journal = new RunEventJournalService(new FileRunEventRepository(directory));
    const result = await journal.append(
      appendInput({
        payload: {
          chunks: Array.from(
            { length: 10 },
            (_, index) => `${index}:${'bounded provider output '.repeat(360)}`
          ),
        },
      })
    );

    expect(result.event.redaction.status).toBe('dropped');
    expect(result.event.payload).toMatchObject({ dropped: true });
    expect(result.event.redaction.persistedBytes).toBeLessThan(32 * 1024);
  });

  it.runIf(process.platform !== 'win32')('refuses a symlinked journal target', async () => {
    const directory = await temporaryDirectory();
    const taskDirectory = path.join(directory, 'task_1');
    await mkdir(taskDirectory, { recursive: true });
    const target = path.join(directory, 'outside.jsonl');
    await writeFile(target, '');
    await symlink(target, path.join(taskDirectory, 'attempt_1.jsonl'));
    const journal = new RunEventJournalService(new FileRunEventRepository(directory));

    await expect(journal.append(appendInput())).rejects.toThrow(
      'Run event journal is not a bounded regular file'
    );
  });

  it('uses transactional ordering and deduplication in SQLite', async () => {
    const database = new SqliteDatabase({ databasePath: ':memory:' });
    database.open();
    try {
      const journal = new RunEventJournalService(new SqliteRunEventRepository(database));
      const first = await journal.append(
        appendInput({ providerEventId: 'sqlite_event', payload: { summary: 'one' } })
      );
      const duplicate = await journal.append(
        appendInput({ providerEventId: 'sqlite_event', payload: { summary: 'two' } })
      );
      const second = await journal.append(appendInput({ payload: { summary: 'three' } }));
      const otherTask = await journal.append(
        appendInput({
          taskId: 'task_2',
          providerEventId: 'sqlite_event',
          payload: { summary: 'same provider identity in a different task' },
        })
      );

      expect(first.event.sequence).toBe(1);
      expect(duplicate.appended).toBe(false);
      expect(duplicate.event.eventId).toBe(first.event.eventId);
      expect(second.event.sequence).toBe(2);
      expect(otherTask).toMatchObject({
        appended: true,
        event: { taskId: 'task_2', sequence: 1 },
      });
      expect(
        (
          await journal.list({
            taskId: 'task_1',
            attemptId: 'attempt_1',
            afterSequence: 0,
          })
        ).events.map((event) => event.sequence)
      ).toEqual([1, 2]);
    } finally {
      database.close();
    }
  });

  it('replays and live-tails provider and operator events through one ordered subscription', async () => {
    const directory = await temporaryDirectory();
    const journal = new RunEventJournalService(new FileRunEventRepository(directory));
    const providerMapper = getProviderRunEventMapper('codex-cli');
    const firstProviderEvent = providerMapper.mapEvent(
      'item.completed',
      {
        id: 'provider_event_1',
        item: { type: 'agent_message', text: 'first provider output' },
      },
      'first provider output'
    );
    await journal.append(
      appendInput({
        ...firstProviderEvent,
        source: { provider: 'codex-cli', adapter: 'codex-cli', agent: 'codex' },
      })
    );

    const received: RunEventEnvelope[] = [];
    const subscription = await journal.subscribe(
      { taskId: 'task_1', attemptId: 'attempt_1', afterSequence: 0 },
      (event) => received.push(event)
    );
    expect(subscription.cursor).toBe(1);

    await journal.append(
      appendInput({
        kind: 'message.operator',
        source: { provider: 'operator', adapter: 'veritas-operator-message' },
        payload: { content: 'operator follow-up' },
      })
    );
    await journal.append(
      appendInput({
        kind: 'message.delta',
        payload: { content: 'provider response' },
      })
    );
    expect(received.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(received.map((event) => event.source.provider)).toEqual([
      'codex-cli',
      'operator',
      'codex-cli',
    ]);
    subscription.unsubscribe();

    const reconnected: number[] = [];
    const reconnect = await journal.subscribe(
      { taskId: 'task_1', attemptId: 'attempt_1', afterSequence: 1 },
      (event) => reconnected.push(event.sequence)
    );
    expect(reconnected).toEqual([2, 3]);
    expect(reconnect.cursor).toBe(3);
    reconnect.unsubscribe();
  });

  it('buffers an event appended while a reconnect replay is in flight', async () => {
    const directory = await temporaryDirectory();
    const repository = new FileRunEventRepository(directory);
    const writer = new RunEventJournalService(repository);
    await writer.append(appendInput({ payload: { summary: 'before reconnect' } }));

    let releaseReplay!: () => void;
    let replayStarted!: () => void;
    const replayGate = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const replayObserved = new Promise<void>((resolve) => {
      replayStarted = resolve;
    });
    let firstReplay = true;
    const delayedRepository: RunEventRepository = {
      append: (event) => repository.append(event),
      list: async (query) => {
        const page = await repository.list(query);
        if (firstReplay) {
          firstReplay = false;
          replayStarted();
          await replayGate;
        }
        return page;
      },
    };
    const subscriber = new RunEventJournalService(delayedRepository);
    const received: number[] = [];
    const pendingSubscription = subscriber.subscribe(
      { taskId: 'task_1', attemptId: 'attempt_1' },
      (event) => received.push(event.sequence)
    );

    await replayObserved;
    await subscriber.append(
      appendInput({
        kind: 'message.operator',
        source: { provider: 'operator', adapter: 'veritas-operator-message' },
        payload: { content: 'arrived during replay' },
      })
    );
    releaseReplay();
    const subscription = await pendingSubscription;

    expect(received).toEqual([1, 2]);
    expect(subscription.cursor).toBe(2);
    subscription.unsubscribe();
  });

  it('does not let a live projection failure invalidate a durable append', async () => {
    const directory = await temporaryDirectory();
    const journal = new RunEventJournalService(new FileRunEventRepository(directory));
    journal.onEvent(() => {
      throw new Error('closed WebSocket');
    });

    await expect(journal.append(appendInput())).resolves.toMatchObject({ appended: true });
    await expect(journal.list({ taskId: 'task_1', attemptId: 'attempt_1' })).resolves.toMatchObject(
      { nextCursor: 1 }
    );
  });
});

describe('provider run event mappers', () => {
  it('maps every executable provider and preserves unknown future events', () => {
    expect(getProviderRunEventMapper('hermes-cli').mapStream('stdout', 'hello')).toMatchObject({
      kind: 'message.delta',
    });
    expect(
      getProviderRunEventMapper('codex-cli').mapEvent('item.completed', {
        type: 'item.completed',
        item: { id: 'item_1', type: 'agent_message', text: 'done' },
      })
    ).toMatchObject({
      kind: 'message.assistant',
      providerEventId: 'item_1',
      itemId: 'item_1',
    });
    expect(
      getProviderRunEventMapper('codex-sdk').mapEvent('future.capability', {
        type: 'future.capability',
        id: 'future_1',
        future: true,
      })
    ).toMatchObject({
      kind: 'provider.unknown',
      providerEventId: 'future_1',
      payload: { providerType: 'future.capability' },
    });
    expect(
      getProviderRunEventMapper('openclaw').mapEvent('tool.started', {
        type: 'tool.started',
        id: 'tool_1',
      })
    ).toMatchObject({
      kind: 'tool.started',
      providerEventId: 'tool_1',
    });
  });

  it('deduplicates retries without collapsing distinct phases that share one item ID', () => {
    const mapper = getProviderRunEventMapper('codex-cli');
    const started = mapper.mapEvent('item.started', {
      item: { id: 'shared_item', type: 'command_execution' },
    });
    const completed = mapper.mapEvent('item.completed', {
      item: { id: 'shared_item', type: 'command_execution' },
    });
    const longIdentity = mapper.mapEvent('item.completed', {
      item: { id: 'x'.repeat(500), type: 'agent_message' },
    });

    expect(started).toMatchObject({
      kind: 'command.started',
      providerEventId: 'shared_item',
    });
    expect(completed).toMatchObject({
      kind: 'command.completed',
      providerEventId: 'shared_item',
    });
    expect(started.dedupeKey).not.toBe(completed.dedupeKey);
    expect(longIdentity.providerEventId).toMatch(/^sha256_[a-f0-9]{64}$/);
    expect(longIdentity.dedupeKey?.length).toBeLessThanOrEqual(240);
    expect(
      getProviderRunEventMapper('openclaw').mapEvent(
        'message.completed',
        { event_id: 'callback_1' },
        'OpenClaw completed the task'
      )
    ).toMatchObject({
      kind: 'message.assistant',
      providerEventId: 'callback_1',
    });
  });
});

describe('run event schema artifacts', () => {
  it('keeps the TypeScript/Zod contract and published JSON Schema on v1', async () => {
    const schemaPath = new URL(
      '../../../shared/schemas/run-event-envelope.v1.schema.json',
      import.meta.url
    );
    const jsonSchema = JSON.parse(await readFile(schemaPath, 'utf-8')) as {
      properties: Record<
        string,
        {
          const?: string;
          anyOf?: Array<{ enum?: string[] }>;
        }
      >;
      required: string[];
    };
    expect(jsonSchema.properties.schemaVersion.const).toBe(RUN_EVENT_SCHEMA_VERSION);
    expect(jsonSchema.required).toContain('payloadHash');
    expect(RUN_EVENT_KINDS).toContain('provider.unknown');
    expect(jsonSchema.properties.kind.anyOf?.[0]?.enum).toEqual([...RUN_EVENT_KINDS]);
    expect(RunEventKindSchema.safeParse('progress').success).toBe(true);
    expect(RunEventKindSchema.safeParse('provider.future-event').success).toBe(true);
    expect(RunEventKindSchema.safeParse('future').success).toBe(false);

    const parsed = RunEventEnvelopeSchema.safeParse({
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: 'runevt_abcdefghijklmnopqr',
      taskId: 'task_1',
      runId: 'attempt_1',
      attemptId: 'attempt_1',
      sequence: 1,
      receivedAt: '2026-07-23T12:00:00.000Z',
      kind: 'provider.future-event',
      source: { provider: 'system', adapter: 'fixture' },
      redaction: {
        status: 'none',
        fields: [],
        originalBytes: 2,
        persistedBytes: 2,
      },
      payload: {},
      payloadHash: 'a'.repeat(64),
    });
    expect(parsed.success).toBe(true);
  });

  it('adds the journal table without rewriting existing attempt logs', async () => {
    const directory = await temporaryDirectory();
    const databasePath = path.join(directory, 'veritas.db');
    const logsDirectory = path.join(directory, 'logs');
    const legacyLogPath = path.join(logsDirectory, 'task_legacy_attempt_legacy.md');
    const legacyLog = '# Legacy attempt\n\nExisting provider output remains readable.\n';
    await mkdir(logsDirectory, { recursive: true });
    await writeFile(legacyLogPath, legacyLog);

    const legacyDatabase = new SqliteDatabase({
      databasePath,
      migrations: SQLITE_BASE_MIGRATIONS.filter((migration) => migration.version < 18),
    });
    legacyDatabase.open();
    legacyDatabase.close();

    const migratedDatabase = new SqliteDatabase({ databasePath });
    migratedDatabase.open();
    try {
      const table = migratedDatabase
        .getConnection()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_events'")
        .get() as { name?: string } | undefined;
      expect(table?.name).toBe('run_events');
      expect(await readFile(legacyLogPath, 'utf-8')).toBe(legacyLog);
    } finally {
      migratedDatabase.close();
    }
  });
});
