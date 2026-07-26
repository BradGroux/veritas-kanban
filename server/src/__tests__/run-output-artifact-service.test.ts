import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunOutputArtifactLookup } from '@veritas-kanban/shared';
import {
  RunOutputArtifactService,
  type RunOutputArtifactQueryPolicy,
} from '../services/run-output-artifact-service.js';
import { RunOutputSpillService } from '../services/run-output-spill-service.js';
import { FileRunOutputArtifactRepository } from '../storage/run-output-artifact-repository.js';

const cleanupPaths: string[] = [];

async function fixture(policy: Partial<RunOutputArtifactQueryPolicy> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'veritas-run-output-query-'));
  cleanupPaths.push(directory);
  const repository = new FileRunOutputArtifactRepository(directory);
  const spillService = new RunOutputSpillService({
    schemaVersion: 'run-output-spill-policy/v1',
    inlineBytes: 256,
    maxQueryBytes: 1_024,
    maxJsonDepth: 8,
    retentionSeconds: 3_600,
    activeLeaseSeconds: 0,
    allowBinaryPersistence: false,
    allowCompressedPersistence: false,
  });
  const queryPolicy: RunOutputArtifactQueryPolicy = {
    maxResultBytes: 1_024,
    maxLineCount: 100,
    maxScanBytes: 8 * 1_024,
    maxStructuredBytes: 8 * 1_024,
    maxJsonDepth: 8,
    maxQueriesPerMinute: 60,
    ...policy,
  };
  return {
    directory,
    repository,
    service: new RunOutputArtifactService(repository, spillService, queryPolicy),
  };
}

function spillInput(content: string, mediaType = 'text/plain') {
  return {
    scope: {
      workspaceId: 'workspace_1',
      taskId: 'task_1',
      runId: 'run_1',
      attemptId: 'attempt_1',
      turnId: 'turn_1',
    },
    source: {
      kind: 'tool-result' as const,
      name: 'example',
      eventId: 'event_1',
      toolCallId: 'tool_1',
    },
    content,
    mediaType,
    now: new Date('2026-07-25T12:00:00.000Z'),
  };
}

function lookup(artifactId: string): RunOutputArtifactLookup {
  return {
    workspaceId: 'workspace_1',
    taskId: 'task_1',
    runId: 'run_1',
    attemptId: 'attempt_1',
    artifactId,
  };
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((entry) => rm(entry, { recursive: true })));
});

