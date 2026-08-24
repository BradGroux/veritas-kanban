import { describe, expect, it } from 'vitest';
import {
  createSafeRecord,
  deleteSafeRecordValue,
  getSafeRecordValue,
  safeRecordFrom,
  setSafeRecordValue,
} from '../utils/safe-record.js';

describe('safe record utilities', () => {
  it('stores, reads, and deletes own values without an object prototype', () => {
    const record = createSafeRecord<string>();

    setSafeRecordValue(record, 'task-1', 'value');

    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(getSafeRecordValue(record, 'task-1')).toBe('value');
    expect(deleteSafeRecordValue(record, 'task-1')).toBe(true);
    expect(getSafeRecordValue(record, 'task-1')).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the reserved key %s', (key) => {
    const record = createSafeRecord<string>();
    expect(() => setSafeRecordValue(record, key, 'blocked')).toThrow('not allowed');
    expect(() => getSafeRecordValue(record, key)).toThrow('not allowed');
  });

  it('fails closed when persisted JSON contains a prototype key', () => {
    const parsed = JSON.parse('{"safe":"value","__proto__":{"polluted":true}}');

    expect(() => safeRecordFrom<string>(parsed, 'persisted state')).toThrow('not allowed');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
