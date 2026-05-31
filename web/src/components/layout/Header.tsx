import {
  Plus,
  Settings,
  Search,
  Archive,
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
  Scale,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
// ActivitySidebar removed — merged into ActivityFeed (GH-66)
// ArchiveSidebar removed — replaced with full-page ArchivePage
import { UserMenu } from './UserMenu';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { WebSocketIndicator } from '@/components/shared/WebSocketIndicator';
import { lazy, Suspense, useState, useCallback } from 'react';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useView } from '@/contexts/ViewContext';
import { useBacklogCount } from '@/hooks/useBacklog';
import { useTheme } from '@/hooks/useTheme';
import { useIdentity } from '@/hooks/useIdentity';
import { Badge } from '@/components/ui/badge';
import { NAVIGATION_VIEWS, type ViewIcon } from '@/lib/views';

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

const VIEW_ICONS: Record<ViewIcon, LucideIcon> = {
  Activity,
  Archive,
  FileText,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListOrdered,
  Scale,
  ShieldAlert,
  Workflow,
};

export function Header() {
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  // activityOpen removed — sidebar merged into feed (GH-66)
  // archiveOpen removed — archive is now a full page view
  const [chatOpen, setChatOpen] = useState(false);
  const [squadChatOpen, setSquadChatOpen] = useState(false);
  const [loadedPanels, setLoadedPanels] = useState<Set<LazyPanel>>(() => new Set());
  const { setOpenCreateDialog, setOpenChatPanel } = useKeyboard();
  const { view, setView, navigateToTask } = useView();
  const { data: backlogCount = 0 } = useBacklogCount();
  const { theme, setTheme } = useTheme();
  const { hasPermission } = useIdentity();
  const canCreateTask = hasPermission('task:write');
  const canOpenSettings = hasPermission('settings:read') || hasPermission('admin:manage');

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
    markPanelLoaded('chat');
    setChatOpen(true);
  }, [markPanelLoaded]);

  const openSearchDialog = useCallback(() => {
    markPanelLoaded('search');
    setSearchOpen(true);
  }, [markPanelLoaded]);

  const openSquadChatPanel = useCallback(() => {
    markPanelLoaded('squadChat');
    setSquadChatOpen(true);
  }, [markPanelLoaded]);

  const openSettingsDialog = useCallback(() => {
    markPanelLoaded('settings');
    setSettingsOpen(true);
  }, [markPanelLoaded]);

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

  // Register the create dialog and chat panel openers with keyboard context (refs, no useEffect needed)
  setOpenCreateDialog(openCreateDialog);
  setOpenChatPanel(openChatPanel);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card" role="banner">
      <nav aria-label="Main navigation" className="container mx-auto px-4">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
              onClick={() => window.location.reload()}
              aria-label="Refresh page"
              title="Refresh page"
            >
              <span className="text-xl" aria-hidden="true">
                ⚖️
              </span>
              <h1 className="text-lg font-semibold">Veritas Kanban</h1>
            </button>
            <div className="h-4 w-px bg-border" aria-hidden="true" />
            <WorkspaceSwitcher />
            <div className="hidden md:block h-4 w-px bg-border" aria-hidden="true" />
            <WebSocketIndicator />
          </div>

          <div className="flex items-center gap-2" role="toolbar" aria-label="Board actions">
            <Button
              variant="default"
              size="sm"
              onClick={openCreateDialog}
              disabled={!canCreateTask}
              title={canCreateTask ? 'New Task' : 'Task write permission required'}
            >
              <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
              New Task
            </Button>
            {NAVIGATION_VIEWS.map((item) => {
              const Icon = VIEW_ICONS[item.icon];
              const isBacklog = item.view === 'backlog';

              return (
                <Button
                  key={item.view}
                  variant={view === item.view ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => setView(view === item.view ? 'board' : item.view)}
                  aria-label={item.label}
                  title={item.title ?? item.label}
                  className={isBacklog ? 'relative' : undefined}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {isBacklog && backlogCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-[10px]"
                    >
                      {backlogCount > 99 ? '99+' : backlogCount}
                    </Badge>
                  )}
                </Button>
              );
            })}
            <Button
              variant="ghost"
              size="icon"
              onClick={openSearchDialog}
              aria-label="Search"
              title="Search"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={openSquadChatPanel}
              aria-label="Squad Chat"
              title="Squad Chat — Agent communication"
            >
              <Users className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={openSettingsDialog}
              disabled={!canOpenSettings}
              aria-label="Settings"
              title={canOpenSettings ? 'Settings' : 'Settings permission required'}
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'light' ? (
                <Moon className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Sun className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
            <UserMenu
              onOpenSecuritySettings={openSecuritySettings}
              onOpenIdentitySettings={openIdentitySettings}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
              }
              aria-label="Command palette"
              title="Command palette (⌘K)"
              className="gap-1.5 text-muted-foreground"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px]">
                ⌘K
              </kbd>
            </Button>
          </div>
        </div>
      </nav>

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
          />
        )}
      </Suspense>
    </header>
  );
}
