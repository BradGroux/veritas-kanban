import { constants } from 'node:fs';
import fs, { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  PHASE_TRANSITION_RECORD_SCHEMA_VERSION,
  type PhaseAuthoritySource,
  type PhaseTransitionRecord,
} from '@veritas-kanban/shared';
import { DurableGoalService } from '../services/durable-goal-service.js';
import { ReflectionExtractionJobService } from '../services/reflection-extraction-job-service.js';
import { RunApprovalBrokerService } from '../services/run-approval-broker-service.js';
import { RunEventJournalService } from '../services/run-event-journal-service.js';
import { RunSupervisorService } from '../services/run-supervisor-service.js';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
} from '../services/phase-capability-service.js';
import { calculatePhaseAuthorityDelta } from '../services/phase-transition-service.js';
import { FileDurableGoalRepository } from '../storage/durable-goal-repository.js';
import { FileReflectionExtractionJobRepository } from '../storage/reflection-extraction-job-repository.js';
import { FileRunApprovalRepository } from '../storage/run-approval-repository.js';
import { FileRunEventRepository } from '../storage/run-event-repository.js';
import { FileRunSupervisorRepository } from '../storage/run-supervisor-repository.js';
import { FilePhaseTransitionRepository } from '../storage/phase-transition-repository.js';
import type {
  DurableGoalRepository,
  ReflectionExtractionJobRepository,
  RunEventRepository,
} from '../storage/interfaces.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const roots: string[] = [];
const timestamp = '2026-10-23T00:00:00.000Z';
const digest = `sha256:${'a'.repeat(64)}`;
const unicode = 'café 😊';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(open).mockImplementation(actualFs.open);
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

interface JournalHarness {
  filePath: string;
  records: unknown[];
  append(index: number): Promise<unknown>;
  first(): Promise<unknown>;
  reload(): Promise<unknown[]>;
  repeat(): Promise<unknown>;
}

function snapshots<T extends { id: string }>(
  filePath: string,
  records: T[],
  create: (record: T) => Promise<unknown>,
  get: (id: string) => Promise<unknown>,
  idempotent = false
): JournalHarness {
  return {
    filePath,
    records,
    append: (index) => create(records[index]),
    first: () => get(records[0].id),
    reload: () => Promise.all(records.map((record) => get(record.id))),
    repeat: () =>
      idempotent
        ? expect(create(records[1])).resolves.toMatchObject({ created: false })
        : expect(create(records[1])).rejects.toThrow(/already exists/),
  };
}

