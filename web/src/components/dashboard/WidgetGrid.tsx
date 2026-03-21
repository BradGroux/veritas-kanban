import { useMemo } from 'react';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import type { ReactNode } from 'react';
import type { ResponsiveLayouts, Layout, LayoutItem } from 'react-grid-layout';

// Import react-grid-layout styles locally (not globally)
import 'react-grid-layout/css/styles.css';

import { useDashboardLayout, DEFAULT_LAYOUTS } from '@/hooks/useDashboardLayout';
import { cn } from '@/lib/utils';

export interface GridWidgetConfig {
  id: string;
  content: ReactNode;
  /** If false, widget is hidden entirely */
  visible?: boolean;
}

interface WidgetGridProps {
  widgets: GridWidgetConfig[];
  className?: string;
}

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 };
const COLS = { lg: 12, md: 10, sm: 6, xs: 4 };
const ROW_HEIGHT = 40;

function WidgetGridInner({
  widgets,
  className,
  width,
}: WidgetGridProps & { width: number }) {
  const { layouts, onLayoutChange, resetLayout } = useDashboardLayout();

  const visibleIds = useMemo(
    () => new Set(widgets.filter((w) => w.visible !== false).map((w) => w.id)),
    [widgets]
  );

  // Filter layouts to only include visible widgets
  const filteredLayouts = useMemo(() => {
    const result: ResponsiveLayouts = {};
    for (const bp of Object.keys(DEFAULT_LAYOUTS) as Array<keyof typeof DEFAULT_LAYOUTS>) {
      const bpLayout: Layout = layouts[bp] ?? DEFAULT_LAYOUTS[bp] ?? [];
      result[bp] = bpLayout.filter((item: LayoutItem) =>
        visibleIds.has(item.i)
      );
    }
    return result;
  }, [layouts, visibleIds]);

  const visibleWidgets = widgets.filter((w) => w.visible !== false);

  // Disable drag/resize on mobile breakpoints (sm = 768px, xs = 480px)
  const isMobile = width < 768;

  return (
    <div className={cn('widget-grid-root', className)}>
      {/* Reset layout button */}
      <div className="flex justify-end mb-2">
        <button
          onClick={resetLayout}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-transparent hover:border-border"
          title="Reset widget layout to defaults"
        >
          Reset Layout
        </button>
      </div>

      <ResponsiveGridLayout
        width={width}
        className="layout"
        layouts={filteredLayouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        dragConfig={{ handle: '.widget-drag-handle', enabled: !isMobile, bounded: false, threshold: 3 }}
        resizeConfig={{ enabled: !isMobile, handles: ['se'] }}
        onLayoutChange={onLayoutChange}
        margin={[12, 12]}
        containerPadding={[0, 0]}
      >
        {visibleWidgets.map((widget) => (
          <div key={widget.id} className="widget-grid-item">
            {widget.content}
          </div>
        ))}
      </ResponsiveGridLayout>

      <style>{`
        .widget-grid-item {
          display: flex;
          flex-direction: column;
        }
        .widget-grid-item > * {
          flex: 1;
          min-height: 0;
        }
      `}</style>
    </div>
  );
}

export function WidgetGrid({ widgets, className }: WidgetGridProps) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1280 });

  return (
    <div ref={containerRef}>
      {mounted && (
        <WidgetGridInner widgets={widgets} className={className} width={width} />
      )}
    </div>
  );
}
