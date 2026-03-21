import { useState, useCallback } from 'react';
import type { ResponsiveLayouts, Layout } from 'react-grid-layout';

// Bump this version when adding new widgets to force re-layout for all users
const LAYOUT_VERSION = 1;
const STORAGE_KEY = 'veritas-kanban-widget-layout';
const STORAGE_VERSION_KEY = 'veritas-kanban-widget-layout-version';

// Default layout definition - matches current Dashboard widget order
// lg: 12-col, md: 10-col, sm: 6-col, xs: 4-col
export const DEFAULT_LAYOUTS: ResponsiveLayouts = {
  lg: [
    { i: 'token-usage',        x: 0,  y: 0,  w: 6,  h: 5, minH: 4, minW: 3 },
    { i: 'run-duration',       x: 6,  y: 0,  w: 6,  h: 5, minH: 4, minW: 3 },
    { i: 'agent-comparison',   x: 0,  y: 5,  w: 6,  h: 8, minH: 5, minW: 3 },
    { i: 'status-timeline',    x: 6,  y: 5,  w: 6,  h: 8, minH: 5, minW: 3 },
    { i: 'cost-per-task',      x: 0,  y: 13, w: 6,  h: 9, minH: 6, minW: 3 },
    { i: 'agent-utilization',  x: 6,  y: 13, w: 6,  h: 9, minH: 6, minW: 3 },
    { i: 'wall-time',          x: 0,  y: 22, w: 4,  h: 7, minH: 5, minW: 2 },
    { i: 'session-metrics',    x: 4,  y: 22, w: 4,  h: 7, minH: 5, minW: 2 },
    { i: 'activity-clock',     x: 8,  y: 22, w: 4,  h: 7, minH: 5, minW: 2 },
    { i: 'where-time-went',    x: 0,  y: 29, w: 6,  h: 8, minH: 5, minW: 3 },
    { i: 'hourly-activity',    x: 6,  y: 29, w: 6,  h: 8, minH: 5, minW: 3 },
    { i: 'trends-charts',      x: 0,  y: 37, w: 12, h: 9, minH: 6, minW: 4 },
  ],
  md: [
    { i: 'token-usage',        x: 0,  y: 0,  w: 5,  h: 5, minH: 4, minW: 3 },
    { i: 'run-duration',       x: 5,  y: 0,  w: 5,  h: 5, minH: 4, minW: 3 },
    { i: 'agent-comparison',   x: 0,  y: 5,  w: 5,  h: 8, minH: 5, minW: 3 },
    { i: 'status-timeline',    x: 5,  y: 5,  w: 5,  h: 8, minH: 5, minW: 3 },
    { i: 'cost-per-task',      x: 0,  y: 13, w: 5,  h: 9, minH: 6, minW: 3 },
    { i: 'agent-utilization',  x: 5,  y: 13, w: 5,  h: 9, minH: 6, minW: 3 },
    { i: 'wall-time',          x: 0,  y: 22, w: 3,  h: 7, minH: 5, minW: 2 },
    { i: 'session-metrics',    x: 3,  y: 22, w: 4,  h: 7, minH: 5, minW: 2 },
    { i: 'activity-clock',     x: 7,  y: 22, w: 3,  h: 7, minH: 5, minW: 2 },
    { i: 'where-time-went',    x: 0,  y: 29, w: 5,  h: 8, minH: 5, minW: 3 },
    { i: 'hourly-activity',    x: 5,  y: 29, w: 5,  h: 8, minH: 5, minW: 3 },
    { i: 'trends-charts',      x: 0,  y: 37, w: 10, h: 9, minH: 6, minW: 4 },
  ],
  sm: [
    { i: 'token-usage',        x: 0,  y: 0,  w: 6,  h: 5, minH: 4, minW: 2 },
    { i: 'run-duration',       x: 0,  y: 5,  w: 6,  h: 5, minH: 4, minW: 2 },
    { i: 'agent-comparison',   x: 0,  y: 10, w: 6,  h: 8, minH: 5, minW: 2 },
    { i: 'status-timeline',    x: 0,  y: 18, w: 6,  h: 8, minH: 5, minW: 2 },
    { i: 'cost-per-task',      x: 0,  y: 26, w: 6,  h: 9, minH: 6, minW: 2 },
    { i: 'agent-utilization',  x: 0,  y: 35, w: 6,  h: 9, minH: 6, minW: 2 },
    { i: 'wall-time',          x: 0,  y: 44, w: 6,  h: 7, minH: 5, minW: 2 },
    { i: 'session-metrics',    x: 0,  y: 51, w: 6,  h: 7, minH: 5, minW: 2 },
    { i: 'activity-clock',     x: 0,  y: 58, w: 6,  h: 7, minH: 5, minW: 2 },
    { i: 'where-time-went',    x: 0,  y: 65, w: 6,  h: 8, minH: 5, minW: 2 },
    { i: 'hourly-activity',    x: 0,  y: 73, w: 6,  h: 8, minH: 5, minW: 2 },
    { i: 'trends-charts',      x: 0,  y: 81, w: 6,  h: 9, minH: 6, minW: 2 },
  ],
  xs: [
    { i: 'token-usage',        x: 0,  y: 0,  w: 4,  h: 5  },
    { i: 'run-duration',       x: 0,  y: 5,  w: 4,  h: 5  },
    { i: 'agent-comparison',   x: 0,  y: 10, w: 4,  h: 8  },
    { i: 'status-timeline',    x: 0,  y: 18, w: 4,  h: 8  },
    { i: 'cost-per-task',      x: 0,  y: 26, w: 4,  h: 9  },
    { i: 'agent-utilization',  x: 0,  y: 35, w: 4,  h: 9  },
    { i: 'wall-time',          x: 0,  y: 44, w: 4,  h: 7  },
    { i: 'session-metrics',    x: 0,  y: 51, w: 4,  h: 7  },
    { i: 'activity-clock',     x: 0,  y: 58, w: 4,  h: 7  },
    { i: 'where-time-went',    x: 0,  y: 65, w: 4,  h: 8  },
    { i: 'hourly-activity',    x: 0,  y: 73, w: 4,  h: 8  },
    { i: 'trends-charts',      x: 0,  y: 81, w: 4,  h: 9  },
  ],
};

function loadLayouts(): ResponsiveLayouts | null {
  try {
    const storedVersion = localStorage.getItem(STORAGE_VERSION_KEY);
    if (storedVersion !== String(LAYOUT_VERSION)) {
      // Version mismatch — clear and use defaults
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_VERSION_KEY, String(LAYOUT_VERSION));
      return null;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as ResponsiveLayouts;
  } catch {
    return null;
  }
}

function saveLayouts(layouts: ResponsiveLayouts): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
    localStorage.setItem(STORAGE_VERSION_KEY, String(LAYOUT_VERSION));
  } catch {
    // localStorage may be unavailable
  }
}

export function useDashboardLayout() {
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(() => loadLayouts() ?? DEFAULT_LAYOUTS);

  const onLayoutChange = useCallback((_layout: Layout, allLayouts: ResponsiveLayouts) => {
    setLayouts(allLayouts);
    saveLayouts(allLayouts);
  }, []);

  const resetLayout = useCallback(() => {
    setLayouts(DEFAULT_LAYOUTS);
    saveLayouts(DEFAULT_LAYOUTS);
  }, []);

  return { layouts, onLayoutChange, resetLayout };
}