const cases: { name: string; create(root: string): Promise<JournalHarness> }[] = [
  {
    name: 'approval',
    async create(root) {
      const broker = new RunApprovalBrokerService({
        repository: {
          get: async () => null,
          create: async (record) => record,
          list: async () => [],
          transition: async () => {
            throw new Error('Unexpected fixture transition');
          },
        },
        now: () => new Date(timestamp),
        journal: { append: vi.fn() } as unknown as RunEventJournalService,
        broadcast: vi.fn(),
      });
      const records = await Promise.all(
        [1, 2].map((index) =>
          broker.request({
            workspaceId: 'local',
            taskId: 'task-1',
            attemptId: 'attempt-1',
            provider: 'codex-app-server',
            agentId: 'fixture',
            requestKind: 'approval',
            actionClass: 'shell',
            action: `${unicode} ${index}`,
            exactAction: { command: ['true'], cwd: root },
            workingDirectory: root,
            riskClass: 'medium',
            evidenceRevision: 'fixture-v1',
            providerRequestId: `request-${index}`,
          })
        )
      );
      const filePath = path.join(root, 'approvals.jsonl');
      return snapshots(
        filePath,
        records,
        (record) => new FileRunApprovalRepository(filePath).create(record),
        (id) => new FileRunApprovalRepository(filePath).get(id)
      );
    },
  },
  {
    name: 'supervisor',
    async create(root) {
      const service = new RunSupervisorService({
        repository: {
          get: async () => null,
          create: async (record) => record,
          list: async () => [],
          compareAndSet: async () => {
            throw new Error('Unexpected fixture mutation');
          },
        },
        hostId: '1'.repeat(64),
        ownerId: 'fixture',
        processId: 101,
        now: () => new Date(timestamp),
        processProbe: () => ({ alive: false }),
      });
      let records;
      try {
        records = await Promise.all(
          [1, 2].map((index) =>
            service.register({
              workspaceId: 'local',
              taskId: 'task-1',
              attemptId: `attempt-${index}`,
              provider: 'codex-cli',
              adapter: 'codex-cli',
              providerVersion: '0.145.0',
              providerRuntimeManifestDigest: digest,
              taskEnvelopeDigest: digest,
              runLaunchManifestDigest: digest,
              worktreePath: root,
              worktreeManifestId: 'fixture',
              worktreeLeaseId: 'fixture',
              recoveryOperations: ['status'],
            })
          )
        );
      } finally {
        service.dispose();
      }
      const filePath = path.join(root, 'supervisors.jsonl');
      return snapshots(
        filePath,
        records,
        (record) => new FileRunSupervisorRepository(filePath).create(record),
        (id) => new FileRunSupervisorRepository(filePath).get(id)
      );
    },
  },
  {
    name: 'goal',
    async create(root) {
      const service = new DurableGoalService({
        repository: { create: async (record) => record } as DurableGoalRepository,
        now: () => new Date(timestamp),
      });
      const records = await Promise.all(
        [1, 2].map((index) =>
          service.create({
            id: `goal_${String(index).padStart(16, '0')}`,
            workspaceId: 'local',
            objective: `${unicode} ${index}`,
            acceptanceCriteria: ['Reload the complete record.'],
            root: { kind: 'task', taskId: 'task-1' },
            continuation: { mode: 'manual' },
            completionRequirements: [
              {
                id: 'reload',
                description: 'Reload is verified.',
                required: true,
                verificationKind: 'test',
              },
            ],
          })
        )
      );
      const filePath = path.join(root, 'goals.jsonl');
      return snapshots(
        filePath,
        records,
        (record) => new FileDurableGoalRepository(filePath).create(record),
        (id) => new FileDurableGoalRepository(filePath).get(id)
      );
    },
  },
  {
    name: 'extraction',
    async create(root) {
      const service = new ReflectionExtractionJobService({
        repository: {
          enqueue: async (job) => ({ job, created: true }),
        } as ReflectionExtractionJobRepository,
        now: () => new Date(timestamp),
      });
      const records = await Promise.all(
        [1, 2].map(
          async (index) =>
            (
              await service.enqueue({
                workspaceId: 'local',
                idempotencyKey: `${unicode}-${index}`,
                source: {
                  taskId: 'task-1',
                  attemptId: 'attempt-1',
                  completionId: `completion-${index}`,
                  completionDigest: digest,
                },
              })
            ).job
        )
      );
      const filePath = path.join(root, 'extraction.jsonl');
      return snapshots(
        filePath,
        records,
        (record) => new FileReflectionExtractionJobRepository(filePath).enqueue(record),
        (id) => new FileReflectionExtractionJobRepository(filePath).get(id),
        true
      );
    },
  },
  {
    name: 'phase',
    async create(root) {
      const records = [1, 2].map(phaseRecord);
      const filePath = path.join(root, 'phases.jsonl');
      const append = (index: number) => {
        const record = records[index];
        return new FilePhaseTransitionRepository(filePath).append({
          record,
          expectedSequence: 0,
          expectedPhaseEvidenceDigest: record.priorEvidence.digest,
          expectedManifestDigest: digest,
        });
      };
      const read = (index: number) =>
        new FilePhaseTransitionRepository(filePath).getByOperationId(
          'local',
          `task-${index + 1}`,
          'attempt-1',
          `operation-${index + 1}`
        );
      return {
        filePath,
        records,
        append,
        first: () => read(0),
        reload: () => Promise.all([read(0), read(1)]),
        repeat: () => expect(append(1)).resolves.toMatchObject({ appended: false }),
      };
    },
  },
  {
    name: 'event',
    async create(root) {
      const records = await Promise.all(
        [1, 2].map(async (index) => {
          const service = new RunEventJournalService({
            append: async (event) => ({ event: { ...event, sequence: index }, appended: true }),
          } as RunEventRepository);
          return (
            await service.append({
              taskId: 'task-1',
              attemptId: 'attempt-1',
              kind: 'progress',
              source: { provider: 'codex-cli', adapter: 'codex-cli' },
              providerEventId: `event-${index}`,
              payload: { summary: `${unicode} ${index}` },
            })
          ).event;
        })
      );
      const repository = () => new FileRunEventRepository(root);
      const append = (index: number) => {
        const { sequence, ...event } = records[index];
        expect(sequence).toBe(index + 1);
        return repository().append(event);
      };
      const reload = async () =>
        (await repository().list({ taskId: 'task-1', attemptId: 'attempt-1' })).events;
      return {
        filePath: path.join(root, 'task-1', 'attempt-1.jsonl'),
        records,
        append,
        first: async () => (await reload())[0],
        reload,
        repeat: () => expect(append(1)).resolves.toMatchObject({ appended: false }),
      };
    },
  },
];

