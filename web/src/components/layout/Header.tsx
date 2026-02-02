import { Plus, Settings, Search, ListOrdered, Archive, Inbox, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
// ActivitySidebar removed — merged into ActivityFeed (GH-66)
// ArchiveSidebar removed — replaced with full-page ArchivePage
import { ChatPanel } from '@/components/chat/ChatPanel';
import { UserMenu } from './UserMenu';
import { WebSocketIndicator } from '@/components/shared/WebSocketIndicator';
import { useState, useCallback } from 'react';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useView } from '@/contexts/ViewContext';
import { useBacklogCount } from '@/hooks/useBacklog';
import { useTheme } from '@/hooks/useTheme';
import { Badge } from '@/components/ui/badge';

export function Header() {
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  // activityOpen removed — sidebar merged into feed (GH-66)
  // archiveOpen removed — archive is now a full page view
  const [chatOpen, setChatOpen] = useState(false);
  const { setOpenCreateDialog, setOpenChatPanel } = useKeyboard();
  const { view, setView } = useView();
  const { data: backlogCount = 0 } = useBacklogCount();
  const { theme, setTheme } = useTheme();

  const openSecuritySettings = useCallback(() => {
    setSettingsTab('security');
    setSettingsOpen(true);
  }, []);

  // Register the create dialog and chat panel openers with keyboard context (refs, no useEffect needed)
  setOpenCreateDialog(() => setCreateOpen(true));
  setOpenChatPanel(() => setChatOpen(true));

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
            <WebSocketIndicator />
          </div>

          <div className="flex items-center gap-2" role="toolbar" aria-label="Board actions">
            <Button variant="default" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
              New Task
            </Button>
            <Button
              variant={view === 'activity' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setView(view === 'activity' ? 'board' : 'activity')}
              aria-label="Activity"
              title="Activity"
            >
              <ListOrdered className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant={view === 'backlog' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setView(view === 'backlog' ? 'board' : 'backlog')}
              aria-label="Backlog"
              title="Backlog"
              className="relative"
            >
              <Inbox className="h-4 w-4" aria-hidden="true" />
              {backlogCount > 0 && (
                <Badge
                  variant="secondary"
                  className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-[10px]"
                >
                  {backlogCount > 99 ? '99+' : backlogCount}
                </Badge>
              )}
            </Button>
            <Button
              variant={view === 'archive' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setView(view === 'archive' ? 'board' : 'archive')}
              aria-label="Archive"
              title="Archive"
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
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
            <UserMenu onOpenSecuritySettings={openSecuritySettings} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
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

      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsTab(undefined);
        }}
        defaultTab={settingsTab}
      />
      <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
    </header>
  );
}
