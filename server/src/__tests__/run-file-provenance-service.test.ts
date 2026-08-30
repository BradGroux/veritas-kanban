import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunEventEnvelope, RunFileProvenanceScope } from '@veritas-kanban/shared';
import { RunEventJournalService } from '../services/run-event-journal-service.js';
import {
  RunFileProvenanceService,
  type RecordRunFileProvenanceInput,
} from '../services/run-file-provenance-service.js';
import { FileRunEventRepository } from '../storage/run-event-repository.js';

describe('RunFileProvenanceService', () => {
  let root: string;
  let journal: RunEventJournalService;
  let service: RunFileProvenanceService;
  const now = new Date('2026-08-30T10:00:00.000Z');

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-run-file-provenance-'));
    journal = new RunEventJournalService(new FileRunEventRepository(root));
    service = new RunFileProvenanceService(journal, () => now);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('persists causal digest-bound replacements and resolves only the current bytes', async () => {
    const firstEvent = await causalEvent('file-one');
    const first = await service.record(recordInput(firstEvent, 'a'.repeat(64)));
    if (first.status !== 'recorded') throw new Error('Expected provenance record.');

    const secondEvent = await causalEvent('file-two');
    const second = await service.record({
      ...recordInput(secondEvent, 'b'.repeat(64)),
      operation: 'replace',
    });
    if (second.status !== 'recorded') throw new Error('Expected replacement record.');

    expect(second.record.predecessorId).toBe(first.record.id);
    await expect(resolve('b'.repeat(64))).resolves.toMatchObject({
      status: 'exact',
      current: { id: second.record.id },
      chain: [{ id: second.record.id }, { id: first.record.id }],
    });
    await expect(resolve('a'.repeat(64))).resolves.toMatchObject({
      status: 'stale',
      current: { id: second.record.id },
      chain: [],
    });
    const evidence = await service.approvalEvidence({
      workspaceId: 'workspace-a',
      taskId: 'task-a',
      attemptId: 'attempt-a',
      root: 'run-artifact',
      relativePath: 'outputs/report.txt',
      sha256: `sha256:${'b'.repeat(64)}`,
    });
    expect(evidence).toMatchObject({
      schemaVersion: 'run-file-provenance-approval-evidence/v1',
      status: 'exact',
      currentRecordId: second.record.id,
      currentRecordDigest: second.record.digest,
      chainDigests: [second.record.digest, first.record.digest],
      gapCodes: [],
    });
    expect(evidence.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('replays idempotently after restart without duplicating the causal ledger', async () => {
    const event = await causalEvent('restart-safe');
    const input = recordInput(event, 'c'.repeat(64));
    const first = await service.record(input);
    const restarted = new RunFileProvenanceService(journal, () => now);
    const replay = await restarted.record(input);
    const records = await restarted.list('workspace-a', 'task-a', 'attempt-a');

    expect(first.status).toBe('recorded');
    expect(replay).toMatchObject({ status: 'recorded', appended: false });
    expect(records.records).toHaveLength(1);
  });

  it('redacts source metadata and fails closed on path identity collisions', async () => {
    const event = await causalEvent('redaction');
    const input = recordInput(event, 'd'.repeat(64));
    input.location.relativePath = 'reports/Résumé.txt';
    input.producer.sourceUrl = 'https://user:pass@example.com/report?token=signed-secret#private';
    input.producer.connectorTarget = 'teams/reviewed-channel';
    input.producer.metadata = {
      authorization: 'Bearer secret',
      output: '/Users/operator/private/report.txt',
      label: 'reviewed',
    };
    const recorded = await service.record(input);
    if (recorded.status !== 'recorded') throw new Error('Expected provenance record.');

    expect(recorded.record.producer).toMatchObject({
      sourceUrl: 'https://example.com/report',
      connectorTarget: 'teams/reviewed-channel',
      safeMetadata: { output: '[host-path-redacted]', label: 'reviewed' },
    });
    expect(JSON.stringify(recorded.record)).not.toContain('signed-secret');
    expect(JSON.stringify(recorded.record)).not.toContain('Bearer secret');

    const collisionEvent = await causalEvent('collision');
    const collision = recordInput(collisionEvent, 'e'.repeat(64));
    collision.location.relativePath = 'reports/RÉSUMÉ.TXT';
    await expect(service.record(collision)).resolves.toMatchObject({
      status: 'gap',
      gap: { code: 'path-collision' },
    });
  });

  it('records typed gaps for uncertified links and unsupported capture paths', async () => {
    const event = await causalEvent('unsupported');
    const linked = recordInput(event, 'f'.repeat(64));
    linked.location.linkKind = 'symlink';
    const unsupported = recordInput(event, 'f'.repeat(64));
    unsupported.location.relativePath = 'outputs/unsupported.txt';
    unsupported.captureSupport = 'unsupported-provider';

    await expect(service.record(linked)).resolves.toMatchObject({
      status: 'gap',
      gap: { code: 'link-identity-uncertified' },
    });
    await expect(service.record(unsupported)).resolves.toMatchObject({
      status: 'gap',
      gap: { code: 'unsupported-provider-path' },
    });
    await expect(resolve('f'.repeat(64))).resolves.toMatchObject({ status: 'gap' });
  });

  async function causalEvent(key: string): Promise<RunEventEnvelope> {
    return (
      await journal.append({
        workspaceId: 'workspace-a',
        taskId: 'task-a',
        attemptId: 'attempt-a',
        kind: 'file.changed',
        source: { provider: 'system', adapter: 'test' },
        payload: { key },
        dedupeKey: `causal:${key}`,
      })
    ).event;
  }

  function resolve(sha256: string) {
    return service.resolve({
      workspaceId: 'workspace-a',
      taskId: 'task-a',
      attemptId: 'attempt-a',
      root: 'run-artifact',
      relativePath: 'outputs/report.txt',
      sha256: `sha256:${sha256}`,
    });
  }
});

const scope: RunFileProvenanceScope = {
  workspaceId: 'workspace-a',
  taskId: 'task-a',
  rootObjectiveId: 'root-a',
  executionNodeId: 'node-a',
  runId: 'run-a',
  attemptId: 'attempt-a',
  workflowStepId: null,
};

function recordInput(event: RunEventEnvelope, sha256: string): RecordRunFileProvenanceInput {
  return {
    scope,
    source: 'agent-created',
    operation: 'create',
    producer: { eventId: event.eventId, eventSequence: event.sequence },
    location: {
      root: 'run-artifact',
      relativePath: 'outputs/report.txt',
      linkKind: 'regular',
    },
    content: {
      sha256,
      byteSize: 42,
      mediaType: 'text/plain',
      mediaClass: 'text',
    },
  };
}