function phaseRecord(index: number): PhaseTransitionRecord {
  const source = <K extends PhaseAuthoritySource['kind']>(
    kind: K
  ): PhaseAuthoritySource & { kind: K } => ({
    id: kind,
    kind,
    authority: Object.fromEntries(
      PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, ['*']])
    ) as PhaseAuthoritySource['authority'],
    enforcement: Object.fromEntries(
      PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, 'enforced'])
    ) as PhaseAuthoritySource['enforcement'],
  });
  const sources = {
    parent: source('parent'),
    agentProfile: source('agent-profile'),
    sandbox: source('sandbox'),
    toolCatalog: source('tool-catalog'),
    launchPolicy: source('launch-policy'),
  };
  const evidence = (phase: 'plan' | 'implement') =>
    compilePhaseCapabilityAuthority({
      profile: getBuiltInPhaseCapabilityProfile(phase),
      sources,
    });
  const priorEvidence = evidence('implement');
  const effectiveEvidence = evidence('plan');
  return {
    schemaVersion: PHASE_TRANSITION_RECORD_SCHEMA_VERSION,
    id: `phasetransition_${String(index).padStart(18, '0')}`,
    workspaceId: 'local',
    taskId: `task-${index}`,
    attemptId: 'attempt-1',
    sequence: 1,
    operationId: `operation-${index}`,
    priorEvidence,
    effectiveEvidence,
    authorityDelta: calculatePhaseAuthorityDelta(
      priorEvidence.effectiveAuthority,
      effectiveEvidence.effectiveAuthority
    ),
    actor: { id: 'fixture', type: 'user', authMethod: 'session', workspaceId: 'local' },
    reason: `${unicode} ${index}`,
    policyDecision: 'allow',
    manifestDigest: digest,
    eventReference: `phase-${index}`,
    createdAt: timestamp,
  };
}

function injectWrites(filePath: string, mode: 'partial' | 'zero' | 'failure') {
  const failure = new Error('fixture append failed');
  const state = {
    calls: 0,
    bytes: Buffer.alloc(0),
    expected: Buffer.alloc(0),
    syncs: 0,
    closes: 0,
  };
  vi.mocked(open).mockImplementation(async (file, flags, permissions) => {
    const handle = await actualFs.open(file, flags, permissions);
    if (String(file) !== filePath || typeof flags !== 'number' || !(flags & constants.O_APPEND))
      return handle;
    const write = handle.write.bind(handle);
    const sync = handle.sync.bind(handle);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'write').mockImplementation((async (
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null
    ) => {
      state.calls++;
      expect(buffer).toBeInstanceOf(Uint8Array);
      if (offset === 0) state.expected = Buffer.from(buffer);
      if (mode === 'zero') return { bytesWritten: 0, buffer };
      if (mode === 'failure' && state.calls > 1) throw failure;
      const boundary = state.expected.findIndex((byte) => byte >= 0xc0) + 1;
      expect(boundary).toBeGreaterThan(0);
      expect(state.expected[boundary] & 0xc0).toBe(0x80);
      const count = Math.min(length, offset === 0 ? boundary : 17);
      const result = await write(buffer, offset, count, position);
      state.bytes = Buffer.concat([
        state.bytes,
        Buffer.from(buffer).subarray(offset, offset + result.bytesWritten),
      ]);
      return result;
    }) as typeof handle.write);
    vi.spyOn(handle, 'sync').mockImplementation(async () => {
      expect(state.bytes).toEqual(state.expected);
      state.syncs++;
      await sync();
    });
    vi.spyOn(handle, 'close').mockImplementation(async () => {
      state.closes++;
      await close();
    });
    return handle;
  });
  return { state, failure };
}

describe.each(cases)('$name durable journal consumer', ({ name, create }) => {
  async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `veritas-${name}-${unicode}-`));
    roots.push(root);
    const harness = await create(root);
    await harness.append(0);
    return { harness, prefix: await fs.readFile(harness.filePath) };
  }

  it('completes a split UTF-8 append, syncs exact bytes, reloads and preserves duplicate semantics', async () => {
    const { harness, prefix } = await fixture();
    const { state } = injectWrites(harness.filePath, 'partial');
    await harness.append(1);
    expect(state.calls).toBeGreaterThan(1);
    expect(state.syncs).toBe(1);
    expect(state.closes).toBe(1);
    expect(await fs.readFile(harness.filePath)).toEqual(Buffer.concat([prefix, state.expected]));
    expect(await harness.reload()).toEqual(harness.records);
    const completed = await fs.readFile(harness.filePath);
    await harness.repeat();
    expect(await fs.readFile(harness.filePath)).toEqual(completed);
  });

  it('rejects zero progress in one write without syncing or changing complete records', async () => {
    const { harness, prefix } = await fixture();
    const { state } = injectWrites(harness.filePath, 'zero');
    await expect(harness.append(1)).rejects.toThrow(/no forward progress/i);
    expect(state.calls).toBe(1);
    expect(state.syncs).toBe(0);
    expect(state.closes).toBe(1);
    expect(await fs.readFile(harness.filePath)).toEqual(prefix);
    expect(await harness.first()).toEqual(harness.records[0]);
  });

  it('rejects a later failure and retains the complete prefix and failed tail without false acknowledgement', async () => {
    const { harness, prefix } = await fixture();
    const { state, failure } = injectWrites(harness.filePath, 'failure');
    await expect(harness.append(1)).rejects.toBe(failure);
    expect(state.calls).toBe(2);
    expect(state.syncs).toBe(0);
    expect(state.closes).toBe(1);
    expect(await fs.readFile(harness.filePath)).toEqual(Buffer.concat([prefix, state.bytes]));
    expect(state.bytes.length).toBeGreaterThan(0);
    expect(state.bytes.length).toBeLessThan(state.expected.length);
    await expect(harness.first()).rejects.toThrow();
  });
});
