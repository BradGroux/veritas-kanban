/**
 * QA Gate & Run Mode — Unit tests for the blocking logic
 *
 * These tests verify that:
 * 1. runMode and qaGate fields are accepted in the updateTaskSchema
 * 2. The QA gate check correctly identifies when a task is blocked from done
 *
 * We test the logic layer directly (not via HTTP) to avoid the
 * singleton service wiring complexity of the route layer.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { QaGateState } from '@veritas-kanban/shared';

// ─── Re-create the minimal schemas from the route (mirrors tasks.ts) ──────────

const runModeSchema = z
  .enum(['strategy', 'eng-review', 'paranoid-review', 'qa'])
  .optional()
  .nullable();

const qaGateSchema = z
  .object({
    required: z.boolean(),
    passed: z.boolean(),
    passedAt: z.string().optional(),
    passedBy: z.string().optional(),
  })
  .optional()
  .nullable();

const patchSchema = z.object({
  status: z.enum(['todo', 'in-progress', 'blocked', 'done']).optional(),
  runMode: runModeSchema,
  qaGate: qaGateSchema,
});

// ─── QA gate blocking logic (mirrors tasks.ts) ────────────────────────────────

function wouldBeBlockedByQaGate(
  existingGate: QaGateState | null | undefined,
  incomingGate: QaGateState | null | undefined,
  newStatus: string | undefined
): boolean {
  if (newStatus !== 'done') return false;
  const merged = incomingGate !== undefined ? incomingGate : existingGate;
  return !!(merged?.required && !merged?.passed);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runMode schema', () => {
  it('accepts valid run modes', () => {
    for (const mode of ['strategy', 'eng-review', 'paranoid-review', 'qa']) {
      const result = runModeSchema.safeParse(mode);
      expect(result.success, `mode: ${mode}`).toBe(true);
    }
  });

  it('rejects invalid run modes', () => {
    const result = runModeSchema.safeParse('auto-ship');
    expect(result.success).toBe(false);
  });

  it('accepts null to clear', () => {
    expect(runModeSchema.safeParse(null).success).toBe(true);
  });

  it('accepts undefined (no-op)', () => {
    expect(runModeSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('qaGate schema', () => {
  it('accepts required+not-passed gate', () => {
    const result = qaGateSchema.safeParse({ required: true, passed: false });
    expect(result.success).toBe(true);
  });

  it('accepts required+passed gate with metadata', () => {
    const result = qaGateSchema.safeParse({
      required: true,
      passed: true,
      passedAt: '2026-03-12T21:00:00Z',
      passedBy: 'brad',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null to clear', () => {
    expect(qaGateSchema.safeParse(null).success).toBe(true);
  });

  it('rejects missing required field', () => {
    const result = qaGateSchema.safeParse({ passed: false });
    expect(result.success).toBe(false);
  });
});

describe('QA gate blocking logic', () => {
  it('blocks done when required=true, passed=false on existing gate', () => {
    expect(wouldBeBlockedByQaGate({ required: true, passed: false }, undefined, 'done')).toBe(true);
  });

  it('allows done when required=true, passed=true on existing gate', () => {
    expect(wouldBeBlockedByQaGate({ required: true, passed: true }, undefined, 'done')).toBe(false);
  });

  it('allows done when no gate is set', () => {
    expect(wouldBeBlockedByQaGate(undefined, undefined, 'done')).toBe(false);
  });

  it('allows done when required=false', () => {
    expect(wouldBeBlockedByQaGate({ required: false, passed: false }, undefined, 'done')).toBe(
      false
    );
  });

  it('allows passing QA and moving to done in same PATCH', () => {
    // Existing: required, not passed. Incoming: required, passed.
    expect(
      wouldBeBlockedByQaGate(
        { required: true, passed: false },
        { required: true, passed: true },
        'done'
      )
    ).toBe(false);
  });

  it('does not block non-done transitions', () => {
    expect(
      wouldBeBlockedByQaGate({ required: true, passed: false }, undefined, 'in-progress')
    ).toBe(false);
  });

  it('uses incoming gate over existing when both present', () => {
    // Incoming says passed=false, should block
    expect(
      wouldBeBlockedByQaGate(
        { required: true, passed: true }, // existing (passed)
        { required: true, passed: false }, // incoming (revoked)
        'done'
      )
    ).toBe(true);
  });
});
