import {
  Plus,
  Settings,
  Keyboard,
  Activity,
  ListOrdered,
  Archive,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { ActivitySidebar } from './ActivitySidebar';
import { ArchiveSidebar } from './ArchiveSidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { UserMenu } from './UserMenu';
import { AgentStatusIndicator } from '@/components/shared/AgentStatusIndicator';
import { WebSocketIndicator } from '@/components/shared/WebSocketIndicator';
import { useState, useCallback } from 'react';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useView } from '@/contexts/ViewContext';

export function Header() {
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  const [activityOpen, setActivityOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { setOpenCreateDialog, setOpenChatPanel, openHelpDialog } = useKeyboard();
  const { view, setView } = useView();

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
            <div className="h-4 w-px bg-border" aria-hidden="true" />
            <AgentStatusIndicator onOpenActivityLog={() => setActivityOpen(true)} />
          </div>

          <div className="flex items-center gap-2" role="toolbar" aria-label="Board actions">
            <Button variant="default" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
              New Task
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={openHelpDialog}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setActivityOpen(true)}
              aria-label="Activity log"
              title="Activity log"
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant={view === 'activity' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setView(view === 'activity' ? 'board' : 'activity')}
              aria-label="Activity feed"
              title="Activity feed"
            >
              <ListOrdered className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setArchiveOpen(true)}
              aria-label="Archive"
              title="Archive"
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setChatOpen(true)}
              aria-label="Agent Chat"
              title="Agent Chat (⌘⇧C)"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
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
            <UserMenu onOpenSecuritySettings={openSecuritySettings} />
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
      <ActivitySidebar open={activityOpen} onOpenChange={setActivityOpen} />
      <ArchiveSidebar open={archiveOpen} onOpenChange={setArchiveOpen} />
      <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
    </header>
  );
}
