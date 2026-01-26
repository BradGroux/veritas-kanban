import { Plus, Settings, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { useState, useEffect } from 'react';
import { useKeyboard } from '@/hooks/useKeyboard';

export function Header() {
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { setOpenCreateDialog, openHelpDialog } = useKeyboard();

  // Register the create dialog opener with keyboard context
  useEffect(() => {
    setOpenCreateDialog(() => setCreateOpen(true));
  }, [setOpenCreateDialog]);

  return (
    <header className="border-b border-border bg-card">
      <div className="container mx-auto px-4">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚖️</span>
              <h1 className="text-lg font-semibold">Veritas Kanban</h1>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="default" 
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              New Task
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={openHelpDialog}
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      
      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  );
}
