import { describe, expect, it } from 'vitest';
import { normalizeArrayData } from '@/lib/query-data';

describe('normalizeArrayData', () => {
  it('returns raw arrays unchanged', () => {
    expect(normalizeArrayData<number>([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('unwraps array payloads nested under data', () => {
    expect(normalizeArrayData<number>({ data: [1, 2, 3] })).toEqual([1, 2, 3]);
  });

  it('unwraps one extra success envelope layer', () => {
    expect(normalizeArrayData<number>({ success: true, data: { data: [1, 2, 3] } })).toEqual([
      1, 2, 3,
    ]);
  });

  it('falls back to an empty array for non-array payloads', () => {
    expect(normalizeArrayData<number>({ success: true, data: null })).toEqual([]);
  });
});
