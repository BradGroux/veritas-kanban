import { describe, expect, it } from 'vitest';

import {
  interpretCodexEvent,
  redactProviderTraceText,
} from '../services/codex-event-interpreter.js';

describe('Codex event interpretation', () => {
  it('normalizes fallback-only completion events and protects trace text', () => {
    const interpreted = interpretCodexEvent(
      {
        args: [' status ', '', 42],
        file_path: ['./result.ts', 'ignored'],
        retryAttempt: '2',
        item: { type: '' },
      },
      'turn.completed'
    );

    expect(interpreted).toMatchObject({
      command: 'status',
      files: ['./result.ts'],
      retryAttempt: 2,
      tool: 'turn.completed',
      traceStepType: 'complete',
      logActivity: true,
    });
    expect(interpreted.usage).toBeUndefined();
    expect(interpreted.stream).toBeUndefined();

    const redacted = redactProviderTraceText(`token=secret-value ${'x'.repeat(2100)}`);
    expect(redacted.startsWith('token=[REDACTED]')).toBe(true);
    expect(redacted).toHaveLength(2003);
    expect(redacted.endsWith('...')).toBe(true);
  });
});
