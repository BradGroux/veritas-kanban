import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Group,
  Kbd,
  Menu,
  Text,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  Plus,
  Settings,
  Search,
  Archive,
  Clock,
  ClipboardList,
  Inbox,
  Sun,
  Moon,
  FileText,
  Users,
  Workflow,
  Activity,
  GitBranch,
  LayoutDashboard,
  ListOrdered,
  MoreHorizontal,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Scale,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
// ActivitySidebar removed — merged into ActivityFeed (GH-66)
// ArchiveSidebar removed — replaced with full-page ArchivePage
import { UserMenu } from './UserMenu';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { WebSocketIndicator } from '@/components/shared/WebSocketIndicator';
import { lazy, Suspense, useState, useCallback, useEffect, type MouseEvent } from 'react';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useView } from '@/contexts/ViewContext';
import { useBacklogCount } from '@/hooks/useBacklog';
import { useTheme } from '@/hooks/useTheme';
import { useIdentity } from '@/hooks/useIdentity';
import type { SearchCollection } from '@/lib/api';
import { NAVIGATION_VIEWS, type ViewIcon } from '@/lib/views';
import { cn } from '@/lib/utils';
import { useDesktopShell } from './DesktopShellContext';

const CreateTaskDialog = lazy(() =>
  import('@/components/task/CreateTaskDialog').then((mod) => ({
    default: mod.CreateTaskDialog,
  }))
);

const SettingsDialog = lazy(() =>
  import('@/components/settings/SettingsDialog').then((mod) => ({
    default: mod.SettingsDialog,
  }))
);

const ChatPanel = lazy(() =>
  import('@/components/chat/ChatPanel').then((mod) => ({
    default: mod.ChatPanel,
  }))
);

const SquadChatPanel = lazy(() =>
  import('@/components/chat/SquadChatPanel').then((mod) => ({
    default: mod.SquadChatPanel,
  }))
);

const SearchDialog = lazy(() =>
  import('@/components/search').then((mod) => ({
    default: mod.SearchDialog,
  }))
);

type LazyPanel = 'chat' | 'create' | 'search' | 'settings' | 'squadChat';

interface SearchPreset {
  query?: string;
  collections?: SearchCollection[];
}

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

const PRIMARY_NAVIGATION_VIEW_IDS = new Set<string>([
  'activity',
  'backlog',
  'archive',
  'workflows',
]);

const PRIMARY_NAVIGATION_VIEWS = NAVIGATION_VIEWS.filter((item) =>
  PRIMARY_NAVIGATION_VIEW_IDS.has(item.view)
);

type NavigationItem = (typeof NAVIGATION_VIEWS)[number];

function VeritasMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-card shadow-sm',
        className
      )}
      aria-hidden="true"
    >
      <img src="/icons/pwa-icon-192.png" alt="" className="h-full w-full object-cover" />
    </span>
  );
}

