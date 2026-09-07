import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

const ESTIMATED_HEIGHT = 180;
const OVERSCAN = 6;
export const VIRTUAL_COLUMN_THRESHOLD = 80;

/** Variable-height card window. Measurements and focus are keyed by stable task ID. */
export function useVirtualColumn(
  ids: string[],
  selectedId?: string | null,
  activeId?: string | null
) {
  const enabled = ids.length > VIRTUAL_COLUMN_THRESHOLD;
  const viewport = useRef<HTMLDivElement>(null);
  const sizes = useRef(new Map<string, number>());
  const elements = useRef(new Map<string, HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState(0);
  const [view, setView] = useState({ top: 0, height: 800 });
  const layout = useMemo(() => {
    let offset = 0;
    const rows = ids.map((id, index) => {
      const size = sizes.current.get(id) ?? ESTIMATED_HEIGHT;
      const row = { id, index, offset, size };
      offset += size;
      return row;
    });
    return { rows, height: offset };
    // Measurements are stored outside render so ResizeObserver can batch updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ResizeObserver mutates the size map; its revision invalidates this layout.
  }, [ids, measurement]);
  const updateView = useCallback(() => {
    const element = viewport.current;
    if (element) setView({ top: element.scrollTop, height: element.clientHeight });
  }, []);
  useLayoutEffect(() => {
    if (!enabled) return;
    observer.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.virtualTask;
        if (!id) continue;
        const height = Math.ceil(entry.target.getBoundingClientRect().height) + 8;
        if (height > 8 && sizes.current.get(id) !== height) {
          sizes.current.set(id, height);
          changed = true;
        }
      }
      if (changed) setMeasurement((value) => value + 1);
    });
    for (const element of elements.current.values()) observer.current.observe(element);
    const resize = new ResizeObserver(updateView);
    if (viewport.current) resize.observe(viewport.current);
    updateView();
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      resize.disconnect();
    };
  }, [enabled, updateView]);
  const measure = useCallback((id: string, element: HTMLDivElement | null) => {
    const previous = elements.current.get(id);
    if (previous && previous !== element) observer.current?.unobserve(previous);
    if (element) {
      elements.current.set(id, element);
      observer.current?.observe(element);
    } else elements.current.delete(id);
  }, []);
  const reveal = useCallback(
    (id: string, focus = false) => {
      const element = viewport.current;
      const row = layout.rows.find((item) => item.id === id);
      if (!element || !row) return;
      if (
        row.offset < element.scrollTop ||
        row.offset + row.size > element.scrollTop + element.clientHeight
      ) {
        element.scrollTop = Math.max(0, row.offset - 8);
        updateView();
      }
      if (focus)
        requestAnimationFrame(() =>
          elements.current.get(id)?.querySelector<HTMLElement>('[data-task-id]')?.focus()
        );
    },
    [layout, updateView]
  );
  const lastSelected = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (enabled && selectedId && selectedId !== lastSelected.current) reveal(selectedId);
    lastSelected.current = selectedId;
  }, [enabled, selectedId, reveal]);
  const visible = useMemo(() => {
    if (!enabled) return { rows: layout.rows, start: 0, end: ids.length };
    const foundFirst = layout.rows.findIndex((row) => row.offset + row.size >= view.top);
    const first = foundFirst < 0 ? Math.max(0, ids.length - 1) : foundFirst;
    const last = layout.rows.findIndex((row) => row.offset > view.top + view.height);
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(ids.length, (last < 0 ? ids.length : last) + OVERSCAN);
    const rows = layout.rows.filter(
      (row) =>
        (row.index >= start && row.index < end) || row.id === activeId || row.id === focusedId
    );
    return { rows, start, end };
  }, [enabled, layout, view, ids.length, activeId, focusedId]);
  return {
    enabled,
    viewport,
    setFocusedId,
    height: layout.height,
    ...visible,
    measure,
    updateView,
    reveal,
  };
}
