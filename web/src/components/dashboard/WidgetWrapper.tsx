import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface WidgetWrapperProps {
  title: string;
  children: ReactNode;
  viewAllHref?: string;
  onViewAll?: () => void;
  className?: string;
  /** Pass the drag handle className so react-grid-layout can attach drag listeners */
  dragHandleClassName?: string;
}

export function WidgetWrapper({
  title,
  children,
  viewAllHref,
  onViewAll,
  className,
  dragHandleClassName = 'widget-drag-handle',
}: WidgetWrapperProps) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border bg-card overflow-hidden h-full',
        className
      )}
    >
      {/* Widget Header — drag handle lives here */}
      <div
        className={cn(
          'flex items-center justify-between px-4 py-2 border-b bg-muted/30 shrink-0',
          dragHandleClassName,
          'cursor-grab active:cursor-grabbing select-none'
        )}
      >
        <span className="text-sm font-medium text-foreground">{title}</span>
        {(viewAllHref || onViewAll) && (
          <a
            href={viewAllHref}
            onClick={
              onViewAll
                ? (e) => {
                    e.preventDefault();
                    onViewAll();
                  }
                : undefined
            }
            className="text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer"
          >
            View all →
          </a>
        )}
      </div>

      {/* Widget Content — fills remaining space, scrolls internally */}
      <div className="flex-1 overflow-auto p-4 min-h-0">{children}</div>
    </div>
  );
}
