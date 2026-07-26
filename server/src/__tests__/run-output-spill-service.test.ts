import { describe, expect, it } from 'vitest';
import {
  RUN_OUTPUT_ARTIFACT_SCHEMA_VERSION,
  RUN_OUTPUT_PREVIEW_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
import {
  DEFAULT_RUN_OUTPUT_SPILL_POLICY,
  RunOutputSpillService,
  type PrepareRunOutputInput,
} from '../services/run-output-spill-service.js';

function input(overrides: Partial<PrepareRunOutputInput> = {}): PrepareRunOutputInput {
  return {
    scope: {
      workspaceId: 'workspace_1',
      taskId: 'task_1',
      runId: 'run_1',
      attemptId: 'attempt_1',
      turnId: 'turn_1',
    },
    source: {
      kind: 'tool-result',
      name: 'example',
      eventId: 'event_1',
      toolCallId: 'tool_1',
    },
    content: 'safe output',
    mediaType: 'text/plain',
    now: new Date('2026-07-25T12:00:00.000Z'),
    ...overrides,
  };
}

function service(inlineBytes = 16): RunOutputSpillService {
  return new RunOutputSpillService({
    ...DEFAULT_RUN_OUTPUT_SPILL_POLICY,
    inlineBytes: Math.max(256, inlineBytes),
  });
}

function textWithBytes(bytes: number): string {
  return `${'. '.repeat(Math.floor(bytes / 2))}${bytes % 2 === 1 ? '.' : ''}`;
}

describe('RunOutputSpillService', () => {
  it('keeps output immediately below and at the inline limit inline', () => {
    const spill = service(256);

    for (const bytes of [255, 256]) {
      const result = spill.prepare(input({ content: textWithBytes(bytes) }));
      expect(result.preview).toMatchObject({
        schemaVersion: RUN_OUTPUT_PREVIEW_SCHEMA_VERSION,
        inline: true,
        originalBytes: bytes,
        previewBytes: bytes,
        truncated: false,
      });
      expect(result.artifact).toBeUndefined();
    }
  });

  it('returns a bounded preview and opaque artifact reference above the limit', () => {
    const result = service(256).prepare(input({ content: textWithBytes(257) }));

    expect(result.preview).toMatchObject({
      inline: false,
      previewBytes: 256,
      truncated: true,
      truncationReason: 'inline-limit',
    });
    expect(result.preview.artifact?.artifactId).toMatch(/^spill_[A-Za-z0-9_-]{24}$/);
    expect(result.preview.artifact?.operations).toEqual([
      'metadata',
      'byte-range',
      'line-range',
      'download',
    ]);
    expect(result.artifact?.metadata.schemaVersion).toBe(RUN_OUTPUT_ARTIFACT_SCHEMA_VERSION);
    expect(result.artifact?.content).toHaveLength(257);
  });

  it('clips multi-byte UTF-8 without emitting a broken code point', () => {
    const prefix = textWithBytes(255);
    const result = service(256).prepare(input({ content: `${prefix}💥` }));

    expect(result.preview.content).toBe(prefix);
    expect(result.preview.previewBytes).toBe(255);
    expect(result.preview.content).not.toContain('�');
  });

  it('redacts secret-shaped text before hashing and persistence', () => {
    const raw = `token=super-secret-value${' output'.repeat(60)}`;
    const result = service(256).prepare(input({ content: raw }));
    const stored = Buffer.from(result.artifact?.content ?? []).toString('utf-8');

    expect(stored).not.toContain('super-secret-value');
    expect(stored).toContain('token=[REDACTED]');
    expect(result.artifact?.metadata.redaction).toMatchObject({
      state: 'redacted',
      fields: ['$'],
    });
  });

  it('redacts sensitive JSON fields and exposes bounded structured queries', () => {
    const result = service(256).prepare(
      input({
        mediaType: 'application/json',
        content: JSON.stringify({
          api_key: 'short-secret',
          rows: Array.from({ length: 100 }, (_, index) => ({ index, value: 'row' })),
        }),
      })
    );
    const stored = Buffer.from(result.artifact?.content ?? []).toString('utf-8');

    expect(stored).not.toContain('short-secret');
    expect(JSON.parse(stored).api_key).toBe('[REDACTED]');
    expect(result.preview.artifact?.operations).toContain('json-path');
    expect(result.preview.queryHints).toMatchObject({
      maxResultBytes: DEFAULT_RUN_OUTPUT_SPILL_POLICY.maxQueryBytes,
      maxJsonDepth: DEFAULT_RUN_OUTPUT_SPILL_POLICY.maxJsonDepth,
    });
  });

  it('quarantines invalid UTF-8 declared as text without persisting bytes', () => {
    const result = service().prepare(
      input({
        content: Uint8Array.from([0xc3, 0x28]),
        mediaType: 'text/plain',
      })
    );

    expect(result.preview).toMatchObject({
      contentClass: 'invalid-utf8',
      truncationReason: 'content-policy',
      artifact: { state: 'quarantined', operations: ['metadata'] },
    });
    expect(result.artifact?.content).toBeNull();
    expect(result.artifact?.metadata).toMatchObject({
      encoding: 'binary',
      storedBytes: 0,
      redaction: { state: 'quarantined' },
    });
  });

  it.each([
    ['application/octet-stream', Uint8Array.from([0, 255, 1]), 'binary'],
    ['application/gzip', Uint8Array.from([31, 139, 8]), 'compressed'],
  ])('quarantines disallowed %s payloads', (mediaType, content, contentClass) => {
    const result = service().prepare(input({ mediaType, content }));

    expect(result.preview).toMatchObject({
      inline: false,
      contentClass,
      truncationReason: 'content-policy',
      artifact: { state: 'quarantined', operations: ['metadata'] },
    });
    expect(result.artifact?.content).toBeNull();
  });

  it('uses an explicit caller limit as causal truncation evidence', () => {
    const result = service(256).prepare(
      input({ content: textWithBytes(300), truncationReason: 'websocket-limit' })
    );

    expect(result.preview.truncationReason).toBe('websocket-limit');
    expect(result.artifact?.metadata.truncationReason).toBe('websocket-limit');
  });

  it('retains the causal scope without exposing a host path', () => {
    const result = service(256).prepare(input({ content: textWithBytes(300) }));
    const serialized = JSON.stringify(result);

    expect(result.artifact?.metadata.scope).toEqual(input().scope);
    expect(result.artifact?.metadata.source).toEqual(input().source);
    expect(result.artifact?.metadata.retention).toEqual({
      createdAt: '2026-07-25T12:00:00.000Z',
      expiresAt: '2026-08-01T12:00:00.000Z',
      activeLeaseUntil: '2026-07-26T12:00:00.000Z',
    });
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('file://');
  });
});
