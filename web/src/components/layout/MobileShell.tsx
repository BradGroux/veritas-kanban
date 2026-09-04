import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Badge, Drawer, Group, Stack } from '@mantine/core';
import { Bell, Columns3, Files, Home, Settings, Workflow } from 'lucide-react';
import { NeedsAttentionQueue } from '@/components/dashboard/NeedsAttentionQueue';
import { FloatingChat } from '@/components/chat/FloatingChat';
import { useIdentity } from '@/hooks/useIdentity';
import { useView } from '@/contexts/ViewContext';

function scrollToBoardColumns() {
  const columns = document.getElementById('mobile-board-columns');
  if (!columns) return false;
  // The sticky toolbar remains over the document after scrolling. Measure it
  // at activation so enlarged text and responsive chrome use their real size.
  const toolbarHeight =
    document.querySelector('.desktop-app-header')?.getBoundingClientRect().height ?? 0;
  // Browsers can round fractional scroll offsets up. Keep the column edge on
  // the visible side of the toolbar when enlarged text yields subpixel sizes.
  window.scrollTo({
    top: Math.max(
      0,
      Math.floor(window.scrollY + columns.getBoundingClientRect().top - toolbarHeight)
    ),
    behavior: 'instant',
  });
  return true;
}

export function MobileShell({ showChat = true }: { showChat?: boolean }) {
  const [inboxOpen, setInboxOpen] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  const [boardJumpRequested, setBoardJumpRequested] = useState(false);
  const { authContext, hasPermission } = useIdentity();
  const { navigateToTask, setView, view } = useView();
  const clientMode = authContext?.clientMode;

  // Content, chat, and toasts must clear both navigation rows and the device safe area.
  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty(
        '--vk-mobile-nav-height',
        `${navigation.getBoundingClientRect().height}px`
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(navigation, { box: 'border-box' });
    measure();
    return () => {
      observer.disconnect();
      root.style.removeProperty('--vk-mobile-nav-height');
    };
  }, []);

  useEffect(() => {
    if (!boardJumpRequested) return;
    let frame = 0;
    const attemptJump = () => {
      if (view !== 'board' || scrollToBoardColumns()) {
        observer.disconnect();
        setBoardJumpRequested(false);
      }
    };
    const scheduleJump = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(attemptJump);
    };
    // Route code and task data may both arrive after the navigation click.
    // Observe the content mount instead of guessing a loading delay.
    const observer = new MutationObserver(scheduleJump);
    observer.observe(document.getElementById('main-content') ?? document.body, {
      childList: true,
      subtree: true,
    });
    scheduleJump();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [boardJumpRequested, view]);

  const openBoardHome = () => {
    setBoardJumpRequested(false);
    setView('board');
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  };

  const openBoardColumns = () => {
    setView('board');
    setBoardJumpRequested(true);
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
      compactLabel: 'Alerts',
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
      <div
        ref={navigationRef}
        data-mobile-navigation-surface
        className="mobile-navigation-surface fixed inset-x-0 bottom-0 z-[100] flex items-stretch gap-1 border-t border-border bg-card/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 shadow-lg backdrop-blur md:contents"
      >
        <nav aria-label="Mobile navigation" className="min-w-0 flex-1 md:hidden">
          {clientMode && (
            <div className="mb-1 flex justify-center">
              <Badge size="xs" variant="light" color="gray">
                {clientMode}
              </Badge>
            </div>
          )}
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
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
                    'flex min-h-12 min-w-0 flex-col items-center justify-center rounded-md px-0 text-sm leading-tight text-muted-foreground transition-colors',
                    item.active
                      ? 'bg-primary/15 text-primary'
                      : 'hover:bg-muted hover:text-foreground',
                    item.disabled ? 'cursor-not-allowed opacity-40' : '',
                  ].join(' ')}
                >
                  <Icon className="mb-0.5 h-4 w-4" aria-hidden="true" />
                  <span data-mobile-nav-label className="block w-full text-center">
                    {'compactLabel' in item ? item.compactLabel : item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
        {showChat && <FloatingChat />}
      </div>

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
