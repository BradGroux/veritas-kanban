import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useVirtualColumn } from '@/hooks/useVirtualColumn';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
afterEach(cleanup);
const ids = Array.from({ length: 5000 }, (_, index) => `task_${index}`);

describe('large column card window', () => {
  it('bounds DOM work across scrolling, selection and an offscreen drag', () => {
    const { result, rerender } = renderHook(
      ({ selected, active }) => useVirtualColumn(ids, selected, active),
      { initialProps: { selected: null as string | null, active: null as string | null } }
    );
    expect(result.current.rows.length).toBeLessThan(20);
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientHeight', { value: 800 });
    result.current.viewport.current = element;
    act(() => {
      element.scrollTop = 180 * 2500;
      result.current.updateView();
    });
    expect(result.current.rows.length).toBeLessThan(20);
    expect(result.current.rows.some((row) => row.id === 'task_2500')).toBe(true);
    act(() => {
      element.scrollTop = 2_000_000;
      result.current.updateView();
    });
    expect(result.current.rows.length).toBeLessThan(20);
    expect(result.current.rows.some((row) => row.id === 'task_4999')).toBe(true);
    rerender({ selected: 'task_4999', active: 'task_0' });
    expect(element.scrollTop).toBeGreaterThan(180 * 4900);
    expect(result.current.rows.some((row) => row.id === 'task_4999')).toBe(true);
    expect(result.current.rows.some((row) => row.id === 'task_0')).toBe(true);
    expect(result.current.rows.length).toBeLessThan(20);
  });

  it('keeps a focused offscreen card mounted and small columns unchanged', () => {
    const { result } = renderHook(() => useVirtualColumn(ids));
    act(() => result.current.setFocusedId('task_4000'));
    expect(result.current.rows.some((row) => row.id === 'task_4000')).toBe(true);
    expect(result.current.rows.length).toBeLessThan(20);
    const small = renderHook(() => useVirtualColumn(ids.slice(0, 20)));
    expect(small.result.current.enabled).toBe(false);
    expect(small.result.current.rows).toHaveLength(20);
  });
});
