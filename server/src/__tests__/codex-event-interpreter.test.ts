import { describe, expect, it } from 'vitest';

import {
  interpretCodexEvent,
  redactProviderTraceText,
} from '../services/codex-event-interpreter.js';

describe('Codex event interpretation', () => {
  it('normalizes nested completion events and protects trace text', () => {
    const interpreted = interpretCodexEvent(
      {
        args: [' status ', '', 42],
        file: 'direct.ts',
        file_path: [
          './result.ts',
          '../parent.ts',
          '/tmp/output.log',
          'https://example.com/result',
          'nested/result.json',
          'notes.md',
          'line\nbreak',
          '',
          42,
        ],
        retryAttempt: '2',
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          cost_usd: 0.01,
          model: 'gpt-test',
        },
        nested: { final_response: ' done ' },
        item: { type: 'completed_item' },
      },
      'turn.completed'
    );

    expect(interpreted).toMatchObject({
      command: 'status',
      files: [
        'direct.ts',
        './result.ts',
        '../parent.ts',
        '/tmp/output.log',
        'https://example.com/result',
        'nested/result.json',
        'notes.md',
      ],
      retryAttempt: 2,
      tool: 'completed_item',
      traceStepType: 'complete',
      logActivity: true,
      summary: 'done',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cost: 0.01,
        model: 'gpt-test',
      },
    });
    expect(interpreted.stream).toBeUndefined();

    const redacted = redactProviderTraceText(`token=secret-value ${'x'.repeat(2100)}`);
    expect(redacted.startsWith('token=[REDACTED]')).toBe(true);
    expect(redacted).toHaveLength(2003);
    expect(redacted.endsWith('...')).toBe(true);
  });

  it.each([
    ['turn.retrying', {}, 'retry', undefined],
    ['run.aborted', {}, 'abort', undefined],
    ['run.cancelled', {}, 'abort', undefined],
    ['turn.failed', { message: 'failed' }, 'error', undefined],
    ['error', { error: 'broken' }, 'error', 'stderr'],
    ['run.finalizing', {}, 'finalize', undefined],
    ['response.output', {}, 'stream', 'stdout'],
    ['item.created', { item: { type: 'message_delta' } }, 'stream', undefined],
    ['response.completed', {}, 'complete', undefined],
    ['item.created', {}, 'execute', undefined],
  ] as const)('maps %s to its trace lifecycle', (type, event, traceStepType, stream) => {
    expect(interpretCodexEvent(event, type)).toMatchObject({ traceStepType, stream });
  });
});
