import { useState } from 'react';
import { ActionIcon, Badge, Drawer, Group, Stack } from '@mantine/core';
import { Bell, Columns3, Files, Home, Settings, Workflow } from 'lucide-react';
import { NeedsAttentionQueue } from '@/components/dashboard/NeedsAttentionQueue';
import { useIdentity } from '@/hooks/useIdentity';
import { useView } from '@/contexts/ViewContext';

function scrollToBoardColumns() {
  window.setTimeout(() => {
    document.getElementById('mobile-board-columns')?.scrollIntoView({ block: 'start' });
  }, 0);
}

export function MobileShell() {
  const [inboxOpen, setInboxOpen] = useState(false);
  const { authContext, hasPermission } = useIdentity();
  const { navigateToTask, setView, view } = useView();
  const clientMode = authContext?.clientMode;

  const openBoardHome = () => {
    setView('board');
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  };

  const openBoardColumns = () => {
    setView('board');
    scrollToBoardColumns();
  };

  const openSettingsLite = () => {
    window.dispatchEvent(
      new CustomEvent('veritas:open-settings', { detail: { section: 'general' } })
    );
  };

  const openWorkProducts = () => {
    window.dispatchEvent(
      new CustomEvent('veritas:open-search', { detail: { collections: ['work-products'] } })
    );
  };

  const openRuns = () => {
    setView('workflows');
  };

  const navItems = [
    {
      label: 'Home',
      active: false,
      icon: Home,
      onClick: openBoardHome,
    },
    {
      label: 'Board',
      active: view === 'board',
      icon: Columns3,
      onClick: openBoardColumns,
    },
    {
      label: 'Notifications',
      active: inboxOpen,
      icon: Bell,
      onClick: () => setInboxOpen(true),
    },
    {
      label: 'Runs',
      active: view === 'workflows',
      icon: Workflow,
      onClick: openRuns,
    },
    {
      label: 'Work',
      active: false,
      icon: Files,
      onClick: openWorkProducts,
    },
    {
      label: 'Settings',
      active: false,
      icon: Settings,
      onClick: openSettingsLite,
      disabled: !hasPermission('settings:read') && !hasPermission('admin:manage'),
    },
  ];

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 shadow-lg backdrop-blur md:hidden"
      >
        {clientMode && (
          <div className="mb-1 flex justify-center">
            <Badge size="xs" variant="light" color="gray">
              {clientMode}
            </Badge>
          </div>
        )}
        <div className="grid grid-cols-6 gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                aria-label={`Mobile ${item.label.toLowerCase()}`}
                aria-current={item.active ? 'page' : undefined}
                disabled={item.disabled}
                onClick={item.onClick}
                className={[
                  'flex min-h-12 flex-col items-center justify-center rounded-md px-1 text-[11px] leading-tight text-muted-foreground transition-colors',
                  item.active
                    ? 'bg-primary/15 text-primary'
                    : 'hover:bg-muted hover:text-foreground',
                  item.disabled ? 'cursor-not-allowed opacity-40' : '',
                ].join(' ')}
              >
                <Icon className="mb-0.5 h-4 w-4" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <Drawer
        opened={inboxOpen}
        onClose={() => setInboxOpen(false)}
        position="bottom"
        size="92%"
        title="Notifications"
        classNames={{
          body: 'px-3 pb-4',
          content: 'rounded-t-xl',
          header: 'border-b',
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              aria-label="Open workflows"
              onClick={() => {
                setInboxOpen(false);
                setView('workflows');
              }}
            >
              <Workflow className="h-4 w-4" />
            </ActionIcon>
          </Group>
          <NeedsAttentionQueue
            period="7d"
            onOpenTask={(taskId, target) => {
              setInboxOpen(false);
              navigateToTask(taskId, target);
            }}
            onOpenWorkflows={() => {
              setInboxOpen(false);
              setView('workflows');
            }}
          />
        </Stack>
      </Drawer>
    </>
  );
}
