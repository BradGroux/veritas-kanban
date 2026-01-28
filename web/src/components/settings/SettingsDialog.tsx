import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  useFeatureSettings,
  useDebouncedFeatureUpdate,
} from '@/hooks/useFeatureSettings';
import {
  Settings2, Layout, ListTodo, Cpu, Database, Bell, Archive,
  Download, Upload, RotateCcw,
} from 'lucide-react';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import {
  GeneralTab,
  BoardTab,
  TasksTab,
  AgentsTab,
  DataTab,
  NotificationsTab,
  ManageTab,
} from './tabs';
import { SettingsErrorBoundary } from './shared';

// ============ Tab Configuration ============

type TabId = 'general' | 'board' | 'tasks' | 'agents' | 'data' | 'notifications' | 'manage';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const TABS: TabDef[] = [
  { id: 'general',       label: 'General',       icon: Settings2 },
  { id: 'board',         label: 'Board',         icon: Layout },
  { id: 'tasks',         label: 'Tasks',         icon: ListTodo },
  { id: 'agents',        label: 'Agents',        icon: Cpu },
  { id: 'data',          label: 'Data',          icon: Database },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'manage',        label: 'Manage',        icon: Archive },
];

// ============ Settings Dialog Props ============

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ============ Main Settings Dialog ============

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const { settings: currentSettings } = useFeatureSettings();
  const { debouncedUpdate } = useDebouncedFeatureUpdate();
  const settingsFileInputRef = useRef<HTMLInputElement>(null);

  const handleExportSettings = () => {
    const blob = new Blob([JSON.stringify(currentSettings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `veritas-kanban-settings-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportSettings = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!imported || typeof imported !== 'object') {
        alert('Invalid settings file: must be a JSON object');
        return;
      }
      // Validate expected top-level keys
      const validSections = ['board', 'tasks', 'agents', 'telemetry', 'notifications', 'archive'];
      const importedKeys = Object.keys(imported);
      const unknownKeys = importedKeys.filter(k => !validSections.includes(k));
      if (unknownKeys.length > 0) {
        alert(`Warning: Unknown sections will be ignored: ${unknownKeys.join(', ')}`);
      }
      const validPatch: Record<string, any> = {};
      for (const key of importedKeys) {
        if (validSections.includes(key)) {
          validPatch[key] = imported[key];
        }
      }
      if (Object.keys(validPatch).length === 0) {
        alert('No valid settings found in file');
        return;
      }
      if (confirm(`Import ${Object.keys(validPatch).length} setting sections: ${Object.keys(validPatch).join(', ')}?\n\nThis will overwrite current values.`)) {
        debouncedUpdate(validPatch);
        alert('Settings imported successfully!');
      }
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'Invalid JSON'}`);
    } finally {
      if (settingsFileInputRef.current) settingsFileInputRef.current.value = '';
    }
  };

  const handleResetAll = () => {
    debouncedUpdate({ ...DEFAULT_FEATURE_SETTINGS });
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIndex = TABS.findIndex(t => t.id === activeTab);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (currentIndex + 1) % TABS.length;
      setActiveTab(TABS[next].id);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (currentIndex - 1 + TABS.length) % TABS.length;
      setActiveTab(TABS[prev].id);
    }
  }, [activeTab]);

  const renderTab = () => {
    switch (activeTab) {
      case 'general':
        return <SettingsErrorBoundary tabName="General"><GeneralTab /></SettingsErrorBoundary>;
      case 'board':
        return <SettingsErrorBoundary tabName="Board"><BoardTab /></SettingsErrorBoundary>;
      case 'tasks':
        return <SettingsErrorBoundary tabName="Tasks"><TasksTab /></SettingsErrorBoundary>;
      case 'agents':
        return <SettingsErrorBoundary tabName="Agents"><AgentsTab /></SettingsErrorBoundary>;
      case 'data':
        return <SettingsErrorBoundary tabName="Data"><DataTab /></SettingsErrorBoundary>;
      case 'notifications':
        return <SettingsErrorBoundary tabName="Notifications"><NotificationsTab /></SettingsErrorBoundary>;
      case 'manage':
        return <SettingsErrorBoundary tabName="Manage"><ManageTab /></SettingsErrorBoundary>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] h-[85vh] p-0 overflow-hidden">
        <div className="flex h-full min-h-0">
          {/* Sidebar Tabs — hidden on narrow screens, shown as dropdown instead */}
          <div className="hidden sm:flex flex-col w-48 border-r bg-muted/30 py-4">
            <div className="px-4 pb-3">
              <h2 className="text-sm font-semibold">Settings</h2>
            </div>
            <nav
              className="flex-1 space-y-0.5 px-2"
              role="tablist"
              aria-orientation="vertical"
              onKeyDown={handleKeyDown}
            >
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    tabIndex={activeTab === tab.id ? 0 : -1}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left',
                      activeTab === tab.id
                        ? 'bg-background shadow-sm font-medium'
                        : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            {/* Import/Export/Reset */}
            <div className="px-2 pt-3 mt-auto border-t space-y-1">
              <input
                ref={settingsFileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportSettings}
                className="hidden"
              />
              <button
                onClick={handleExportSettings}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-background/50 hover:text-foreground transition-colors text-left"
              >
                <Download className="h-3.5 w-3.5 flex-shrink-0" />
                Export Settings
              </button>
              <button
                onClick={() => settingsFileInputRef.current?.click()}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-background/50 hover:text-foreground transition-colors text-left"
              >
                <Upload className="h-3.5 w-3.5 flex-shrink-0" />
                Import Settings
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs text-red-400 hover:bg-red-500/10 transition-colors text-left"
                  >
                    <RotateCcw className="h-3.5 w-3.5 flex-shrink-0" />
                    Reset All
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will reset ALL feature settings across every section back to their default values. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Reset Everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Mobile Tab Selector */}
          <div className="sm:hidden absolute top-3 right-12">
            <Select value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
              <SelectTrigger className="w-36 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABS.map((tab) => (
                  <SelectItem key={tab.id} value={tab.id}>{tab.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <DialogHeader className="px-6 py-4 border-b sm:hidden">
              <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0">
              <div className="max-w-lg px-6 py-4">
                {renderTab()}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