describe('RunOutputArtifactService', () => {
  it('persists oversized output and serves byte and line queries without journaling copies', async () => {
    const { service, repository } = await fixture();
    const content = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n');
    const preview = await service.spill(spillInput(content));
    const artifactId = preview.artifact?.artifactId;
    if (!artifactId) throw new Error('Expected a spill artifact.');

    const bytes = await service.query({
      lookup: lookup(artifactId),
      query: { operation: 'byte-range', offset: 0, length: 12 },
      requesterId: 'user_1',
    });
    const lines = await service.query({
      lookup: lookup(artifactId),
      query: { operation: 'line-range', startLine: 10, lineCount: 3 },
      requesterId: 'user_1',
    });

    expect(bytes).toMatchObject({
      operation: 'byte-range',
      content: content.slice(0, 12),
      length: 12,
      truncated: true,
    });
    expect(lines).toMatchObject({
      operation: 'line-range',
      content: 'line 10\nline 11\nline 12',
      encoding: 'utf-8',
      truncated: true,
    });
    expect(await repository.list({ workspaceId: 'workspace_1' })).toHaveLength(1);
  });

  it('supports bounded JSON paths without arbitrary expressions', async () => {
    const { service } = await fixture();
    const preview = await service.spill(
      spillInput(
        JSON.stringify({
          rows: Array.from({ length: 100 }, (_, index) => ({
            id: index,
            nested: { value: `row-${index}` },
          })),
        }),
        'application/json'
      )
    );
    const artifactId = preview.artifact?.artifactId;
    if (!artifactId) throw new Error('Expected a spill artifact.');

    const selected = await service.query({
      lookup: lookup(artifactId),
      query: { operation: 'json-path', path: '$.rows[42].nested.value' },
      requesterId: 'user_1',
    });

    expect(selected).toMatchObject({
      operation: 'json-path',
      content: '"row-42"',
      encoding: 'json',
      truncated: false,
    });
    await expect(
      service.query({
        lookup: lookup(artifactId),
        query: { operation: 'json-path', path: '$.rows.filter(secret)' },
        requesterId: 'user_1',
      })
    ).rejects.toThrow('unsupported syntax');
  });

  it('enforces a per-requester artifact query rate', async () => {
    const { service } = await fixture({ maxQueriesPerMinute: 2 });
    const preview = await service.spill(spillInput('rate limited output\n'.repeat(30)));
    const artifactId = preview.artifact?.artifactId;
    if (!artifactId) throw new Error('Expected a spill artifact.');
    const request = {
      lookup: lookup(artifactId),
      query: { operation: 'byte-range' as const, offset: 0, length: 10 },
      requesterId: 'user_1',
      now: new Date('2026-07-25T12:05:00.000Z'),
    };

    await service.query(request);
    await service.query(request);
    await expect(service.query(request)).rejects.toThrow('rate limit');
    await expect(service.query({ ...request, requesterId: 'user_2' })).resolves.not.toBeNull();
  });

  it('quarantines a body that contains a secret shape at export time', async () => {
    const { service, repository } = await fixture();
    const prepared = new RunOutputSpillService({
      schemaVersion: 'run-output-spill-policy/v1',
      inlineBytes: 256,
      maxQueryBytes: 1_024,
      maxJsonDepth: 8,
      retentionSeconds: 3_600,
      activeLeaseSeconds: 0,
      allowBinaryPersistence: false,
      allowCompressedPersistence: false,
    }).prepare(spillInput('safe output\n'.repeat(40)));
    if (!prepared.artifact?.content) throw new Error('Expected a spill artifact.');
    const unsafe = Buffer.from(`token=unredacted-value${' output'.repeat(40)}`, 'utf-8');
    const metadata = {
      ...prepared.artifact.metadata,
      originalBytes: unsafe.byteLength,
      storedBytes: unsafe.byteLength,
      sha256: createHash('sha256').update(unsafe).digest('hex'),
    };
    await repository.create(metadata, unsafe);

    const validated = await service.validateForExport(lookup(metadata.id));

    expect(validated).toMatchObject({
      state: 'quarantined',
      quarantineReason: 'secret-validation',
      redaction: { state: 'quarantined' },
    });
    expect(
      await repository.readRange({ ...lookup(metadata.id), offset: 0, length: 32 })
    ).toBeNull();
  });

  it('returns scoped metadata for quarantined content without exposing a body', async () => {
    const { service } = await fixture();
    const preview = await service.spill({
      ...spillInput('ignored'),
      content: Uint8Array.from([0, 255, 1]),
      mediaType: 'application/octet-stream',
    });
    const artifactId = preview.artifact?.artifactId;
    if (!artifactId) throw new Error('Expected a quarantined artifact.');

    const metadata = await service.query({
      lookup: lookup(artifactId),
      query: { operation: 'metadata' },
      requesterId: 'user_1',
    });
    const body = await service.query({
      lookup: lookup(artifactId),
      query: { operation: 'byte-range', offset: 0, length: 16 },
      requesterId: 'user_1',
    });

    expect(metadata).toMatchObject({
      metadata: { state: 'quarantined', quarantineReason: 'content-policy' },
      operation: 'metadata',
    });
    expect(body).toMatchObject({
      metadata: { state: 'quarantined' },
      operation: 'byte-range',
      truncated: false,
    });
    expect(body?.content).toBeUndefined();
  });
});
