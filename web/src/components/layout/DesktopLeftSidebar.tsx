import { ScrollArea, Text } from '@mantine/core';
import {
  Activity,
  Archive,
  Clock,
  ClipboardList,
  FileText,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Scale,
  ShieldAlert,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { useView } from '@/contexts/ViewContext';
import { useBacklogCount } from '@/hooks/useBacklog';
import { VIEW_DEFINITIONS, type ViewIcon } from '@/lib/views';
import { cn } from '@/lib/utils';
import { useDesktopShell } from './DesktopShellContext';

const VIEW_ICONS: Record<ViewIcon, LucideIcon> = {
  Activity,
  Archive,
  Clock,
  ClipboardList,
  FileText,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Scale,
  ShieldAlert,
  Workflow,
};

const DESKTOP_NAV_ITEMS = VIEW_DEFINITIONS.filter(
  (item) => item.view === 'board' || item.showInNavigation
);

export function DesktopLeftSidebar() {
  const { isDesktopClient, leftRailOpen } = useDesktopShell();
  const { view, setView } = useView();
  const { data: backlogCount = 0 } = useBacklogCount();

  if (!isDesktopClient) return null;

  return (
    <aside
      aria-label="Desktop navigation"
      className={cn(
        'desktop-left-sidebar border-r border-border bg-card/80 transition-[width] duration-150',
        leftRailOpen ? 'w-56' : 'w-12'
      )}
    >
      <ScrollArea className="h-full">
        <nav className="flex flex-col gap-1 p-2">
          {DESKTOP_NAV_ITEMS.map((item) => {
            const Icon = VIEW_ICONS[item.icon];
            const active = view === item.view;
            const badge = item.view === 'backlog' && backlogCount > 0 ? backlogCount : null;

            return (
              <button
                key={item.view}
                type="button"
                title={item.title ?? item.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => setView(item.view)}
                className={cn(
                  'desktop-no-drag flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  !leftRailOpen && 'justify-center px-0'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {leftRailOpen && (
                  <>
                    <Text component="span" size="sm" className="min-w-0 flex-1 truncate">
                      {item.title ?? item.label}
                    </Text>
                    {badge !== null && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