export function Header() {
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchPreset, setSearchPreset] = useState<SearchPreset | undefined>();
  // activityOpen removed — sidebar merged into feed (GH-66)
  // archiveOpen removed — archive is now a full page view
  const [chatOpen, setChatOpen] = useState(false);
  const [squadChatOpen, setSquadChatOpen] = useState(false);
  const [loadedPanels, setLoadedPanels] = useState<Set<LazyPanel>>(() => new Set());
  const isCompactHeader = useMediaQuery('(max-width: 639px)', false);
  const { setOpenCreateDialog, setOpenChatPanel } = useKeyboard();
  const { view, setView, navigateToTask } = useView();
  const { data: backlogCount = 0 } = useBacklogCount();
  const { theme, setTheme } = useTheme();
  const { hasPermission } = useIdentity();
  const canCreateTask = hasPermission('task:write');
  const canOpenSettings = hasPermission('settings:read') || hasPermission('admin:manage');
  const {
    isDesktopClient,
    leftRailOpen,
    rightRailOpen,
    bottomPanel,
    setLeftRailOpen,
    setRightRailOpen,
    openBottomPanel,
    toggleBottomPanel,
  } = useDesktopShell();
  const usesWorkbenchChat = isDesktopClient;
  const boardChatActive = usesWorkbenchChat && bottomPanel === 'board-chat';
  const squadChatActive = usesWorkbenchChat && bottomPanel === 'squad-chat';
  const boardChatAction = !usesWorkbenchChat
    ? 'Open Board Chat'
    : boardChatActive
      ? 'Close Board Chat'
      : bottomPanel
        ? 'Switch to Board Chat'
        : 'Open Board Chat';
  const squadChatAction = !usesWorkbenchChat
    ? 'Open Squad Chat'
    : squadChatActive
      ? 'Close Squad Chat'
      : bottomPanel
        ? 'Switch to Squad Chat'
        : 'Open Squad Chat';

  const toggleView = useCallback(
    (nextView: NavigationItem['view']) => setView(view === nextView ? 'board' : nextView),
    [setView, view]
  );

  const markPanelLoaded = useCallback((panel: LazyPanel) => {
    setLoadedPanels((current) => {
      if (current.has(panel)) return current;

      const next = new Set(current);
      next.add(panel);
      return next;
    });
  }, []);

  const openCreateDialog = useCallback(() => {
    markPanelLoaded('create');
    setCreateOpen(true);
  }, [markPanelLoaded]);

  const openChatPanel = useCallback(() => {
    if (isDesktopClient) {
      openBottomPanel('board-chat');
      return;
    }
    markPanelLoaded('chat');
    setChatOpen(true);
  }, [isDesktopClient, markPanelLoaded, openBottomPanel]);

  const toggleChatPanel = useCallback(() => {
    if (usesWorkbenchChat) {
      toggleBottomPanel('board-chat');
      return;
    }
    openChatPanel();
  }, [openChatPanel, toggleBottomPanel, usesWorkbenchChat]);

  const openSearchDialog = useCallback(
    (preset?: SearchPreset) => {
      markPanelLoaded('search');
      setSearchPreset(preset);
      setSearchOpen(true);
    },
    [markPanelLoaded]
  );

  const openSquadChatPanel = useCallback(() => {
    if (isDesktopClient) {
      openBottomPanel('squad-chat');
      return;
    }
    markPanelLoaded('squadChat');
    setSquadChatOpen(true);
  }, [isDesktopClient, markPanelLoaded, openBottomPanel]);

  const toggleSquadChatPanel = useCallback(() => {
    if (usesWorkbenchChat) {
      toggleBottomPanel('squad-chat');
      return;
    }
    openSquadChatPanel();
  }, [openSquadChatPanel, toggleBottomPanel, usesWorkbenchChat]);

  const openSettingsDialog = useCallback(
    (section?: string) => {
      markPanelLoaded('settings');
      setSettingsTab(section);
      setSettingsOpen(true);
    },
    [markPanelLoaded]
  );

  const openSecuritySettings = useCallback(() => {
    markPanelLoaded('settings');
    setSettingsTab('security');
    setSettingsOpen(true);
  }, [markPanelLoaded]);

  const openIdentitySettings = useCallback(() => {
    markPanelLoaded('settings');
    setSettingsTab('multi-user');
    setSettingsOpen(true);
  }, [markPanelLoaded]);

  const renderNavigationAction = (item: NavigationItem) => {
    const Icon = VIEW_ICONS[item.icon];
    const isBacklog = item.view === 'backlog';

    return (
      <ActionIcon
        key={item.view}
        variant={view === item.view ? 'light' : 'subtle'}
        color={view === item.view ? 'veritas' : 'gray'}
        size={32}
        onClick={() => toggleView(item.view)}
        aria-label={item.label}
        aria-pressed={view === item.view}
        title={item.title ?? item.label}
        className={isBacklog ? 'relative shrink-0' : 'shrink-0'}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {isBacklog && backlogCount > 0 && (
          <Badge
            variant="light"
            color="gray"
            size="xs"
            px={0}
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full text-[10px]"
          >
            {backlogCount > 99 ? '99+' : backlogCount}
          </Badge>
        )}
      </ActionIcon>
    );
  };

  const renderNavigationMenuItem = (item: NavigationItem) => {
    const Icon = VIEW_ICONS[item.icon];
    const isBacklog = item.view === 'backlog';

    return (
      <Menu.Item
        key={item.view}
        leftSection={<Icon className="h-4 w-4" aria-hidden="true" />}
        rightSection={
          isBacklog && backlogCount > 0 ? (
            <Badge variant="light" color="gray" size="xs">
              {backlogCount > 99 ? '99+' : backlogCount}
            </Badge>
          ) : undefined
        }
        onClick={() => toggleView(item.view)}
        aria-current={view === item.view ? 'page' : undefined}
      >
        {item.title ?? item.label}
      </Menu.Item>
    );
  };

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const section = (event as CustomEvent<{ section?: string }>).detail?.section;
      openSettingsDialog(section);
    };

    window.addEventListener('veritas:open-settings', handleOpenSettings);
    return () => window.removeEventListener('veritas:open-settings', handleOpenSettings);
  }, [openSettingsDialog]);

  useEffect(() => {
    const handleOpenSearch = (event: Event) => {
      const detail = (event as CustomEvent<SearchPreset>).detail;
      openSearchDialog(detail);
    };

    window.addEventListener('veritas:open-search', handleOpenSearch);
    return () => window.removeEventListener('veritas:open-search', handleOpenSearch);
  }, [openSearchDialog]);

  const handleChromeDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!isDesktopClient) return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'button, a, input, textarea, select, [role="button"], [role="combobox"], .desktop-no-drag'
        )
      ) {
        return;
      }
      void (
        window as Window & {
          veritasDesktop?: { toggleWindowMaximize?: () => Promise<{ maximized: boolean }> };
        }
      ).veritasDesktop?.toggleWindowMaximize?.();
    },
    [isDesktopClient]
  );

  // Register the create dialog and chat panel openers with keyboard context (refs, no useEffect needed)
  setOpenCreateDialog(openCreateDialog);
  setOpenChatPanel(openChatPanel);

  return (
    <Box
      component="header"
      className="desktop-app-header sticky top-0 z-50 border-b border-border bg-card"
      role="banner"
    >
      <Container fluid px={{ base: 'xs', sm: 'md' }}>
        <Group
          component="nav"
          aria-label="Main navigation"
          h={58}
          justify="space-between"
          wrap="nowrap"
          className="desktop-window-drag min-w-0"
          onDoubleClick={handleChromeDoubleClick}
        >
          <Group gap="sm" wrap="nowrap" miw={0} className="desktop-header-leading min-w-0 flex-1">
            <Box
              component="button"
              type="button"
              className="desktop-no-drag flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
              onClick={() => window.location.reload()}
              aria-label="Refresh page"
              title="Refresh page"
            >
              <VeritasMark />
              {!isDesktopClient && (
                <Text component="h1" size="sm" fw={700} lh={1.1} m={0} className="hidden sm:block">
                  <span className="block">Veritas</span>
                  <span className="block text-xs font-medium text-muted-foreground">Kanban</span>
                </Text>
              )}
            </Box>
            {!isCompactHeader && (
              <>
                <Divider orientation="vertical" className="h-5 border-border" aria-hidden="true" />
                <WorkspaceSwitcher />
                <Divider
                  orientation="vertical"
                  className="hidden h-5 border-border lg:block"
                  aria-hidden="true"
                />
              </>
            )}
            <WebSocketIndicator />
          </Group>

          <Group
            gap={6}
            wrap="nowrap"
            role="toolbar"
            aria-label="Board actions"
            className="min-w-0 shrink-0"
          >
            {isDesktopClient && (
              <Group gap={4} wrap="nowrap" className="desktop-no-drag">
                {isDesktopClient && (
                  <>
                    <ActionIcon
                      variant={leftRailOpen ? 'light' : 'subtle'}
                      color={leftRailOpen ? 'veritas' : 'gray'}
                      size={32}
                      onClick={() => setLeftRailOpen(!leftRailOpen)}
                      aria-label={leftRailOpen ? 'Collapse left sidebar' : 'Expand left sidebar'}
                      aria-pressed={leftRailOpen}
                      title={leftRailOpen ? 'Collapse left sidebar' : 'Expand left sidebar'}
                    >
                      {leftRailOpen ? (
                        <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <PanelLeft className="h-4 w-4" aria-hidden="true" />
                      )}
                    </ActionIcon>
                    <ActionIcon
                      variant={rightRailOpen ? 'light' : 'subtle'}
                      color={rightRailOpen ? 'veritas' : 'gray'}
                      size={32}
                      onClick={() => setRightRailOpen(!rightRailOpen)}
                      aria-label={rightRailOpen ? 'Collapse right sidebar' : 'Expand right sidebar'}
                      aria-pressed={rightRailOpen}
                      title={rightRailOpen ? 'Collapse right sidebar' : 'Expand right sidebar'}
                    >
                      {rightRailOpen ? (
                        <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <PanelRight className="h-4 w-4" aria-hidden="true" />
                      )}
                    </ActionIcon>
                  </>
                )}
                <ActionIcon
                  variant={bottomPanel ? 'light' : 'subtle'}
                  color={bottomPanel ? 'veritas' : 'gray'}
                  size={32}
                  onClick={() => toggleBottomPanel('board-chat')}
                  aria-label={bottomPanel ? 'Close right chat dock' : 'Open chat dock'}
                  aria-pressed={Boolean(bottomPanel)}
                  title={bottomPanel ? 'Close right chat dock' : 'Open chat dock'}
                >
                  {bottomPanel ? (
                    <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <PanelRight className="h-4 w-4" aria-hidden="true" />
                  )}
                </ActionIcon>
              </Group>
            )}
            {isCompactHeader ? (
              <ActionIcon
                variant="filled"
                color="veritas"
                size={32}
                onClick={openCreateDialog}
                disabled={!canCreateTask}
                aria-label="New Task"
                title={canCreateTask ? 'New Task' : 'Task write permission required'}
                className="shrink-0"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </ActionIcon>
            ) : (
              <Button
                variant="filled"
                size="sm"
                leftSection={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={openCreateDialog}
                disabled={!canCreateTask}
                title={canCreateTask ? 'New Task' : 'Task write permission required'}
                className="shrink-0"
              >
                New Task
              </Button>
            )}
            {!isDesktopClient && (
              <Group gap={4} wrap="nowrap" className="hidden xl:flex">
                {PRIMARY_NAVIGATION_VIEWS.map(renderNavigationAction)}
              </Group>
            )}
            <Menu position="bottom-end" shadow="md" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={32}
                  aria-label="More views"
                  title="More views"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Views</Menu.Label>
                {NAVIGATION_VIEWS.map(renderNavigationMenuItem)}
              </Menu.Dropdown>
            </Menu>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={32}
              onClick={() => openSearchDialog()}
              aria-label="Search"
              title="Search"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </ActionIcon>
            {!isCompactHeader && (
              <>
                <ActionIcon
                  variant={boardChatActive ? 'light' : 'subtle'}
                  color={boardChatActive ? 'veritas' : 'gray'}
                  size={32}
                  onClick={toggleChatPanel}
                  aria-label={boardChatAction}
                  aria-pressed={boardChatActive}
                  title={boardChatAction}
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                </ActionIcon>
                <ActionIcon
                  variant={squadChatActive ? 'light' : 'subtle'}
                  color={squadChatActive ? 'veritas' : 'gray'}
                  size={32}
                  onClick={toggleSquadChatPanel}
                  aria-label={squadChatAction}
                  aria-pressed={squadChatActive}
                  title={squadChatAction}
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                </ActionIcon>
              </>
            )}
            {!isCompactHeader && (
              <ActionIcon
                variant="subtle"
                color="gray"
                size={32}
                onClick={() => openSettingsDialog()}
                disabled={!canOpenSettings}
                aria-label="Settings"
                title={canOpenSettings ? 'Settings' : 'Settings permission required'}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
              </ActionIcon>
            )}
            {!isCompactHeader && (
              <ActionIcon
                variant="subtle"
                color="gray"
                size={32}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle theme"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'light' ? (
                  <Moon className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Sun className="h-4 w-4" aria-hidden="true" />
                )}
              </ActionIcon>
            )}
            <UserMenu
              compact={isCompactHeader}
              onOpenSecuritySettings={openSecuritySettings}
              onOpenIdentitySettings={openIdentitySettings}
            />
            <Button
              visibleFrom="lg"
              variant="subtle"
              color="gray"
              size="sm"
              leftSection={<Search className="h-4 w-4" aria-hidden="true" />}
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
              }
              aria-label="Command palette"
              title="Command palette (⌘K)"
              className="hidden gap-1.5 text-muted-foreground lg:inline-flex"
            >
              <Kbd className="hidden h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline-flex">
                ⌘K
              </Kbd>
            </Button>
          </Group>
        </Group>
      </Container>

      <Suspense fallback={null}>
        {loadedPanels.has('create') && (
          <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
        )}
        {loadedPanels.has('settings') && (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={(open) => {
              setSettingsOpen(open);
              if (!open) setSettingsTab(undefined);
            }}
            defaultTab={settingsTab}
          />
        )}
        {loadedPanels.has('chat') && <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />}
        {loadedPanels.has('squadChat') && (
          <SquadChatPanel open={squadChatOpen} onOpenChange={setSquadChatOpen} />
        )}
        {loadedPanels.has('search') && (
          <SearchDialog
            open={searchOpen}
            onOpenChange={setSearchOpen}
            onTaskOpen={navigateToTask}
            onViewOpen={setView}
            onSettingsOpen={openSettingsDialog}
            initialQuery={searchPreset?.query}
            initialCollections={searchPreset?.collections}
          />
        )}
      </Suspense>
    </Box>
  );
}
