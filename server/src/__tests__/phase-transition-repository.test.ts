import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PHASE_AUTHORITY_DIMENSIONS,
  PHASE_TRANSITION_RECORD_SCHEMA_VERSION,
  type PhaseAuthorityDimension,
  type PhaseAuthoritySource,
  type PhaseTransitionRecord,
} from '@veritas-kanban/shared';
import {
  compilePhaseCapabilityAuthority,
  getBuiltInPhaseCapabilityProfile,
} from '../services/phase-capability-service.js';
import { calculatePhaseAuthorityDelta } from '../services/phase-transition-service.js';
import type { PhaseTransitionRepository } from '../storage/interfaces.js';
import { FilePhaseTransitionRepository } from '../storage/phase-transition-repository.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqlitePhaseTransitionRepository } from '../storage/sqlite/phase-transition-repository.js';

const roots: string[] = [];
const MANIFEST_DIGEST = `sha256:${'1'.repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('phase transition repository parity', () => {
  it('persists append-only compare-and-set state in the file backend', async () => {
    const root = await temporaryRoot();
    const filePath = path.join(root, 'phase-transitions.jsonl');

    await exerciseRepository(
      new FilePhaseTransitionRepository(filePath),
      async () => new FilePhaseTransitionRepository(filePath)
    );
  });

  it('persists append-only compare-and-set state through SQLite restart', async () => {
    const root = await temporaryRoot();
    const databasePath = path.join(root, 'veritas.db');
    let database = new SqliteDatabase({ databasePath });
    database.open();
    const repository = new SqlitePhaseTransitionRepository(database);

    await exerciseRepository(repository, async () => {
      database.close();
      database = new SqliteDatabase({ databasePath });
      database.open();
      return new SqlitePhaseTransitionRepository(database);
    });

    database.close();
  });
});

async function exerciseRepository(
  repository: PhaseTransitionRepository,
  reopen: () => Promise<PhaseTransitionRepository>
): Promise<void> {
  const record = transitionRecord();
  const input = {
    record,
    expectedSequence: 0,
    expectedPhaseEvidenceDigest: record.priorEvidence.digest,
    expectedManifestDigest: MANIFEST_DIGEST,
  };
  const first = await repository.append(input);
  const duplicate = await repository.append(input);
  const staleRecord = {
    ...record,
    id: 'phasetransition_000000000000000002',
    operationId: 'stale-operation',
  };
  const stale = await repository.append({ ...input, record: staleRecord });

  expect(first).toMatchObject({ appended: true, record: { sequence: 1 } });
  expect(duplicate).toMatchObject({ appended: false, record: { id: record.id } });
  expect(stale).toMatchObject({ appended: false, reason: 'stale-sequence' });
  expect(
    await repository.getByOperationId('local', 'task-1', 'attempt-1', record.operationId)
  ).toEqual(record);
  expect(await repository.list(query())).toEqual([record]);

  const restarted = await reopen();
  expect(await restarted.getCurrent('local', 'task-1', 'attempt-1')).toEqual(record);
  expect(await restarted.list(query())).toEqual([record]);
}

function transitionRecord(): PhaseTransitionRecord {
  const priorEvidence = phaseEvidence('implement');
  const effectiveEvidence = phaseEvidence('plan');
  return {
    schemaVersion: PHASE_TRANSITION_RECORD_SCHEMA_VERSION,
    id: 'phasetransition_000000000000000001',
    workspaceId: 'local',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    sequence: 1,
    operationId: 'transition-1',
    priorEvidence,
    effectiveEvidence,
    authorityDelta: calculatePhaseAuthorityDelta(
      priorEvidence.effectiveAuthority,
      effectiveEvidence.effectiveAuthority
    ),
    actor: {
      id: 'operator',
      type: 'user',
      authMethod: 'session',
      workspaceId: 'local',
    },
    reason: 'Narrow to planning.',
    policyDecision: 'allow',
    manifestDigest: MANIFEST_DIGEST,
    eventReference: 'phase:phasetransition_000000000000000001',
    createdAt: '2026-07-25T01:00:00.000Z',
  };
}

function phaseEvidence(phase: 'plan' | 'implement') {
  return compilePhaseCapabilityAuthority({
    profile: getBuiltInPhaseCapabilityProfile(phase),
    sources: {
      parent: source('parent', 'parent'),
      agentProfile: source('agent-profile', 'agent-profile'),
      sandbox: source('sandbox', 'sandbox'),
      toolCatalog: source('tool-catalog', 'tool-catalog'),
      launchPolicy: source('launch-policy', 'launch-policy'),
    },
  });
}

function source<K extends PhaseAuthoritySource['kind']>(
  id: string,
  kind: K
): PhaseAuthoritySource & { kind: K } {
  return {
    id,
    kind,
    authority: dimensions(() => ['*']),
    enforcement: dimensions(() => 'enforced' as const),
  };
}

function dimensions<T>(
  value: (dimension: PhaseAuthorityDimension) => T
): Record<PhaseAuthorityDimension, T> {
  return Object.fromEntries(
    PHASE_AUTHORITY_DIMENSIONS.map((dimension) => [dimension, value(dimension)])
  ) as Record<PhaseAuthorityDimension, T>;
}

function query() {
  return {
    workspaceId: 'local',
    taskId: 'task-1',
    attemptId: 'attempt-1',
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-phase-transitions-'));
  roots.push(root);
  return root;
}
