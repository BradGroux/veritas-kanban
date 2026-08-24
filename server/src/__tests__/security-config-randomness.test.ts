import { describe, expect, it } from 'vitest';
import { generateRecoveryKey } from '../config/security.js';

describe('security config recovery keys', () => {
  it('generates the documented alphabet and grouping', () => {
    const keys = Array.from({ length: 128 }, () => generateRecoveryKey());

    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}(?:-[A-HJ-KM-NP-Z2-9]{4}){3}$/);
    }
  });
});
